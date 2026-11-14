//! Meter, reading, and issued utility-bill invariants.
use crate::money;
use chrono::{Datelike, NaiveDate};
use rust_decimal::Decimal;
use serde_json::Value;

fn decimal(document: &Value, field: &str) -> Option<Decimal> {
    document.get(field).and_then(money::decimal)
}

pub fn validate(entity: &str, document: &Value) -> Vec<String> {
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
                let current_period = chrono::Utc::now()
                    .date_naive()
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
            if !consumption
                .zip(rate.zip(amount))
                .is_some_and(|(consumption, (rate, amount))| {
                    rate > Decimal::ZERO
                        && amount >= Decimal::ZERO
                        && money::amount(consumption, rate).is_some_and(|expected| {
                            money::within_tolerance(amount, expected, Decimal::new(1, 4))
                        })
                })
            {
                errors.push("Tiền ghi nhận phải bằng mức tiêu thụ nhân đơn giá tại kỳ đo".into());
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
