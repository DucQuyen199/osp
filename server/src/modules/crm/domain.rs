//! Pure CRM validation and lifecycle guards.
use crate::money;
use rust_decimal::Decimal;
use serde_json::Value;
use uuid::Uuid;

fn amount(document: &Value) -> Option<Decimal> {
    document.get("amount").and_then(money::decimal)
}

pub fn validate(entity: &str, document: &Value) -> Vec<String> {
    match entity {
        "lead" => {
            let mut errors = Vec::new();
            if document
                .get("name")
                .and_then(Value::as_str)
                .is_some_and(|name| name.trim().is_empty())
            {
                errors.push("Lead name cannot be empty".into());
            }
            if document
                .get("email")
                .and_then(Value::as_str)
                .is_some_and(|email| !email.trim().is_empty() && !email.contains('@'))
            {
                errors.push("Lead email must be a valid address".into());
            }
            errors
        }
        "deal" => {
            let mut errors = Vec::new();
            if document.get("amount").is_some_and(|value| {
                !money::decimal(value).is_some_and(|amount| amount >= Decimal::ZERO)
            }) {
                errors.push("Deal amount must be non-negative".into());
            }
            if document.get("probability").is_some_and(|value| {
                !money::decimal(value).is_some_and(|probability| {
                    (Decimal::ZERO..=Decimal::ONE_HUNDRED).contains(&probability)
                })
            }) {
                errors.push("Deal probability must be between 0 and 100".into());
            }
            if let Some(stage) = document
                .get("pipeline_stage")
                .and_then(Value::as_str)
                .filter(|stage| !stage.trim().is_empty())
            {
                if !valid_stage_code(stage) {
                    errors.push("Mã giai đoạn phải dùng chữ thường, số và dấu gạch dưới".into());
                }
            }
            errors
        }
        "pipeline_stage" => {
            let mut errors = Vec::new();
            if document
                .get("stage")
                .and_then(Value::as_str)
                .is_none_or(|stage| !valid_stage_code(stage))
            {
                errors.push("Mã giai đoạn phải bắt đầu bằng chữ thường và chỉ dùng chữ thường, số, dấu gạch dưới".into());
            }
            if document.get("probability").is_some_and(|value| {
                !money::decimal(value).is_some_and(|probability| {
                    (Decimal::ZERO..=Decimal::ONE_HUNDRED).contains(&probability)
                })
            }) {
                errors.push("Stage probability must be between 0 and 100".into());
            }
            if document
                .get("name")
                .and_then(Value::as_str)
                .is_some_and(|name| name.trim().is_empty())
            {
                errors.push("Stage name cannot be blank".into());
            }
            errors
        }
        "activity" => {
            let target_count = ["deal", "lead", "party"]
                .iter()
                .filter(|field| document.get(**field).is_some_and(|value| !value.is_null()))
                .count();
            if target_count > 1 {
                vec!["A CRM activity can be linked to only one lead, deal, or customer".into()]
            } else {
                Vec::new()
            }
        }
        _ => Vec::new(),
    }
}

fn valid_stage_code(stage: &str) -> bool {
    let trimmed = stage.trim();
    let mut chars = trimmed.chars();
    stage == trimmed
        && trimmed != "unclassified"
        && trimmed.len() <= 48
        && chars.next().is_some_and(|first| first.is_ascii_lowercase())
        && chars.all(|character| {
            character.is_ascii_lowercase() || character.is_ascii_digit() || character == '_'
        })
        && canonical_pipeline_stage(trimmed).is_none_or(|canonical| canonical == trimmed)
}

pub(super) fn canonical_pipeline_stage(value: &str) -> Option<&'static str> {
    match value.trim().to_ascii_lowercase().as_str() {
        "qualification" | "qualified" | "đủ điều kiện" => Some("qualification"),
        "discovery" | "needs analysis" | "needs_analysis" | "phân tích nhu cầu" => {
            Some("discovery")
        }
        "proposal" | "quote" | "quotation" | "báo giá" => Some("proposal"),
        "negotiation" | "thương lượng" => Some("negotiation"),
        _ => None,
    }
}

pub(super) fn default_probability(stage: &str) -> Decimal {
    match stage {
        "qualification" => Decimal::new(10, 0),
        "discovery" => Decimal::new(25, 0),
        "proposal" => Decimal::new(50, 0),
        "negotiation" => Decimal::new(75, 0),
        _ => Decimal::ZERO,
    }
}

pub fn validate_action(entity: &str, action: &str, document: &Value) -> Vec<String> {
    match (entity, action) {
        ("lead", "converted") => {
            let has_name = document
                .get("name")
                .and_then(Value::as_str)
                .is_some_and(|name| !name.trim().is_empty());
            let has_party = document
                .get("party")
                .and_then(Value::as_str)
                .and_then(|id| Uuid::parse_str(id).ok())
                .is_some();
            if !has_name || has_party {
                vec!["Lead conversion requires a name and cannot already have a customer".into()]
            } else {
                Vec::new()
            }
        }
        ("deal", "won") => {
            let mut errors = Vec::new();
            if !amount(document).is_some_and(|amount| amount > Decimal::ZERO) {
                errors.push("Cơ hội thắng cần có giá trị lớn hơn 0".into());
            }
            if document
                .get("party")
                .and_then(Value::as_str)
                .and_then(|id| Uuid::parse_str(id).ok())
                .is_none()
            {
                errors.push("Cơ hội thắng cần khách hàng hợp lệ".into());
            }
            if document
                .get("warehouse")
                .and_then(Value::as_str)
                .and_then(|id| Uuid::parse_str(id).ok())
                .is_none()
            {
                errors.push("Chọn kho xuất hàng trước khi thắng cơ hội".into());
            }
            if document
                .get("lines")
                .and_then(Value::as_array)
                .is_none_or(Vec::is_empty)
            {
                errors.push("Thêm ít nhất một dòng hàng trước khi thắng cơ hội".into());
            }
            errors
        }
        ("deal", "lost") => {
            let reason = document
                .get("lost_reason")
                .and_then(Value::as_str)
                .map(str::trim)
                .unwrap_or_default();
            if !(5..=1000).contains(&reason.chars().count()) {
                vec!["A lost deal requires a reason between 5 and 1000 characters".into()]
            } else {
                Vec::new()
            }
        }
        _ => Vec::new(),
    }
}

pub fn validate_update(entity: &str, current: &Value, patch: &Value) -> Vec<String> {
    if entity == "pipeline_stage"
        && patch
            .get("stage")
            .is_some_and(|stage| Some(stage) != current.get("stage"))
    {
        return vec!["A pipeline stage code is immutable; edit its name or probability".into()];
    }
    let immutable = match (entity, current.get("status").and_then(Value::as_str)) {
        ("lead", Some("converted")) => {
            ["name", "email", "phone", "company", "source", "owner"]
                .iter()
                .any(|field| patch.get(*field).is_some())
                || (current.get("party").is_some_and(|party| !party.is_null())
                    && patch.get("party").is_some())
        }
        ("deal", Some("won" | "lost")) => [
            "title",
            "party",
            "amount",
            "stage",
            "pipeline_stage",
            "probability",
            "expected_close",
            "owner",
            "lost_reason",
            "lead",
        ]
        .iter()
        .any(|field| patch.get(*field).is_some()),
        _ => false,
    };
    if immutable {
        vec!["Converted leads and closed deals are immutable".into()]
    } else {
        Vec::new()
    }
}

pub fn validate_remove(entity: &str, document: &Value) -> Vec<String> {
    let status = document.get("status").and_then(Value::as_str);
    match (entity, status) {
        ("lead", Some("converted")) | ("deal", Some("won" | "lost")) => {
            vec!["Converted leads and closed deals must remain as CRM history".into()]
        }
        ("activity", _)
            if ["deal", "lead", "party"]
                .iter()
                .any(|field| document.get(*field).is_some_and(|value| !value.is_null())) =>
        {
            vec!["CRM activities linked to a record must remain as customer history".into()]
        }
        _ => Vec::new(),
    }
}
