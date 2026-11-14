use super::shared::*;

impl Kernel {
    pub(super) async fn reconcile_account_balance_in(
        &self,
        tx: &Tx<'_>,
        actor: &Actor,
        t: &Tenant,
        qname: &str,
        id: &str,
        opts: &Opts,
    ) -> R<()> {
        let (fk, note_table, note_fk) = match qname {
            "accounting.invoice" => ("invoice", "accounting__credit_note", "invoice"),
            "accounting.bill" => ("bill", "accounting__debit_note", "bill"),
            _ => return Ok(()),
        };
        let ent = self.ent(t, qname)?;
        let mut record = self
            .get_row(tx, t, qname, id)
            .await?
            .ok_or_else(|| ApiError::not_found(format!("Không tìm thấy {qname} {id}")))?;
        let status = record
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        if !matches!(
            status.as_str(),
            "posted" | "partially_paid" | "partially_settled" | "paid" | "settled"
        ) {
            return Ok(());
        }
        let uid = Uuid::parse_str(id).map_err(ApiError::internal)?;
        let payment_sql = format!(
            "SELECT COALESCE(SUM(amount), 0)::text FROM accounting__payment WHERE tenant_id = $1 AND {fk} = $2"
        );
        let paid_text: String = tx
            .query_opt(&payment_sql, &[&t.id, &uid])
            .await?
            .map(|row| row.get(0))
            .unwrap_or_else(|| "0".into());
        let paid = money::decimal_str(&paid_text)
            .ok_or_else(|| ApiError::internal("invalid stored payment total"))?;
        let adjustment_sql = format!(
            "SELECT COALESCE(SUM(total), 0)::text FROM {note_table} WHERE tenant_id = $1 AND {note_fk} = $2 AND status = 'posted'"
        );
        let adjusted_text: String = tx
            .query_opt(&adjustment_sql, &[&t.id, &uid])
            .await?
            .map(|row| row.get(0))
            .unwrap_or_else(|| "0".into());
        let adjusted = money::decimal_str(&adjusted_text)
            .ok_or_else(|| ApiError::internal("invalid stored adjustment total"))?;
        let total = record
            .get("total")
            .and_then(money::decimal)
            .unwrap_or_default();
        let paid_changed = record
            .get("paid_amount")
            .and_then(money::decimal)
            .is_none_or(|current| {
                !money::within_tolerance(current, paid, rust_decimal::Decimal::new(1, 4))
            });
        let adjustment_changed = record
            .get("adjustment_amount")
            .and_then(money::decimal)
            .is_none_or(|current| {
                !money::within_tolerance(current, adjusted, rust_decimal::Decimal::new(1, 4))
            });
        let balance_due = total
            .checked_sub(paid)
            .and_then(|balance| balance.checked_sub(adjusted))
            .ok_or_else(|| ApiError::internal("accounting balance exceeds Decimal range"))?
            .max(rust_decimal::Decimal::ZERO);
        let balance_changed = record
            .get("balance_due")
            .and_then(money::decimal)
            .is_none_or(|current| {
                !money::within_tolerance(current, balance_due, rust_decimal::Decimal::new(1, 4))
            });
        if paid_changed || adjustment_changed || balance_changed {
            let paid_value = money::json_number(paid)
                .ok_or_else(|| ApiError::internal("payment total exceeds JSON Decimal range"))?;
            let adjusted_value = money::json_number(adjusted)
                .ok_or_else(|| ApiError::internal("adjustment total exceeds JSON Decimal range"))?;
            let balance_value = money::json_number(balance_due)
                .ok_or_else(|| ApiError::internal("balance due exceeds JSON Decimal range"))?;
            self.update_in(
                tx,
                &Actor::System,
                t,
                &ent,
                id,
                Obj::from_iter([
                    ("paid_amount".into(), paid_value.clone()),
                    ("adjustment_amount".into(), adjusted_value.clone()),
                    ("balance_due".into(), balance_value.clone()),
                ]),
                opts,
            )
            .await?;
            record.insert("paid_amount".into(), paid_value);
            record.insert("adjustment_amount".into(), adjusted_value);
            record.insert("balance_due".into(), balance_value);
        }
        let covered = paid
            .checked_add(adjusted)
            .ok_or_else(|| ApiError::internal("settled total exceeds Decimal range"))?;
        let tolerance = rust_decimal::Decimal::new(5, 3);
        let reached_total = total
            .checked_sub(tolerance)
            .is_none_or(|minimum| covered >= minimum);
        let paid_total = total
            .checked_sub(tolerance)
            .is_none_or(|minimum| paid >= minimum);
        let action = if reached_total {
            if paid_total {
                Some("paid")
            } else {
                Some("settled")
            }
        } else if adjusted > tolerance {
            Some("partially_settled")
        } else if paid > tolerance {
            Some("partially_paid")
        } else if matches!(
            status.as_str(),
            "paid" | "partially_paid" | "partially_settled"
        ) {
            Some("reopened")
        } else {
            None
        };
        if let Some(action) = action {
            if record.get("status").and_then(Value::as_str) != Some(action) {
                self.act_in(tx, actor, t, &ent, id, action, opts).await?;
            }
        }
        Ok(())
    }

    pub(super) async fn ensure_fixed_asset_accounts_in(
        &self,
        tx: &Tx<'_>,
        t: &Tenant,
        opts: &Opts,
    ) -> R<()> {
        let ent = self.ent(t, "accounting.account")?;
        for (code, name, kind) in [
            ("111", "Tiền mặt", "asset"),
            ("112", "Tiền gửi ngân hàng", "asset"),
            ("211", "Tài sản cố định hữu hình", "asset"),
            ("214", "Hao mòn tài sản cố định", "asset"),
            ("411", "Vốn chủ sở hữu", "equity"),
            ("642", "Chi phí quản lý doanh nghiệp", "expense"),
        ] {
            if tx
                .query_opt(
                    "SELECT 1 FROM accounting__account WHERE tenant_id = $1 AND code = $2 LIMIT 1",
                    &[&t.id, &code],
                )
                .await?
                .is_none()
            {
                let data = serde_json::json!({ "code": code, "name": name, "kind": kind })
                    .as_object()
                    .cloned()
                    .unwrap_or_default();
                self.create_in(tx, &Actor::System, t, &ent, data, opts)
                    .await?;
            }
        }
        Ok(())
    }

    pub(super) async fn ensure_manufacturing_account_in(
        &self,
        tx: &Tx<'_>,
        t: &Tenant,
        opts: &Opts,
    ) -> R<()> {
        let lock_key = format!("accounting.account:{}:154", t.id);
        tx.query_opt(
            "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
            &[&lock_key],
        )
        .await?;
        if tx
            .query_opt(
                "SELECT 1 FROM accounting__account WHERE tenant_id = $1 AND code = '154' LIMIT 1",
                &[&t.id],
            )
            .await?
            .is_none()
        {
            let ent = self.ent(t, "accounting.account")?;
            let data = serde_json::json!({
                "code": "154",
                "name": "Chi phí sản xuất, kinh doanh dở dang",
                "kind": "asset"
            })
            .as_object()
            .cloned()
            .unwrap_or_default();
            self.create_in(tx, &Actor::System, t, &ent, data, opts)
                .await?;
        }
        Ok(())
    }
}
