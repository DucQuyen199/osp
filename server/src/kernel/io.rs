//! Xuất/nhập dữ liệu (quyền di chuyển dữ liệu): JSON toàn tenant, CSV từng entity, nhập tất-cả-hoặc-không.
use super::data::ListQuery;
use super::{Actor, Ent, Kernel, Obj, Opts, Tenant};
use crate::db::Tx;
use crate::defs::FieldDef;
use crate::error::{ApiError, R};
use serde_json::{Value, json};
use sha2::Digest;

/// Chống CSV/formula injection khi mở bằng Excel: ô chuỗi bắt đầu bằng = + - @ thêm dấu nháy đơn.
fn safe_cell(v: Option<&Value>, f: Option<&FieldDef>) -> String {
    let mut s = match v {
        None | Some(Value::Null) => return String::new(),
        Some(Value::String(s)) => s.clone(),
        Some(other) => other.to_string(),
    };
    let textual = f.is_none_or(|f| ["string", "text", "json"].contains(&f.ty.as_str()));
    if textual && s.starts_with(['=', '+', '-', '@', '\t', '\r']) {
        s.insert(0, '\'');
    }
    if s.contains(['"', ',', '\n', '\r']) {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s
    }
}

fn safe_report_cell(v: Option<&Value>) -> String {
    let Some(value) = v.filter(|value| !value.is_null()) else {
        return String::new();
    };
    let mut cell = match value {
        Value::String(text) => {
            let mut text = text.clone();
            if text.starts_with(['=', '+', '-', '@', '\t', '\r']) {
                text.insert(0, '\'');
            }
            text
        }
        other => other.to_string(),
    };
    if cell.contains(['"', ',', '\n', '\r']) {
        cell = format!("\"{}\"", cell.replace('"', "\"\""));
    }
    cell
}

/// Serialize aggregate report rows with formula-injection protection for text values.
pub fn report_rows_to_csv(headers: &[&str], rows: &[Value]) -> String {
    let mut out = String::from('\u{FEFF}');
    out.push_str(&headers.join(","));
    out.push_str("\r\n");
    for row in rows {
        let cells = headers
            .iter()
            .map(|header| safe_report_cell(row.get(*header)))
            .collect::<Vec<_>>();
        out.push_str(&cells.join(","));
        out.push_str("\r\n");
    }
    out
}

pub fn to_csv(fields: &[&FieldDef], rows: &[Value]) -> String {
    let mut out = String::from('\u{FEFF}');
    let mut head = vec!["id".to_string()];
    head.extend(fields.iter().map(|f| f.name.clone()));
    head.push("createdAt".into());
    out.push_str(&head.join(","));
    out.push_str("\r\n");
    for r in rows {
        let mut cells = vec![safe_cell(r.get("id"), None)];
        cells.extend(fields.iter().map(|f| safe_cell(r.get(&f.name), Some(f))));
        cells.push(safe_cell(r.get("createdAt"), None));
        out.push_str(&cells.join(","));
        out.push_str("\r\n");
    }
    out
}

/// Ép giá trị chuỗi từ CSV về đúng kiểu trường.
fn coerce_row(ent: &Ent, raw: &[(String, String)]) -> Result<Obj, String> {
    let mut out = Obj::new();
    for (k, v) in raw {
        if v.is_empty() || ["id", "createdAt", "updatedAt"].contains(&k.as_str()) {
            continue;
        }
        let s = if v.starts_with('\'') && v.len() > 1 && "=+-@".contains(&v[1..2]) {
            &v[1..]
        } else {
            v.as_str()
        };
        let Some(f) = ent.field(k) else {
            out.insert(k.clone(), json!(s)); // để kiểm tra dữ liệu báo "trường không tồn tại"
            continue;
        };
        let val = match f.ty.as_str() {
            "number" | "money" => crate::money::json_number(
                crate::money::decimal_str(&s.replace(' ', ""))
                    .ok_or_else(|| format!("{k}: \"{v}\" không phải số"))?,
            )
            .ok_or_else(|| format!("{k}: \"{v}\" vượt giới hạn Decimal"))?,
            "bool" => match s.trim().to_lowercase().as_str() {
                "true" | "1" | "có" | "co" | "yes" | "x" => json!(true),
                "false" | "0" | "không" | "khong" | "no" => json!(false),
                _ => return Err(format!("{k}: \"{v}\" không phải true/false")),
            },
            "json" => {
                serde_json::from_str(s).map_err(|_| format!("{k}: không phải JSON hợp lệ"))?
            }
            _ => json!(s),
        };
        out.insert(k.clone(), val);
    }
    Ok(out)
}

impl Kernel {
    /// Xuất toàn bộ dữ liệu tenant. Không bao gồm mật khẩu/token.
    pub async fn export_tenant(&self, actor: &Actor, t: &Tenant) -> R<Value> {
        self.authorize(t, actor, "tenant.export")?;
        let mut conn = self.pool.get().await?;
        let tx = Tx::begin(&mut conn, &t.id, false).await?;
        let mut data = serde_json::Map::new();
        for mid in &t.modules {
            let Some(m) = self.reg.modules.get(mid) else {
                continue;
            };
            for e in &m.entities {
                let q = format!("{mid}.{}", e.name);
                let ent = self.ent(t, &q)?;
                let (rows, _) = self
                    .query_rows(
                        &tx,
                        t,
                        &ent,
                        &ListQuery {
                            filter: vec![],
                            limit: 1000,
                            offset: 0,
                            q: None,
                            sort: None,
                            desc: false,
                        },
                    )
                    .await?;
                let mut all = rows;
                let mut offset = 1000;
                while all.len() as i64 == offset {
                    let (more, _) = self
                        .query_rows(
                            &tx,
                            t,
                            &ent,
                            &ListQuery {
                                filter: vec![],
                                limit: 1000,
                                offset,
                                q: None,
                                sort: None,
                                desc: false,
                            },
                        )
                        .await?;
                    if more.is_empty() {
                        break;
                    }
                    all.extend(more);
                    offset += 1000;
                }
                if !all.is_empty() {
                    data.insert(q, Value::Array(all));
                }
            }
        }
        drop(tx);
        drop(conn);
        let users: Vec<Value> = self.list_users(t).await?.into_iter().map(|u| json!({ "id": u.id, "name": u.name, "email": u.email, "roles": u.roles, "disabled": u.disabled })).collect();
        self.audit_raw_ro(t, actor, "export", "tenant").await?;
        Ok(json!({
            "format": "osp-export/1",
            "exportedAt": chrono::Utc::now().to_rfc3339(),
            "tenant": { "id": t.id, "name": t.name, "vertical": t.vertical, "modules": t.modules, "terminology": t.terminology, "roles": t.roles, "extensions": t.extensions, "settings": t.settings, "users": users },
            "data": data,
        }))
    }

    pub(crate) async fn audit_raw_ro(
        &self,
        t: &Tenant,
        actor: &Actor,
        action: &str,
        target: &str,
    ) -> R<()> {
        let mut conn = self.pool.get().await?;
        let tx = Tx::begin(&mut conn, &t.id, true).await?;
        self.audit_raw(&tx, &t.id, actor.user_id(), action, Some(target), None)
            .await?;
        tx.commit().await?;
        Ok(())
    }

    pub async fn export_csv(&self, actor: &Actor, t: &Tenant, qname: &str) -> R<String> {
        let ent = self.ent(t, qname)?;
        self.authorize(t, actor, &format!("{qname}.read"))?;
        self.authorize(t, actor, "tenant.export")?;
        let mut conn = self.pool.get().await?;
        let tx = Tx::begin(&mut conn, &t.id, false).await?;
        let mut rows = Vec::new();
        let mut offset = 0;
        loop {
            let (chunk, _) = self
                .query_rows(
                    &tx,
                    t,
                    &ent,
                    &ListQuery {
                        filter: vec![],
                        limit: 1000,
                        offset,
                        q: None,
                        sort: None,
                        desc: false,
                    },
                )
                .await?;
            let n = chunk.len();
            rows.extend(chunk);
            if n < 1000 {
                break;
            }
            offset += 1000;
        }
        drop(tx);
        drop(conn);
        self.audit_raw_ro(t, actor, "export", qname).await?;
        let fields: Vec<&FieldDef> = ent.fields().collect();
        Ok(to_csv(&fields, &rows))
    }

    /// Nhập hàng loạt (JSON mảng hoặc CSV). Tất-cả-hoặc-không: có lỗi ở bất kỳ dòng nào thì không ghi gì.
    pub async fn import_records(
        &self,
        actor: &Actor,
        t: &Tenant,
        qname: &str,
        rows_in: ImportInput,
        fire_events: bool,
        idempotency_key: Option<&str>,
    ) -> R<Value> {
        let ent = self.ent(t, qname)?;
        self.authorize(t, actor, "tenant.import")?;
        self.authorize(t, actor, &format!("{qname}.create"))?;
        if qname == "construction.material_request" {
            self.authorize(t, actor, "purchasing.purchase_requisition.create")?;
            if !fire_events {
                return Err(ApiError::validation(
                    qname,
                    vec!["Importing material requests requires source events so the linked purchase requisition is created atomically".into()],
                ));
            }
        }
        let canonical = match &rows_in {
            ImportInput::Rows(rows) => serde_json::to_vec(&(qname, fire_events, "rows", rows)),
            ImportInput::Csv(csv) => serde_json::to_vec(&(qname, fire_events, "csv", csv)),
        }
        .map_err(|error| ApiError::internal(error.to_string()))?;
        let request_hash = hex::encode(sha2::Sha256::digest(canonical));
        let mut errors: Vec<(usize, String)> = Vec::new();
        let rows: Vec<Obj> = match rows_in {
            ImportInput::Rows(r) => r,
            ImportInput::Csv(text) => {
                let text = text.trim_start_matches('\u{FEFF}');
                let mut rdr = csv::ReaderBuilder::new()
                    .flexible(true)
                    .from_reader(text.as_bytes());
                let header: Vec<String> = rdr
                    .headers()
                    .map_err(|e| ApiError::new(400, "BAD_CSV", e.to_string()))?
                    .iter()
                    .map(|h| h.trim().to_string())
                    .collect();
                let mut out = Vec::new();
                for (i, rec) in rdr.records().enumerate() {
                    let rec = rec.map_err(|e| ApiError::new(400, "BAD_CSV", e.to_string()))?;
                    let raw: Vec<(String, String)> = header
                        .iter()
                        .enumerate()
                        .map(|(j, h)| (h.clone(), rec.get(j).unwrap_or("").to_string()))
                        .collect();
                    if raw.iter().all(|(_, v)| v.is_empty()) {
                        continue;
                    }
                    match coerce_row(&ent, &raw) {
                        Ok(o) => out.push(o),
                        Err(e) => {
                            errors.push((i + 1, e));
                            out.push(Obj::new());
                        }
                    }
                }
                out
            }
        };
        if rows.len() > 5000 {
            return Err(ApiError::new(
                413,
                "TOO_MANY_ROWS",
                "Tối đa 5000 dòng mỗi lần nhập",
            ));
        }
        let mut conn = self.pool.get().await?;
        let tx = Tx::begin(&mut conn, &t.id, true).await?;
        let actor_id = actor.user_id().to_owned();
        let entity = format!("import:{qname}");
        if let Some(key) = idempotency_key {
            tx.execute(
                "DELETE FROM osp_idempotency_keys WHERE tenant_id = $1 AND created_at < now() - interval '30 days'",
                &[&t.id],
            )
            .await?;
            let key_lock = format!("idempotency:{}:{}:{}:{}", t.id, actor_id, entity, key);
            tx.query_opt(
                "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
                &[&key_lock],
            )
            .await?;
            if let Some(row) = tx
                .query_opt(
                    "SELECT request_hash, response FROM osp_idempotency_keys WHERE tenant_id = $1 AND actor_id = $2 AND entity = $3 AND idempotency_key = $4",
                    &[&t.id, &actor_id, &entity, &key],
                )
                .await?
            {
                let saved_hash: String = row.get(0);
                if saved_hash != request_hash {
                    return Err(ApiError::new(
                        409,
                        "IDEMPOTENCY_KEY_REUSED",
                        "Idempotency-Key đã được dùng với nội dung yêu cầu khác",
                    ));
                }
                tx.commit().await?;
                return Ok(row.get(1));
            }
        }
        let opts = Opts {
            depth: Some(0),
            causation: None,
            silent: !fire_events,
        };
        for (i, row) in rows.iter().enumerate() {
            if errors.iter().any(|(r, _)| *r == i + 1) {
                continue;
            }
            let sp = tx.savepoint().await?;
            match self
                .create_in(&tx, &Actor::System, t, &ent, row.clone(), &opts)
                .await
            {
                Ok(_) => tx.release(&sp).await?,
                Err(e) => {
                    tx.rollback_to(&sp).await?;
                    errors.push((i + 1, e.message));
                }
            }
        }
        if !errors.is_empty() {
            errors.sort_by_key(|e| e.0);
            let list: Vec<Value> = errors
                .iter()
                .map(|(r, m)| json!({ "row": r, "message": m }))
                .collect();
            return Ok(json!({ "imported": 0, "errors": list }));
        }
        self.audit_raw(
            &tx,
            &t.id,
            actor.user_id(),
            "import",
            Some(qname),
            Some(format!("{} dòng", rows.len())),
        )
        .await?;
        let result = json!({ "imported": rows.len(), "errors": [] });
        if let Some(key) = idempotency_key {
            tx.execute(
                "INSERT INTO osp_idempotency_keys (tenant_id, actor_id, entity, idempotency_key, request_hash, response) VALUES ($1, $2, $3, $4, $5, $6)",
                &[&t.id, &actor_id, &entity, &key, &request_hash, &result],
            )
            .await?;
        }
        tx.commit().await?;
        Ok(result)
    }
}

pub enum ImportInput {
    Rows(Vec<Obj>),
    Csv(String),
}
