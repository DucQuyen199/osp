use serde_json::Value;

#[derive(Clone, Copy)]
pub(super) enum Target {
    Invoice,
    Bill,
    Payment,
}

#[derive(Clone, Copy)]
pub(super) enum Condition {
    Always,
    Positive(&'static str),
    PartyAndPositive(&'static str, &'static str),
}

#[derive(Clone, Copy)]
pub(super) enum Method {
    Field(&'static str),
}

pub(super) struct SourceDocument {
    pub(super) target: Target,
    pub(super) amount: &'static str,
    pub(super) party: Option<&'static str>,
    pub(super) supplier: Option<&'static str>,
    pub(super) source: &'static str,
    pub(super) method: Option<Method>,
    pub(super) condition: Condition,
    pub(super) post: bool,
}

pub(super) fn source_document(event_type: &str) -> Option<SourceDocument> {
    let spec = match event_type {
        "sales.sales_order.confirmed" => (
            Target::Invoice,
            "total",
            Some("party"),
            None,
            "sales_order",
            None,
            Condition::Always,
            true,
        ),
        "purchasing.purchase_order.received" => (
            Target::Bill,
            "total",
            None,
            Some("supplier"),
            "purchase_order",
            None,
            Condition::Always,
            true,
        ),
        "pos.pos_order.completed" => (
            Target::Payment,
            "total",
            Some("party"),
            None,
            "pos_order",
            Some(Method::Field("method")),
            Condition::Positive("total"),
            false,
        ),
        "subscription.billing_cycle.due" => (
            Target::Invoice,
            "amount",
            Some("party"),
            None,
            "subscription",
            None,
            Condition::Positive("amount"),
            true,
        ),
        "field-service.work_order.done" => (
            Target::Invoice,
            "total",
            Some("party"),
            None,
            "work_order",
            None,
            Condition::Positive("total"),
            true,
        ),
        "booking.booking.completed" => (
            Target::Invoice,
            "price",
            Some("party"),
            None,
            "booking",
            None,
            Condition::PartyAndPositive("party", "price"),
            true,
        ),
        "restaurant.table_order.completed" => (
            Target::Payment,
            "total",
            Some("party"),
            None,
            "table_order",
            Some(Method::Field("method")),
            Condition::Positive("total"),
            false,
        ),
        "hotel.reservation.checked_out" => (
            Target::Invoice,
            "total",
            Some("party"),
            None,
            "reservation",
            None,
            Condition::Positive("total"),
            true,
        ),
        "auto-service.repair_order.completed" => (
            Target::Invoice,
            "total",
            Some("party"),
            None,
            "repair_order",
            None,
            Condition::Positive("total"),
            true,
        ),
        "school.fee.issued" => (
            Target::Invoice,
            "amount",
            Some("party"),
            None,
            "school_fee",
            None,
            Condition::Positive("amount"),
            true,
        ),
        "insurance.policy.activated" => (
            Target::Invoice,
            "premium",
            Some("party"),
            None,
            "policy",
            None,
            Condition::Positive("premium"),
            true,
        ),
        "utilities.utility_bill.issued" => (
            Target::Invoice,
            "amount",
            Some("party"),
            None,
            "utility_bill",
            None,
            Condition::Positive("amount"),
            true,
        ),
        "case-management.time_entry.billed" => (
            Target::Invoice,
            "amount",
            Some("party"),
            None,
            "time_entry",
            None,
            Condition::Positive("amount"),
            true,
        ),
        "clinic.encounter.completed" => (
            Target::Invoice,
            "fee",
            Some("party"),
            None,
            "encounter",
            None,
            Condition::Positive("fee"),
            true,
        ),
        "real-estate.property.sold" => (
            Target::Invoice,
            "sale_price",
            Some("buyer"),
            None,
            "property",
            None,
            Condition::PartyAndPositive("buyer", "sale_price"),
            true,
        ),
        "real-estate.rent_cycle.created" => (
            Target::Invoice,
            "amount",
            Some("party"),
            None,
            "real_estate_rent_cycle",
            None,
            Condition::Positive("amount"),
            true,
        ),
        "construction.subcontract.signed" => (
            Target::Bill,
            "value",
            None,
            Some("vendor"),
            "subcontract",
            None,
            Condition::Positive("value"),
            true,
        ),
        "lending.repayment.paid" => (
            Target::Payment,
            "amount",
            Some("party"),
            None,
            "repayment",
            Some(Method::Field("method")),
            Condition::Always,
            false,
        ),
        "charity.donation.received" => (
            Target::Payment,
            "amount",
            Some("donor"),
            None,
            "donation",
            Some(Method::Field("method")),
            Condition::Always,
            false,
        ),
        "events.ticket.sold" => (
            Target::Payment,
            "price",
            Some("party"),
            None,
            "ticket",
            Some(Method::Field("method")),
            Condition::Always,
            false,
        ),
        "payroll.payroll_run.paid" => (
            Target::Payment,
            "total_net",
            None,
            None,
            "payroll_run",
            Some(Method::Field("payment_method")),
            Condition::Always,
            false,
        ),
        "payroll.contribution_remittance.paid" => (
            Target::Payment,
            "amount",
            None,
            None,
            "payroll_contribution_remittance",
            Some(Method::Field("payment_method")),
            Condition::Positive("amount"),
            false,
        ),
        "expense.expense_claim.paid" => (
            Target::Payment,
            "total",
            None,
            None,
            "expense_claim",
            Some(Method::Field("payment_method")),
            Condition::Always,
            false,
        ),
        _ => return None,
    };
    Some(SourceDocument {
        target: spec.0,
        amount: spec.1,
        party: spec.2,
        supplier: spec.3,
        source: spec.4,
        method: spec.5,
        condition: spec.6,
        post: spec.7,
    })
}

pub(super) fn qualifies(spec: &SourceDocument, event: &Value) -> bool {
    match spec.condition {
        Condition::Always => true,
        Condition::Positive(field) => event
            .get(field)
            .and_then(crate::money::decimal)
            .is_some_and(|amount| amount > rust_decimal::Decimal::ZERO),
        Condition::PartyAndPositive(party, amount) => {
            event.get(party).is_some_and(|value| !value.is_null())
                && event
                    .get(amount)
                    .and_then(crate::money::decimal)
                    .is_some_and(|amount| amount > rust_decimal::Decimal::ZERO)
        }
    }
}
