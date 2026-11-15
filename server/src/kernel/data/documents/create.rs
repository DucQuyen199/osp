use super::super::shared::*;

impl Kernel {
    #[async_recursion]
    pub(crate) async fn create_in(
        &self,
        tx: &Tx<'_>,
        actor: &Actor,
        t: &Tenant,
        ent: &Ent,
        data: Obj,
        opts: &Opts,
    ) -> R<Value> {
        let qname = ent.qname();
        let mut clean: Obj = data
            .into_iter()
            .filter(|(_, v)| !v.is_null() && v != &json!(""))
            .collect();
        // Keep the original request keys separate from values added by module
        // preparation so generated system fields remain writable internally.
        let user_supplied_system_fields = clean
            .keys()
            .filter(|key| ent.field(key).is_some_and(|field| field.system))
            .cloned()
            .collect::<Vec<_>>();
        if qname == "accounting.account" {
            crate::modules::accounting::prepare_document(ent.def.name.as_str(), &mut clean);
        }
        if qname == "accounting.bank_statement" {
            let errors =
                crate::modules::accounting::prepare_bank_statement(tx, t, &mut clean).await?;
            if !errors.is_empty() {
                return Err(ApiError::validation(&qname, errors));
            }
        }
        if qname == "accounting.bank_statement_line" {
            let errors =
                crate::modules::accounting::prepare_bank_statement_line(tx, t, &mut clean).await?;
            if !errors.is_empty() {
                return Err(ApiError::validation(&qname, errors));
            }
        }
        if qname == "asset.asset" {
            let errors =
                crate::modules::asset::prepare_asset_document(ent.def.name.as_str(), &mut clean);
            if !errors.is_empty() {
                return Err(ApiError::validation(&qname, errors));
            }
        }
        if qname.starts_with("integration-hub.") {
            crate::modules::integration_hub::prepare_document(ent.def.name.as_str(), &mut clean);
        }
        if qname.starts_with("insurance.") {
            let errors =
                crate::modules::insurance::prepare_document(ent.def.name.as_str(), &mut clean);
            if !errors.is_empty() {
                return Err(ApiError::validation(&qname, errors));
            }
        }
        if qname.starts_with("agriculture.") {
            let errors =
                crate::modules::agriculture::prepare_document(ent.def.name.as_str(), &mut clean);
            if !errors.is_empty() {
                return Err(ApiError::validation(&qname, errors));
            }
        }
        if qname == "agriculture.input_application" {
            let errors = crate::modules::agriculture::prepare_stock_quantity(
                tx,
                t,
                ent.def.name.as_str(),
                &mut clean,
            )
            .await?;
            if !errors.is_empty() {
                return Err(ApiError::validation(&qname, errors));
            }
            let errors =
                crate::modules::agriculture::prepare_input_application(tx, t, &mut clean).await?;
            if !errors.is_empty() {
                return Err(ApiError::validation(&qname, errors));
            }
        }
        if qname == "agriculture.harvest" {
            let errors = crate::modules::agriculture::prepare_stock_quantity(
                tx,
                t,
                ent.def.name.as_str(),
                &mut clean,
            )
            .await?;
            if !errors.is_empty() {
                return Err(ApiError::validation(&qname, errors));
            }
        }
        if qname.starts_with("clinic.") {
            let errors =
                crate::modules::clinic::prepare_document(tx, t, ent.def.name.as_str(), &mut clean)
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
                &mut clean,
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
                &mut clean,
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
                &mut clean,
            )
            .await?;
            if !errors.is_empty() {
                return Err(ApiError::validation(&qname, errors));
            }
        }
        if qname.starts_with("school.") {
            let errors =
                crate::modules::school::prepare_document(tx, t, ent.def.name.as_str(), &mut clean)
                    .await?;
            if !errors.is_empty() {
                return Err(ApiError::validation(&qname, errors));
            }
        }
        if qname.starts_with("marketing.") {
            let errors =
                crate::modules::marketing::prepare_document(ent.def.name.as_str(), &mut clean);
            if !errors.is_empty() {
                return Err(ApiError::validation(&qname, errors));
            }
        }
        if qname.starts_with("lms.") {
            let errors = crate::modules::lms::prepare_document(ent.def.name.as_str(), &mut clean);
            if !errors.is_empty() {
                return Err(ApiError::validation(&qname, errors));
            }
        }
        if qname.starts_with("helpdesk.") {
            let errors =
                crate::modules::helpdesk::prepare_document(ent.def.name.as_str(), &mut clean);
            if !errors.is_empty() {
                return Err(ApiError::validation(&qname, errors));
            }
        }
        if qname.starts_with("charity.") {
            crate::modules::charity::prepare_document(ent.def.name.as_str(), &mut clean);
        }
        if qname.starts_with("hrm.") {
            crate::modules::hrm::prepare_document(ent.def.name.as_str(), &mut clean);
        }
        if qname.starts_with("master-data.") {
            let errors =
                crate::modules::master_data::prepare_document(ent.def.name.as_str(), &mut clean);
            if !errors.is_empty() {
                return Err(ApiError::validation(&qname, errors));
            }
        }
        if qname.starts_with("project.") {
            let errors =
                crate::modules::project::prepare_document(ent.def.name.as_str(), &mut clean);
            if !errors.is_empty() {
                return Err(ApiError::validation(&qname, errors));
            }
        }
        if qname.starts_with("performance.") {
            let errors =
                crate::modules::performance::prepare_document(ent.def.name.as_str(), &mut clean);
            if !errors.is_empty() {
                return Err(ApiError::validation(&qname, errors));
            }
        }
        if qname.starts_with("document.") {
            let errors =
                crate::modules::document::prepare_document(ent.def.name.as_str(), &mut clean);
            if !errors.is_empty() {
                return Err(ApiError::validation(&qname, errors));
            }
        }
        if qname.starts_with("bi.") {
            let errors = crate::modules::bi::prepare_document(ent.def.name.as_str(), &mut clean);
            if !errors.is_empty() {
                return Err(ApiError::validation(&qname, errors));
            }
        }
        if qname.starts_with("auto-service.") {
            let errors = crate::modules::auto_service::prepare_document(
                tx,
                t,
                ent.def.name.as_str(),
                &mut clean,
                true,
            )
            .await?;
            if !errors.is_empty() {
                return Err(ApiError::validation(&qname, errors));
            }
        }
        if qname == "field-service.work_order" {
            let errors =
                crate::modules::field_service::prepare_document(tx, t, &mut clean, true).await?;
            if !errors.is_empty() {
                return Err(ApiError::validation(&qname, errors));
            }
        }
        if qname == "ecommerce.web_order" {
            let errors = crate::modules::ecommerce::prepare_document(tx, t, &mut clean).await?;
            if !errors.is_empty() {
                return Err(ApiError::validation(&qname, errors));
            }
        }
        if qname == "expense.expense_claim" {
            let errors =
                crate::modules::expense::prepare_document(ent.def.name.as_str(), &mut clean);
            if !errors.is_empty() {
                return Err(ApiError::validation(&qname, errors));
            }
        }
        if qname == "asset.asset" && !clean.contains_key("accumulated_depreciation") {
            clean.insert(
                "accumulated_depreciation".into(),
                crate::modules::asset::initial_accumulated_depreciation(),
            );
        }
        if qname == "budget.budget_line" && !clean.contains_key("actual") {
            clean.insert("actual".into(), json!(0.0));
        }
        let mut errors = self.validate(tx, t, ent, &clean, true).await?;
        if !matches!(actor, Actor::System) && !user_supplied_system_fields.is_empty() {
            errors.push("Không được gửi trực tiếp trường dữ liệu do hệ thống tính".into());
        }
        if errors.is_empty() && qname == "logistics.shipment" {
            errors.extend(crate::modules::logistics::prepare_shipment(tx, t, &mut clean).await?);
        }
        if errors.is_empty() && qname.starts_with("booking.") {
            errors.extend(
                crate::modules::booking::prepare_document(tx, t, ent.def.name.as_str(), &mut clean)
                    .await?,
            );
        }
        if errors.is_empty() && qname.starts_with("sales.") {
            errors.extend(
                crate::modules::sales::prepare_document(tx, t, ent.def.name.as_str(), &mut clean)
                    .await?,
            );
        }
        if errors.is_empty() && qname.starts_with("purchasing.") {
            errors.extend(
                crate::modules::purchasing::prepare_document(
                    tx,
                    t,
                    ent.def.name.as_str(),
                    &mut clean,
                )
                .await?,
            );
        }
        if errors.is_empty() && qname == "pos.pos_order" {
            errors.extend(crate::modules::pos::prepare_document(tx, t, &mut clean).await?);
        }
        if errors.is_empty() && qname.starts_with("pharmacy.") {
            errors.extend(
                crate::modules::pharmacy::prepare_document(
                    tx,
                    t,
                    ent.def.name.as_str(),
                    &mut clean,
                )
                .await?,
            );
        }
        if errors.is_empty() && qname.starts_with("payments.") {
            errors.extend(
                crate::modules::payments::prepare_document(
                    tx,
                    t,
                    ent.def.name.as_str(),
                    &mut clean,
                )
                .await?,
            );
        }
        if errors.is_empty() && qname.starts_with("subscription.") {
            errors.extend(
                crate::modules::subscription::prepare_document(
                    tx,
                    t,
                    ent.def.name.as_str(),
                    &mut clean,
                )
                .await?,
            );
        }
        if errors.is_empty() && qname.starts_with("hotel.") {
            errors.extend(
                crate::modules::hotel::prepare_document(tx, t, ent.def.name.as_str(), &mut clean)
                    .await?,
            );
        }
        if errors.is_empty() && qname.starts_with("utilities.") {
            errors.extend(
                crate::modules::utilities::prepare_document(
                    tx,
                    t,
                    ent.def.name.as_str(),
                    &mut clean,
                )
                .await?,
            );
        }
        if errors.is_empty() && qname == "restaurant.table_order" {
            errors
                .extend(crate::modules::restaurant::prepare_order(tx, t, &mut clean, true).await?);
        }
        if errors.is_empty() {
            errors.extend(
                crate::modules::inventory::prepare_tracked_lines(
                    tx,
                    t,
                    ent.def.name.as_str(),
                    &mut clean,
                )
                .await?,
            );
        }
        if errors.is_empty() && qname == "manufacturing.bom" {
            errors.extend(crate::modules::manufacturing::prepare_bom(tx, t, &mut clean).await?);
        }
        if errors.is_empty() && qname == "accounting.payment" {
            errors.extend(
                crate::modules::accounting::prepare_payment_currency(tx, t, &mut clean).await?,
            );
        }
        errors.extend(crate::modules::validate_document(
            &qname,
            &Value::Object(clean.clone()),
        ));
        if errors.is_empty() && qname == "asset.depreciation" {
            errors.extend(crate::modules::asset::prepare_depreciation(tx, t, &mut clean).await?);
        }
        if errors.is_empty() {
            if ent.def.system_managed && !matches!(actor, Actor::System) {
                errors.push("Bản ghi này chỉ được tạo từ luồng nghiệp vụ Rust của hệ thống".into());
            }
            if qname == "inventory.stock_move" {
                if matches!(actor, Actor::System) {
                    errors.extend(
                        crate::modules::inventory::prepare_stock_move(tx, t, &mut clean).await?,
                    );
                }
            }
        }
        if errors.is_empty() {
            errors.extend(
                crate::modules::validate_persistence(
                    tx,
                    t,
                    &qname,
                    "created",
                    &Value::Object(clean.clone()),
                )
                .await?,
            );
        }
        if !errors.is_empty() {
            return Err(ApiError::validation(&qname, errors));
        }
        let now = now_iso();
        let mut rec: Obj = Obj::new();
        rec.insert("id".into(), json!(Uuid::new_v4().to_string()));
        rec.insert("createdAt".into(), json!(now));
        rec.insert("updatedAt".into(), json!(now));
        rec.extend(clean);
        if let Some(s) = &ent.def.states {
            rec.insert(s.field.clone(), json!(s.initial));
        }
        self.apply_computed(ent, &mut rec);
        self.check_constraints(tx, t, ent, &rec).await?;
        tx.execute(
            &self.sql_for(&qname).insert,
            &[&self.db_object(t, ent, &rec)],
        )
        .await?;
        let id = rec["id"].as_str().unwrap_or("").to_string();
        self.audit(tx, t, actor, "create", &format!("{qname}#{id}"), None)
            .await?;
        let rec = Value::Object(rec);
        self.emit(tx, t, &format!("{qname}.created"), rec.clone(), opts)
            .await?;
        if qname == "accounting.payment" {
            for (field, document) in [
                ("invoice", "accounting.invoice"),
                ("bill", "accounting.bill"),
            ] {
                if let Some(target_id) = rec.get(field).and_then(Value::as_str) {
                    self.reconcile_account_balance_in(
                        tx,
                        &Actor::System,
                        t,
                        document,
                        target_id,
                        opts,
                    )
                    .await?;
                }
            }
        }
        Ok(rec)
    }
}
