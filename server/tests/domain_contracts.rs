use osp_server::{modules, money};
use rust_decimal::Decimal;
use serde_json::json;

#[test]
fn crm_optional_probability_allows_win_but_invalid_values_do_not() {
    let party = uuid::Uuid::new_v4().to_string();
    let warehouse = uuid::Uuid::new_v4().to_string();
    let product = uuid::Uuid::new_v4().to_string();
    let document = json!({
        "title": "Service contract",
        "party": party,
        "amount": 5000000,
        "probability": null,
        "warehouse": warehouse,
        "lines": [{ "product": product, "qty": 1, "price": 5000000 }]
    });
    assert!(modules::validate_action("crm.deal", "won", &document).is_empty());
    for probability in [json!(-1), json!(101), json!("50"), json!(true)] {
        let mut invalid = document.clone();
        invalid["probability"] = probability;
        assert!(!modules::validate_action("crm.deal", "won", &invalid).is_empty());
    }
    let mut invalid = document.clone();
    invalid["party"] = json!(null);
    assert!(!modules::validate_action("crm.deal", "won", &invalid).is_empty());
    invalid["party"] = json!(party);
    invalid["amount"] = json!(0);
    assert!(!modules::validate_action("crm.deal", "won", &invalid).is_empty());
}

#[test]
fn null_patch_cannot_clear_closed_financial_or_crm_history() {
    for (entity, current, patch) in [
        (
            "crm.deal",
            json!({ "status": "won" }),
            json!({ "amount": null }),
        ),
        (
            "sales.sales_order",
            json!({ "status": "confirmed" }),
            json!({ "warehouse": null }),
        ),
        (
            "payments.payment_txn",
            json!({ "status": "succeeded" }),
            json!({ "reference": null }),
        ),
        (
            "manufacturing.production_order",
            json!({ "status": "done" }),
            json!({ "bom": null }),
        ),
    ] {
        assert!(
            !modules::validate_update(entity, &current, &patch).is_empty(),
            "{entity}"
        );
    }
}

#[test]
fn journal_balances_use_exact_decimal_and_checked_totals() {
    let valid = json!({ "lines": [
        { "account": "111", "debit": 0.1, "credit": 0 },
        { "account": "112", "debit": 0.2, "credit": 0 },
        { "account": "131", "debit": 0, "credit": 0.3 }
    ] });
    assert!(modules::validate_document("accounting.journal_entry", &valid).is_empty());
    let mut invalid = valid.clone();
    invalid["lines"][2]["credit"] = json!(0.31);
    assert!(!modules::validate_document("accounting.journal_entry", &invalid).is_empty());
    invalid["lines"][2]["credit"] = json!(-0.3);
    assert!(!modules::validate_document("accounting.journal_entry", &invalid).is_empty());
    let max = money::json_number(Decimal::MAX).unwrap();
    let overflow = json!({ "lines": [
        { "account": "111", "debit": max, "credit": 0 },
        { "account": "112", "debit": max, "credit": 0 },
        { "account": "131", "debit": 0, "credit": max }
    ] });
    assert!(!modules::validate_document("accounting.journal_entry", &overflow).is_empty());
}

#[test]
fn line_pricing_rejects_overflow_and_rounds_discount_and_tax_consistently() {
    let result = money::line_amounts(
        Decimal::new(3, 0),
        Decimal::new(1999, 2),
        Decimal::new(10, 0),
        Decimal::new(8, 0),
    )
    .unwrap();
    assert_eq!(
        result,
        (
            Decimal::new(5997, 3),
            Decimal::new(53973, 3),
            Decimal::new(43178, 4),
            Decimal::new(582908, 4)
        )
    );
    assert!(
        money::line_amounts(Decimal::MAX, Decimal::MAX, Decimal::ZERO, Decimal::ZERO).is_none()
    );
    assert!(
        money::line_amounts(
            Decimal::ONE,
            Decimal::ONE,
            Decimal::new(101, 0),
            Decimal::ZERO
        )
        .is_none()
    );
}

#[test]
fn production_completion_defaults_missing_database_columns_and_preserves_explicit_output() {
    let mut document = json!({ "qty": 10, "good_qty": null, "scrap_qty": null })
        .as_object()
        .unwrap()
        .clone();
    assert!(modules::manufacturing::prepare_completion(&mut document).is_empty());
    assert_eq!(document["good_qty"], 10);
    assert_eq!(document["scrap_qty"], 0);
    let mut document = json!({ "qty": 10, "good_qty": 8, "scrap_qty": null })
        .as_object()
        .unwrap()
        .clone();
    assert!(modules::manufacturing::prepare_completion(&mut document).is_empty());
    assert_eq!(document["scrap_qty"], 2);
    document.insert("good_qty".into(), json!("bad"));
    assert!(!modules::manufacturing::prepare_completion(&mut document).is_empty());
}
