//! Deterministic, read-only matching suggestions for explicitly supplied,
//! unverified intercompany snapshots. This module never reads member ledgers.

use crate::{
    db::Tx,
    error::{ApiError, R},
    kernel::{Actor, Kernel, Tenant},
};
use chrono::NaiveDate;
use rust_decimal::Decimal;
use serde_json::{Value, json};
use std::collections::BTreeMap;
use uuid::Uuid;

const MAX_DOCUMENTS: usize = 500;
const MAX_DATE_GAP_DAYS: i64 = 31;

#[derive(Clone)]
struct OpenItem {
    tenant_id: String,
    counterparty_tenant_id: String,
    document_type: String,
    document_id: Uuid,
    reference: String,
    counterparty_reference: Option<String>,
    issue_date: NaiveDate,
    currency: String,
    amount: Decimal,
}

impl Kernel {
    /// Preview possible invoice/bill pairs from caller-supplied snapshots.
    /// Existing group consent is rechecked, but it does not grant document
    /// sharing; the payload is unverified and never saved or posted.
    pub async fn preview_intercompany_matches(
        &self,
        actor: &Actor,
        owner: &Tenant,
        group_id: &str,
        payload: &Value,
    ) -> R<Value> {
        self.ent(owner, "consolidation.company_group")?;
        self.ent(owner, "consolidation.member")?;
        self.authorize(owner, actor, "consolidation.company_group.read")?;
        self.authorize(owner, actor, "accounting.journal_entry.read")?;
        let group_id = super::domain::parse_id(group_id, "Company group")?;
        let rows = payload
            .get("documents")
            .and_then(Value::as_array)
            .ok_or_else(|| validation("documents must be an array"))?;
        if rows.is_empty() || rows.len() > MAX_DOCUMENTS {
            return Err(validation("Provide between 1 and 500 open-item snapshots"));
        }

        let mut conn = self.pool.get().await?;
        let tx = Tx::begin(&mut conn, &owner.id, false).await?;
        let grant = tx.query_opt(
            "SELECT id FROM consolidation__report_grant WHERE tenant_id=$1 AND \"group\"=$2 AND user_id=$3 AND report_type='intercompany_match_preview' AND status='active' LIMIT 1",
            &[&owner.id, &group_id, &actor.user_id()],
        ).await?.is_some();
        if !grant {
            return Err(ApiError::forbidden(
                "consolidation.report_grant.intercompany_match_preview",
            ));
        }
        let group_exists = tx
            .query_opt(
                "SELECT id FROM consolidation__company_group WHERE tenant_id=$1 AND id=$2",
                &[&owner.id, &group_id],
            )
            .await?
            .is_some();
        if !group_exists {
            return Err(ApiError::not_found("Company group"));
        }
        let rows_in_group = tx.query(
            "SELECT id, member_tenant_id FROM consolidation__member WHERE tenant_id=$1 AND \"group\"=$2 AND status='active'",
            &[&owner.id, &group_id],
        ).await?;
        tx.commit().await?;

        // Re-check each external tenant's reciprocal consent in its own RLS
        // transaction before accepting any snapshot that names it.
        let mut members = BTreeMap::<String, Uuid>::new();
        for row in rows_in_group {
            members.insert(row.get::<_, String>(1), row.get::<_, Uuid>(0));
        }
        for (tenant_id, owner_member_id) in &members {
            if tenant_id == &owner.id {
                continue;
            }
            let member_tenant = self.tenant(tenant_id).await?;
            if member_tenant.suspended || !member_tenant.has_module("accounting") {
                return Err(ApiError::new(
                    409,
                    "MEMBER_TENANT_UNAVAILABLE",
                    "A group member cannot provide accounting snapshots",
                ));
            }
            let mut member_conn = self.pool.get().await?;
            let member_tx = Tx::begin(&mut member_conn, &member_tenant.id, false).await?;
            let consent = member_tx.query_opt(
                "SELECT id FROM consolidation__shared_company WHERE tenant_id=$1 AND owner_tenant_id=$2 AND owner_member_id=$3 AND status='active'",
                &[&member_tenant.id, &owner.id, &owner_member_id.to_string()],
            ).await?.ok_or_else(|| ApiError::new(409, "MEMBER_CONSENT_MISSING", format!("Tenant {} no longer has active consent", member_tenant.name)))?;
            let _: Uuid = consent.get(0);
            member_tx.commit().await?;
        }
        members.insert(owner.id.clone(), Uuid::nil());

        let mut items = Vec::with_capacity(rows.len());
        for row in rows {
            let Some(object) = row.as_object() else {
                return Err(validation("Every document snapshot must be an object"));
            };
            if object.keys().any(|key| {
                !matches!(
                    key.as_str(),
                    "tenantId"
                        | "counterpartyTenantId"
                        | "documentType"
                        | "documentId"
                        | "reference"
                        | "counterpartyReference"
                        | "issueDate"
                        | "currency"
                        | "outstandingAmount"
                )
            }) {
                return Err(validation(
                    "Document snapshots contain an unsupported field",
                ));
            }
            let tenant_id = required_string(row, "tenantId")?;
            let counterparty_tenant_id = required_string(row, "counterpartyTenantId")?;
            if tenant_id == counterparty_tenant_id
                || !members.contains_key(tenant_id)
                || !members.contains_key(counterparty_tenant_id)
            {
                return Err(validation(
                    "Every item and counterparty must be different active entities in this group",
                ));
            }
            let document_type = required_string(row, "documentType")?;
            if !matches!(document_type, "sales_invoice" | "purchase_bill") {
                return Err(validation(
                    "documentType must be sales_invoice or purchase_bill",
                ));
            }
            let document_id = Uuid::parse_str(required_string(row, "documentId")?)
                .map_err(|_| validation("documentId must be a UUID"))?;
            let reference = required_string(row, "reference")?.trim().to_owned();
            if reference.is_empty() || reference.len() > 200 {
                return Err(validation("reference must contain 1 to 200 characters"));
            }
            let counterparty_reference = row
                .get("counterpartyReference")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_owned);
            let issue_date =
                NaiveDate::parse_from_str(required_string(row, "issueDate")?, "%Y-%m-%d")
                    .map_err(|_| validation("issueDate must use YYYY-MM-DD"))?;
            let currency = required_string(row, "currency")?
                .trim()
                .to_ascii_uppercase();
            if currency.len() != 3 || !currency.bytes().all(|byte| byte.is_ascii_uppercase()) {
                return Err(validation("currency must be a three-letter currency code"));
            }
            let amount = row
                .get("outstandingAmount")
                .and_then(crate::money::decimal)
                .filter(|amount| *amount > Decimal::ZERO)
                .ok_or_else(|| validation("outstandingAmount must be a positive decimal amount"))?;
            items.push(OpenItem {
                tenant_id: tenant_id.to_owned(),
                counterparty_tenant_id: counterparty_tenant_id.to_owned(),
                document_type: document_type.to_owned(),
                document_id,
                reference,
                counterparty_reference,
                issue_date,
                currency,
                amount,
            });
        }

        let receivables: Vec<_> = items
            .iter()
            .filter(|item| item.document_type == "sales_invoice")
            .collect();
        let payables: Vec<_> = items
            .iter()
            .filter(|item| item.document_type == "purchase_bill")
            .collect();
        let mut candidates = Vec::new();
        for receivable in &receivables {
            for payable in &payables {
                if receivable.tenant_id != payable.counterparty_tenant_id
                    || payable.tenant_id != receivable.counterparty_tenant_id
                    || receivable.currency != payable.currency
                {
                    continue;
                }
                let day_gap = (receivable.issue_date - payable.issue_date)
                    .num_days()
                    .abs();
                let reference_match = receivable
                    .counterparty_reference
                    .as_ref()
                    .is_some_and(|reference| normalize(reference) == normalize(&payable.reference))
                    || payable
                        .counterparty_reference
                        .as_ref()
                        .is_some_and(|reference| {
                            normalize(reference) == normalize(&receivable.reference)
                        });
                let amount_match = receivable.amount == payable.amount;
                if day_gap > MAX_DATE_GAP_DAYS && !reference_match {
                    continue;
                }
                if !reference_match && !amount_match {
                    continue;
                }
                candidates.push(json!({
                    "salesInvoice": item_json(receivable),
                    "purchaseBill": item_json(payable),
                    "referenceMatch": reference_match,
                    "amountMatch": amount_match,
                    "dateGapDays": day_gap,
                    "confidence": if reference_match && amount_match { "high" } else if reference_match { "review_amount_difference" } else { "review_reference" },
                    "automaticMatchAllowed": false,
                }));
            }
        }
        self.audit_raw_ro(
            owner,
            actor,
            "company_group.intercompany_match_preview",
            &format!("consolidation.company_group#{group_id}"),
        )
        .await?;
        Ok(json!({
            "groupId": group_id,
            "suggestions": candidates,
            "inputSnapshotVerified": false,
            "requiresHumanReview": true,
            "persisted": false,
            "ledgerChanged": false,
            "policy": "Suggestions compare caller-supplied, unverified snapshots. The server checks active group membership and existing group-sharing consent, which is not document-sharing consent. It does not read source documents, verify references or amounts, save matches, or post ledger entries.",
        }))
    }
}

fn item_json(item: &OpenItem) -> Value {
    json!({
        "tenantId": item.tenant_id,
        "documentType": item.document_type,
        "documentId": item.document_id,
        "reference": item.reference,
        "counterpartyReference": item.counterparty_reference,
        "issueDate": item.issue_date,
        "currency": item.currency,
        "outstandingAmount": item.amount.normalize().to_string(),
    })
}

fn normalize(reference: &str) -> String {
    reference.trim().to_ascii_uppercase()
}

fn required_string<'a>(row: &'a Value, field: &str) -> R<&'a str> {
    row.get(field)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| validation(&format!("{field} is required")))
}

fn validation(message: &str) -> ApiError {
    ApiError::validation(
        "consolidation.intercompany_match_preview",
        vec![message.into()],
    )
}
