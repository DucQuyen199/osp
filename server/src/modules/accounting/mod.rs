//! Accounting bounded context: pure accounting rules, transactional checks and ledger use cases.
mod application;
mod bank_import;
mod domain;
mod persistence;
mod reports;

pub use application::{
    create_adjustment_refund, handle_ledger_event, handle_source_document_event,
    post_abnormal_scrap_cost, post_production_qc_scrap_cost, prepare_bank_statement,
    prepare_bank_statement_line, prepare_currency_posting, prepare_document, prepare_match,
    prepare_payment_currency,
};
pub use bank_import::{
    import_statement_camt053, import_statement_casso, import_statement_csv, sync_statement_casso,
    sync_statement_sepay,
};
pub use domain::{validate, validate_action, validate_action_at, validate_remove, validate_update};
pub use persistence::{post_stock_movement, validate_persistence};
