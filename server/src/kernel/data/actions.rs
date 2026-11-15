use super::shared::*;

mod bulk;

impl Kernel {
    #[async_recursion]
    pub(crate) async fn act_in(
        &self,
        tx: &Tx<'_>,
        actor: &Actor,
        t: &Tenant,
        ent: &Ent,
        id: &str,
        action: &str,
        opts: &Opts,
    ) -> R<Value> {
        let qname = ent.qname();
        if matches!(actor, Actor::User { .. })
            && ((qname == "contract.amendment" && action == "applied")
                || (qname == "contract.contract" && action == "amended")
                || (qname == "workflow-approval.approval_request" && action == "cancelled"))
        {
            return Err(ApiError::forbidden("contract.addendum.system_apply"));
        }
        let states = ent.def.states.as_ref().ok_or_else(|| {
            ApiError::new(
                404,
                "UNKNOWN_ACTION",
                format!("{qname} không có action \"{action}\""),
            )
        })?;
        let tr = states.actions.get(action).ok_or_else(|| {
            ApiError::new(
                404,
                "UNKNOWN_ACTION",
                format!("{qname} không có action \"{action}\""),
            )
        })?;
        // Serialize transitions on this row so concurrent requests cannot
        // validate the same source state or repeat transactional side effects.
        let uid = Uuid::parse_str(id).map_err(|_| ApiError::not_found(format!("{qname} {id}")))?;
        let row = tx
            .query_opt(
                &format!(
                    "SELECT id FROM {} WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
                    crate::schema::quote(&ent.def.table())
                ),
                &[&t.id, &uid],
            )
            .await?;
        if row.is_none() {
            return Err(ApiError::not_found(format!("{qname} {id}")));
        }
        let mut cur = self
            .get_row(tx, t, &qname, id)
            .await?
            .ok_or_else(|| ApiError::not_found(format!("Không tìm thấy {qname} {id}")))?;
        if let (
            Actor::User {
                id: acting_user, ..
            },
            Some(previous_action),
        ) = (actor, segregation_reference(&qname, action))
        {
            let target = format!("{qname}#{id}");
            let previous = if qname == "inventory.stock_count" {
                tx.query_opt(
                    "SELECT user_id FROM osp_audit WHERE tenant_id=$1 AND target=$2 AND action IN ('create', 'update') ORDER BY seq DESC LIMIT 1 FOR SHARE",
                    &[&t.id, &target],
                )
                .await?
            } else {
                tx.query_opt(
                    "SELECT user_id FROM osp_audit WHERE tenant_id=$1 AND target=$2 AND action=$3 ORDER BY seq DESC LIMIT 1 FOR SHARE",
                    &[&t.id, &target, &previous_action],
                )
                .await?
            };
            if let Some(previous) = previous {
                let previous_user: String = previous.get(0);
                if previous_user == *acting_user {
                    let reason = match qname.as_str() {
                        "purchasing.rfq" => "The RFQ creator cannot award their own supplier quote",
                        "inventory.stock_count" => {
                            "Stock count creator cannot approve or reject their own variance"
                        }
                        "construction.boq" => {
                            "NgÆ°á»i láº­p BOQ khÃ´ng Ä‘Æ°á»£c tá»± duyá»‡t baseline dá»± Ã¡n"
                        }
                        "lending.loan" if action == "disbursed" => {
                            "NgÆ°á»i duyá»‡t khoáº£n vay khÃ´ng Ä‘Æ°á»£c tá»± giáº£i ngÃ¢n"
                        }
                        "lending.loan" => {
                            "NgÆ°á»i láº­p há»“ sÆ¡ vay khÃ´ng Ä‘Æ°á»£c tá»± duyá»‡t hoáº·c tá»« chá»‘i"
                        }
                        "insurance.claim" if action == "paid" => {
                            "NgÆ°á»i duyá»‡t bá»“i thÆ°á»ng khÃ´ng Ä‘Æ°á»£c tá»± chi tráº£"
                        }
                        _ => {
                            "NgÆ°á»i tiáº¿p nháº­n há»“ sÆ¡ bá»“i thÆ°á»ng khÃ´ng Ä‘Æ°á»£c tá»± duyá»‡t hoáº·c tá»« chá»‘i"
                        }
                    };
                    return Err(ApiError::validation(&qname, vec![reason.into()]));
                }
            }
        }
        if qname == "field-service.work_order" {
            let errors =
                crate::modules::field_service::prepare_document(tx, t, &mut cur, false).await?;
            if !errors.is_empty() {
                return Err(ApiError::validation(&qname, errors));
            }
        }
        if qname == "ecommerce.web_order" && action == "placed" {
            let errors = crate::modules::ecommerce::prepare_document(tx, t, &mut cur).await?;
            if !errors.is_empty() {
                return Err(ApiError::validation(&qname, errors));
            }
        }
        if action == "posted"
            && qname.starts_with("accounting.")
            && matches!(
                ent.def.name.as_str(),
                "invoice" | "bill" | "credit_note" | "debit_note"
            )
        {
            let errors = crate::modules::accounting::prepare_currency_posting(
                tx,
                t,
                ent.def.name.as_str(),
                &mut cur,
            )
            .await?;
            if !errors.is_empty() {
                return Err(ApiError::validation(&qname, errors));
            }
        }
        if qname == "workflow-approval.approval_request" {
            crate::modules::workflow_approval::authorize_decision(
                tx,
                t,
                actor,
                action,
                &Value::Object(cur.clone()),
            )
            .await?;
        }
        if qname.starts_with("school.") {
            let errors =
                crate::modules::school::prepare_document(tx, t, ent.def.name.as_str(), &mut cur)
                    .await?;
            if !errors.is_empty() {
                return Err(ApiError::validation(&qname, errors));
            }
        }
        if qname.starts_with("marketing.") {
            let errors =
                crate::modules::marketing::prepare_document(ent.def.name.as_str(), &mut cur);
            if !errors.is_empty() {
                return Err(ApiError::validation(&qname, errors));
            }
        }
        if qname.starts_with("lms.") {
            let errors = crate::modules::lms::prepare_document(ent.def.name.as_str(), &mut cur);
            if !errors.is_empty() {
                return Err(ApiError::validation(&qname, errors));
            }
        }
        if qname.starts_with("helpdesk.") {
            let errors =
                crate::modules::helpdesk::prepare_document(ent.def.name.as_str(), &mut cur);
            if !errors.is_empty() {
                return Err(ApiError::validation(&qname, errors));
            }
        }
        if qname.starts_with("charity.") {
            crate::modules::charity::prepare_document(ent.def.name.as_str(), &mut cur);
        }
        if qname.starts_with("hrm.") {
            crate::modules::hrm::prepare_document(ent.def.name.as_str(), &mut cur);
        }
        if qname.starts_with("master-data.") {
            let errors =
                crate::modules::master_data::prepare_document(ent.def.name.as_str(), &mut cur);
            if !errors.is_empty() {
                return Err(ApiError::validation(&qname, errors));
            }
        }
        if qname.starts_with("project.") {
            let errors = crate::modules::project::prepare_document(ent.def.name.as_str(), &mut cur);
            if !errors.is_empty() {
                return Err(ApiError::validation(&qname, errors));
            }
        }
        if qname.starts_with("performance.") {
            let errors =
                crate::modules::performance::prepare_document(ent.def.name.as_str(), &mut cur);
            if !errors.is_empty() {
                return Err(ApiError::validation(&qname, errors));
            }
        }
        if qname.starts_with("document.") {
            let errors =
                crate::modules::document::prepare_document(ent.def.name.as_str(), &mut cur);
            if !errors.is_empty() {
                return Err(ApiError::validation(&qname, errors));
            }
        }
        if qname.starts_with("bi.") {
            let errors = crate::modules::bi::prepare_document(ent.def.name.as_str(), &mut cur);
            if !errors.is_empty() {
                return Err(ApiError::validation(&qname, errors));
            }
        }
        if qname.starts_with("auto-service.") {
            let errors = crate::modules::auto_service::prepare_document(
                tx,
                t,
                ent.def.name.as_str(),
                &mut cur,
                false,
            )
            .await?;
            if !errors.is_empty() {
                return Err(ApiError::validation(&qname, errors));
            }
        }
        if qname == "expense.expense_claim" && matches!(action, "submitted" | "approved" | "paid") {
            let errors = crate::modules::expense::prepare_document(ent.def.name.as_str(), &mut cur);
            if !errors.is_empty() {
                return Err(ApiError::validation(&qname, errors));
            }
        }
        if qname == "logistics.shipment"
            && action == "dispatched"
            && cur.get("source").and_then(Value::as_str) == Some("sales_order")
            && (cur.get("weight").is_none() || cur.get("lines").is_none())
        {
            let mut backfilled = cur.clone();
            let errors =
                crate::modules::logistics::prepare_shipment(tx, t, &mut backfilled).await?;
            if !errors.is_empty() {
                return Err(ApiError::validation(&qname, errors));
            }
            cur = backfilled;
        }
        if qname == "einvoice.einvoice" {
            crate::modules::einvoice::prepare_action(ent.def.name.as_str(), action, &mut cur);
        }
        if qname == "contract.contract" && action == "amended" {
            let errors = crate::modules::contract::prepare_amendment(tx, t, &mut cur).await?;
            if !errors.is_empty() {
                return Err(ApiError::validation(&qname, errors));
            }
        }
        if (qname == "pos.pos_session" && action == "closed")
            || (qname == "pos.pos_order" && action == "refunded")
        {
            if qname == "pos.pos_session" {
                let errors =
                    crate::modules::pos::validate_session_close(&Value::Object(cur.clone()));
                if !errors.is_empty() {
                    return Err(ApiError::validation(&qname, errors));
                }
            }
            let errors =
                crate::modules::pos::prepare_action(tx, t, ent.def.name.as_str(), action, &mut cur)
                    .await?;
            if !errors.is_empty() {
                return Err(ApiError::validation(&qname, errors));
            }
        }
        if (qname == "sales.sales_order" && action == "confirmed")
            || (qname == "pos.pos_order" && matches!(action, "completed" | "refunded"))
            || (qname == "purchasing.purchase_order" && action == "received")
            || (qname == "purchasing.purchase_return" && action == "dispatched")
        {
            let errors = if qname.starts_with("sales.") {
                crate::modules::sales::prepare_document(tx, t, ent.def.name.as_str(), &mut cur)
                    .await?
            } else if qname.starts_with("purchasing.") {
                crate::modules::purchasing::prepare_document(tx, t, ent.def.name.as_str(), &mut cur)
                    .await?
            } else {
                crate::modules::pos::prepare_document(tx, t, &mut cur).await?
            };
            if !errors.is_empty() {
                return Err(ApiError::validation(&qname, errors));
            }
        }
        if (qname == "sales.sales_order" && action == "confirmed")
            || (qname == "pos.pos_order" && action == "completed")
        {
            let errors = crate::modules::loyalty::apply_voucher_to_order(tx, t, &mut cur).await?;
            if !errors.is_empty() {
                return Err(ApiError::validation(&qname, errors));
            }
        }
        if qname == "restaurant.table_order" && action == "completed" {
            let errors = crate::modules::restaurant::prepare_order(tx, t, &mut cur, false).await?;
            if !errors.is_empty() {
                return Err(ApiError::validation(&qname, errors));
            }
        }
        if qname.starts_with("utilities.") {
            let errors =
                crate::modules::utilities::prepare_document(tx, t, ent.def.name.as_str(), &mut cur)
                    .await?;
            if !errors.is_empty() {
                return Err(ApiError::validation(&qname, errors));
            }
        }
        if qname.starts_with("agriculture.") {
            let errors =
                crate::modules::agriculture::prepare_document(ent.def.name.as_str(), &mut cur);
            if !errors.is_empty() {
                return Err(ApiError::validation(&qname, errors));
            }
        }
        if matches!(action, "done" | "completed" | "dispensed") {
            let errors = crate::modules::inventory::prepare_tracked_lines(
                tx,
                t,
                ent.def.name.as_str(),
                &mut cur,
            )
            .await?;
            if !errors.is_empty() {
                return Err(ApiError::validation(&qname, errors));
            }
        }
        if qname == "inventory.stock_count" && action == "submitted" {
            let errors = crate::modules::inventory::prepare_stock_count(tx, t, &mut cur).await?;
            if !errors.is_empty() {
                return Err(ApiError::validation(&qname, errors));
            }
        }
        if qname == "inventory.stock_count" && action == "approved" {
            let errors = crate::modules::inventory::validate_expiry_writeoff_quality_holds(
                tx,
                t,
                &Value::Object(cur.clone()),
            )
            .await?;
            if !errors.is_empty() {
                return Err(ApiError::validation(&qname, errors));
            }
        }
        if qname == "accounting.bank_statement_line" && action == "matched" {
            let errors = crate::modules::accounting::prepare_match(
                tx,
                t,
                ent.def.name.as_str(),
                action,
                &mut cur,
            )
            .await?;
            if !errors.is_empty() {
                return Err(ApiError::validation(&qname, errors));
            }
        }
        if qname == "manufacturing.production_order" && action == "done" {
            let errors = crate::modules::manufacturing::prepare_completion(&mut cur);
            if !errors.is_empty() {
                return Err(ApiError::validation(&qname, errors));
            }
        }
        let mut domain_errors =
            crate::modules::validate_action(&qname, action, &Value::Object(cur.clone()));
        domain_errors.extend(crate::modules::inventory::validate_source_action(
            &qname,
            action,
            &Value::Object(cur.clone()),
        ));
        if !domain_errors.is_empty() {
            return Err(ApiError::validation(&qname, domain_errors));
        }
        if matches!(
            (qname.as_str(), action),
            (
                "asset.asset",
                "activated" | "opening_balance_recorded" | "disposed"
            ) | ("asset.depreciation", "posted")
        ) {
            self.ensure_fixed_asset_accounts_in(tx, t, opts).await?;
        }
        if qname == "manufacturing.production_order" && action == "done" {
            self.ensure_manufacturing_account_in(tx, t, opts).await?;
        }
        let mut persistence_errors = crate::modules::validate_persistence(
            tx,
            t,
            &qname,
            action,
            &Value::Object(cur.clone()),
        )
        .await?;
        persistence_errors.extend(
            crate::modules::inventory::validate_source_persistence(
                tx,
                t,
                &qname,
                &Value::Object(cur.clone()),
            )
            .await?,
        );
        if !persistence_errors.is_empty() {
            return Err(ApiError::validation(&qname, persistence_errors));
        }
        let from = cur
            .get(&states.field)
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if !tr.from.contains(&from) {
            return Err(ApiError::new(
                409,
                "INVALID_STATE",
                format!(
                    "{qname}.{action}: trạng thái hiện tại \"{from}\", chỉ cho phép từ {}",
                    tr.from.join("|")
                ),
            ));
        }
        let voucher_source = match (qname.as_str(), action) {
            ("sales.sales_order", "confirmed") => Some("sales_order"),
            ("pos.pos_order", "completed") => Some("pos_order"),
            _ => None,
        };
        if let Some(source) = voucher_source {
            let errors = crate::modules::loyalty::redeem_for_order(
                self,
                tx,
                t,
                &Value::Object(cur.clone()),
                source,
                opts,
            )
            .await?;
            if !errors.is_empty() {
                return Err(ApiError::validation(&qname, errors));
            }
        }
        cur.insert(states.field.clone(), json!(tr.to));
        cur.insert("updatedAt".into(), json!(now_iso()));
        self.check_constraints(tx, t, ent, &cur).await?;
        self.write_row(tx, t, ent, &cur).await?;
        self.audit(
            tx,
            t,
            actor,
            action,
            &format!("{qname}#{id}"),
            Some(format!("{from}→{}", tr.to)),
        )
        .await?;
        let rec = Value::Object(cur);
        let mut event_payload = rec.clone();
        if action == "submitted"
            && let Actor::User { id, .. } = actor
            && let Value::Object(payload) = &mut event_payload
        {
            payload.insert("_approval_actor_id".into(), json!(id));
        }
        self.emit(tx, t, &format!("{qname}.{action}"), event_payload, opts)
            .await?;
        if ((qname == "accounting.journal_entry" && action == "posted")
            || (qname == "budget.budget" && action == "approved"))
            && t.has_module("budget")
        {
            crate::modules::budget::refresh_actuals(tx, t).await?;
        }
        if action == "posted" {
            let related = match qname.as_str() {
                "accounting.invoice" => rec
                    .get("id")
                    .and_then(Value::as_str)
                    .map(|id| ("accounting.invoice", id)),
                "accounting.bill" => rec
                    .get("id")
                    .and_then(Value::as_str)
                    .map(|id| ("accounting.bill", id)),
                "accounting.credit_note" => rec
                    .get("invoice")
                    .and_then(Value::as_str)
                    .map(|id| ("accounting.invoice", id)),
                "accounting.debit_note" => rec
                    .get("bill")
                    .and_then(Value::as_str)
                    .map(|id| ("accounting.bill", id)),
                _ => None,
            };
            if let Some((document, document_id)) = related {
                self.reconcile_account_balance_in(
                    tx,
                    &Actor::System,
                    t,
                    document,
                    document_id,
                    opts,
                )
                .await?;
            }
        }
        Ok(rec)
    }
}

fn segregation_reference(qname: &str, action: &str) -> Option<&'static str> {
    match (qname, action) {
        ("inventory.stock_count", "approved" | "rejected") => Some("create"),
        ("accounting.settlement_batch", "approved" | "rejected") => Some("create"),
        ("purchasing.rfq", "accepted") => Some("create"),
        ("construction.boq", "approved") => Some("create"),
        ("lending.loan", "approved" | "rejected") => Some("create"),
        ("lending.loan", "disbursed") => Some("approved"),
        ("insurance.claim", "approved" | "rejected") => Some("create"),
        ("insurance.claim", "paid") => Some("approved"),
        ("contract.amendment", "approved" | "rejected") => Some("create"),
        _ => None,
    }
}
