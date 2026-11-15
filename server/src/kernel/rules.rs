//! Sự kiện, luật tích hợp, cảnh báo luật lỗi (có thử lại) và tác vụ theo lịch.
use super::{Actor, Kernel, Obj, Opts, Tenant};
use crate::db::Tx;
use crate::defs::{RuleSpec, Sub};
use crate::error::{ApiError, R};
use crate::expr::{Scope, matches, resolve_path, resolve_value};
use async_recursion::async_recursion;
use chrono::Utc;
use rust_decimal::Decimal;
use serde_json::{Value, json};
use tokio_postgres::types::ToSql;
use uuid::Uuid;

pub struct Event {
    pub id: Uuid,
    pub ty: String,
    pub payload: Value,
    pub depth: u32,
    pub causation: Option<Uuid>,
}

enum Outcome {
    Ok,
    Skipped(String),
}

fn clean(v: Value) -> Obj {
    match v {
        Value::Object(o) => o
            .into_iter()
            .filter(|(_, x)| !x.is_null() && x != &json!(""))
            .collect(),
        _ => Obj::new(),
    }
}

fn num(value: Option<&Value>) -> Decimal {
    match value {
        Some(Value::String(text)) => crate::money::decimal_str(text.trim()).unwrap_or_default(),
        Some(value) => crate::money::decimal(value).unwrap_or_default(),
        None => Decimal::ZERO,
    }
}

fn apply_inc(found: &Obj, set: Obj, inc: &Obj) -> R<Obj> {
    let mut patch = set;
    for (k, v) in inc {
        let value = num(found.get(k)).checked_add(num(Some(v))).ok_or_else(|| {
            ApiError::validation(
                "rule.increment",
                vec![format!(
                    "Increment for {k} exceeds the supported Decimal range"
                )],
            )
        })?;
        patch.insert(k.clone(), crate::expr::decimal_value(value));
    }
    Ok(patch)
}

impl Kernel {
    /// Phát sự kiện: chạy mọi luật của module ĐÃ BẬT, mỗi luật trong một savepoint.
    /// Luật lỗi: hoàn tác phần của nó + ghi cảnh báo (trừ khi `required`: hủy cả thao tác gốc).
    #[async_recursion]
    pub(crate) async fn emit(
        &self,
        tx: &Tx<'_>,
        t: &Tenant,
        ty: &str,
        payload: Value,
        opts: &Opts,
    ) -> R<()> {
        if opts.silent {
            return Ok(());
        }
        let depth = opts.depth.unwrap_or(0);
        if depth > self.cfg.max_event_depth {
            return Err(ApiError::new(
                508,
                "EVENT_LOOP",
                format!(
                    "Chuỗi sự kiện quá sâu (>{}) tại {ty}: có thể đang lặp vòng",
                    self.cfg.max_event_depth
                ),
            ));
        }
        let payload = if let Some((entity, _)) = ty
            .strip_prefix("integration-hub.")
            .and_then(|value| value.rsplit_once('.'))
        {
            crate::modules::integration_hub::redact_document(entity, payload)
        } else {
            payload
        };
        let event = Event {
            id: Uuid::new_v4(),
            ty: ty.to_string(),
            payload,
            depth,
            causation: opts.causation,
        };
        let at = Utc::now();
        let mut handled: Vec<Value> = Vec::new();

        for sub in self.reg.subscribers(ty) {
            if !t.has_module(&sub.module) {
                continue;
            }
            let rule = &self.reg.modules[&sub.module].rules[sub.rule_index];
            let sp = tx.savepoint().await?;
            match self.run_rule(tx, t, sub, rule, &event).await {
                Ok(Outcome::Ok) => {
                    tx.release(&sp).await?;
                    handled.push(
                        json!({ "module": sub.module, "rule": sub.rule_index, "outcome": "ok" }),
                    );
                }
                Ok(Outcome::Skipped(why)) => {
                    tx.release(&sp).await?;
                    handled.push(json!({ "module": sub.module, "rule": sub.rule_index, "outcome": "skipped", "detail": why }));
                }
                Err(e) => {
                    tx.rollback_to(&sp).await?;
                    if e.code == "EVENT_LOOP" || rule.required {
                        return Err(e);
                    }
                    self.record_failure(tx, t, &event, sub, &e.message).await?;
                    handled.push(json!({ "module": sub.module, "rule": sub.rule_index, "outcome": "error", "detail": e.message }));
                }
            }
        }

        crate::modules::dispatch_source_events(self, tx, t, &event, &mut handled).await?;

        let record_id = event
            .payload
            .get("id")
            .and_then(|v| v.as_str())
            .map(String::from);
        crate::modules::integration_hub::enqueue_event(
            tx,
            t,
            event.id,
            &event.ty,
            at,
            event.depth,
            event.causation,
            &event.payload,
        )
        .await?;
        tx.execute(
            "INSERT INTO osp_events (tenant_id, id, type, at, depth, record_id, causation_id, handled) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
            &[&t.id, &event.id, &event.ty, &at, &(depth as i32), &record_id, &event.causation, &Value::Array(handled)],
        )
        .await?;
        Ok(())
    }

    async fn record_failure(
        &self,
        tx: &Tx<'_>,
        t: &Tenant,
        event: &Event,
        sub: &Sub,
        error: &str,
    ) -> R<()> {
        let snapshot = json!({ "id": event.id, "type": event.ty, "payload": event.payload, "depth": event.depth, "causationId": event.causation });
        tx.execute(
            "INSERT INTO osp_failures (id, tenant_id, event_id, event_type, module, rule_index, error, event) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
            &[&Uuid::new_v4(), &t.id, &event.id, &event.ty, &sub.module, &(sub.rule_index as i32), &error, &snapshot],
        )
        .await?;
        Ok(())
    }

    async fn run_rule(
        &self,
        tx: &Tx<'_>,
        t: &Tenant,
        sub: &Sub,
        rule: &RuleSpec,
        event: &Event,
    ) -> R<Outcome> {
        let module = &sub.module;
        let mut payload = event.payload.clone();

        // Tra cứu bản ghi liên quan -> $$._lookup.<tên>
        if let Some(lookups) = &rule.lookup {
            let mut found = serde_json::Map::new();
            for (name, spec) in lookups {
                let q = self.reg.qualify(module, &spec.entity);
                if !self.reg.entity(&q).is_some_and(|d| t.has_module(&d.module)) {
                    if rule.required {
                        return Err(ApiError::new(
                            422,
                            "RULE_LOOKUP_MISSING",
                            format!("Module của lookup \"{name}\" chưa được bật"),
                        ));
                    }
                    return Ok(Outcome::Skipped(format!(
                        "module của lookup \"{name}\" chưa bật"
                    )));
                }
                let ent = self.ent(t, &q)?;
                let sc = Scope {
                    this: &event.payload,
                    event: &event.payload,
                };
                let m = match resolve_value(&spec.match_, &sc) {
                    Value::Object(o) => o,
                    _ => Obj::new(),
                };
                match self.find_first(tx, t, &ent, &m).await? {
                    Some(rec) => {
                        found.insert(name.clone(), Value::Object(rec));
                    }
                    None => {
                        if rule.required {
                            return Err(ApiError::new(
                                422,
                                "RULE_LOOKUP_MISSING",
                                format!("Không tìm thấy bản ghi lookup \"{name}\""),
                            ));
                        }
                        return Ok(Outcome::Skipped(format!(
                            "không tìm thấy bản ghi lookup \"{name}\""
                        )));
                    }
                }
            }
            payload["_lookup"] = Value::Object(found);
        }

        let base = Scope {
            this: &payload,
            event: &payload,
        };
        if !matches(rule.when.as_ref(), &base) {
            return Ok(Outcome::Skipped("when không khớp".into()));
        }
        let target = self.reg.qualify(module, &rule.entity);
        let target_module = target.split('.').next().unwrap_or("");
        if !t.has_module(target_module) {
            return Ok(Outcome::Skipped(format!(
                "module đích \"{target_module}\" chưa bật"
            )));
        }
        let ent = self.ent(t, &target)?;

        let items: Vec<Value> = match &rule.for_each {
            Some(p) => match resolve_path(p, &base) {
                Some(Value::Array(a)) => a.clone(),
                Some(_) => return Ok(Outcome::Skipped("forEach không phải mảng".into())),
                None => Vec::new(),
            },
            None => vec![Value::Null],
        };

        let child = Opts {
            depth: Some(event.depth + 1),
            causation: Some(event.id),
            silent: false,
        };
        let mut did = 0;
        let mut note = String::new();
        for item in &items {
            let scope = Scope {
                this: if item.is_null() { &payload } else { item },
                event: &payload,
            };
            if let Some(w) = &rule.where_ {
                if !matches(Some(w), &scope) {
                    continue;
                }
            }
            let resolved = |o: &Option<Value>| -> Obj {
                clean(resolve_value(o.as_ref().unwrap_or(&json!({})), &scope))
            };

            match rule.do_.as_str() {
                "create" => {
                    let rec = self
                        .create_in(tx, &Actor::System, t, &ent, resolved(&rule.map), &child)
                        .await?;
                    if let Some(a) = &rule.then_action {
                        let id = rec["id"].as_str().unwrap_or("");
                        self.act_in(tx, &Actor::System, t, &ent, id, a, &child)
                            .await?;
                    }
                    did += 1;
                }
                "action" | "update" | "upsert" => {
                    let raw_match =
                        match resolve_value(rule.match_.as_ref().unwrap_or(&json!({})), &scope) {
                            Value::Object(o) => o,
                            _ => Obj::new(),
                        };
                    let found = self.find_first(tx, t, &ent, &raw_match).await?;
                    let found_id = found
                        .as_ref()
                        .and_then(|f| f["id"].as_str().map(String::from));
                    match (rule.do_.as_str(), found, found_id) {
                        ("action", Some(_), Some(id)) => {
                            self.act_in(
                                tx,
                                &Actor::System,
                                t,
                                &ent,
                                &id,
                                rule.action.as_deref().unwrap_or(""),
                                &child,
                            )
                            .await?;
                            did += 1;
                        }
                        ("update", Some(f), Some(id)) => {
                            let patch = apply_inc(&f, resolved(&rule.set), &resolved(&rule.inc))?;
                            self.update_in(tx, &Actor::System, t, &ent, &id, patch, &child)
                                .await?;
                            did += 1;
                        }
                        ("upsert", Some(f), Some(id)) => {
                            let patch = apply_inc(&f, resolved(&rule.set), &resolved(&rule.inc))?;
                            self.update_in(tx, &Actor::System, t, &ent, &id, patch, &child)
                                .await?;
                            did += 1;
                        }
                        ("upsert", None, _) => {
                            let mut data = resolved(&rule.map);
                            data.extend(clean(Value::Object(raw_match)));
                            data.extend(resolved(&rule.set));
                            data.extend(resolved(&rule.inc));
                            self.create_in(tx, &Actor::System, t, &ent, data, &child)
                                .await?;
                            did += 1;
                        }
                        (_, None, _) => note = "không tìm thấy bản ghi phù hợp".into(),
                        _ => {}
                    }
                }
                other => return Err(ApiError::internal(format!("do không hợp lệ: {other}"))),
            }
        }
        if did == 0 {
            return Ok(Outcome::Skipped(if note.is_empty() {
                "không có phần tử phù hợp".into()
            } else {
                note
            }));
        }
        Ok(Outcome::Ok)
    }

    // ───────────────────── Nhật ký sự kiện / cảnh báo ─────────────────────

    pub async fn event_log(&self, t: &Tenant, limit: i64) -> R<Value> {
        let mut conn = self.pool.get().await?;
        let tx = Tx::begin(&mut conn, &t.id, false).await?;
        let rows = tx
            .query_json(
                "SELECT jsonb_build_object('id', id, 'type', type, 'at', at, 'depth', depth, 'recordId', record_id, 'causationId', causation_id, 'handled', handled) \
                 FROM (SELECT * FROM osp_events WHERE tenant_id = $1 ORDER BY seq DESC LIMIT $2) s ORDER BY at, depth",
                &[&t.id, &limit.clamp(1, 1000)],
            )
            .await?;
        Ok(Value::Array(rows))
    }

    pub async fn audit_log(&self, actor: &Actor, t: &Tenant, limit: i64) -> R<Value> {
        self.authorize(t, actor, "tenant.audit")?;
        let mut conn = self.pool.get().await?;
        let tx = Tx::begin(&mut conn, &t.id, false).await?;
        let rows = tx
            .query_json(
                "SELECT jsonb_build_object('id', id, 'at', at, 'userId', user_id, 'action', action, 'target', target, 'detail', detail) \
                 FROM osp_audit WHERE tenant_id = $1 ORDER BY seq DESC LIMIT $2",
                &[&t.id, &limit.clamp(1, 1000)],
            )
            .await?;
        Ok(Value::Array(rows))
    }

    pub async fn list_failures(&self, actor: &Actor, t: &Tenant, status: &str) -> R<Value> {
        self.authorize(t, actor, "tenant.admin")?;
        let conn = self.pool.get().await?;
        let rows = conn
            .query(
                "SELECT jsonb_build_object('id', id, 'eventType', event_type, 'module', module, 'rule', rule_index, 'error', error, \
                 'status', status, 'attempts', attempts, 'createdAt', created_at, 'updatedAt', updated_at, 'recordId', event->'payload'->>'id') \
                 FROM osp_failures WHERE tenant_id = $1 AND status = $2 ORDER BY created_at DESC LIMIT 200",
                &[&t.id, &status],
            )
            .await?;
        Ok(Value::Array(
            rows.into_iter().map(|r| r.get::<_, Value>(0)).collect(),
        ))
    }

    pub async fn open_failure_count(&self, t: &Tenant) -> R<i64> {
        let conn = self.pool.get().await?;
        Ok(conn
            .query_one(
                "SELECT count(*) FROM osp_failures WHERE tenant_id = $1 AND status = 'open'",
                &[&t.id],
            )
            .await?
            .get(0))
    }

    pub async fn dismiss_failure(&self, actor: &Actor, t: &Tenant, id: &str) -> R<()> {
        self.authorize(t, actor, "tenant.admin")?;
        let uid =
            Uuid::parse_str(id).map_err(|_| ApiError::not_found("Không tìm thấy cảnh báo"))?;
        let conn = self.pool.get().await?;
        let n = conn.execute("UPDATE osp_failures SET status = 'dismissed', updated_at = now() WHERE id = $1 AND tenant_id = $2 AND status = 'open'", &[&uid, &t.id]).await?;
        if n == 0 {
            Err(ApiError::not_found("Không tìm thấy cảnh báo đang mở"))
        } else {
            Ok(())
        }
    }

    /// Chạy lại một luật đã lỗi (hoặc một tác vụ theo lịch đã lỗi). Thành công -> đóng cảnh báo.
    pub async fn retry_failure(&self, actor: &Actor, t: &Tenant, id: &str) -> R<Value> {
        self.authorize(t, actor, "tenant.admin")?;
        let uid =
            Uuid::parse_str(id).map_err(|_| ApiError::not_found("Không tìm thấy cảnh báo"))?;
        let mut conn = self.pool.get().await?;
        let tx = Tx::begin(&mut conn, &t.id, true).await?;
        let row = tx.query_opt(
            "SELECT module, rule_index, event, status FROM osp_failures WHERE id = $1 AND tenant_id = $2 FOR UPDATE",
            &[&uid, &t.id],
        ).await?.ok_or_else(|| ApiError::not_found("Không tìm thấy cảnh báo"))?;
        let (module, rule_index, event, status): (String, i32, Value, String) =
            (row.get(0), row.get(1), row.get(2), row.get(3));
        if status != "open" {
            return Err(ApiError::new(409, "NOT_OPEN", "Cảnh báo này đã được xử lý"));
        }
        // Keep the retry and its resolved status in one tenant transaction.
        // A savepoint lets failed commands roll back while recording attempts.
        let savepoint = tx.savepoint().await?;
        let outcome = self.rerun(&tx, t, &module, rule_index, &event).await;
        match outcome {
            Ok(()) => {
                tx.release(&savepoint).await?;
                tx.execute("UPDATE osp_failures SET status = 'resolved', attempts = attempts + 1, updated_at = now() WHERE id = $1 AND tenant_id = $2", &[&uid, &t.id]).await?;
                self.audit(
                    &tx,
                    t,
                    actor,
                    "retry_failure",
                    &format!("failure#{uid}"),
                    Some("resolved".into()),
                )
                .await?;
                tx.commit().await?;
                Ok(json!({ "ok": true, "status": "resolved" }))
            }
            Err(e) => {
                tx.rollback_to(&savepoint).await?;
                tx.execute("UPDATE osp_failures SET error = $3, attempts = attempts + 1, updated_at = now() WHERE id = $1 AND tenant_id = $2", &[&uid, &t.id, &e.message]).await?;
                self.audit(
                    &tx,
                    t,
                    actor,
                    "retry_failure",
                    &format!("failure#{uid}"),
                    Some("failed".into()),
                )
                .await?;
                tx.commit().await?;
                Err(ApiError::new(422, "RETRY_FAILED", e.message))
            }
        }
    }

    async fn rerun(
        &self,
        tx: &Tx<'_>,
        t: &Tenant,
        module: &str,
        rule_index: i32,
        ev: &Value,
    ) -> R<()> {
        // Tác vụ theo lịch lỗi: chạy lại hành động trên bản ghi
        if let Some(job) = ev.get("job").and_then(|j| j.as_str()) {
            let q = ev["entity"].as_str().unwrap_or("");
            let ent = self.ent(t, q)?;
            let spec = crate::modules::scheduled_jobs(module)
                .into_iter()
                .find(|spec| spec.id == job)
                .ok_or_else(|| ApiError::not_found("Tác vụ không còn tồn tại"))?;
            self.act_in(
                tx,
                &Actor::System,
                t,
                &ent,
                ev["recordId"].as_str().unwrap_or(""),
                &spec.action,
                &Opts::top(),
            )
            .await?;
            return Ok(());
        }
        let m = self
            .reg
            .modules
            .get(module)
            .ok_or_else(|| ApiError::not_found("Module không còn được cài"))?;
        let rule = m
            .rules
            .get(rule_index as usize)
            .ok_or_else(|| ApiError::not_found("Luật không còn tồn tại"))?;
        if !t.has_module(module) {
            return Err(ApiError::new(
                409,
                "MODULE_NOT_ENABLED",
                format!("Module \"{module}\" chưa được bật"),
            ));
        }
        let event = Event {
            id: Uuid::new_v4(),
            ty: ev["type"].as_str().unwrap_or("").to_string(),
            payload: ev["payload"].clone(),
            depth: ev["depth"].as_u64().unwrap_or(0) as u32,
            causation: None,
        };
        let sub = Sub {
            module: module.to_string(),
            rule_index: rule_index as usize,
        };
        // Lỗi thì savepoint/giao dịch bị hủy; thành công thì giữ lại
        match self.run_rule(tx, t, &sub, rule, &event).await? {
            Outcome::Ok => Ok(()),
            Outcome::Skipped(why) => Err(ApiError::new(
                409,
                "SKIPPED",
                format!("Luật không áp dụng được: {why}"),
            )),
        }
    }

    // ───────────────────── Tác vụ theo lịch ─────────────────────

    /// Chạy mọi tác vụ đến hạn của một tenant. Trả về số bản ghi đã xử lý.
    pub async fn run_jobs(&self, t: &Tenant) -> R<u32> {
        let quote = crate::schema::quote;
        let mut done = 0;
        for id in &t.modules {
            for job in crate::modules::scheduled_jobs(id) {
                let q = self.reg.qualify(id, &job.entity);
                let Ok(ent) = self.ent(t, &q) else { continue };
                let Some(due) = ent.def.field(&job.due.field) else {
                    continue;
                };
                let (now_expr, op) = (
                    if due.ty == "date" {
                        "current_date"
                    } else {
                        "now()"
                    },
                    if job.due.op == "lt" { "<" } else { "<=" },
                );
                let mut params: Vec<Box<dyn ToSql + Sync + Send>> = vec![Box::new(t.id.clone())];
                let mut wh = vec![
                    "e.tenant_id = $1".to_string(),
                    format!("e.{} {op} {now_expr}", quote(&job.due.field)),
                ];
                if let Some(Value::Object(w)) = &job.where_ {
                    for (k, v) in w {
                        params.push(Box::new(
                            v.as_str()
                                .map(String::from)
                                .unwrap_or_else(|| v.to_string()),
                        ));
                        wh.push(format!("e.{}::text = ${}", quote(k), params.len()));
                    }
                }
                params.push(Box::new(job.id.clone()));
                let job_param = params.len();
                params.push(Box::new(id.clone()));
                let module_param = params.len();
                wh.push(format!(
                    "NOT EXISTS (SELECT 1 FROM osp_failures f WHERE f.tenant_id = $1 AND f.module = ${module_param} AND f.event_type = 'job:' || ${job_param} AND f.rule_index = -1 AND f.status = 'open' AND f.event->>'job' = ${job_param} AND f.event->>'recordId' = e.id::text AND f.updated_at > now() - make_interval(secs => LEAST(21600, (60 * power(2, LEAST(GREATEST(f.attempts - 1, 0), 9)))::integer)))"
                ));
                let sql = format!(
                    "SELECT e.id::text FROM {} AS e WHERE {} ORDER BY e.created_at LIMIT 500",
                    quote(&ent.def.table()),
                    wh.join(" AND ")
                );
                let ids: Vec<String> = {
                    let mut conn = self.pool.get().await?;
                    let tx = Tx::begin(&mut conn, &t.id, false).await?;
                    let refs: Vec<&(dyn ToSql + Sync)> = params
                        .iter()
                        .map(|b| b.as_ref() as &(dyn ToSql + Sync))
                        .collect();
                    tx.query(&sql, &refs)
                        .await?
                        .into_iter()
                        .map(|r| r.get(0))
                        .collect()
                };
                for rid in ids {
                    let res = {
                        let mut conn = self.pool.get().await?;
                        let tx = Tx::begin(&mut conn, &t.id, true).await?;
                        let Some(record_id) = Uuid::parse_str(&rid).ok() else {
                            continue;
                        };
                        let mut lock_params: Vec<Box<dyn ToSql + Sync + Send>> =
                            vec![Box::new(t.id.clone()), Box::new(record_id)];
                        let mut lock_wh = vec![
                            "e.tenant_id = $1".to_string(),
                            "e.id = $2".to_string(),
                            format!("e.{} {op} {now_expr}", quote(&job.due.field)),
                        ];
                        if let Some(Value::Object(w)) = &job.where_ {
                            for (k, v) in w {
                                lock_params.push(Box::new(
                                    v.as_str()
                                        .map(String::from)
                                        .unwrap_or_else(|| v.to_string()),
                                ));
                                lock_wh.push(format!(
                                    "{}::text = ${}",
                                    quote(k),
                                    lock_params.len()
                                ));
                            }
                        }
                        lock_params.push(Box::new(job.id.clone()));
                        let job_param = lock_params.len();
                        lock_params.push(Box::new(id.clone()));
                        let module_param = lock_params.len();
                        lock_wh.push(format!(
                            "NOT EXISTS (SELECT 1 FROM osp_failures f WHERE f.tenant_id = $1 AND f.module = ${module_param} AND f.event_type = 'job:' || ${job_param} AND f.rule_index = -1 AND f.status = 'open' AND f.event->>'job' = ${job_param} AND f.event->>'recordId' = e.id::text AND f.updated_at > now() - make_interval(secs => LEAST(21600, (60 * power(2, LEAST(GREATEST(f.attempts - 1, 0), 9)))::integer)))"
                        ));
                        let lock_sql = format!(
                            "SELECT e.id FROM {} AS e WHERE {} FOR UPDATE",
                            quote(&ent.def.table()),
                            lock_wh.join(" AND ")
                        );
                        let lock_refs: Vec<&(dyn ToSql + Sync)> = lock_params
                            .iter()
                            .map(|b| b.as_ref() as &(dyn ToSql + Sync))
                            .collect();
                        if tx.query_opt(&lock_sql, &lock_refs).await?.is_none() {
                            tx.commit().await?;
                            continue;
                        }
                        let r = self
                            .act_in(
                                &tx,
                                &Actor::System,
                                t,
                                &ent,
                                &rid,
                                &job.action,
                                &Opts::top(),
                            )
                            .await;
                        match r {
                            Ok(_) => {
                                tx.execute(
                                    "UPDATE osp_failures SET status = 'resolved', attempts = attempts + 1, updated_at = now() WHERE tenant_id = $1 AND event_type = $2 AND module = $3 AND rule_index = -1 AND event->>'job' = $4 AND event->>'recordId' = $5 AND status = 'open'",
                                    &[&t.id, &format!("job:{}", job.id), &id, &job.id, &rid],
                                ).await?;
                                tx.commit().await.map(|_| ())
                            }
                            Err(e) => Err(e),
                        }
                    };
                    match res {
                        Ok(()) => done += 1,
                        Err(e) => {
                            let mut conn = self.pool.get().await?;
                            let tx = Tx::begin(&mut conn, &t.id, true).await?;
                            let snap = json!({ "job": job.id, "entity": q, "recordId": rid, "type": format!("job:{}", job.id) });
                            let lock_key =
                                format!("scheduled-job-failure:{}:{}:{}", t.id, job.id, rid);
                            tx.query_opt(
                                "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
                                &[&lock_key],
                            )
                            .await?;
                            let changed = tx.execute(
                                "UPDATE osp_failures SET error = $6, attempts = attempts + 1, updated_at = now() WHERE tenant_id = $1 AND event_type = $2 AND module = $3 AND rule_index = -1 AND event->>'job' = $4 AND event->>'recordId' = $5 AND status = 'open'",
                                &[&t.id, &format!("job:{}", job.id), &id, &job.id, &rid, &e.message],
                            ).await?;
                            if changed == 0 {
                                tx.execute(
                                    "INSERT INTO osp_failures (id, tenant_id, event_type, module, rule_index, error, event) VALUES ($1, $2, $3, $4, -1, $5, $6)",
                                    &[&Uuid::new_v4(), &t.id, &format!("job:{}", job.id), id, &e.message, &snap],
                                ).await?;
                            }
                            tx.commit().await?;
                        }
                    }
                }
            }
        }
        Ok(done)
    }

    pub async fn run_jobs_all(&self) -> R<u32> {
        let ids: Vec<String> = {
            let conn = self.pool.get().await?;
            conn.query("SELECT id FROM osp_tenants WHERE NOT suspended", &[])
                .await?
                .into_iter()
                .map(|r| r.get(0))
                .collect()
        };
        let mut total = 0;
        for id in ids {
            if let Ok(t) = self.tenant(&id).await {
                total += self.run_jobs(&t).await.unwrap_or(0);
            }
        }
        Ok(total)
    }
}
