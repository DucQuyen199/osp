use super::*;

pub(super) async fn handle(
    kernel: &Kernel,
    tx: &Tx<'_>,
    tenant: &Tenant,
    event_type: &str,
    event: &Value,
    event_id: Uuid,
    depth: u32,
) -> R<Option<bool>> {
    let original_id = event
        .get("id")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
        .ok_or_else(|| {
            crate::error::ApiError::validation(
                event_type,
                vec!["Bút toán đảo cần mã bút toán gốc hợp lệ".into()],
            )
        })?;
    let original_lines = event
        .get("lines")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            crate::error::ApiError::validation(
                event_type,
                vec!["Bút toán đảo cần các dòng Nợ/Có gốc".into()],
            )
        })?;
    let mut reversal_lines = Vec::with_capacity(original_lines.len());
    let mut amount = Decimal::ZERO;
    for line in original_lines {
        let account = line
            .get("account")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
            .ok_or_else(|| {
                crate::error::ApiError::validation(
                    event_type,
                    vec!["Bút toán gốc có tài khoản không hợp lệ".into()],
                )
            })?;
        let debit = line
            .get("debit")
            .and_then(crate::money::decimal)
            .ok_or_else(|| {
                crate::error::ApiError::validation(
                    event_type,
                    vec!["Original journal contains an invalid debit amount".into()],
                )
            })?;
        let credit = line
            .get("credit")
            .and_then(crate::money::decimal)
            .ok_or_else(|| {
                crate::error::ApiError::validation(
                    event_type,
                    vec!["Original journal contains an invalid credit amount".into()],
                )
            })?;
        amount = amount
            .checked_add(debit)
            .ok_or_else(|| overflow_error(event_type))?;
        let mut reversal_line = journal_line_decimal(account, credit, debit)?;
        if let Some(department) = line.get("department").filter(|value| !value.is_null()) {
            reversal_line["department"] = department.clone();
        }
        reversal_lines.push(reversal_line);
    }
    if amount <= Decimal::ZERO {
        return Err(crate::error::ApiError::validation(
            event_type,
            vec!["Tổng tiền bút toán gốc phải lớn hơn 0".into()],
        ));
    }
    let original_memo = event
        .get("memo")
        .and_then(Value::as_str)
        .unwrap_or("Bút toán");
    let entity = kernel.ent(tenant, "accounting.journal_entry")?;
    let opts = Opts {
        depth: Some(depth + 1),
        causation: Some(event_id),
        silent: false,
    };
    let mut data = Map::new();
    data.insert(
        "memo".into(),
        Value::String(format!("Đảo: {original_memo}")),
    );
    data.insert(
        "amount".into(),
        crate::money::json_number(amount).ok_or_else(|| overflow_error(event_type))?,
    );
    data.insert(
        "posting_date".into(),
        Value::String(chrono::Utc::now().date_naive().to_string()),
    );
    data.insert("lines".into(), Value::Array(reversal_lines));
    data.insert("source".into(), Value::String("reversal".into()));
    data.insert("source_id".into(), Value::String(original_id.to_string()));
    let reversal = kernel
        .create_in(tx, &Actor::System, tenant, &entity, data, &opts)
        .await?;
    let reversal_id = reversal["id"]
        .as_str()
        .ok_or_else(|| crate::error::ApiError::internal("Created reversal journal has no id"))?;
    kernel
        .act_in(
            tx,
            &Actor::System,
            tenant,
            &entity,
            reversal_id,
            "posted",
            &opts,
        )
        .await?;
    Ok(Some(true))
}
