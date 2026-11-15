//! Doanh nghiệp (tenant): tạo theo gói ngành, bật/tắt module, trường mở rộng, cài đặt, xóa.
use super::{Actor, Kernel, Tenant, base_roles};
use crate::db::Tx;
use crate::defs::{FieldDef, parse_field};
use crate::error::{ApiError, R};
use serde_json::{Value, json};
use std::collections::BTreeMap;
use std::sync::Arc;
use uuid::Uuid;

pub struct AdminInput {
    pub name: Option<String>,
    pub email: Option<String>,
    pub password: Option<String>,
}

pub struct CreateTenant {
    pub name: String,
    pub vertical: Option<String>,
    pub modules: Vec<String>,
    pub admin: Option<AdminInput>,
    pub require_email_verification: bool,
}

impl Kernel {
    pub async fn create_tenant(
        &self,
        input: CreateTenant,
    ) -> R<(Arc<Tenant>, String, Vec<String>)> {
        let mut warnings = Vec::new();
        let vertical = match &input.vertical {
            Some(v) => Some(self.verticals.get(v).cloned().ok_or_else(|| {
                ApiError::new(
                    404,
                    "VERTICAL_NOT_FOUND",
                    format!("Không có gói ngành \"{v}\""),
                )
            })?),
            None => None,
        };
        if let Some(p) = input.admin.as_ref().and_then(|a| a.password.as_deref()) {
            super::auth::check_password(p)?;
        }

        let mut wanted: Vec<String> = vertical
            .as_ref()
            .map(|v| v.modules.clone())
            .unwrap_or_default();
        wanted.extend(input.modules.iter().cloned());
        let installed: Vec<String> = wanted
            .into_iter()
            .filter(|id| {
                let ok = self.reg.modules.contains_key(id);
                if !ok {
                    warnings.push(format!(
                        "Module \"{id}\" chưa được cài trong hệ thống này, bỏ qua"
                    ));
                }
                ok
            })
            .collect();
        let modules = self
            .reg
            .closure(&installed)
            .map_err(|e| ApiError::new(404, "MODULE_NOT_FOUND", e))?;

        let mut roles = base_roles();
        if let Some(v) = &vertical {
            roles.extend(v.roles.clone());
        }
        let mut extensions: BTreeMap<String, Vec<FieldDef>> = BTreeMap::new();
        if let Some(v) = &vertical {
            for (q, fields) in &v.custom_fields {
                let enabled = self
                    .reg
                    .entity(q)
                    .is_some_and(|d| modules.contains(&d.module));
                if enabled {
                    extensions.insert(q.clone(), fields.clone());
                } else {
                    warnings.push(format!("Bỏ qua trường mở rộng cho {q} (module chưa bật)"));
                }
            }
        }
        let id = format!("t_{}", &Uuid::new_v4().simple().to_string()[..8]);
        let tenant = Tenant {
            id: id.clone(),
            name: input.name.clone(),
            vertical: vertical.as_ref().map(|v| v.id.clone()),
            plan_id: None,
            suspended: false,
            modules: modules.clone(),
            terminology: vertical
                .as_ref()
                .map(|v| v.terminology.clone())
                .unwrap_or_default(),
            settings: json!({ "allowNegativeStock": false, "inventoryCostMethod": "moving_average", "baseCurrency": "VND", "enforceBudgetControl": false, "businessTimezone": "UTC" }),
            extensions,
            roles: roles.clone(),
            created_at: String::new(),
        };

        let mut conn = self.pool.get().await?;
        let tx = Tx::begin(&mut conn, &id, true).await?;
        tx.execute(
            "INSERT INTO osp_tenants (id, name, vertical, modules, terminology, settings, extensions) VALUES ($1, $2, $3, $4, $5, $6, $7)",
            &[&id, &tenant.name, &tenant.vertical, &tenant.modules, &json!(tenant.terminology), &tenant.settings, &json!(tenant.extensions)],
        )
        .await?;
        for (rid, r) in &roles {
            tx.execute(
                "INSERT INTO osp_roles (tenant_id, id, name, permissions) VALUES ($1, $2, $3, $4)",
                &[&id, rid, &r.name, &r.permissions],
            )
            .await?;
        }
        let admin = input.admin.as_ref();
        if input.require_email_verification {
            let email = admin
                .and_then(|a| a.email.as_deref())
                .map(str::trim)
                .filter(|e| !e.is_empty());
            let password = admin.and_then(|a| a.password.as_deref());
            if email.is_none() || password.is_none() {
                return Err(ApiError::new(
                    422,
                    "SIGNUP_CREDENTIALS_REQUIRED",
                    "Tạo doanh nghiệp cần email và mật khẩu quản trị",
                ));
            }
            let origin = std::env::var("OSP_PUBLIC_URL").unwrap_or_default();
            let origin = origin.trim().trim_end_matches('/');
            let local_http = origin.starts_with("http://localhost")
                || origin.starts_with("http://127.0.0.1")
                || origin.starts_with("http://[::1]");
            if origin.is_empty() || (!origin.starts_with("https://") && !local_http) {
                return Err(ApiError::new(
                    503,
                    "EMAIL_VERIFICATION_UNAVAILABLE",
                    "Máy chủ chưa cấu hình OSP_PUBLIC_URL để xác minh email",
                ));
            }
        }
        let user = self
            .insert_user(
                &tx,
                &id,
                admin.and_then(|a| a.name.as_deref()).unwrap_or("Admin"),
                admin.and_then(|a| a.email.as_deref()),
                admin.and_then(|a| a.password.as_deref()),
                &["admin".to_string()],
                &roles,
            )
            .await?;
        if input.require_email_verification {
            tx.execute(
                "UPDATE osp_users SET email_verified = false WHERE tenant_id = $1 AND id = $2",
                &[&id, &user.id],
            )
            .await?;
            let (token, _, _) = self
                .insert_token(
                    &tx,
                    &id,
                    &user.id,
                    "verify_email",
                    Some("email verification"),
                    Some(std::time::Duration::from_secs(24 * 60 * 60)),
                    None,
                )
                .await?;
            let recipient = user.email.as_deref().unwrap_or_default();
            let origin = std::env::var("OSP_PUBLIC_URL").unwrap_or_default();
            let verify_url = format!(
                "{}/#/verify-email/{}",
                origin.trim().trim_end_matches('/'),
                token
            );
            let subject = "Xác minh email OSP Suite";
            let body = format!(
                "Xác minh địa chỉ email để kích hoạt tài khoản quản trị (liên kết có hiệu lực 24 giờ):\n\n{verify_url}\n\nNếu bạn không tạo tài khoản này, hãy bỏ qua email."
            );
            tx.execute("INSERT INTO osp_auth_mail_outbox (id, tenant_id, user_id, recipient, subject, body) VALUES ($1, $2, $3, $4, $5, $6)", &[&Uuid::new_v4(), &id, &user.id, &recipient, &subject, &body]).await?;
        }
        let has_pw = admin.is_some_and(|a| a.password.is_some());
        let (token, _, _) = if has_pw {
            self.insert_token(
                &tx,
                &id,
                &user.id,
                "session",
                Some("bootstrap"),
                Some(self.cfg.session_ttl),
                None,
            )
            .await?
        } else {
            self.insert_token(&tx, &id, &user.id, "api", Some("bootstrap"), None, None)
                .await?
        };

        // Seed của module (theo thứ tự phụ thuộc) và của gói ngành
        for mid in &modules {
            let seeds = &self.reg.modules[mid].seeds;
            if !seeds.is_empty() {
                self.apply_seeds(&tx, &tenant, mid, seeds).await?;
            }
        }
        if let Some(v) = &vertical {
            self.apply_seeds(&tx, &tenant, &v.id, &v.seeds).await?;
        }
        self.audit_raw(
            &tx,
            &id,
            &user.id,
            "tenant.create",
            Some(&id),
            vertical.as_ref().map(|v| v.id.clone()),
        )
        .await?;
        tx.commit().await?;
        let t = self.tenant(&id).await?;
        Ok((t, token, warnings))
    }

    pub async fn list_tenants(&self) -> R<Vec<Value>> {
        let conn = self.pool.get().await?;
        let rows = conn.query("SELECT jsonb_build_object('id', id, 'name', name, 'vertical', vertical, 'planId', plan_id, 'suspended', suspended, 'createdAt', created_at) FROM osp_tenants ORDER BY created_at", &[]).await?;
        Ok(rows.into_iter().map(|r| r.get(0)).collect())
    }

    pub async fn enable_modules(&self, t: &Tenant, ids: &[String]) -> R<Vec<String>> {
        let mut want: Vec<String> = t.modules.clone();
        want.extend(ids.iter().cloned());
        let target = self
            .reg
            .closure(&want)
            .map_err(|e| ApiError::new(404, "MODULE_NOT_FOUND", e))?;
        let added: Vec<String> = target
            .iter()
            .filter(|m| !t.modules.contains(m))
            .cloned()
            .collect();
        if added.is_empty() {
            return Ok(added);
        }
        let mut next = t.clone();
        next.modules = target.clone();
        let mut conn = self.pool.get().await?;
        let tx = Tx::begin(&mut conn, &t.id, true).await?;
        tx.execute(
            "UPDATE osp_tenants SET modules = $2 WHERE id = $1",
            &[&t.id, &target],
        )
        .await?;
        for mid in &added {
            let seeds = &self.reg.modules[mid].seeds;
            if !seeds.is_empty() {
                self.apply_seeds(&tx, &next, mid, seeds).await?;
            }
        }
        self.audit_raw(
            &tx,
            &t.id,
            "system",
            "module.enable",
            None,
            Some(added.join(",")),
        )
        .await?;
        tx.commit().await?;
        self.invalidate(&t.id);
        Ok(added)
    }

    pub async fn disable_module(&self, t: &Tenant, id: &str) -> R<()> {
        let m = self.reg.modules.get(id).ok_or_else(|| {
            ApiError::new(404, "MODULE_NOT_FOUND", format!("Không có module {id}"))
        })?;
        if m.core {
            return Err(ApiError::new(
                409,
                "CORE_MODULE",
                format!("Module lõi \"{id}\" không thể tắt"),
            ));
        }
        let blockers: Vec<String> = self
            .reg
            .dependents(id)
            .into_iter()
            .filter(|d| t.has_module(d))
            .collect();
        if !blockers.is_empty() {
            return Err(ApiError::new(
                409,
                "HAS_DEPENDENTS",
                format!(
                    "Không thể tắt \"{id}\": còn module phụ thuộc: {}",
                    blockers.join(", ")
                ),
            ));
        }
        let modules: Vec<String> = t.modules.iter().filter(|m| *m != id).cloned().collect(); // dữ liệu được giữ nguyên
        let mut conn = self.pool.get().await?;
        let tx = Tx::begin(&mut conn, &t.id, true).await?;
        tx.execute(
            "UPDATE osp_tenants SET modules = $2 WHERE id = $1",
            &[&t.id, &modules],
        )
        .await?;
        self.audit_raw(
            &tx,
            &t.id,
            "system",
            "module.disable",
            None,
            Some(id.to_string()),
        )
        .await?;
        tx.commit().await?;
        self.invalidate(&t.id);
        Ok(())
    }

    pub async fn add_custom_field(&self, t: &Tenant, qname: &str, spec: &Value) -> R<FieldDef> {
        let field = match spec {
            Value::String(s) => parse_field(s).map_err(|e| ApiError::new(422, "BAD_FIELD", e))?,
            Value::Object(_) => serde_json::from_value::<FieldDef>(spec.clone())
                .map_err(|e| ApiError::new(422, "BAD_FIELD", e.to_string()))?,
            _ => return Err(ApiError::new(422, "BAD_FIELD", "Cần khai báo trường")),
        };
        self.add_ext_field_check(t, qname, &field)?;
        let mut ext = t.extensions.clone();
        ext.entry(qname.to_string())
            .or_default()
            .push(field.clone());
        let conn = self.pool.get().await?;
        conn.execute(
            "UPDATE osp_tenants SET extensions = $2 WHERE id = $1",
            &[&t.id, &json!(ext)],
        )
        .await?;
        self.invalidate(&t.id);
        Ok(field)
    }

    pub async fn update_settings(&self, t: &Tenant, patch: &Value) -> R<Value> {
        let mut conn = self.pool.get().await?;
        let tx = Tx::begin(&mut conn, &t.id, true).await?;
        let mut settings = tx
            .query_one_row(
                "SELECT settings FROM osp_tenants WHERE id = $1 FOR UPDATE",
                &[&t.id],
            )
            .await?
            .get::<_, Value>(0);
        let Some(obj) = settings.as_object_mut() else {
            return Err(ApiError::new(
                500,
                "BAD_SETTINGS",
                "Cấu hình doanh nghiệp không hợp lệ",
            ));
        };
        let Some(changes) = patch.as_object() else {
            return Err(ApiError::new(422, "BAD_SETTING", "Cần gửi object cài đặt"));
        };
        for (key, value) in changes {
            match key.as_str() {
                "baseCurrency" if value.as_str().is_some_and(|code| !code.trim().is_empty()) => {
                    let code = value
                        .as_str()
                        .unwrap_or_default()
                        .trim()
                        .to_ascii_uppercase();
                    if tx
                        .query_opt(
                            "SELECT id FROM master_data__currency WHERE tenant_id = $1 AND upper(code) = $2 FOR SHARE",
                            &[&t.id, &code],
                        )
                        .await?
                        .is_none()
                    {
                        return Err(ApiError::new(
                            422,
                            "BAD_BASE_CURRENCY",
                            "Tiá»n tá»‡ cÆ¡ sá»Ÿ pháº£i cÃ³ trong danh má»¥c tiá»n tá»‡ cá»§a doanh nghiá»‡p",
                        ));
                    }
                    let current = obj
                        .get("baseCurrency")
                        .and_then(Value::as_str)
                        .unwrap_or("VND");
                    if current != code && t.has_module("accounting") {
                        let has_financial_history = tx
                            .query_one_row(
                                "SELECT EXISTS(SELECT 1 FROM accounting__journal_entry WHERE tenant_id = $1) OR EXISTS(SELECT 1 FROM accounting__invoice WHERE tenant_id = $1) OR EXISTS(SELECT 1 FROM accounting__bill WHERE tenant_id = $1) OR EXISTS(SELECT 1 FROM accounting__payment WHERE tenant_id = $1)",
                                &[&t.id],
                            )
                            .await?
                            .get::<_, bool>(0);
                        if has_financial_history {
                            return Err(ApiError::new(
                                409,
                                "BASE_CURRENCY_LOCKED",
                                "KhÃ´ng thá»ƒ Ä‘á»•i tiá»n tá»‡ cÆ¡ sá»Ÿ sau khi doanh nghiá»‡p Ä‘Ã£ cÃ³ chá»©ng tá»« káº¿ toÃ¡n",
                            ));
                        }
                    }
                    obj.insert(key.clone(), Value::String(code));
                }
                "allowNegativeStock" if value.is_boolean() => {
                    obj.insert(key.clone(), value.clone());
                }
                "enforceBudgetControl" if value.is_boolean() => {
                    obj.insert(key.clone(), value.clone());
                }
                "inventoryCostMethod"
                    if matches!(value.as_str(), Some("moving_average" | "fifo")) =>
                {
                    obj.insert(key.clone(), value.clone());
                }
                "businessTimezone"
                    if value
                        .as_str()
                        .is_some_and(|zone| zone.parse::<chrono_tz::Tz>().is_ok()) =>
                {
                    obj.insert(key.clone(), value.clone());
                }
                _ => {
                    return Err(ApiError::new(
                        422,
                        "BAD_SETTING",
                        format!("Cài đặt không hợp lệ: {key}"),
                    ));
                }
            }
        }
        let cost_method = obj
            .get("inventoryCostMethod")
            .and_then(Value::as_str)
            .unwrap_or("moving_average");
        if cost_method == "fifo" && obj.get("allowNegativeStock") == Some(&Value::Bool(true)) {
            return Err(ApiError::new(
                422,
                "BAD_SETTING",
                "FIFO yêu cầu chặn tồn âm để xác định đầy đủ lớp giá vốn",
            ));
        }
        if changes.contains_key("inventoryCostMethod") && !t.has_module("inventory") {
            return Err(ApiError::new(
                404,
                "MODULE_DISABLED",
                "Module inventory chưa được bật cho doanh nghiệp này",
            ));
        }
        if changes.contains_key("enforceBudgetControl") && !t.has_module("budget") {
            return Err(ApiError::new(
                404,
                "MODULE_DISABLED",
                "Module budget chưa được bật cho doanh nghiệp này",
            ));
        }
        let previous_method = tx
            .query_one_row("SELECT settings FROM osp_tenants WHERE id = $1", &[&t.id])
            .await?
            .get::<_, Value>(0)
            .get("inventoryCostMethod")
            .and_then(Value::as_str)
            .unwrap_or("moving_average")
            .to_owned();
        if previous_method != cost_method {
            let stock_exists = tx
                .query_opt(
                    "SELECT 1 FROM inventory__stock_move WHERE tenant_id = $1 UNION ALL SELECT 1 FROM inventory__stock_level WHERE tenant_id = $1 AND (COALESCE(qty, 0) <> 0 OR COALESCE(value, 0) <> 0) LIMIT 1",
                    &[&t.id],
                )
                .await?
                .is_some();
            if stock_exists {
                return Err(ApiError::new(
                    422,
                    "COST_METHOD_LOCKED",
                    "Chỉ đổi được phương pháp giá vốn trước khi có phiếu kho hoặc tồn đầu kỳ",
                ));
            }
        }
        tx.execute(
            "UPDATE osp_tenants SET settings = $2 WHERE id = $1",
            &[&t.id, &settings],
        )
        .await?;
        tx.commit().await?;
        self.invalidate(&t.id);
        Ok(settings)
    }

    /// Xóa vĩnh viễn tenant và toàn bộ dữ liệu (quyền được xóa). Phải gõ lại đúng tên doanh nghiệp.
    pub async fn delete_tenant(&self, actor: &Actor, t: &Tenant, confirm: &str) -> R<()> {
        self.authorize(t, actor, "tenant.delete")?;
        if confirm != t.name {
            return Err(ApiError::new(
                422,
                "CONFIRM_MISMATCH",
                "Tên xác nhận không khớp với tên doanh nghiệp",
            ));
        }
        let mut conn = self.pool.get().await?;
        let tx = Tx::begin(&mut conn, &t.id, true).await?;
        // Hoãn kiểm tra khóa ngoại để xóa theo thứ tự bất kỳ, kiểm tra lại khi COMMIT
        tx.batch("SET CONSTRAINTS ALL DEFERRED").await?;
        let mut tables: Vec<String> = Vec::new();
        for m in &self.reg.order {
            for e in &self.reg.modules[m].entities {
                tables.push(crate::defs::table_name(m, &e.name));
            }
        }
        for q in tables {
            tx.execute(
                &format!(
                    "DELETE FROM {} WHERE tenant_id = $1",
                    crate::schema::quote(&q)
                ),
                &[&t.id],
            )
            .await?;
        }
        for table in ["osp_events", "osp_failures", "osp_outbox"] {
            tx.execute(
                &format!("DELETE FROM {table} WHERE tenant_id = $1"),
                &[&t.id],
            )
            .await?;
        }
        tx.execute("DELETE FROM osp_tenants WHERE id = $1", &[&t.id])
            .await?; // CASCADE: vai trò, người dùng, phiên
        tx.commit().await?;
        self.invalidate(&t.id);
        Ok(())
    }
}
