use crate::{
    db::Tx,
    error::{ApiError, R},
    kernel::{Actor, Kernel, Opts, Tenant},
};
use serde_json::{Map, Value, json};
use std::collections::{HashMap, HashSet};

mod tt133_sme_2016;
mod tt99_2025;

#[derive(Clone, Copy)]
struct AccountTemplate {
    code: &'static str,
    name: &'static str,
    kind: &'static str,
    parent_code: Option<&'static str>,
}

const fn account(code: &'static str, name: &'static str, kind: &'static str) -> AccountTemplate {
    AccountTemplate {
        code,
        name,
        kind,
        parent_code: None,
    }
}

const fn detail(
    code: &'static str,
    parent_code: &'static str,
    name: &'static str,
    kind: &'static str,
) -> AccountTemplate {
    AccountTemplate {
        code,
        name,
        kind,
        parent_code: Some(parent_code),
    }
}

struct ExistingAccount {
    id: uuid::Uuid,
    name: String,
    kind: String,
    parent: Option<uuid::Uuid>,
}

struct ChartTemplate {
    id: &'static str,
    name: &'static str,
    description: &'static str,
    source: &'static str,
    accounts: &'static [AccountTemplate],
    details: &'static [AccountTemplate],
}

const TEMPLATES: &[ChartTemplate] = &[
    ChartTemplate {
        id: "tt99_2025",
        name: "Doanh nghiệp — Thông tư 99/2025/TT-BTC",
        description: "Danh mục cấp 1 và các mã chi tiết được liệt kê tại Phụ lục II; dùng cho doanh nghiệp áp dụng Thông tư 99.",
        source: "https://congbao.chinhphu.vn/tai-ve-van-ban-so-99-2025-tt-btc-46529-59634",
        accounts: tt99_2025::ACCOUNTS,
        details: tt99_2025::DETAILS,
    },
    ChartTemplate {
        id: "tt133_sme_2016",
        name: "Doanh nghiệp nhỏ và vừa — Thông tư 133/2016/TT-BTC",
        description: "Danh mục cấp 1 và các mã chi tiết trong Phụ lục 1 cho doanh nghiệp nhỏ và vừa.",
        source: "https://vbpq.mof.gov.vn/DKC.FileManagement/FileStorage/File/19990",
        accounts: tt133_sme_2016::ACCOUNTS,
        details: tt133_sme_2016::DETAILS,
    },
];

fn find_template(id: &str) -> Option<&'static ChartTemplate> {
    TEMPLATES.iter().find(|template| template.id == id)
}

impl Kernel {
    pub async fn accounting_chart_templates(&self, actor: &Actor, tenant: &Tenant) -> R<Value> {
        self.ent(tenant, "accounting.account")?;
        self.authorize(tenant, actor, "accounting.account.read")?;
        let templates = TEMPLATES
            .iter()
            .map(|template| {
                json!({
                    "id": template.id,
                    "name": template.name,
                    "description": template.description,
                    "source": template.source,
                    "accountCount": template.accounts.len(),
                    "detailAccountCount": template.details.len(),
                    "totalAccountCount": template.accounts.len() + template.details.len(),
                })
            })
            .collect::<Vec<_>>();
        Ok(json!({
            "current": tenant.setting_str("accountingStandard"),
            "templates": templates,
        }))
    }

    pub async fn apply_accounting_chart_template(
        &self,
        actor: &Actor,
        tenant: &Tenant,
        template_id: &str,
    ) -> R<Value> {
        let template = find_template(template_id).ok_or_else(|| {
            ApiError::new(
                404,
                "CHART_TEMPLATE_NOT_FOUND",
                "Không có mẫu hệ thống tài khoản này",
            )
        })?;
        let entity = self.ent(tenant, "accounting.account")?;
        self.authorize(tenant, actor, "accounting.account.create")?;

        let mut conn = self.pool.get().await?;
        let tx = Tx::begin(&mut conn, &tenant.id, true).await?;
        let settings_row = tx
            .query_opt(
                "SELECT settings FROM osp_tenants WHERE id = $1 FOR UPDATE",
                &[&tenant.id],
            )
            .await?
            .ok_or_else(|| ApiError::not_found("Không tìm thấy doanh nghiệp"))?;
        let mut settings: Value = settings_row.get(0);
        let settings_object = settings.as_object_mut().ok_or_else(|| {
            ApiError::new(500, "BAD_SETTINGS", "Cấu hình doanh nghiệp không hợp lệ")
        })?;
        let active_template = settings_object
            .get("accountingStandard")
            .and_then(Value::as_str)
            .map(str::to_owned);
        if active_template
            .as_deref()
            .is_some_and(|active| active != template.id)
        {
            return Err(ApiError::new(
                409,
                "ACCOUNTING_STANDARD_LOCKED",
                format!(
                    "Doanh nghiệp đã chọn mẫu {}; không thể trộn mẫu {}",
                    active_template.as_deref().unwrap_or_default(),
                    template.id
                ),
            ));
        }
        let already_selected = active_template.is_some();
        if !already_selected {
            settings_object.insert(
                "accountingStandard".into(),
                Value::String(template.id.into()),
            );
            tx.execute(
                "UPDATE osp_tenants SET settings = $2 WHERE id = $1",
                &[&tenant.id, &settings],
            )
            .await?;
        }

        let accounts = template
            .accounts
            .iter()
            .chain(template.details.iter())
            .collect::<Vec<_>>();
        let codes = accounts
            .iter()
            .map(|account| account.code.to_owned())
            .collect::<Vec<_>>();
        let rows = tx
            .query(
                "SELECT id, code, name, kind, parent FROM accounting__account WHERE tenant_id = $1 AND code = ANY($2)",
                &[&tenant.id, &codes],
            )
            .await?;
        let existing = rows
            .into_iter()
            .map(|row| {
                (
                    row.get::<_, String>(1),
                    ExistingAccount {
                        id: row.get(0),
                        name: row.get(2),
                        kind: row.get(3),
                        parent: row.get(4),
                    },
                )
            })
            .collect::<HashMap<_, _>>();
        let mut account_ids = existing
            .iter()
            .map(|(code, account)| (code.clone(), account.id))
            .collect::<HashMap<_, _>>();

        let mut created = Vec::new();
        let mut preserved = Vec::new();
        let mut blocked = Vec::new();
        let mut blocked_parent_codes = HashSet::new();
        for account in accounts {
            let parent_is_blocked = account
                .parent_code
                .is_some_and(|parent_code| blocked_parent_codes.contains(parent_code));
            let parent_id = account
                .parent_code
                .and_then(|parent_code| account_ids.get(parent_code).copied());
            if account.parent_code.is_some() && parent_id.is_none() && !parent_is_blocked {
                let parent_code = account.parent_code.unwrap_or_default();
                return Err(ApiError::new(
                    500,
                    "CHART_TEMPLATE_PARENT_MISSING",
                    format!("Mẫu {} thiếu tài khoản cha {parent_code}", template.id),
                ));
            }
            if let Some(existing_account) = existing.get(account.code) {
                let parent_matches = existing_account.parent == parent_id && !parent_is_blocked;
                preserved.push(json!({
                    "code": account.code,
                    "name": existing_account.name,
                    "kind": existing_account.kind,
                    "parentCode": account.parent_code,
                    "parentMatchesTemplate": parent_matches,
                    "matchesTemplate": existing_account.name == account.name
                        && existing_account.kind == account.kind
                        && parent_matches,
                }));
                if existing_account.kind != account.kind || !parent_matches {
                    blocked_parent_codes.insert(account.code.to_owned());
                }
                continue;
            }
            if parent_is_blocked {
                blocked.push(json!({
                    "code": account.code,
                    "parentCode": account.parent_code,
                    "reason": "parent_or_ancestor_mismatch",
                }));
                blocked_parent_codes.insert(account.code.to_owned());
                continue;
            }
            let mut data = Map::from_iter([
                ("code".into(), json!(account.code)),
                ("name".into(), json!(account.name)),
                ("kind".into(), json!(account.kind)),
            ]);
            if let Some(parent_id) = parent_id {
                data.insert("parent".into(), json!(parent_id));
            }
            let created_account = self
                .create_in(&tx, actor, tenant, &entity, data, &Opts::top())
                .await?;
            let account_id = created_account["id"]
                .as_str()
                .and_then(|id| uuid::Uuid::parse_str(id).ok())
                .ok_or_else(|| ApiError::internal("Created account has no valid id"))?;
            account_ids.insert(account.code.to_owned(), account_id);
            created.push(created_account);
        }

        self.audit(
            &tx,
            tenant,
            actor,
            "accounting.chart_template.apply",
            "accounting.account",
            Some(format!(
                "{}; created={}; preserved={}; blocked={}",
                template.id,
                created.len(),
                preserved.len(),
                blocked.len()
            )),
        )
        .await?;
        tx.commit().await?;
        self.invalidate(&tenant.id);

        Ok(json!({
            "template": template.id,
            "alreadySelected": already_selected,
            "created": created,
            "preserved": preserved,
            "blocked": blocked,
        }))
    }
}
