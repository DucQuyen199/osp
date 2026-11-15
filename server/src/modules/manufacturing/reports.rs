//! Manufacturing read models derived from tenant-scoped inventory movements.
use crate::{
    db::Tx,
    error::{ApiError, R},
    kernel::{Actor, Kernel, Opts, Tenant},
    money,
};
use chrono::NaiveDate;
use rust_decimal::Decimal;
use serde_json::{Map, Value, json};
use uuid::Uuid;

fn decimal_column(row: &tokio_postgres::Row, column: usize, field: &str) -> R<Decimal> {
    let value: String = row.get(column);
    money::decimal_str(&value).ok_or_else(|| {
        ApiError::validation(
            "manufacturing.report",
            vec![format!(
                "Stored manufacturing {field} is not a valid decimal"
            )],
        )
    })
}

fn decimal_json(value: Decimal) -> R<Value> {
    money::json_number(value).ok_or_else(|| {
        ApiError::validation(
            "manufacturing.report",
            vec!["Manufacturing amount exceeds the supported decimal range".into()],
        )
    })
}

async fn wip_subledger_balance(tx: &Tx<'_>, tenant: &Tenant, as_of: NaiveDate) -> R<Decimal> {
    let row = tx
        .query_one_row(
            "WITH production_costs AS ( \
               SELECT po.id::text AS source_id, \
                 COALESCE(sum(sm.total_cost) FILTER (WHERE sm.source = 'production_order_bom' AND sm.direction = 'out' AND sm.source_id = po.id::text), 0)::numeric AS base_material_cost, \
                 COALESCE(sum(sm.total_cost) FILTER (WHERE sm.source = 'production_order_bom' AND sm.direction = 'out' AND sm.source_id <> po.id::text), 0)::numeric AS rework_material_cost, \
                 COALESCE(sum(sm.total_cost) FILTER (WHERE sm.source IN ('production_order', 'production_rework') AND sm.direction = 'in'), 0)::numeric AS finished_cost \
               FROM manufacturing__production_order po \
               LEFT JOIN inventory__stock_move sm ON sm.tenant_id = po.tenant_id AND (sm.created_at AT TIME ZONE 'UTC')::date <= $2::date AND ( \
                 (sm.source = 'production_order_bom' AND (sm.source_id = po.id::text OR EXISTS (SELECT 1 FROM manufacturing__rework_order ro WHERE ro.tenant_id = po.tenant_id AND ro.id::text = sm.source_id AND ro.production_order = po.id))) OR \
                 (sm.source = 'production_order' AND sm.source_id = po.id::text) OR \
                 (sm.source = 'production_rework' AND EXISTS (SELECT 1 FROM manufacturing__rework_order ro WHERE ro.tenant_id = po.tenant_id AND ro.id::text = sm.source_id AND ro.production_order = po.id)) \
               ) WHERE po.tenant_id = $1 GROUP BY po.id \
             ) SELECT COALESCE(SUM(cost.base_material_cost + cost.rework_material_cost - cost.finished_cost - CASE WHEN po.status = 'done' AND po.scrap_cost_method = 'expense' THEN cost.base_material_cost * COALESCE(po.scrap_qty, 0)::numeric / NULLIF(po.qty, 0)::numeric ELSE 0 END), 0)::text \
               FROM manufacturing__production_order po \
               JOIN production_costs cost ON cost.source_id = po.id::text \
               WHERE po.tenant_id = $1 AND po.status IN ('in_progress', 'done')",
            &[&tenant.id, &as_of],
        )
        .await?;
    decimal_column(&row, 0, "WIP subledger balance")
}

async fn ledger_wip_balance(tx: &Tx<'_>, tenant: &Tenant, as_of: NaiveDate) -> R<Decimal> {
    let row = tx
        .query_one_row(
            "SELECT COALESCE(SUM(COALESCE((line->>'debit')::numeric, 0) - COALESCE((line->>'credit')::numeric, 0)), 0)::text \
             FROM accounting__journal_entry entry \
             CROSS JOIN LATERAL jsonb_array_elements(COALESCE(entry.lines, '[]'::jsonb)) line \
             JOIN accounting__account account ON account.tenant_id = entry.tenant_id AND account.id::text = line->>'account' \
             WHERE entry.tenant_id = $1 AND account.code = '154' AND entry.status IN ('posted', 'reversed') \
               AND COALESCE(entry.posting_date, (entry.created_at AT TIME ZONE 'UTC')::date) <= $2::date",
            &[&tenant.id, &as_of],
        )
        .await?;
    decimal_column(&row, 0, "ledger WIP balance")
}

impl Kernel {
    /// Lists active WIP: issued materials not yet transferred into accepted
    /// finished goods through a passed quality inspection.
    pub async fn manufacturing_wip_report(
        &self,
        actor: &Actor,
        tenant: &Tenant,
        as_of: Option<&str>,
    ) -> R<Value> {
        if !tenant.has_module("manufacturing") {
            return Err(ApiError::new(
                404,
                "MODULE_DISABLED",
                "Module manufacturing is not enabled for this tenant",
            ));
        }
        self.authorize(tenant, actor, "manufacturing.production_order.read")?;
        let as_of = as_of
            .map(|value| {
                NaiveDate::parse_from_str(value, "%Y-%m-%d")
                    .map_err(|_| ApiError::new(422, "INVALID_DATE", "asOf must use YYYY-MM-DD"))
            })
            .transpose()?
            .unwrap_or_else(|| chrono::Utc::now().date_naive());

        let mut conn = self.pool.get().await?;
        let tx = Tx::begin(&mut conn, &tenant.id, false).await?;
        let orders = tx
            .query_json(
                "WITH production_costs AS ( \
               SELECT po.id::text AS source_id, \
                 COALESCE(sum(sm.total_cost) FILTER (WHERE sm.source = 'production_order_bom' AND sm.direction = 'out' AND sm.source_id = po.id::text), 0)::numeric AS base_material_cost, \
                 COALESCE(sum(sm.total_cost) FILTER (WHERE sm.source = 'production_order_bom' AND sm.direction = 'out' AND sm.source_id <> po.id::text), 0)::numeric AS rework_material_cost, \
                 COALESCE(sum(sm.total_cost) FILTER (WHERE sm.source IN ('production_order', 'production_rework') AND sm.direction = 'in'), 0)::numeric AS finished_cost \
               FROM manufacturing__production_order po \
               LEFT JOIN inventory__stock_move sm ON sm.tenant_id = po.tenant_id AND (sm.created_at AT TIME ZONE 'UTC')::date <= $2::date AND ( \
                 (sm.source = 'production_order_bom' AND (sm.source_id = po.id::text OR EXISTS (SELECT 1 FROM manufacturing__rework_order ro WHERE ro.tenant_id = po.tenant_id AND ro.id::text = sm.source_id AND ro.production_order = po.id))) OR \
                 (sm.source = 'production_order' AND sm.source_id = po.id::text) OR \
                 (sm.source = 'production_rework' AND EXISTS (SELECT 1 FROM manufacturing__rework_order ro WHERE ro.tenant_id = po.tenant_id AND ro.id::text = sm.source_id AND ro.production_order = po.id)) \
               ) WHERE po.tenant_id = $1 GROUP BY po.id \
                 ) SELECT jsonb_build_object( \
                   'id', po.id, 'productId', product.id, 'product', product.name, \
                   'warehouseId', po.warehouse, 'plannedQty', po.qty, 'goodQty', po.good_qty, \
                   'scrapQty', po.scrap_qty, 'scrapReason', po.scrap_reason, 'status', po.status, \
                   'qualityStatus', inspection.status, \
                   'materialCost', COALESCE(cost.base_material_cost, 0) + COALESCE(cost.rework_material_cost, 0), \
                   'finishedCost', COALESCE(cost.finished_cost, 0), \
                   'scrapExpense', CASE WHEN po.status = 'done' AND po.scrap_cost_method = 'expense' THEN COALESCE(cost.base_material_cost, 0) * COALESCE(po.scrap_qty, 0)::numeric / NULLIF(po.qty, 0)::numeric ELSE 0 END, \
                   'wipValue', COALESCE(cost.base_material_cost, 0) + COALESCE(cost.rework_material_cost, 0) - COALESCE(cost.finished_cost, 0) - CASE WHEN po.status = 'done' AND po.scrap_cost_method = 'expense' THEN COALESCE(cost.base_material_cost, 0) * COALESCE(po.scrap_qty, 0)::numeric / NULLIF(po.qty, 0)::numeric ELSE 0 END \
                 ) FROM manufacturing__production_order po \
                 JOIN master_data__product product ON product.tenant_id = po.tenant_id AND product.id = po.product \
                 LEFT JOIN production_costs cost ON cost.source_id = po.id::text \
                 LEFT JOIN LATERAL ( \
                   SELECT status FROM quality__inspection qi \
                   WHERE qi.tenant_id = po.tenant_id AND qi.source = 'production_order' AND qi.source_id = po.id::text \
                   ORDER BY qi.created_at DESC, qi.id DESC LIMIT 1 \
                 ) inspection ON true \
                 WHERE po.tenant_id = $1 AND po.status IN ('in_progress', 'done') \
                   AND abs(COALESCE(cost.base_material_cost, 0) + COALESCE(cost.rework_material_cost, 0) - COALESCE(cost.finished_cost, 0) - CASE WHEN po.status = 'done' AND po.scrap_cost_method = 'expense' THEN COALESCE(cost.base_material_cost, 0) * COALESCE(po.scrap_qty, 0)::numeric / NULLIF(po.qty, 0)::numeric ELSE 0 END) > 0.005 \
                 ORDER BY po.updated_at, po.id",
                &[&tenant.id, &as_of],
            )
            .await?;
        let total_wip = wip_subledger_balance(&tx, tenant, as_of).await?;
        let ledger_wip_balance = if tenant.has_module("accounting")
            && self
                .authorize(tenant, actor, "accounting.journal_entry.read")
                .is_ok()
        {
            Some(ledger_wip_balance(&tx, tenant, as_of).await?)
        } else {
            None
        };
        let wip_variance = ledger_wip_balance
            .map(|ledger| {
                total_wip.checked_sub(ledger).ok_or_else(|| {
                    ApiError::validation(
                        "manufacturing.report",
                        vec!["WIP variance exceeds the supported decimal range".into()],
                    )
                })
            })
            .transpose()?;
        let total_wip_json = decimal_json(total_wip)?;
        let ledger_wip_json = ledger_wip_balance.map(decimal_json).transpose()?;
        let wip_variance_json = wip_variance.map(decimal_json).transpose()?;
        Ok(json!({
            "asOf": as_of,
            "orders": orders,
            "orderCount": orders.len(),
            "totalWipValue": total_wip_json,
            "ledgerWipBalance": ledger_wip_json,
            "wipVariance": wip_variance_json,
            "ledgerComparisonAvailable": ledger_wip_balance.is_some(),
            "reconciled": wip_variance.is_some_and(|variance| variance.abs() <= Decimal::new(5, 3)),
        }))
    }

    /// Creates an idempotent draft adjustment for a WIP/154 difference.
    /// The caller chooses the contra account and reviews/posts through the normal journal workflow.
    pub async fn create_manufacturing_wip_reconciliation_draft(
        &self,
        actor: &Actor,
        tenant: &Tenant,
        as_of: &str,
        offset_account_id: &str,
        memo: &str,
    ) -> R<Value> {
        if !tenant.has_module("manufacturing") || !tenant.has_module("accounting") {
            return Err(ApiError::new(
                404,
                "MODULE_DISABLED",
                "Manufacturing and accounting modules must both be enabled for WIP reconciliation",
            ));
        }
        self.authorize(tenant, actor, "manufacturing.production_order.read")?;
        self.authorize(tenant, actor, "accounting.journal_entry.create")?;
        self.authorize(tenant, actor, "accounting.account.read")?;
        let as_of = NaiveDate::parse_from_str(as_of, "%Y-%m-%d")
            .map_err(|_| ApiError::new(422, "INVALID_DATE", "asOf must use YYYY-MM-DD"))?;
        let offset_account_id = Uuid::parse_str(offset_account_id).map_err(|_| {
            ApiError::validation(
                "manufacturing.wip_reconciliation",
                vec!["Tài khoản đối ứng không hợp lệ".into()],
            )
        })?;
        let memo = memo.trim();
        if memo.is_empty() || memo.chars().count() > 300 {
            return Err(ApiError::validation(
                "manufacturing.wip_reconciliation",
                vec!["Diễn giải phải có từ 1 đến 300 ký tự".into()],
            ));
        }

        let mut conn = self.pool.get().await?;
        let tx = Tx::begin(&mut conn, &tenant.id, true).await?;
        if tx
            .query_opt(
                "SELECT 1 FROM accounting__period WHERE tenant_id = $1 AND status = 'period_closed' AND start_date <= $2 AND end_date >= $2 LIMIT 1",
                &[&tenant.id, &as_of],
            )
            .await?
            .is_some()
        {
            return Err(ApiError::validation(
                "manufacturing.wip_reconciliation",
                vec!["Không thể tạo bút toán cho ngày thuộc kỳ kế toán đã khóa".into()],
            ));
        }
        let wip_account = tx
            .query_opt(
                "SELECT id FROM accounting__account WHERE tenant_id = $1 AND code = '154' FOR SHARE",
                &[&tenant.id],
            )
            .await?
            .map(|row| row.get::<_, Uuid>(0))
            .ok_or_else(|| {
                ApiError::validation(
                    "manufacturing.wip_reconciliation",
                    vec!["Không tìm thấy tài khoản 154 trong doanh nghiệp".into()],
                )
            })?;
        let offset_code = tx
            .query_opt(
                "SELECT code FROM accounting__account WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                &[&tenant.id, &offset_account_id],
            )
            .await?
            .map(|row| row.get::<_, String>(0))
            .ok_or_else(|| {
                ApiError::validation(
                    "manufacturing.wip_reconciliation",
                    vec!["Không tìm thấy tài khoản đối ứng trong doanh nghiệp".into()],
                )
            })?;
        if offset_account_id == wip_account || offset_code == "154" {
            return Err(ApiError::validation(
                "manufacturing.wip_reconciliation",
                vec!["Tài khoản đối ứng phải khác tài khoản 154".into()],
            ));
        }

        let subledger = wip_subledger_balance(&tx, tenant, as_of).await?;
        let ledger = ledger_wip_balance(&tx, tenant, as_of).await?;
        let variance = money::round_money(subledger.checked_sub(ledger).ok_or_else(|| {
            ApiError::validation(
                "manufacturing.wip_reconciliation",
                vec!["WIP variance exceeds the supported decimal range".into()],
            )
        })?);
        if variance.abs() <= Decimal::new(5, 3) {
            return Err(ApiError::validation(
                "manufacturing.wip_reconciliation",
                vec!["WIP và tài khoản 154 đang khớp; không cần tạo bút toán điều chỉnh".into()],
            ));
        }

        let source_id = format!("{}:{}:{variance:.4}", as_of, offset_account_id);
        let variance_json = decimal_json(variance)?;
        if let Some(existing) = tx
            .query_opt(
                "SELECT id, status FROM accounting__journal_entry WHERE tenant_id = $1 AND source = 'wip_reconciliation' AND source_id = $2 LIMIT 1 FOR UPDATE",
                &[&tenant.id, &source_id],
            )
            .await?
        {
            let id: Uuid = existing.get(0);
            let status: String = existing.get(1);
            tx.commit().await?;
            return Ok(json!({
                "journalId": id,
                "status": status,
                "asOf": as_of,
                "variance": variance_json,
                "existing": true,
            }));
        }

        let amount = variance.abs();
        let amount_json = decimal_json(amount)?;
        let lines = if variance > Decimal::ZERO {
            json!([
                { "account": wip_account, "debit": amount_json, "credit": 0 },
                { "account": offset_account_id, "debit": 0, "credit": amount_json }
            ])
        } else {
            json!([
                { "account": offset_account_id, "debit": amount_json, "credit": 0 },
                { "account": wip_account, "debit": 0, "credit": amount_json }
            ])
        };
        let entity = self.ent(tenant, "accounting.journal_entry")?;
        let created = self
            .create_in(
                &tx,
                actor,
                tenant,
                &entity,
                Map::from_iter([
                    ("memo".into(), json!(memo)),
                    ("amount".into(), amount_json),
                    ("posting_date".into(), json!(as_of)),
                    ("source".into(), json!("wip_reconciliation")),
                    ("source_id".into(), json!(source_id)),
                    ("lines".into(), lines),
                ]),
                &Opts::top(),
            )
            .await?;
        tx.commit().await?;
        Ok(json!({
            "journal": created,
            "asOf": as_of,
            "variance": variance_json,
            "existing": false,
        }))
    }
}
