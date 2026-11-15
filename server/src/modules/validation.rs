use super::*;
use crate::kernel::Tenant;
use std::borrow::Cow;

/// PostgreSQL read models include null columns while create commands omit them.
/// Domain document validation must see the same values on both paths. Patches
/// deliberately keep nulls so clearing an immutable field cannot bypass guards.
fn document_values(document: &serde_json::Value) -> Cow<'_, serde_json::Value> {
    match document.as_object() {
        Some(fields) if fields.values().any(serde_json::Value::is_null) => {
            Cow::Owned(serde_json::Value::Object(
                fields
                    .iter()
                    .filter(|(_, value)| !value.is_null())
                    .map(|(key, value)| (key.clone(), value.clone()))
                    .collect(),
            ))
        }
        _ => Cow::Borrowed(document),
    }
}

pub fn validate_document(qname: &str, document: &serde_json::Value) -> Vec<String> {
    validate_document_at(chrono::Utc::now().date_naive(), qname, document)
}

pub fn validate_document_for_tenant(
    tenant: &Tenant,
    qname: &str,
    document: &serde_json::Value,
) -> Vec<String> {
    validate_document_at(tenant.business_today(), qname, document)
}

fn validate_document_at(
    today: chrono::NaiveDate,
    qname: &str,
    document: &serde_json::Value,
) -> Vec<String> {
    let values = document_values(document);
    let document = values.as_ref();
    let (module, entity) = qname.split_once('.').unwrap_or(("", ""));
    match module {
        "accounting" => accounting::validate(entity, document),
        "agriculture" => agriculture::validate(entity, document),
        "asset" => asset::validate(entity, document),
        "auto-service" => auto_service::validate(entity, document),
        "budget" => budget::validate(entity, document),
        "case-management" => case_management::validate_at(entity, document, today),
        "charity" => charity::validate(entity, document),
        "clinic" => clinic::validate_at(entity, document, today),
        "communication" => communication::validate(entity, document),
        "booking" => booking::validate(entity, document),
        "bi" => bi::validate(entity, document),
        "contract" => contract::validate(entity, document),
        "construction" => construction::validate_at(entity, document, today),
        "document" => document::validate(entity, document),
        "crm" => crm::validate(entity, document),
        "ecommerce" => ecommerce::validate(entity, document),
        "events" => event_management::validate(entity, document),
        "inventory" => inventory::validate(entity, document),
        "integration-hub" => integration_hub::validate(entity, document),
        "insurance" => insurance::validate_at(entity, document, today),
        "logistics" => logistics::validate(entity, document),
        "lms" => lms::validate(entity, document),
        "marketing" => marketing::validate(entity, document),
        "lending" => lending::validate(entity, document),
        "loyalty" => loyalty::validate_at(entity, document, today),
        "manufacturing" => manufacturing::validate(entity, document),
        "master-data" => master_data::validate(entity, document),
        "maintenance" => maintenance::validate(entity, document),
        "expense" if entity == "expense_claim" => expense::validate(document),
        "field-service" => field_service::validate(entity, document),
        "helpdesk" => helpdesk::validate(entity, document),
        "hotel" => hotel::validate(entity, document),
        "hrm" => hrm::validate(entity, document),
        "sales" => sales::validate(entity, document),
        "school" => school::validate_at(entity, document, today),
        "purchasing" => purchasing::validate(entity, document),
        "payroll" => payroll::validate(entity, document),
        "payments" => payments::validate(entity, document),
        "pharmacy" => pharmacy::validate_at(entity, document, today),
        "performance" => performance::validate(entity, document),
        "subscription" => subscription::validate(entity, document),
        "utilities" => utilities::validate(entity, document),
        "pos" => pos::validate(entity, document),
        "project" => project::validate(entity, document),
        "quality" => quality::validate(entity, document),
        "recruitment" => recruitment::validate(entity, document),
        "restaurant" => restaurant::validate(entity, document),
        "real-estate" => real_estate::validate(entity, document),
        "workflow-approval" => workflow_approval::validate(entity, document),
        _ => Vec::new(),
    }
}

pub fn validate_update(
    qname: &str,
    current: &serde_json::Value,
    patch: &serde_json::Value,
) -> Vec<String> {
    let (module, entity) = qname.split_once('.').unwrap_or(("", ""));
    match module {
        "accounting" => accounting::validate_update(entity, current, patch),
        "agriculture" => agriculture::validate_update(entity, current, patch),
        "asset" => asset::validate_update(entity, current, patch),
        "auto-service" => auto_service::validate_update(entity, current, patch),
        "budget" => budget::validate_update(entity, current, patch),
        "case-management" => case_management::validate_update(entity, current, patch),
        "charity" => charity::validate_update(entity, current, patch),
        "clinic" => clinic::validate_update(entity, current, patch),
        "communication" => communication::validate_update(entity, current, patch),
        "booking" => booking::validate_update(entity, current, patch),
        "bi" => bi::validate_update(entity, current, patch),
        "contract" => contract::validate_update(entity, current, patch),
        "construction" => construction::validate_update(entity, current, patch),
        "document" => document::validate_update(entity, current, patch),
        "einvoice" => einvoice::validate_update(entity, current, patch),
        "crm" => crm::validate_update(entity, current, patch),
        "ecommerce" => ecommerce::validate_update(entity, current, patch),
        "events" => event_management::validate_update(entity, current, patch),
        "inventory" => inventory::validate_update(entity, current, patch),
        "integration-hub" => integration_hub::validate_update(entity, current, patch),
        "insurance" => insurance::validate_update(entity, current, patch),
        "logistics" => logistics::validate_update(entity, current, patch),
        "lms" => lms::validate_update(entity, current, patch),
        "marketing" => marketing::validate_update(entity, current, patch),
        "lending" => lending::validate_update(entity, current, patch),
        "loyalty" => loyalty::validate_update(entity, current, patch),
        "manufacturing" => manufacturing::validate_update(entity, current, patch),
        "maintenance" => maintenance::validate_update(entity, current, patch),
        "sales" => sales::validate_update(entity, current, patch),
        "school" => school::validate_update(entity, current, patch),
        "purchasing" => purchasing::validate_update(entity, current, patch),
        "expense" if entity == "expense_claim" => expense::validate_update(current, patch),
        "field-service" => field_service::validate_update(entity, current, patch),
        "helpdesk" => helpdesk::validate_update(entity, current, patch),
        "hotel" => hotel::validate_update(entity, current, patch),
        "hrm" => hrm::validate_update(entity, current, patch),
        "payroll" => payroll::validate_update(entity, current, patch),
        "payments" => payments::validate_update(entity, current, patch),
        "pharmacy" => pharmacy::validate_update(entity, current, patch),
        "performance" => performance::validate_update(entity, current, patch),
        "subscription" => subscription::validate_update(entity, current, patch),
        "utilities" => utilities::validate_update(entity, current, patch),
        "pos" if entity == "pos_order" => pos::validate_update(current, patch),
        "pos" if entity == "pos_session" => pos::validate_session_update(current, patch),
        "pos" if entity == "cash_movement" => pos::validate_cash_movement_update(current, patch),
        "project" => project::validate_update(entity, current, patch),
        "quality" => quality::validate_update(entity, current, patch),
        "recruitment" => recruitment::validate_update(entity, current, patch),
        "restaurant" => restaurant::validate_update(entity, current, patch),
        "real-estate" => real_estate::validate_update(entity, current, patch),
        _ => Vec::new(),
    }
}

pub fn validate_remove(qname: &str, document: &serde_json::Value) -> Vec<String> {
    let (module, entity) = qname.split_once('.').unwrap_or(("", ""));
    match module {
        "accounting" => accounting::validate_remove(entity, document),
        "agriculture" => agriculture::validate_remove(entity, document),
        "asset" => asset::validate_remove(entity, document),
        "auto-service" => auto_service::validate_remove(entity, document),
        "budget" => budget::validate_remove(entity, document),
        "bi" => bi::validate_remove(entity, document),
        "case-management" => case_management::validate_remove(entity, document),
        "charity" => charity::validate_remove(entity, document),
        "clinic" => clinic::validate_remove(entity, document),
        "communication" => communication::validate_remove(entity, document),
        "contract" => contract::validate_remove(entity, document),
        "construction" => construction::validate_remove(entity, document),
        "document" => document::validate_remove(entity, document),
        "einvoice" => einvoice::validate_remove(entity),
        "crm" => crm::validate_remove(entity, document),
        "ecommerce" => ecommerce::validate_remove(entity, document),
        "events" => event_management::validate_remove(entity, document),
        "inventory" => inventory::validate_remove(entity, document),
        "insurance" => insurance::validate_remove(entity, document),
        "logistics" => logistics::validate_remove(entity, document),
        "lms" => lms::validate_remove(entity, document),
        "marketing" => marketing::validate_remove(entity, document),
        "lending" => lending::validate_remove(entity, document),
        "loyalty" => loyalty::validate_remove(entity),
        "manufacturing" => manufacturing::validate_remove(entity, document),
        "maintenance" => maintenance::validate_remove(entity, document),
        "sales" => sales::validate_remove(entity, document),
        "school" => school::validate_remove(entity, document),
        "purchasing" => purchasing::validate_remove(entity, document),
        "payroll" => payroll::validate_remove(entity, document),
        "payments" => payments::validate_remove(entity, document),
        "pharmacy" => pharmacy::validate_remove(entity, document),
        "performance" => performance::validate_remove(entity, document),
        "subscription" => subscription::validate_remove(entity, document),
        "utilities" => utilities::validate_remove(entity, document),
        "expense" if entity == "expense_claim" => expense::validate_remove(document),
        "field-service" => field_service::validate_remove(entity, document),
        "helpdesk" => helpdesk::validate_remove(entity),
        "hotel" => hotel::validate_remove(entity, document),
        "hrm" => hrm::validate_remove(entity, document),
        "pos" if entity == "pos_order" => pos::validate_remove(document),
        "pos" if entity == "cash_movement" => pos::validate_cash_movement_remove(document),
        "project" => project::validate_remove(entity, document),
        "quality" => quality::validate_remove(entity, document),
        "recruitment" => recruitment::validate_remove(entity, document),
        "restaurant" => restaurant::validate_remove(entity, document),
        "real-estate" => real_estate::validate_remove(entity, document),
        _ => Vec::new(),
    }
}

pub fn validate_action(qname: &str, action: &str, document: &serde_json::Value) -> Vec<String> {
    validate_action_at(chrono::Utc::now().date_naive(), qname, action, document)
}

pub fn validate_action_for_tenant(
    tenant: &Tenant,
    qname: &str,
    action: &str,
    document: &serde_json::Value,
) -> Vec<String> {
    validate_action_at(tenant.business_today(), qname, action, document)
}

fn validate_action_at(
    today: chrono::NaiveDate,
    qname: &str,
    action: &str,
    document: &serde_json::Value,
) -> Vec<String> {
    let values = document_values(document);
    let document = values.as_ref();
    let (module, entity) = qname.split_once('.').unwrap_or(("", ""));
    let mut errors = validate_document_at(today, qname, document);
    errors.extend(match module {
        "accounting" => accounting::validate_action_at(entity, action, document, today),
        "agriculture" => agriculture::validate_action(entity, action, document),
        "asset" => asset::validate_action(entity, action, document),
        "auto-service" => auto_service::validate_action(entity, action, document),
        "booking" => booking::validate_action(entity, action, document),
        "budget" => budget::validate_action(entity, action, document),
        "bi" => bi::validate_action(entity, action, document),
        "case-management" => case_management::validate_action(entity, action, document),
        "charity" => charity::validate_action(entity, action, document),
        "clinic" => clinic::validate_action(entity, action, document),
        "communication" => communication::validate_action(entity, action, document),
        "contract" => contract::validate_action_at(entity, action, document, today),
        "construction" => construction::validate_action(entity, action, document),
        "document" => document::validate_action(entity, action, document),
        "einvoice" => einvoice::validate_action(entity, action, document),
        "crm" => crm::validate_action(entity, action, document),
        "ecommerce" => ecommerce::validate_action(entity, action, document),
        "events" => event_management::validate_action(entity, action, document),
        "inventory" => inventory::validate_action(entity, action, document),
        "insurance" => insurance::validate_action_at(entity, action, document, today),
        "logistics" => logistics::validate_action(entity, action, document),
        "lms" => lms::validate_action(entity, action, document),
        "marketing" => marketing::validate_action_at(entity, action, document, today),
        "lending" => lending::validate_action_at(entity, action, document, today),
        "manufacturing" => manufacturing::validate_action_at(entity, action, document, today),
        "maintenance" => maintenance::validate_action(entity, action, document),
        "sales" => sales::validate_action_at(entity, action, document, today),
        "school" => school::validate_action(entity, action, document),
        "purchasing" => purchasing::validate_action_at(entity, action, document, today),
        "expense" if entity == "expense_claim" => expense::validate_action(action, document),
        "field-service" => field_service::validate_action(entity, action, document),
        "helpdesk" => helpdesk::validate_action(entity, action, document),
        "hotel" => hotel::validate_action(entity, action, document),
        "hrm" => hrm::validate_action(entity, action, document),
        "payroll" => payroll::validate_action(entity, action, document),
        "payments" => payments::validate_action(entity, action, document),
        "pharmacy" => pharmacy::validate_action(entity, action, document),
        "performance" => performance::validate_action(entity, action, document),
        "subscription" => subscription::validate_action_at(entity, action, document, today),
        "utilities" => utilities::validate_action(entity, action, document),
        "pos" => pos::validate_action(entity, action, document),
        "restaurant" => restaurant::validate_action(entity, action, document),
        "project" => project::validate_action(entity, action, document),
        "quality" => quality::validate_action(entity, action, document),
        "recruitment" => recruitment::validate_action(entity, action, document),
        "real-estate" => real_estate::validate_action_at(entity, action, document, today),
        _ => Vec::new(),
    });
    errors
}

pub async fn validate_persistence(
    tx: &crate::db::Tx<'_>,
    tenant: &crate::kernel::Tenant,
    qname: &str,
    action: &str,
    document: &serde_json::Value,
) -> crate::error::R<Vec<String>> {
    let (module, entity) = qname.split_once('.').unwrap_or(("", ""));
    match module {
        "accounting" => {
            let mut errors =
                accounting::validate_persistence(tx, tenant, entity, action, document).await?;
            if entity == "journal_entry" && action == "posted" {
                errors.extend(budget::validate_journal_posting(tx, tenant, document).await?);
            }
            Ok(errors)
        }
        "agriculture" => {
            agriculture::validate_persistence(tx, tenant, entity, action, document).await
        }
        "asset" => asset::validate_persistence(tx, tenant, entity, action, document).await,
        "auto-service" => {
            auto_service::validate_persistence(tx, tenant, entity, action, document).await
        }
        "budget" => budget::validate_persistence(tx, tenant, entity, action, document).await,
        "case-management" => {
            case_management::validate_persistence(tx, tenant, entity, action, document).await
        }
        "charity" => charity::validate_persistence(tx, tenant, entity, action, document).await,
        "clinic" => clinic::validate_persistence(tx, tenant, entity, action, document).await,
        "communication" => {
            communication::validate_persistence(tx, tenant, entity, action, document).await
        }
        "booking" => booking::validate_persistence(tx, tenant, entity, action, document).await,
        "bi" => bi::validate_persistence(tx, tenant, entity, action, document).await,
        "contract" => contract::validate_persistence(tx, tenant, entity, action, document).await,
        "construction" => {
            construction::validate_persistence(tx, tenant, entity, action, document).await
        }
        "document" => document::validate_persistence(tx, tenant, entity, action, document).await,
        "einvoice" => einvoice::validate_persistence(tx, tenant, entity, action, document).await,
        "crm" => crm::validate_persistence(tx, tenant, entity, action, document).await,
        "ecommerce" => ecommerce::validate_persistence(tx, tenant, entity, action, document).await,
        "events" => {
            event_management::validate_persistence(tx, tenant, entity, action, document).await
        }
        "purchasing" => {
            purchasing::validate_persistence(tx, tenant, entity, action, document).await
        }
        "payroll" => payroll::validate_persistence(tx, tenant, entity, action, document).await,
        "payments" => payments::validate_persistence(tx, tenant, entity, action, document).await,
        "performance" => {
            performance::validate_persistence(tx, tenant, entity, action, document).await
        }
        "subscription" => {
            subscription::validate_persistence(tx, tenant, entity, action, document).await
        }
        "utilities" => utilities::validate_persistence(tx, tenant, entity, action, document).await,
        "pos" => {
            let mut errors =
                pos::validate_persistence(tx, tenant, entity, action, document).await?;
            errors.extend(
                pharmacy::validate_persistence(tx, tenant, entity, action, document).await?,
            );
            Ok(errors)
        }
        "pharmacy" => pharmacy::validate_persistence(tx, tenant, entity, action, document).await,
        "project" => project::validate_persistence(tx, tenant, entity, action, document).await,
        "quality" => quality::validate_persistence(tx, tenant, entity, action, document).await,
        "recruitment" => {
            recruitment::validate_persistence(tx, tenant, entity, action, document).await
        }
        "inventory" => inventory::validate_persistence(tx, tenant, entity, action, document).await,
        "workflow-approval" => {
            workflow_approval::validate_persistence(tx, tenant, entity, action, document).await
        }
        "integration-hub" => {
            integration_hub::validate_persistence(tx, tenant, entity, action, document).await
        }
        "insurance" => insurance::validate_persistence(tx, tenant, entity, action, document).await,
        "logistics" => logistics::validate_persistence(tx, tenant, entity, action, document).await,
        "lms" => lms::validate_persistence(tx, tenant, entity, action, document).await,
        "marketing" => marketing::validate_persistence(tx, tenant, entity, action, document).await,
        "lending" => lending::validate_persistence(tx, tenant, entity, action, document).await,
        "loyalty" => loyalty::validate_persistence(tx, tenant, entity, action, document).await,
        "manufacturing" => {
            manufacturing::validate_persistence(tx, tenant, entity, action, document).await
        }
        "master-data" => {
            master_data::validate_persistence(tx, tenant, entity, action, document).await
        }
        "maintenance" => {
            maintenance::validate_persistence(tx, tenant, entity, action, document).await
        }
        "sales" => sales::validate_persistence(tx, tenant, entity, action, document).await,
        "school" => school::validate_persistence(tx, tenant, entity, action, document).await,
        "restaurant" => {
            restaurant::validate_persistence(tx, tenant, entity, action, document).await
        }
        "hrm" => hrm::validate_persistence(tx, tenant, entity, action, document).await,
        "field-service" => {
            field_service::validate_persistence(tx, tenant, entity, action, document).await
        }
        "helpdesk" => helpdesk::validate_persistence(tx, tenant, entity, action, document).await,
        "hotel" => hotel::validate_persistence(tx, tenant, entity, action, document).await,
        "expense" if entity == "expense_claim" => {
            let mut errors = expense::validate_persistence(tx, tenant, action, document).await?;
            errors.extend(
                accounting::validate_persistence(tx, tenant, entity, action, document).await?,
            );
            Ok(errors)
        }
        "real-estate" => {
            real_estate::validate_persistence(tx, tenant, entity, action, document).await
        }
        _ => Ok(Vec::new()),
    }
}
