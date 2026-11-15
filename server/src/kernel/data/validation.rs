use super::shared::*;

impl Kernel {
    // ───────────────────── Kiểm tra dữ liệu ─────────────────────

    async fn ref_exists(&self, tx: &Tx<'_>, t: &Tenant, ref_q: &str, id: &str) -> R<bool> {
        let Ok(uid) = Uuid::parse_str(id) else {
            return Ok(false);
        };
        let Some(def) = self.reg.entity(ref_q) else {
            return Ok(false);
        };
        if !t.has_module(&def.module) {
            return Ok(false);
        }
        let sql = format!(
            "SELECT 1 FROM {} WHERE tenant_id = $1 AND id = $2",
            crate::schema::quote(&def.table())
        );
        Ok(tx.query_opt(&sql, &[&t.id, &uid]).await?.is_some())
    }

    pub(super) async fn validate(
        &self,
        tx: &Tx<'_>,
        t: &Tenant,
        ent: &Ent,
        data: &Obj,
        create: bool,
    ) -> R<Vec<String>> {
        let mut errors = Vec::new();
        let state_field = ent.state_field();
        for (key, value) in data {
            if ["id", "createdAt", "updatedAt", "tenant_id", "custom"].contains(&key.as_str()) {
                errors.push(format!("Trường hệ thống \"{key}\" không được ghi"));
                continue;
            }
            let Some(f) = ent.field(key) else {
                errors.push(format!("Trường không tồn tại: {key}"));
                continue;
            };
            if Some(key.as_str()) == state_field {
                errors.push(format!("Trường trạng thái \"{key}\" chỉ đổi qua action"));
                continue;
            }
            if value.is_null() {
                continue;
            }
            match f.ty.as_str() {
                "string" | "text" => {
                    if !value.is_string() {
                        errors.push(format!("{key} phải là chuỗi"));
                    }
                }
                "number" | "money" => {
                    if money::decimal(value).is_none() {
                        errors.push(format!("{key} phải là số"));
                    }
                }
                "bool" => {
                    if !value.is_boolean() {
                        errors.push(format!("{key} phải là true/false"));
                    }
                }
                "date" => {
                    let ok = value.as_str().is_some_and(|s| {
                        s.len() == 10 && chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").is_ok()
                    });
                    if !ok {
                        errors.push(format!("{key} phải dạng YYYY-MM-DD"));
                    }
                }
                "datetime" => {
                    if !value
                        .as_str()
                        .is_some_and(|s| DateTime::parse_from_rfc3339(s).is_ok())
                    {
                        errors.push(format!("{key} phải là thời gian ISO"));
                    }
                }
                "enum" => {
                    let ok = value.as_str().is_some_and(|s| {
                        f.options.as_ref().is_some_and(|o| o.iter().any(|x| x == s))
                    });
                    if !ok {
                        errors.push(format!(
                            "{key} phải thuộc: {}",
                            f.options.clone().unwrap_or_default().join("|")
                        ));
                    }
                }
                "ref" => match value.as_str() {
                    None => errors.push(format!("{key} phải là id")),
                    Some(id) => {
                        if !self
                            .ref_exists(tx, t, f.reference.as_deref().unwrap_or(""), id)
                            .await?
                        {
                            errors.push(format!(
                                "{key}: không tìm thấy {} id={id}",
                                f.reference.as_deref().unwrap_or("")
                            ));
                        }
                    }
                },
                _ => {}
            }
        }
        for f in ent.fields() {
            let v = data.get(&f.name);
            let missing = v.is_none_or(|x| x.is_null() || x == &json!(""));
            if create {
                if f.required && missing && Some(f.name.as_str()) != state_field {
                    errors.push(format!("Thiếu trường bắt buộc: {}", f.name));
                }
            } else if f.required && v.is_some() && missing {
                errors.push(format!("Không được để trống: {}", f.name));
            }
        }
        Ok(errors)
    }

    pub(super) fn apply_computed(&self, ent: &Ent, rec: &mut Obj) {
        for (field, expr) in &ent.def.computed {
            let this = Value::Object(rec.clone());
            if let Some(v) = eval_expr_decimal(
                expr,
                &Scope {
                    this: &this,
                    event: &this,
                },
            ) {
                rec.insert(field.clone(), decimal_value(v));
            }
        }
    }

    // ───────────────────── Ràng buộc nghiệp vụ ─────────────────────

    async fn format_message(
        &self,
        tx: &Tx<'_>,
        t: &Tenant,
        ent: &Ent,
        rec: &Obj,
        msg: &str,
    ) -> R<String> {
        let mut out = msg.to_string();
        for f in ent.fields() {
            let plain = format!("{{{}}}", f.name);
            let label = format!("{{{}:label}}", f.name);
            if out.contains(&label) {
                let mut text = String::from("?");
                if let (Some(rq), Some(id)) = (
                    f.reference.as_deref(),
                    rec.get(&f.name).and_then(|v| v.as_str()),
                ) {
                    if let (Some(def), Ok(uid)) = (self.reg.entity(rq), Uuid::parse_str(id)) {
                        let sql = format!(
                            "SELECT to_jsonb(r) FROM {} r WHERE tenant_id = $1 AND id = $2",
                            crate::schema::quote(&def.table())
                        );
                        if let Some(row) = tx.query_opt(&sql, &[&t.id, &uid]).await? {
                            let v: Value = row.get(0);
                            text = ["name", "title", "sku", "code", "number"]
                                .iter()
                                .find_map(|k| v.get(k).and_then(|x| x.as_str()))
                                .unwrap_or("?")
                                .to_string();
                        }
                    }
                }
                out = out.replace(&label, &text);
            }
            if out.contains(&plain) {
                let val = match rec.get(&f.name) {
                    Some(Value::String(s)) => s.clone(),
                    Some(Value::Number(n)) => n.to_string(),
                    _ => String::new(),
                };
                out = out.replace(&plain, &val);
            }
        }
        Ok(out)
    }

    pub(super) async fn check_constraints(
        &self,
        tx: &Tx<'_>,
        t: &Tenant,
        ent: &Ent,
        rec: &Obj,
    ) -> R<()> {
        for c in &ent.def.constraints {
            match c {
                Constraint::Min {
                    field,
                    value,
                    message,
                    unless_setting,
                } => {
                    if unless_setting.as_deref().is_some_and(|s| t.setting_bool(s)) {
                        continue;
                    }
                    if rec
                        .get(field)
                        .and_then(money::decimal)
                        .is_some_and(|x| x < *value)
                    {
                        let m = self.format_message(tx, t, ent, rec, message).await?;
                        return Err(ApiError::new(422, "CONSTRAINT", m));
                    }
                }
                Constraint::NoOverlap {
                    scope,
                    start,
                    end,
                    ignore_states,
                    message,
                } => {
                    let (Some(sv), Some(s), Some(e)) = (
                        rec.get(scope).and_then(|v| v.as_str()),
                        rec.get(start).and_then(|v| v.as_str()),
                        rec.get(end).and_then(|v| v.as_str()),
                    ) else {
                        continue;
                    };
                    let (Ok(sdt), Ok(edt)) = (
                        DateTime::parse_from_rfc3339(s),
                        DateTime::parse_from_rfc3339(e),
                    ) else {
                        continue;
                    };
                    let q = crate::schema::quote;
                    let st_col = ent.state_field().map(q).unwrap_or_else(|| "NULL".into());
                    let id_s = rec
                        .get("id")
                        .and_then(|v| v.as_str())
                        .and_then(|s| Uuid::parse_str(s).ok())
                        .unwrap_or(Uuid::nil());
                    let sql = format!(
                        "SELECT 1 FROM {tbl} WHERE tenant_id = $1 AND {sc}::text = $2 AND id <> $3 AND ({st} IS NULL OR NOT ({st} = ANY($4))) AND {sa} < $5 AND {ea} > $6 LIMIT 1",
                        tbl = q(&ent.def.table()),
                        sc = q(scope),
                        st = st_col,
                        sa = q(start),
                        ea = q(end)
                    );
                    let (sdt, edt) = (sdt.with_timezone(&Utc), edt.with_timezone(&Utc));
                    if tx
                        .query_opt(&sql, &[&t.id, &sv, &id_s, ignore_states, &edt, &sdt])
                        .await?
                        .is_some()
                    {
                        return Err(ApiError::new(409, "CONSTRAINT", message.clone()));
                    }
                }
                Constraint::NoDateOverlap {
                    scope,
                    start,
                    end,
                    ignore_states,
                    message,
                } => {
                    let (Some(sv), Some(s), Some(e)) = (
                        rec.get(scope).and_then(|v| v.as_str()),
                        rec.get(start).and_then(|v| v.as_str()),
                        rec.get(end).and_then(|v| v.as_str()),
                    ) else {
                        continue;
                    };
                    let (Ok(start_date), Ok(end_date)) = (
                        NaiveDate::parse_from_str(s, "%Y-%m-%d"),
                        NaiveDate::parse_from_str(e, "%Y-%m-%d"),
                    ) else {
                        continue;
                    };
                    let q = crate::schema::quote;
                    let state_col = ent.state_field().map(q).unwrap_or_else(|| "NULL".into());
                    let id = rec
                        .get("id")
                        .and_then(|v| v.as_str())
                        .and_then(|s| Uuid::parse_str(s).ok())
                        .unwrap_or(Uuid::nil());
                    let sql = format!(
                        "SELECT 1 FROM {table} WHERE tenant_id = $1 AND {scope}::text = $2 AND id <> $3 AND ({state} IS NULL OR NOT ({state} = ANY($4))) AND {start} <= $5 AND {end} >= $6 LIMIT 1",
                        table = q(&ent.def.table()),
                        scope = q(scope),
                        state = state_col,
                        start = q(start),
                        end = q(end),
                    );
                    if tx
                        .query_opt(
                            &sql,
                            &[&t.id, &sv, &id, ignore_states, &end_date, &start_date],
                        )
                        .await?
                        .is_some()
                    {
                        return Err(ApiError::new(409, "CONSTRAINT", message.clone()));
                    }
                }
            }
        }
        Ok(())
    }
}
