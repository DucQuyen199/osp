//! Meter, reading, and issued utility-bill invariants.
use crate::money;
use chrono::{Datelike, NaiveDate};
use rust_decimal::Decimal;
use serde_json::Value;

fn decimal(document: &Value, field: &str) -> Option<Decimal> {
    document.get(field).and_then(money::decimal)
}

fn valid_tariff_tiers(tiers: &Value) -> bool {
    let Some(tiers) = tiers.as_array() else {
        return false;
    };
    if tiers.is_empty() {
        return true;
    }
    if tiers.len() > 20 {
        return false;
    }
    let mut previous = Decimal::ZERO;
    for (index, tier) in tiers.iter().enumerate() {
        if !decimal(tier, "rate").is_some_and(|rate| rate >= Decimal::ZERO) {
            return false;
        }
        match tier.get("up_to") {
            Some(Value::Null) if index == tiers.len() - 1 => return true,
            Some(Value::Null) => return false,
            Some(limit) => {
                let Some(limit) = money::decimal(limit) else {
                    return false;
                };
                if limit <= previous {
                    return false;
                }
                previous = limit;
            }
            None => return false,
        }
    }
    false
}

pub(super) fn calculate_charge(
    consumption: Decimal,
    flat_rate: Decimal,
    tiers: &Value,
) -> Option<(Decimal, Value)> {
    let tiers = tiers.as_array()?;
    if tiers.is_empty() {
        return Some((
            money::amount(consumption, flat_rate)?,
            Value::Array(Vec::new()),
        ));
    }
    if !valid_tariff_tiers(&Value::Array(tiers.clone())) || consumption < Decimal::ZERO {
        return None;
    }
    let mut lower = Decimal::ZERO;
    let mut total = Decimal::ZERO;
    let mut breakdown = Vec::new();
    for tier in tiers {
        let rate = decimal(tier, "rate")?;
        let upper = tier
            .get("up_to")
            .and_then(money::decimal)
            .unwrap_or(consumption);
        let units = consumption
            .min(upper)
            .checked_sub(lower)?
            .max(Decimal::ZERO);
        if units > Decimal::ZERO {
            let amount = money::amount(units, rate)?;
            total = total.checked_add(amount)?;
            breakdown.push(serde_json::json!({
                "units": money::json_number(units)?,
                "rate": money::json_number(rate)?,
                "amount": money::json_number(amount)?
            }));
        }
        if tier.get("up_to").is_some_and(Value::is_null) || consumption <= upper {
            break;
        }
        lower = upper;
    }
    if lower < consumption && !tiers.last()?.get("up_to").is_some_and(Value::is_null) {
        return None;
    }
    Some((total, Value::Array(breakdown)))
}

pub fn validate(entity: &str, document: &Value) -> Vec<String> {
    validate_at(entity, document, chrono::Utc::now().date_naive())
}

pub fn validate_at(entity: &str, document: &Value, today: NaiveDate) -> Vec<String> {
    match entity {
        "meter" => {
            let mut errors = Vec::new();
            if document
                .get("code")
                .and_then(Value::as_str)
                .is_none_or(|value| value.trim().is_empty())
            {
                errors.push("Công tơ cần có mã".into());
            }
            if !decimal(document, "rate").is_some_and(|value| value > Decimal::ZERO) {
                errors.push("Đơn giá công tơ phải lớn hơn 0".into());
            }
            if document.get("fixed_charge").is_some_and(|value| {
                !money::decimal(value).is_some_and(|charge| charge >= Decimal::ZERO)
            }) {
                errors.push("Phí cố định tiện ích không được âm".into());
            }
            if document
                .get("tariff_tiers")
                .is_some_and(|tiers| !valid_tariff_tiers(tiers))
            {
                errors.push("Bậc giá phải có ngưỡng tăng dần và bậc cuối không giới hạn".into());
            }
            if document.get("opening_reading").is_some_and(|value| {
                !money::decimal(value).is_some_and(|reading| reading >= Decimal::ZERO)
            }) {
                errors.push("Chỉ số mở đầu phải là số hữu hạn không âm".into());
            }
            errors
        }
        "meter_reading" => {
            let mut errors = Vec::new();
            if !decimal(document, "reading").is_some_and(|value| value >= Decimal::ZERO) {
                errors.push("Chỉ số công tơ phải là số không âm".into());
            }
            let period = document
                .get("period")
                .and_then(Value::as_str)
                .filter(|value| value.len() == 7)
                .and_then(|period| {
                    NaiveDate::parse_from_str(&format!("{period}-01"), "%Y-%m-%d").ok()
                });
            if let Some(period) = period {
                let current_period = today
                    .with_day(1)
                    .expect("the first day of a valid date exists");
                if period > current_period {
                    errors.push("Không thể ghi chỉ số cho kỳ trong tương lai".into());
                }
            } else {
                errors.push("Kỳ ghi chỉ số phải theo định dạng YYYY-MM".into());
            }
            let consumption = decimal(document, "consumption");
            let previous = decimal(document, "previous_reading");
            let reading = decimal(document, "reading");
            if !consumption.zip(previous.zip(reading)).is_some_and(
                |(consumption, (previous, reading))| {
                    consumption >= Decimal::ZERO
                        && reading >= previous
                        && previous.checked_add(consumption).is_some_and(|expected| {
                            money::within_tolerance(reading, expected, Decimal::new(1, 6))
                        })
                },
            ) {
                errors.push("Mức tiêu thụ phải bằng chỉ số hiện tại trừ chỉ số kỳ trước".into());
            }
            let rate = decimal(document, "rate");
            let amount = decimal(document, "amount");
            let base_amount = decimal(document, "base_amount");
            let fixed_charge = decimal(document, "fixed_charge");
            let tiers = document
                .get("tariff_tiers")
                .cloned()
                .unwrap_or_else(|| serde_json::json!([]));
            let valid_amount = consumption
                .zip(rate)
                .zip(base_amount.zip(fixed_charge))
                .and_then(|((consumption, rate), (base_amount, fixed_charge))| {
                    calculate_charge(consumption, rate, &tiers).and_then(|(expected_base, _)| {
                        expected_base
                            .checked_add(fixed_charge)
                            .map(|expected_total| {
                                (
                                    rate,
                                    base_amount,
                                    fixed_charge,
                                    expected_base,
                                    expected_total,
                                )
                            })
                    })
                })
                .is_some_and(
                    |(rate, base_amount, fixed_charge, expected_base, expected_total)| {
                        rate > Decimal::ZERO
                            && fixed_charge >= Decimal::ZERO
                            && money::within_tolerance(
                                base_amount,
                                expected_base,
                                Decimal::new(1, 4),
                            )
                            && amount.is_some_and(|amount| {
                                money::within_tolerance(amount, expected_total, Decimal::new(1, 4))
                            })
                    },
                );
            if !valid_amount {
                errors.push("Tiền phải khớp biểu giá và phí cố định đã chụp".into());
            }
            errors
        }
        "utility_bill" => {
            if !decimal(document, "amount").is_some_and(|value| value >= Decimal::ZERO) {
                vec!["Tiền hóa đơn phải là số không âm".into()]
            } else {
                Vec::new()
            }
        }
        _ => Vec::new(),
    }
}

pub fn validate_action(entity: &str, action: &str, document: &Value) -> Vec<String> {
    if entity == "utility_bill" && action == "issued" {
        return if document
            .get("amount")
            .and_then(money::decimal)
            .is_some_and(|amount| amount > Decimal::ZERO)
        {
            Vec::new()
        } else {
            vec!["Chỉ phát hành hóa đơn tiêu thụ có số tiền lớn hơn 0".into()]
        };
    }
    Vec::new()
}

pub fn validate_update(entity: &str, current: &Value, patch: &Value) -> Vec<String> {
    let changes = patch.as_object().is_some_and(|values| !values.is_empty());
    if !changes {
        return Vec::new();
    }
    if entity == "meter_reading" {
        return vec!["Chỉ số đã ghi nhận là lịch sử đo và không thể sửa".into()];
    }
    if entity == "utility_bill" && current.get("status").and_then(Value::as_str) != Some("draft") {
        return vec!["Hóa đơn đã phát hành hoặc thanh toán không thể sửa".into()];
    }
    Vec::new()
}

pub fn validate_remove(entity: &str, document: &Value) -> Vec<String> {
    match entity {
        "meter_reading" => vec!["Chỉ số đã ghi nhận không thể xóa khỏi lịch sử công tơ".into()],
        "utility_bill" if document.get("status").and_then(Value::as_str) != Some("draft") => {
            vec!["Hóa đơn đã phát hành hoặc thanh toán không thể xóa".into()]
        }
        _ => Vec::new(),
    }
}
