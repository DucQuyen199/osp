use crate::{
    db::Tx,
    error::R,
    kernel::{Actor, Kernel, Opts, Tenant},
};
use serde_json::{Map, Value};
use uuid::Uuid;

pub fn prepare_document(entity: &str, document: &mut Map<String, Value>) {
    if entity == "account"
        && let Some(code) = document.get("code").and_then(Value::as_str)
    {
        document.insert(
            "code".into(),
            Value::String(code.trim().to_ascii_uppercase()),
        );
    }
}

mod adjustment_refunds;
mod bank_reconciliation;
mod chart_templates;
mod currency;
mod ledger;
mod source_documents;
mod source_events;
pub use adjustment_refunds::create_adjustment_refund;
pub use bank_reconciliation::{prepare_bank_statement, prepare_bank_statement_line, prepare_match};
pub use currency::{prepare_currency_posting, prepare_payment_currency};
pub use source_events::handle_source_document_event;
mod accounts;
mod journal_posting;
mod manufacturing;

pub(super) use accounts::ensure_account;
use accounts::{account_id, tax_payable_account_id};
use journal_posting::{
    create_posted_journal_decimal, create_posted_journal_decimal_at, journal_line_decimal,
    journal_line_decimal_with_department,
};
pub use manufacturing::{post_abnormal_scrap_cost, post_production_qc_scrap_cost};

mod returns;

pub use ledger::handle_ledger_event;
