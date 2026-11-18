use super::super::shared::*;

impl Kernel {
    #[async_recursion]
    pub(crate) async fn update_in(
        &self,
        tx: &Tx<'_>,
        actor: &Actor,
        t: &Tenant,
        ent: &Ent,
        id: &str,
        mut patch: Obj,
        opts: &Opts,
    ) -> R<Value> {
        let qname = ent.qname();
        if qname.starts_with("consolidation.")
            && matches!(actor, Actor::User { .. })
            && matches!(
                qname.as_str(),
                "consolidation.member"
                    | "consolidation.shared_company"
                    | "consolidation.report_grant"
                    | "consolidation.report_snapshot"
            )
        {
            return Err(ApiError::forbidden(
                "This company-group record can only be changed through its dedicated workflow endpoint",
            ));
        }
        if qname.starts_with("loyalty.") {
            crate::modules::loyalty::prepare_document(ent.def.name.as_str(), &mut patch);
        }
        // Serialize updates with other updates and state transitions before
        // validating the current record.
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
            return Err(ApiError::not_found(format!("Không tìm thấy {qname} {id}")));
        }
        let mut cur = self
            .get_row(tx, t, &qname, id)
            .await?
            .ok_or_else(|| ApiError::not_found(format!("Không tìm thấy {qname} {id}")))?;
        if qname == "integration-hub.connector"
            && let (Some(previous), Some(replacement)) =
                (cur.get("config"), patch.get_mut("config"))
        {
            crate::modules::integration_hub::restore_redacted_credentials(
                Some(previous),
                replacement,
            );
        }
        let domain_errors = if matches!(actor, Actor::System) {
            Vec::new()
        } else {
            crate::modules::validate_update(
                &qname,
                &Value::Object(cur.clone()),
                &Value::Object(patch.clone()),
            )
        };
        if !domain_errors.is_empty() {
            return Err(ApiError::validation(&qname, domain_errors));
        }
        let errors = self.validate(tx, t, ent, &patch, false).await?;
        if !errors.is_empty() {
            return Err(ApiError::validation(&qname, errors));
        }
        if !matches!(actor, Actor::System)
            && patch.keys().any(|key| {
                ent.field(key).is_some_and(|field| field.system)
                    || ent
                        .def
                        .states
                        .as_ref()
                        .is_some_and(|states| states.field == key.as_str())
            })
        {
            return Err(ApiError::validation(
                &qname,
                vec!["Không được sửa trực tiếp trường hệ thống hoặc trạng thái; hãy dùng action tương ứng".into()],
            ));
        }
        let previous_total = cur.get("total").cloned();
        let previous_tax_total = cur.get("tax_total").cloned();
        let previous_lines = cur.get("lines").cloned();
        let previous_voucher_discount = cur.get("voucher_discount").cloned();
        let previous_return_invoice = (qname == "sales.sales_return")
            .then(|| cur.get("invoice").cloned())
            .flatten();
        let refresh_auto_prices = patch.contains_key("lines");
        let mut changed: Vec<String> = patch.keys().cloned().collect();
        for (k, v) in patch {
            if v.is_null() || v == json!("") {
                cur.remove(&k);
            } else {
                cur.insert(k, v);
            }
        }
        if qname == "field-service.work_order" {
            let errors = crate::modules::field_service::prepare_document(
                tx,
                t,
                &mut cur,
                refresh_auto_prices,
            )
            .await?;
            if !errors.is_empty() {
                return Err(ApiError::validation(&qname, errors));
            }
            if previous_total != cur.get("total").cloned()
                && !changed.iter().any(|key| key == "total")
            {
                changed.push("total".into());
            }
        }
        if qname == "ecommerce.web_order" {
            let errors = crate::modules::ecommerce::prepare_document(tx, t, &mut cur).await?;
            if !errors.is_empty() {
                return Err(ApiError::validation(&qname, errors));
            }
            if previous_total != cur.get("total").cloned()
                && !changed.iter().any(|key| key == "total")
            {
                changed.push("total".into());
            }
        }
        if qname == "accounting.account" {
            crate::modules::accounting::prepare_document(ent.def.name.as_str(), &mut cur);
        }
        if qname == "hotel.reservation"
            && matches!(
                cur.get("status").and_then(Value::as_str),
                Some("booked" | "checked_in")
            )
        {
            let errors =
                crate::modules::hotel::prepare_document(tx, t, ent.def.name.as_str(), &mut cur)
                    .await?;
            if !errors.is_empty() {
                return Err(ApiError::validation(&qname, errors));
            }
        }
        if qname == "expense.expense_claim"
            && matches!(
                cur.get("status").and_then(Value::as_str),
                Some("draft" | "rejected")
            )
        {
            let errors = crate::modules::expense::prepare_document(ent.def.name.as_str(), &mut cur);
            if !errors.is_empty() {
                return Err(ApiError::validation(&qname, errors));
            }
        }
        if qname.starts_with("integration-hub.") {
            crate::modules::integration_hub::prepare_document(ent.def.name.as_str(), &mut cur);
        }
        if qname.starts_with("insurance.") {
            let errors =
                crate::modules::insurance::prepare_document(ent.def.name.as_str(), &mut cur);
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
        if qname.starts_with("clinic.") {
            let errors =
                crate::modules::clinic::prepare_document(tx, t, ent.def.name.as_str(), &mut cur)
                    .await?;
            if !errors.is_empty() {
                return Err(ApiError::validation(&qname, errors));
            }
        }
        if qname.starts_with("construction.") {
            let errors = crate::modules::construction::prepare_document(
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
        if qname.starts_with("events.") {
            let errors = crate::modules::event_management::prepare_document(
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
        if qname.starts_with("case-management.") {
            let errors = crate::modules::case_management::prepare_document(
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
                refresh_auto_prices,
            )
            .await?;
            if !errors.is_empty() {
                return Err(ApiError::validation(&qname, errors));
            }
            if previous_total != cur.get("total").cloned()
                && !changed.iter().any(|key| key == "total")
            {
                changed.push("total".into());
            }
        }
        if qname.starts_with("payments.") {
            let errors =
                crate::modules::payments::prepare_document(tx, t, ent.def.name.as_str(), &mut cur)
                    .await?;
            if !errors.is_empty() {
                return Err(ApiError::validation(&qname, errors));
            }
        }
        if qname.starts_with("sales.")
            && matches!(
                cur.get("status").and_then(Value::as_str),
                Some("draft" | "rejected")
            )
        {
            let errors =
                crate::modules::sales::prepare_document(tx, t, ent.def.name.as_str(), &mut cur)
                    .await?;
            if !errors.is_empty() {
                return Err(ApiError::validation(&qname, errors));
            }
        }
        if qname == "pharmacy.prescription"
            && cur.get("status").and_then(Value::as_str) == Some("draft")
        {
            let errors =
                crate::modules::pharmacy::prepare_document(tx, t, ent.def.name.as_str(), &mut cur)
                    .await?;
            if !errors.is_empty() {
                return Err(ApiError::validation(&qname, errors));
            }
        }
        if qname == "booking.booking"
            && cur.get("status").and_then(Value::as_str) == Some("requested")
        {
            let errors = crate::modules::booking::prepare_update(
                tx,
                t,
                ent.def.name.as_str(),
                &mut cur,
                &changed,
            )
            .await?;
            if !errors.is_empty() {
                return Err(ApiError::validation(&qname, errors));
            }
        }
        if qname == "pos.pos_order" && cur.get("status").and_then(Value::as_str) == Some("open") {
            let errors = crate::modules::pos::prepare_document(tx, t, &mut cur).await?;
            if !errors.is_empty() {
                return Err(ApiError::validation(&qname, errors));
            }
            if previous_total != cur.get("total").cloned()
                && !changed.iter().any(|key| key == "total")
            {
                changed.push("total".into());
            }
            if previous_tax_total != cur.get("tax_total").cloned()
                && !changed.iter().any(|key| key == "tax_total")
            {
                changed.push("tax_total".into());
            }
        }
        if qname == "restaurant.table_order"
            && cur.get("status").and_then(Value::as_str) == Some("open")
        {
            let errors = crate::modules::restaurant::prepare_order(tx, t, &mut cur, true).await?;
            if !errors.is_empty() {
                return Err(ApiError::validation(&qname, errors));
            }
            if previous_total != cur.get("total").cloned()
                && !changed.iter().any(|key| key == "total")
            {
                changed.push("total".into());
            }
            if previous_tax_total != cur.get("tax_total").cloned()
                && !changed.iter().any(|key| key == "tax_total")
            {
                changed.push("tax_total".into());
            }
        }
        if qname.starts_with("purchasing.")
            && matches!(
                cur.get("status").and_then(Value::as_str),
                Some("draft" | "rejected")
            )
        {
            if qname == "purchasing.supplier_invoice"
                && changed
                    .iter()
                    .any(|field| matches!(field.as_str(), "currency" | "issue_date"))
            {
                cur.remove("exchange_rate");
                cur.remove("exchange_rate_date");
            }
            let errors = crate::modules::purchasing::prepare_document(
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
        if qname.starts_with("utilities.") {
            let errors =
                crate::modules::utilities::prepare_document(tx, t, ent.def.name.as_str(), &mut cur)
                    .await?;
            if !errors.is_empty() {
                return Err(ApiError::validation(&qname, errors));
            }
        }
        if qname.starts_with("insurance.") {
            let errors =
                crate::modules::insurance::prepare_document(ent.def.name.as_str(), &mut cur);
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
        if qname.starts_with("construction.") {
            let errors = crate::modules::construction::prepare_document(
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
        if qname.starts_with("events.") {
            let errors = crate::modules::event_management::prepare_document(
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
        if qname.starts_with("case-management.") {
            let errors = crate::modules::case_management::prepare_document(
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
        let tracked_errors = crate::modules::inventory::prepare_tracked_lines(
            tx,
            t,
            ent.def.name.as_str(),
            &mut cur,
        )
        .await?;
        if !tracked_errors.is_empty() {
            return Err(ApiError::validation(&qname, tracked_errors));
        }
        if qname == "manufacturing.bom"
            && matches!(
                cur.get("status").and_then(Value::as_str),
                Some("draft" | "rejected") | None
            )
        {
            let errors = crate::modules::manufacturing::prepare_bom(tx, t, &mut cur).await?;
            if !errors.is_empty() {
                return Err(ApiError::validation(&qname, errors));
            }
        }
        if qname.starts_with("sales.") {
            let errors = crate::modules::sales::recalculate_lines(&mut cur);
            if !errors.is_empty() {
                return Err(ApiError::validation(&qname, errors));
            }
        }
        if matches!(qname.as_str(), "sales.sales_order" | "pos.pos_order")
            && matches!(
                cur.get("status").and_then(Value::as_str),
                Some("draft" | "open")
            )
        {
            let errors = crate::modules::loyalty::apply_voucher_to_order(tx, t, &mut cur).await?;
            if !errors.is_empty() {
                return Err(ApiError::validation(&qname, errors));
            }
            if previous_total != cur.get("total").cloned()
                && !changed.iter().any(|key| key == "total")
            {
                changed.push("total".into());
            }
            if previous_tax_total != cur.get("tax_total").cloned()
                && !changed.iter().any(|key| key == "tax_total")
            {
                changed.push("tax_total".into());
            }
            if previous_lines != cur.get("lines").cloned()
                && !changed.iter().any(|key| key == "lines")
            {
                changed.push("lines".into());
            }
            if previous_voucher_discount != cur.get("voucher_discount").cloned()
                && !changed.iter().any(|key| key == "voucher_discount")
            {
                changed.push("voucher_discount".into());
            }
        }
        if qname == "logistics.shipment"
            && cur.get("status").and_then(Value::as_str) == Some("created")
        {
            // A line edit invalidates the derived weight from the previous snapshot.
            // An explicitly supplied weight is still checked against the new lines.
            if changed.iter().any(|field| field == "lines")
                && !changed.iter().any(|field| field == "weight")
            {
                cur.remove("weight");
            }
            let errors = crate::modules::logistics::prepare_shipment(tx, t, &mut cur).await?;
            if !errors.is_empty() {
                return Err(ApiError::validation(&qname, errors));
            }
        }
        if qname == "accounting.bank_statement_line"
            && changed
                .iter()
                .any(|field| matches!(field.as_str(), "statement" | "transaction_date" | "amount"))
        {
            let errors =
                crate::modules::accounting::prepare_bank_statement_line(tx, t, &mut cur).await?;
            if !errors.is_empty() {
                return Err(ApiError::validation(&qname, errors));
            }
        }
        let domain_errors =
            crate::modules::validate_document_for_tenant(t, &qname, &Value::Object(cur.clone()));
        if !domain_errors.is_empty() {
            return Err(ApiError::validation(&qname, domain_errors));
        }
        let persistence_action = if qname == "sales.sales_return"
            && changed.iter().any(|field| field == "invoice")
            && previous_return_invoice != cur.get("invoice").cloned()
        {
            "invoice_assigned"
        } else {
            "updated"
        };
        let persistence_errors = crate::modules::validate_persistence(
            tx,
            t,
            &qname,
            persistence_action,
            &Value::Object(cur.clone()),
        )
        .await?;
        if !persistence_errors.is_empty() {
            return Err(ApiError::validation(&qname, persistence_errors));
        }
        cur.insert("updatedAt".into(), json!(now_iso()));
        self.apply_computed(ent, &mut cur);
        self.check_constraints(tx, t, ent, &cur).await?;
        self.write_row(tx, t, ent, &cur).await?;
        self.audit(
            tx,
            t,
            actor,
            "update",
            &format!("{qname}#{id}"),
            Some(changed.join(",")),
        )
        .await?;
        let mut payload = cur.clone();
        payload.insert("_changed".into(), json!(changed));
        self.emit(
            tx,
            t,
            &format!("{qname}.updated"),
            Value::Object(payload),
            opts,
        )
        .await?;
        Ok(Value::Object(cur))
    }

    pub(in crate::kernel::data) async fn write_row(
        &self,
        tx: &Tx<'_>,
        t: &Tenant,
        ent: &Ent,
        rec: &Obj,
    ) -> R<()> {
        let uid = Uuid::parse_str(rec["id"].as_str().unwrap_or("")).map_err(ApiError::internal)?;
        tx.execute(
            &self.sql_for(&ent.qname()).update,
            &[&t.id, &uid, &self.db_object(t, ent, rec)],
        )
        .await?;
        Ok(())
    }
}
