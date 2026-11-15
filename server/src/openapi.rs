//! Đặc tả OpenAPI 3.1 sinh tự động từ các module đã cài.
use crate::defs::{FieldDef, Registry};
use serde_json::{Map, Value, json};

fn field_schema(f: &FieldDef) -> Value {
    match f.ty.as_str() {
        "number" | "money" => json!({ "type": "number" }),
        "bool" => json!({ "type": "boolean" }),
        "date" => json!({ "type": "string", "format": "date" }),
        "datetime" => json!({ "type": "string", "format": "date-time" }),
        "json" => json!({ "description": "JSON tuỳ ý (ví dụ mảng dòng hàng)" }),
        "enum" => json!({ "type": "string", "enum": f.options }),
        "ref" => {
            json!({ "type": "string", "format": "uuid", "description": format!("Tham chiếu tới {}", f.reference.clone().unwrap_or_default()) })
        }
        _ => json!({ "type": "string" }),
    }
}

fn err(desc: &str) -> Value {
    json!({ "description": desc, "content": { "application/json": { "schema": { "$ref": "#/components/schemas/Error" } } } })
}

pub fn build(reg: &Registry) -> Value {
    let mut schemas = Map::new();
    schemas.insert("Error".into(), json!({ "type": "object", "properties": { "error": { "type": "object", "properties": { "code": { "type": "string" }, "message": { "type": "string" }, "details": {} } } } }));
    let mut paths = Map::new();
    let sec = json!([{ "bearer": [] }]);
    let tid = json!({ "name": "tenantId", "in": "path", "required": true, "schema": { "type": "string" } });
    let rid = json!({ "name": "id", "in": "path", "required": true, "schema": { "type": "string", "format": "uuid" } });
    let common = json!({ "401": err("Thiếu/sai token"), "403": err("Không đủ quyền"), "404": err("Không tìm thấy hoặc module chưa bật") });
    let with_common = |mut m: Map<String, Value>| -> Value {
        if let Some(c) = common.as_object() {
            m.extend(c.clone());
        }
        Value::Object(m)
    };

    paths.insert(
        "/api/tenants".into(),
        json!({ "post": {
            "tags": ["tenants"], "summary": "Create a tenant and queue initial email verification",
            "requestBody": { "required": true, "content": { "application/json": { "schema": {
                "type": "object", "required": ["name", "admin"], "properties": {
                    "name": { "type": "string", "maxLength": 120 }, "vertical": { "type": "string" }, "modules": { "type": "array", "items": { "type": "string" } },
                    "admin": { "type": "object", "required": ["name", "email", "password"], "properties": { "name": { "type": "string" }, "email": { "type": "string", "format": "email" }, "password": { "type": "string", "minLength": 8, "maxLength": 200 } } }
                }
            } } } },
            "responses": with_common(Map::from_iter([("201".to_string(), json!({ "description": "Tenant created; verification email queued", "content": { "application/json": { "schema": { "type": "object", "properties": { "tenantId": { "type": "string" }, "emailVerificationRequired": { "type": "boolean" }, "modules": { "type": "array", "items": { "type": "string" } }, "warnings": { "type": "array", "items": { "type": "string" } } } } } } })), ("422".to_string(), err("Invalid tenant or administrator data")), ("503".to_string(), err("Email verification is not configured"))]))
        } }),
    );

    for id in &reg.order {
        for def in &reg.modules[id].entities {
            let name = def.qname().replace(['.', '-'], "_");
            let state_field = def.states.as_ref().map(|s| s.field.clone());
            let mut props = Map::new();
            props.insert(
                "id".into(),
                json!({ "type": "string", "format": "uuid", "readOnly": true }),
            );
            props.insert(
                "createdAt".into(),
                json!({ "type": "string", "format": "date-time", "readOnly": true }),
            );
            props.insert(
                "updatedAt".into(),
                json!({ "type": "string", "format": "date-time", "readOnly": true }),
            );
            let mut input = Map::new();
            for f in &def.fields {
                let mut sc = field_schema(f);
                let ro = state_field.as_deref() == Some(f.name.as_str())
                    || f.system
                    || def.computed.contains_key(&f.name);
                if ro {
                    sc["readOnly"] = json!(true);
                }
                props.insert(f.name.clone(), sc.clone());
                if state_field.as_deref() != Some(f.name.as_str()) {
                    input.insert(f.name.clone(), sc);
                }
            }
            let required: Vec<&String> = def
                .fields
                .iter()
                .filter(|f| f.required)
                .map(|f| &f.name)
                .collect();
            schemas.insert(
                name.clone(),
                json!({ "type": "object", "description": def.label, "properties": props }),
            );
            schemas.insert(format!("{name}Input"), json!({ "type": "object", "description": format!("{} (dữ liệu gửi lên)", def.label), "additionalProperties": false, "properties": input, "required": required }));
            let base = format!("/api/t/{{tenantId}}/data/{}/{}", def.module, def.name);
            let r#ref = json!({ "$ref": format!("#/components/schemas/{name}") });
            let body = json!({ "required": true, "content": { "application/json": { "schema": { "$ref": format!("#/components/schemas/{name}Input") } } } });
            let ok = |sc: &Value| json!({ "description": "OK", "content": { "application/json": { "schema": sc } } });
            paths.insert(base.clone(), json!({
                "get": { "tags": [def.module], "summary": format!("Danh sách {}", def.label), "security": sec,
                    "parameters": [tid, { "name": "limit", "in": "query", "schema": { "type": "integer", "maximum": 1000, "default": 100 } },
                        { "name": "offset", "in": "query", "schema": { "type": "integer", "default": 0 } },
                        { "name": "q", "in": "query", "description": "Tìm văn bản trong các trường chuỗi", "schema": { "type": "string" } },
                        { "name": "sort", "in": "query", "schema": { "type": "string" } },
                        { "name": "dir", "in": "query", "schema": { "type": "string", "enum": ["asc", "desc"] } },
                        { "name": "<field>", "in": "query", "description": "Lọc bằng nhau theo bất kỳ trường nào, ví dụ ?status=draft", "schema": { "type": "string" } }],
                    "responses": with_common(Map::from_iter([("200".to_string(), ok(&json!({ "type": "object", "properties": { "items": { "type": "array", "items": r#ref }, "total": { "type": "integer" } } })))])) },
                "post": { "tags": [def.module], "summary": format!("Tạo {}", def.label), "security": sec,
                    "parameters": [tid, { "name": "Idempotency-Key", "in": "header", "required": false, "description": "Khóa retry cho thao tác tạo; cùng khóa/cùng nội dung trả lại phản hồi đã lưu trong 30 ngày.", "schema": { "type": "string", "minLength": 1, "maxLength": 200, "pattern": "^[!-~]+$" } }], "requestBody": body,
                    "responses": with_common(Map::from_iter([("201".to_string(), ok(&r#ref)), ("409".to_string(), err("Idempotency-Key đã được dùng với nội dung khác")), ("422".to_string(), err("Dữ liệu không hợp lệ"))])) },
            }));
            paths.insert(format!("{base}/{{id}}"), json!({
                "get": { "tags": [def.module], "summary": format!("Xem {}", def.label), "security": sec, "parameters": [tid, rid], "responses": with_common(Map::from_iter([("200".to_string(), ok(&r#ref))])) },
                "patch": { "tags": [def.module], "summary": format!("Sửa {}", def.label), "security": sec, "parameters": [tid, rid], "requestBody": body,
                    "responses": with_common(Map::from_iter([("200".to_string(), ok(&r#ref)), ("422".to_string(), err("Dữ liệu không hợp lệ"))])) },
                "delete": { "tags": [def.module], "summary": format!("Xóa {}", def.label), "security": sec, "parameters": [tid, rid],
                    "responses": with_common(Map::from_iter([("200".to_string(), json!({ "description": "Đã xóa" })), ("409".to_string(), err("Đang được tham chiếu"))])) },
            }));
            if let Some(st) = &def.states {
                for (action, tr) in &st.actions {
                    let mut operation = json!({
                        "tags": [def.module], "summary": format!("{}: {action} ({} → {})", def.label, tr.from.join("|"), tr.to), "security": sec, "parameters": [tid, rid],
                        "description": format!("Phát sự kiện `{}.{action}` cho các module khác phản ứng.", def.qname()),
                        "responses": with_common(Map::from_iter([("200".to_string(), ok(&r#ref)), ("409".to_string(), err("Sai trạng thái"))])),
                    });
                    if matches!(
                        def.qname().as_str(),
                        "payments.payment_txn" | "payments.payment_refund"
                    ) && matches!(action.as_str(), "succeeded" | "failed")
                    {
                        operation["description"] = json!(
                            "Optionally provide the provider reference with the outcome. When supplied, updating the reference and changing the payment state commit atomically."
                        );
                        operation["requestBody"] = json!({
                            "required": false,
                            "content": { "application/json": { "schema": {
                                "type": "object",
                                "required": ["reference"],
                                "additionalProperties": false,
                                "properties": { "reference": { "type": "string", "maxLength": 240 } }
                            } } }
                        });
                    }
                    if def.qname() == "logistics.shipment" && action == "delivered" {
                        operation["description"] = json!(
                            "Hoàn tất vận đơn và ghi POD trong cùng giao dịch. Nhập số lượng thực nhận theo từng dòng; nếu giao thiếu cần nêu lý do."
                        );
                        operation["requestBody"] = json!({
                            "required": true,
                            "content": { "application/json": { "schema": {
                                "type": "object",
                                "additionalProperties": false,
                                "properties": {
                                    "received_by": { "type": "string", "maxLength": 160 },
                                    "delivery_evidence": { "type": "string", "maxLength": 1000 },
                                    "delivered_lines": {
                                        "type": "array", "minItems": 1,
                                        "items": { "type": "object", "required": ["qty"], "properties": {
                                            "product": { "type": "string", "format": "uuid" },
                                            "price": { "type": "number", "minimum": 0 },
                                            "qty": { "type": "number", "exclusiveMinimum": 0 },
                                            "base_qty": { "type": "number", "minimum": 0 },
                                            "uom": { "type": "string", "format": "uuid" },
                                            "tracked": { "type": "boolean" },
                                            "kind": { "type": "string" }
                                        }, "additionalProperties": true }
                                    },
                                    "short_delivery_reason": { "type": "string", "minLength": 5, "maxLength": 500 }
                                },
                                "anyOf": [
                                    { "required": ["received_by"] },
                                    { "required": ["delivery_evidence"] }
                                ]
                            } } }
                        });
                    }
                    if def.qname() == "auto-service.repair_order" && action == "quote_declined" {
                        operation["description"] = json!(
                            "Record a customer's estimate rejection, retain the reason, and release the vehicle for a new intake in one transaction. No stock is consumed and no invoice is created."
                        );
                        operation["requestBody"] = json!({
                            "required": true,
                            "content": { "application/json": { "schema": {
                                "type": "object",
                                "required": ["declined_reason"],
                                "additionalProperties": false,
                                "properties": {
                                    "declined_reason": { "type": "string", "minLength": 5, "maxLength": 500 }
                                }
                            } } }
                        });
                    }
                    if def.qname() == "events.ticket" && action == "sold" {
                        operation["description"] = json!(
                            "Set the validated payment method and sell the reserved ticket atomically. Ticket payment and tax records are generated in the same transaction."
                        );
                        operation["requestBody"] = json!({
                            "required": true,
                            "content": { "application/json": { "schema": {
                                "type": "object",
                                "required": ["method"],
                                "additionalProperties": false,
                                "properties": {
                                    "method": { "type": "string", "enum": ["cash", "card", "transfer", "ewallet", "bank"] }
                                }
                            } } }
                        });
                    }
                    if def.qname() == "events.ticket" && action == "refunded" {
                        operation["description"] = json!(
                            "Record the required refund reason and refund the sold, not-yet-checked-in ticket in one transaction. The accounting refund record is generated atomically."
                        );
                        operation["requestBody"] = json!({
                            "required": true,
                            "content": { "application/json": { "schema": {
                                "type": "object",
                                "required": ["refund_reason"],
                                "additionalProperties": false,
                                "properties": {
                                    "refund_reason": { "type": "string", "minLength": 1, "maxLength": 500 }
                                }
                            } } }
                        });
                    }
                    if def.qname() == "restaurant.table_order" && action == "completed" {
                        operation["description"] = json!(
                            "Set the payment method and settle the served order atomically. Inventory consumption and the accounting payment are created only if settlement succeeds."
                        );
                        operation["requestBody"] = json!({
                            "required": true,
                            "content": { "application/json": { "schema": {
                                "type": "object",
                                "required": ["method"],
                                "additionalProperties": false,
                                "properties": {
                                    "method": { "type": "string", "enum": ["cash", "card", "transfer", "ewallet"] }
                                }
                            } } }
                        });
                    }
                    if def.qname() == "restaurant.table_order" && action == "cancelled" {
                        operation["description"] = json!(
                            "An order sent to the kitchen requires a cancellation reason. The reason, order transition, and cancellation of queued kitchen tickets commit together. An unsent open order may be cancelled without a reason."
                        );
                        operation["requestBody"] = json!({
                            "required": false,
                            "content": { "application/json": { "schema": {
                                "type": "object",
                                "required": ["cancellation_reason"],
                                "additionalProperties": false,
                                "properties": {
                                    "cancellation_reason": { "type": "string", "minLength": 1, "maxLength": 500 }
                                }
                            } } }
                        });
                    }
                    if def.qname() == "insurance.claim" && action == "approved" {
                        operation["description"] = json!(
                            "Record the approved claim amount and approve the claim atomically with the tenant-locked cumulative policy-limit check."
                        );
                        operation["requestBody"] = json!({
                            "required": true,
                            "content": { "application/json": { "schema": {
                                "type": "object",
                                "required": ["approved_amount"],
                                "additionalProperties": false,
                                "properties": {
                                    "approved_amount": { "type": "number", "exclusiveMinimum": 0 }
                                }
                            } } }
                        });
                    }
                    if def.qname() == "insurance.claim" && action == "rejected" {
                        operation["description"] = json!(
                            "Retain the required reason on the claim history while rejecting it in one transaction."
                        );
                        operation["requestBody"] = json!({
                            "required": true,
                            "content": { "application/json": { "schema": {
                                "type": "object",
                                "required": ["rejection_reason"],
                                "additionalProperties": false,
                                "properties": {
                                    "rejection_reason": { "type": "string", "minLength": 5, "maxLength": 1000 }
                                }
                            } } }
                        });
                    }
                    if def.qname() == "insurance.claim" && action == "paid" {
                        operation["description"] = json!(
                            "Record the payout method and expense account, pay the approved claim, and post its accounting journal atomically."
                        );
                        operation["requestBody"] = json!({
                            "required": true,
                            "content": { "application/json": { "schema": {
                                "type": "object",
                                "required": ["method", "expense_account"],
                                "additionalProperties": false,
                                "properties": {
                                    "method": { "type": "string", "enum": ["cash", "bank"] },
                                    "expense_account": { "type": "string", "format": "uuid" }
                                }
                            } } }
                        });
                    }
                    if def.qname() == "accounting.bank_statement_line" && action == "matched" {
                        operation["description"] = json!(
                            "Link exactly one payment or posted journal entry and match the bank statement line atomically. Empty-body requests continue to use the unique automatic matcher."
                        );
                        operation["requestBody"] = json!({
                            "required": false,
                            "content": { "application/json": { "schema": {
                                "type": "object",
                                "required": ["payment", "journal_entry"],
                                "additionalProperties": false,
                                "properties": {
                                    "payment": { "type": ["string", "null"], "format": "uuid" },
                                    "journal_entry": { "type": ["string", "null"], "format": "uuid" }
                                },
                                "oneOf": [
                                    { "properties": { "payment": { "type": "string", "format": "uuid" }, "journal_entry": { "type": "null" } } },
                                    { "properties": { "payment": { "type": "null" }, "journal_entry": { "type": "string", "format": "uuid" } } }
                                ]
                            } } }
                        });
                    }
                    if def.qname() == "accounting.bank_statement_line" && action == "ignored" {
                        operation["description"] = json!(
                            "Save the required audit reason and ignore the bank statement line atomically."
                        );
                        operation["requestBody"] = json!({
                            "required": true,
                            "content": { "application/json": { "schema": {
                                "type": "object",
                                "required": ["ignore_reason"],
                                "additionalProperties": false,
                                "properties": {
                                    "ignore_reason": { "type": "string", "minLength": 1, "maxLength": 500 }
                                }
                            } } }
                        });
                    }
                    if def.qname() == "clinic.encounter" && action == "completed" {
                        operation["description"] = json!(
                            "Save the attending doctor, diagnosis and positive visit fee, complete the encounter, and create the receivable invoice in one transaction."
                        );
                        operation["requestBody"] = json!({
                            "required": true,
                            "content": { "application/json": { "schema": {
                                "type": "object",
                                "required": ["doctor", "diagnosis", "fee"],
                                "additionalProperties": false,
                                "properties": {
                                    "doctor": { "type": "string", "minLength": 1 },
                                    "diagnosis": { "type": "string", "minLength": 1 },
                                    "fee": { "type": "number", "exclusiveMinimum": 0 }
                                }
                            } } }
                        });
                    }
                    if def.qname() == "clinic.lab_order" && action == "resulted" {
                        operation["description"] = json!(
                            "Save the non-empty test result and mark the lab order resulted atomically."
                        );
                        operation["requestBody"] = json!({
                            "required": true,
                            "content": { "application/json": { "schema": {
                                "type": "object",
                                "required": ["result"],
                                "additionalProperties": false,
                                "properties": {
                                    "result": { "type": "string", "minLength": 1 }
                                }
                            } } }
                        });
                    }
                    if def.qname() == "einvoice.einvoice" && action == "cancel_requested" {
                        operation["description"] = json!(
                            "Save the cancellation reason and queue the provider cancellation request atomically; the invoice remains pending cancellation until the provider confirms."
                        );
                        operation["requestBody"] = json!({
                            "required": true,
                            "content": { "application/json": { "schema": {
                                "type": "object",
                                "required": ["cancellation_reason"],
                                "additionalProperties": false,
                                "properties": {
                                    "cancellation_reason": { "type": "string", "minLength": 1, "maxLength": 2000 }
                                }
                            } } }
                        });
                    }
                    if def.qname() == "pos.pos_session" && action == "closed" {
                        operation["description"] = json!(
                            "Record counted closing cash and close the POS session atomically after checking unfinished orders and cash movements; expected cash and variance are calculated from posted sales, refunds and cash movements."
                        );
                        operation["requestBody"] = json!({
                            "required": true,
                            "content": { "application/json": { "schema": {
                                "type": "object",
                                "required": ["closing_cash"],
                                "additionalProperties": false,
                                "properties": {
                                    "closing_cash": { "type": "number", "minimum": 0 }
                                }
                            } } }
                        });
                    }
                    if def.qname() == "maintenance.maintenance_request" && action == "done" {
                        operation["description"] = json!(
                            "Save the repair resolution and optional labor hours/rate pair and complete the maintenance request atomically with material issue and recurring-plan synchronization."
                        );
                        operation["requestBody"] = json!({
                            "required": true,
                            "content": { "application/json": { "schema": {
                                "type": "object",
                                "required": ["resolution"],
                                "additionalProperties": false,
                                "properties": {
                                    "resolution": { "type": "string", "minLength": 1 },
                                    "labor_hours": { "type": "number", "minimum": 0 },
                                    "labor_rate": { "type": "number", "minimum": 0 }
                                },
                                "anyOf": [
                                    { "required": ["labor_hours", "labor_rate"] },
                                    { "not": { "anyOf": [ { "required": ["labor_hours"] }, { "required": ["labor_rate"] } ] } }
                                ]
                            } } }
                        });
                    }
                    if def.qname() == "purchasing.supplier_invoice" && action == "disputed" {
                        operation["description"] = json!(
                            "Save the required supplier-invoice dispute reason and move the invoice from submitted to disputed atomically; no payable bill is created while disputed."
                        );
                        operation["requestBody"] = json!({
                            "required": true,
                            "content": { "application/json": { "schema": {
                                "type": "object",
                                "required": ["dispute_reason"],
                                "additionalProperties": false,
                                "properties": {
                                    "dispute_reason": { "type": "string", "minLength": 1, "maxLength": 500 }
                                }
                            } } }
                        });
                    }
                    if def.qname() == "purchasing.supplier_invoice" && action == "submitted" {
                        operation["description"] = json!(
                            "When resubmitting a disputed supplier invoice, record the resolution note with the transition. Draft and rejected invoice submissions may continue without a body."
                        );
                        operation["requestBody"] = json!({
                            "required": false,
                            "content": { "application/json": { "schema": {
                                "type": "object",
                                "required": ["resolution_note"],
                                "additionalProperties": false,
                                "properties": {
                                    "resolution_note": { "type": "string", "minLength": 1, "maxLength": 1000 }
                                }
                            } } }
                        });
                    }
                    if def.qname() == "hrm.employee" && action == "terminated" {
                        operation["description"] = json!(
                            "Save the termination effective date and terminate the employee atomically after validating hire date, attendance and pending leave; downstream payroll synchronization shares the transaction."
                        );
                        operation["requestBody"] = json!({
                            "required": true,
                            "content": { "application/json": { "schema": {
                                "type": "object",
                                "required": ["termination_date"],
                                "additionalProperties": false,
                                "properties": {
                                    "termination_date": { "type": "string", "format": "date" }
                                }
                            } } }
                        });
                    }
                    if def.qname() == "hotel.reservation" && action == "no_show" {
                        operation["description"] = json!(
                            "Save the required no-show reason and mark the reservation no-show atomically after checking that the arrival date passed and no folio charges remain."
                        );
                        operation["requestBody"] = json!({
                            "required": true,
                            "content": { "application/json": { "schema": {
                                "type": "object",
                                "required": ["no_show_reason"],
                                "additionalProperties": false,
                                "properties": {
                                    "no_show_reason": { "type": "string", "minLength": 1, "maxLength": 500 }
                                }
                            } } }
                        });
                    }
                    if def.qname() == "purchasing.rfq" && action == "quoted" {
                        operation["description"] = json!(
                            "Save the supplier's complete quote, reference and validity date while moving the RFQ to quoted in one transaction. Every requested product and quantity must be covered and expired quotes are rejected."
                        );
                        operation["requestBody"] = json!({
                            "required": true,
                            "content": { "application/json": { "schema": {
                                "type": "object",
                                "required": ["quote_lines"],
                                "additionalProperties": false,
                                "properties": {
                                    "quote_lines": { "type": "array", "minItems": 1, "items": {
                                        "type": "object",
                                        "required": ["product", "qty", "price"],
                                        "additionalProperties": false,
                                        "properties": {
                                            "product": { "type": "string", "format": "uuid" },
                                            "qty": { "type": "number", "exclusiveMinimum": 0 },
                                            "price": { "type": "number", "exclusiveMinimum": 0 },
                                            "tax": { "type": "string", "format": "uuid" }
                                        }
                                    } },
                                    "quote_reference": { "type": ["string", "null"], "maxLength": 120 },
                                    "valid_until": { "type": ["string", "null"], "format": "date" }
                                }
                            } } }
                        });
                    }
                    paths.insert(
                        format!("{base}/{{id}}/{action}"),
                        json!({ "post": operation }),
                    );
                }
                let action_names: Vec<&String> = st.actions.keys().collect();
                paths.insert(format!("{base}/bulk/{{action}}"), json!({ "post": {
                    "tags": [def.module], "summary": format!("Chuyển trạng thái hàng loạt: {}", def.label), "security": sec,
                    "parameters": [tid, { "name": "action", "in": "path", "required": true, "schema": { "type": "string", "enum": action_names } }],
                    "description": "Thực hiện cùng một chuyển trạng thái cho 1–100 bản ghi trong một giao dịch. Nếu một bản ghi lỗi, toàn bộ lô được hoàn tác.",
                    "requestBody": { "required": true, "content": { "application/json": { "schema": { "type": "object", "required": ["ids"], "additionalProperties": false, "properties": {
                        "ids": { "type": "array", "minItems": 1, "maxItems": 100, "uniqueItems": true, "items": { "type": "string", "format": "uuid" } }
                    } } } } },
                    "responses": with_common(Map::from_iter([
                        ("200".to_string(), ok(&json!({ "type": "object", "required": ["action", "count", "items"], "properties": { "action": { "type": "string" }, "count": { "type": "integer" }, "items": { "type": "array", "items": r#ref } } }))),
                        ("409".to_string(), err("Ít nhất một bản ghi không ở trạng thái cho phép")),
                        ("422".to_string(), err("Danh sách ID hoặc dữ liệu không hợp lệ"))
                    ]))
                } }));
            }
        }
    }
    if reg.entity("document.document").is_some() {
        let document_id = json!({
            "name": "documentId", "in": "path", "required": true,
            "schema": { "type": "string", "format": "uuid" }
        });
        let attachment_id = json!({
            "name": "attachmentId", "in": "path", "required": true,
            "schema": { "type": "string", "format": "uuid" }
        });
        let metadata = json!({
            "type": "object", "required": ["id", "documentVersion", "fileName", "contentType", "sizeBytes", "sha256", "createdAt"],
            "properties": {
                "id": { "type": "string", "format": "uuid" },
                "documentVersion": { "type": "integer", "minimum": 1 },
                "fileName": { "type": "string" },
                "contentType": { "type": "string" },
                "sizeBytes": { "type": "integer", "minimum": 1 },
                "sha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
                "createdAt": { "type": "string", "format": "date-time" }
            }
        });
        let attachments = "/api/t/{tenantId}/documents/{documentId}/attachments";
        paths.insert(attachments.into(), json!({
            "get": {
                "tags": ["document"], "summary": "List immutable document attachment versions",
                "security": sec, "parameters": [tid, document_id],
                "responses": with_common(Map::from_iter([("200".to_string(), json!({
                    "description": "Attachment metadata, newest version first",
                    "content": { "application/json": { "schema": { "type": "object", "properties": {
                        "items": { "type": "array", "items": metadata }
                    } } } }
                }))]))
            },
            "post": {
                "tags": ["document"], "summary": "Upload a new immutable document version",
                "description": "Requires document.document.read and document.document.update. Stores up to 10 MiB in PostgreSQL, advances document.version, and updates file_url atomically.",
                "security": sec,
                "parameters": [tid, document_id, { "name": "X-File-Name", "in": "header", "required": true, "description": "UTF-8 file name percent-encoded with encodeURIComponent", "schema": { "type": "string", "maxLength": 765 } }],
                "requestBody": { "required": true, "content": { "application/octet-stream": { "schema": { "type": "string", "format": "binary" } } } },
                "responses": with_common(Map::from_iter([
                    ("201".to_string(), json!({ "description": "Stored attachment version", "content": { "application/json": { "schema": metadata } } })),
                    ("413".to_string(), err("Attachment exceeds 10 MiB")),
                    ("422".to_string(), err("File name, media type, or document version is invalid"))
                ]))
            }
        }));
        paths.insert(format!("{attachments}/{{attachmentId}}"), json!({
            "get": {
                "tags": ["document"], "summary": "Download a document attachment version",
                "security": sec, "parameters": [tid, document_id, attachment_id],
                "responses": with_common(Map::from_iter([("200".to_string(), json!({
                    "description": "Binary attachment; always served as a download",
                    "content": { "application/octet-stream": { "schema": { "type": "string", "format": "binary" } } }
                }))]))
            }
        }));
    }
    paths.insert(
        "/api/t/{tenantId}/business/preview".into(),
        json!({ "post": {
            "tags": ["sales", "purchasing"],
            "summary": "Preview server-calculated sales or purchasing lines",
            "description": "Validates and calculates document lines using tenant-scoped product, tax, price list and source document data. This endpoint does not persist changes.",
            "security": sec,
            "parameters": [tid],
            "requestBody": { "required": true, "content": { "application/json": { "schema": {
                "type": "object", "required": ["entity", "document"], "additionalProperties": false,
                "properties": {
                    "entity": { "type": "string", "enum": ["sales.quotation", "sales.sales_order", "sales.sales_return", "purchasing.purchase_order", "purchasing.purchase_receipt", "purchasing.purchase_return"] },
                    "document": { "type": "object", "description": "Draft document fields and lines to validate and calculate", "additionalProperties": true }
                }
            } } } },
            "responses": with_common(Map::from_iter([
                ("200".to_string(), json!({ "description": "Calculated totals and normalized lines", "content": { "application/json": { "schema": { "type": "object", "properties": {
                    "lines": { "type": "array", "items": { "type": "object" } },
                    "subtotal": { "type": "number" }, "discountTotal": { "type": "number" },
                    "taxTotal": { "type": "number" }, "total": { "type": "number" }
                } } } } })),
                ("422".to_string(), err("Document lines or references are invalid"))
            ]))
        } }),
    );
    let report_parameters = json!([
        tid,
        { "name": "from", "in": "query", "description": "Ngày bắt đầu, YYYY-MM-DD", "schema": { "type": "string", "format": "date" } },
        { "name": "to", "in": "query", "description": "Ngày kết thúc, YYYY-MM-DD", "schema": { "type": "string", "format": "date" } }
    ]);
    paths.insert(
        "/api/auth/password-reset/request".into(),
        json!({ "post": {
            "tags": ["auth"], "summary": "Request a password reset email",
            "requestBody": { "required": true, "content": { "application/json": { "schema": {
                "type": "object", "required": ["tenantId", "email"],
                "properties": { "tenantId": { "type": "string" }, "email": { "type": "string", "format": "email" } }
            } } } },
            "responses": with_common(Map::from_iter([("200".to_string(), json!({ "description": "Generic response independent of account existence" })), ("429".to_string(), err("Too many requests"))]))
        } }),
    );
    paths.insert(
        "/api/auth/password-reset/complete".into(),
        json!({ "post": {
            "tags": ["auth"], "summary": "Consume a reset token and set a new password",
            "requestBody": { "required": true, "content": { "application/json": { "schema": {
                "type": "object", "required": ["token", "password"],
                "properties": { "token": { "type": "string" }, "password": { "type": "string", "minLength": 8, "maxLength": 200 } }
            } } } },
            "responses": with_common(Map::from_iter([("200".to_string(), json!({ "description": "Password changed; reset token consumed and active sessions revoked" })), ("422".to_string(), err("Token expired or password invalid"))]))
        } }),
    );
    paths.insert(
        "/api/auth/email-verification/complete".into(),
        json!({ "post": {
            "tags": ["auth"], "summary": "Verify the email address and activate the initial account",
            "requestBody": { "required": true, "content": { "application/json": { "schema": {
                "type": "object", "required": ["token"], "additionalProperties": false,
                "properties": { "token": { "type": "string" } }
            } } } },
            "responses": with_common(Map::from_iter([("200".to_string(), json!({ "description": "Email verified; one-time token consumed" })), ("422".to_string(), err("Token expired or invalid")), ("429".to_string(), err("Too many requests"))]))
        } }),
    );
    paths.insert(
        "/api/auth/email-verification/request".into(),
        json!({ "post": {
            "tags": ["auth"], "summary": "Request a signup verification email without disclosing account state",
            "requestBody": { "required": true, "content": { "application/json": { "schema": {
                "type": "object", "required": ["tenantId", "email"], "additionalProperties": false,
                "properties": { "tenantId": { "type": "string" }, "email": { "type": "string", "format": "email" } }
            } } } },
            "responses": with_common(Map::from_iter([("200".to_string(), json!({ "description": "Generic response independent of account state" })), ("429".to_string(), err("Too many requests"))]))
        } }),
    );
    paths.insert(
        "/api/auth/mfa/complete".into(),
        json!({ "post": {
            "tags": ["auth"], "summary": "Complete a TOTP login challenge using an authenticator code or one-time recovery code",
            "requestBody": { "required": true, "content": { "application/json": { "schema": {
                "type": "object", "required": ["challengeToken", "code"], "additionalProperties": false,
                "properties": { "challengeToken": { "type": "string" }, "code": { "type": "string", "maxLength": 100 } }
            } } } },
            "responses": with_common(Map::from_iter([("200".to_string(), json!({ "description": "MFA challenge consumed and browser session issued" })), ("401".to_string(), err("Invalid, expired, replayed, or exhausted MFA challenge")), ("429".to_string(), err("Too many authentication attempts"))]))
        } }),
    );
    paths.insert(
        "/api/t/{tenantId}/auth/sessions".into(),
        json!({ "get": {
            "tags": ["auth"], "summary": "List the current user's active browser sessions", "security": sec,
            "parameters": [tid],
            "responses": with_common(Map::from_iter([("200".to_string(), json!({ "description": "Session ids, labels, creation/expiry times, and the current-session flag" }))]))
        } }),
    );
    paths.insert(
        "/api/t/{tenantId}/auth/sessions/revoke-others".into(),
        json!({ "post": {
            "tags": ["auth"], "summary": "Revoke all other browser sessions for the current user", "security": sec,
            "parameters": [tid],
            "responses": with_common(Map::from_iter([("200".to_string(), json!({ "description": "Other sessions revoked; current browser session remains active" }))]))
        } }),
    );
    paths.insert(
        "/api/t/{tenantId}/auth/mfa/status".into(),
        json!({ "get": {
            "tags": ["auth"], "summary": "Read the current user's MFA status and remaining recovery-code count", "security": sec,
            "parameters": [tid],
            "responses": with_common(Map::from_iter([("200".to_string(), json!({ "description": "Account MFA state" }))]))
        } }),
    );
    paths.insert(
        "/api/t/{tenantId}/auth/mfa/setup".into(),
        json!({ "post": {
            "tags": ["auth"], "summary": "Start TOTP enrollment after password reauthentication", "security": sec,
            "parameters": [tid],
            "requestBody": { "required": true, "content": { "application/json": { "schema": { "type": "object", "required": ["password"], "additionalProperties": false, "properties": { "password": { "type": "string" } } } } } },
            "responses": with_common(Map::from_iter([("200".to_string(), json!({ "description": "Temporary secret and otpauth URI; enrollment expires after ten minutes" })), ("409".to_string(), err("MFA is already enabled")), ("503".to_string(), err("TOTP encryption key is not configured"))]))
        } }),
    );
    paths.insert(
        "/api/t/{tenantId}/auth/mfa/confirm".into(),
        json!({ "post": {
            "tags": ["auth"], "summary": "Confirm a live TOTP code and receive one-time recovery codes", "security": sec,
            "parameters": [tid],
            "requestBody": { "required": true, "content": { "application/json": { "schema": { "type": "object", "required": ["code"], "additionalProperties": false, "properties": { "code": { "type": "string", "pattern": "^[0-9]{6}$" } } } } } },
            "responses": with_common(Map::from_iter([("200".to_string(), json!({ "description": "MFA enabled and recovery codes returned once" })), ("422".to_string(), err("Setup code is invalid or setup has expired"))]))
        } }),
    );
    paths.insert(
        "/api/t/{tenantId}/auth/mfa/disable".into(),
        json!({ "post": {
            "tags": ["auth"], "summary": "Disable MFA after password and TOTP or recovery-code confirmation", "security": sec,
            "parameters": [tid],
            "requestBody": { "required": true, "content": { "application/json": { "schema": { "type": "object", "required": ["password", "code"], "additionalProperties": false, "properties": { "password": { "type": "string" }, "code": { "type": "string", "maxLength": 100 } } } } } },
            "responses": with_common(Map::from_iter([("200".to_string(), json!({ "description": "MFA disabled and other sessions revoked" })), ("401".to_string(), err("Password or MFA code is invalid")), ("429".to_string(), err("MFA verification is temporarily locked"))]))
        } }),
    );
    paths.insert(
        "/api/t/{tenantId}/auth/mfa/users/{userId}/reset".into(),
        json!({ "post": {
            "tags": ["auth"], "summary": "Reset a user's MFA with a required audit reason; tenant administrator only", "security": sec,
            "parameters": [tid, { "name": "userId", "in": "path", "required": true, "schema": { "type": "string" } }],
            "requestBody": { "required": true, "content": { "application/json": { "schema": { "type": "object", "required": ["reason"], "additionalProperties": false, "properties": { "reason": { "type": "string", "minLength": 10, "maxLength": 500 } } } } } },
            "responses": with_common(Map::from_iter([("200".to_string(), json!({ "description": "MFA and recovery codes cleared; user's sessions revoked" })), ("403".to_string(), err("Tenant administrator permission required"))]))
        } }),
    );
    paths.insert(
        "/api/t/{tenantId}/reports/bi/kpis/{kpiId}".into(),
        json!({ "get": {
            "tags": ["bi"], "summary": "Evaluate a tenant KPI using its saved aggregate report and Rust formula", "security": sec,
            "parameters": [tid, { "name": "kpiId", "in": "path", "required": true, "schema": { "type": "string", "format": "uuid" } }],
            "responses": with_common(Map::from_iter([("200".to_string(), json!({ "description": "Raw and formula-adjusted KPI value, target, and attainment percentage" })), ("422".to_string(), err("Invalid KPI report or formula"))]))
        } }),
    );
    paths.insert(
        "/api/t/{tenantId}/reports/bi/{reportId}/export".into(),
        json!({ "get": {
            "tags": ["bi"], "summary": "Export all matching rows from a saved BI report as CSV", "security": sec,
            "parameters": [tid, { "name": "reportId", "in": "path", "required": true, "schema": { "type": "string", "format": "uuid" } }],
            "responses": with_common(Map::from_iter([
                ("200".to_string(), json!({ "description": "UTF-8 CSV attachment; up to 50,000 matching rows", "content": { "text/csv": { "schema": { "type": "string", "format": "binary" } } } })),
                ("422".to_string(), err("Invalid report definition or export exceeds the row limit"))
            ]))
        } }),
    );
    paths.insert(
        "/api/t/{tenantId}/reports/bi/{reportId}".into(),
        json!({ "get": {
            "tags": ["bi"], "summary": "Run a saved BI report", "security": sec,
            "parameters": [tid, { "name": "reportId", "in": "path", "required": true, "schema": { "type": "string", "format": "uuid" } }],
            "responses": with_common(Map::from_iter([("200".to_string(), json!({ "description": "Tenant-scoped detail rows or grouped aggregates with saved filters and pagination" })), ("422".to_string(), err("Invalid report definition"))]))
        } }),
    );
    paths.insert(
        "/api/t/{tenantId}/reports/accounting/chart-templates".into(),
        json!({ "get": {
            "tags": ["accounting"], "summary": "List supported Vietnamese chart of accounts templates", "security": sec,
            "parameters": [tid],
            "responses": with_common(Map::from_iter([
                ("200".to_string(), json!({ "description": "Selectable accounting standards and the tenant's active standard; templates contain level-1 accounts only" })),
                ("403".to_string(), err("Requires accounting.account.read"))
            ]))
        } }),
    );
    paths.insert(
        "/api/t/{tenantId}/reports/accounting/chart-templates/{templateId}/apply".into(),
        json!({ "post": {
            "tags": ["accounting"], "summary": "Apply a chart of accounts template", "security": sec,
            "parameters": [tid, { "name": "templateId", "in": "path", "required": true, "schema": { "type": "string", "enum": ["tt99_2025", "tt133_sme_2016"] } }],
            "description": "Adds missing level-1 account codes, preserves existing account records, and locks the tenant to one standard. Requires accounting.account.create.",
            "responses": with_common(Map::from_iter([
                ("200".to_string(), json!({ "description": "The template was already applied; no new account records were created" })),
                ("201".to_string(), json!({ "description": "Template selected and missing accounts created" })),
                ("403".to_string(), err("Requires accounting.account.create")),
                ("404".to_string(), err("Unknown chart of accounts template")),
                ("409".to_string(), err("A different accounting standard is already selected"))
            ]))
        } }),
    );
    paths.insert(
        "/api/t/{tenantId}/reports/accounting/trial-balance".into(),
        json!({ "get": {
            "tags": ["accounting"], "summary": "Bảng cân đối phát sinh theo kỳ", "security": sec,
            "parameters": report_parameters,
            "responses": with_common(Map::from_iter([("200".to_string(), json!({ "description": "Số dư đầu kỳ, phát sinh trong kỳ và số dư cuối kỳ theo tài khoản" })), ("422".to_string(), err("Khoảng ngày không hợp lệ"))]))
        } }),
    );
    paths.insert(
        "/api/t/{tenantId}/reports/accounting/income-statement".into(),
        json!({ "get": {
            "tags": ["accounting"], "summary": "Báo cáo kết quả kinh doanh", "security": sec,
            "parameters": report_parameters,
            "responses": with_common(Map::from_iter([("200".to_string(), json!({ "description": "Doanh thu, chi phí và lợi nhuận thuần theo ngày hạch toán" })), ("422".to_string(), err("Khoảng ngày không hợp lệ"))]))
        } }),
    );
    paths.insert(
        "/api/t/{tenantId}/reports/accounting/balance-sheet".into(),
        json!({ "get": {
            "tags": ["accounting"], "summary": "Bảng cân đối kế toán", "security": sec,
            "parameters": [tid, { "name": "asOf", "in": "query", "description": "Ngày cuối kỳ, YYYY-MM-DD", "schema": { "type": "string", "format": "date" } }],
            "responses": with_common(Map::from_iter([("200".to_string(), json!({ "description": "Tài sản, nợ phải trả, vốn chủ sở hữu, lợi nhuận lũy kế và chênh lệch cân đối đến ngày chỉ định" })), ("422".to_string(), err("Ngày không hợp lệ"))]))
        } }),
    );
    paths.insert(
        "/api/t/{tenantId}/reports/accounting/cash-flow-forecast".into(),
        json!({ "get": {
            "tags": ["accounting"], "summary": "Dá»± bÃ¡o dÃ²ng tiá»n pháº£i thu vÃ  pháº£i tráº£", "security": sec,
            "parameters": report_parameters,
            "responses": with_common(Map::from_iter([("200".to_string(), json!({ "description": "Open posted receivables/payables, unbilled approved purchase orders, approved payroll and approved expense claims with a payment date; balances are calculated as of the forecast start" })), ("422".to_string(), err("Khoáº£ng ngÃ y khÃ´ng há»£p lá»‡"))]))
        } }),
    );
    let aging_parameters = json!([
        tid,
        { "name": "asOf", "in": "query", "description": "Ngày tính tuổi nợ, YYYY-MM-DD; mặc định ngày hiện tại", "schema": { "type": "string", "format": "date" } }
    ]);
    paths.insert(
        "/api/t/{tenantId}/reports/accounting/receivables-aging".into(),
        json!({ "get": {
            "tags": ["accounting"], "summary": "Aging công nợ phải thu", "security": sec,
            "parameters": aging_parameters,
            "responses": with_common(Map::from_iter([("200".to_string(), json!({ "description": "Công nợ hóa đơn bán theo đối tác và các nhóm chưa đến hạn, đến hạn, quá hạn 1–30, 31–60, 61–90, trên 90 ngày" })), ("422".to_string(), err("Ngày asOf không hợp lệ"))]))
        } }),
    );
    paths.insert(
        "/api/t/{tenantId}/reports/accounting/payables-aging".into(),
        json!({ "get": {
            "tags": ["accounting"], "summary": "Aging công nợ phải trả", "security": sec,
            "parameters": aging_parameters,
            "responses": with_common(Map::from_iter([("200".to_string(), json!({ "description": "Công nợ hóa đơn mua theo nhà cung cấp và các nhóm chưa đến hạn, đến hạn, quá hạn 1–30, 31–60, 61–90, trên 90 ngày" })), ("422".to_string(), err("Ngày asOf không hợp lệ"))]))
        } }),
    );
    paths.insert(
        "/api/t/{tenantId}/reports/accounting/fx-revaluation-preview".into(),
        json!({ "get": {
            "tags": ["accounting"], "summary": "Foreign-currency receivable/payable revaluation preview", "security": sec,
            "parameters": aging_parameters,
            "responses": with_common(Map::from_iter([
                ("200".to_string(), json!({ "description": "Open foreign-currency receivables and payables as of the requested date, with carrying base amount, latest saved closing rate, target base amount, and proposed signed adjustment. The result supports creation of a draft journal through the standard approval workflow." })),
                ("422".to_string(), err("Invalid asOf date"))
            ]))
        } }),
    );
    paths.insert(
        "/api/t/{tenantId}/reports/accounting/fx-revaluation-journals".into(),
        json!({ "post": {
            "tags": ["accounting"], "summary": "Create foreign-currency revaluation journal draft", "security": sec,
            "parameters": [tid],
            "requestBody": { "required": true, "content": { "application/json": { "schema": { "type": "object", "required": ["asOf", "memo"], "properties": { "asOf": { "type": "string", "format": "date" }, "memo": { "type": "string", "minLength": 1, "maxLength": 300 } } } } } },
            "responses": with_common(Map::from_iter([
                ("201".to_string(), json!({ "description": "Idempotent draft journal created; posting remains subject to the standard journal workflow" })),
                ("200".to_string(), json!({ "description": "Draft or posted journal already exists for this accounting date" })),
                ("403".to_string(), err("Requires accounting.journal_entry.create")),
                ("422".to_string(), err("Invalid date, closed period, missing closing rate, or no material adjustment"))
            ]))
        } }),
    );
    paths.insert(
        "/api/t/{tenantId}/reports/accounting/tax-register".into(),
        json!({ "get": {
            "tags": ["accounting"], "summary": "Output and input tax register", "security": sec,
            "parameters": report_parameters,
            "responses": with_common(Map::from_iter([
                ("200".to_string(), json!({ "description": "Posted invoices, customer credit notes, supplier bills, and supplier debit notes grouped by tax name and rate, with source-document details, counterparty tax identity, and line snapshots using journal posting dates" })),
                ("422".to_string(), err("Invalid date range"))
            ]))
        } }),
    );
    paths.insert(
        "/api/t/{tenantId}/accounting/adjustment-refunds".into(),
        json!({ "post": {
            "tags": ["accounting"], "summary": "Refund a posted credit/debit note", "security": sec,
            "parameters": [tid],
            "requestBody": { "required": true, "content": { "application/json": { "schema": { "type": "object", "required": ["kind", "adjustmentId", "amount", "method", "paymentDate", "requestId"], "properties": {
                "kind": { "type": "string", "enum": ["credit_note", "debit_note"] },
                "adjustmentId": { "type": "string", "format": "uuid" },
                "amount": { "type": "number", "exclusiveMinimum": 0 },
                "method": { "type": "string", "enum": ["cash", "card", "transfer", "ewallet", "bank"] },
                "paymentDate": { "type": "string", "format": "date" },
                "requestId": { "type": "string", "format": "uuid", "description": "Idempotency key reused for retries" }
            } } } } },
            "responses": with_common(Map::from_iter([
                ("201".to_string(), json!({ "description": "Payment and accounting journal created" })),
                ("200".to_string(), json!({ "description": "Idempotent replay returned the existing payment" })),
                ("422".to_string(), err("Invalid note, amount, date, method, or insufficient refundable balance"))
            ]))
        } }),
    );
    paths.insert(
        "/api/t/{tenantId}/accounting/bank-statements/{statementId}/import".into(),
        json!({ "post": {
            "tags": ["accounting"], "summary": "Import bank statement CSV", "security": sec,
            "parameters": [tid, { "name": "statementId", "in": "path", "required": true, "schema": { "type": "string", "format": "uuid" } }],
            "requestBody": { "required": true, "content": { "text/csv": { "schema": { "type": "string", "description": "CSV header: transaction_date (or date), amount+direction or debit+credit, and optional reference/description" } } } },
            "responses": with_common(Map::from_iter([
                ("200".to_string(), json!({ "description": "Rows imported or skipped as exact idempotent replays" })),
                ("409".to_string(), err("Only a draft statement accepts imported rows")),
                ("422".to_string(), err("Invalid CSV rows or dates outside the statement period"))
            ]))
        } }),
    );
    paths.insert(
        "/api/t/{tenantId}/accounting/bank-statements/{statementId}/import-camt053".into(),
        json!({ "post": {
            "tags": ["accounting"], "summary": "Import ISO 20022 CAMT.053 bank statement", "security": sec,
            "parameters": [tid, { "name": "statementId", "in": "path", "required": true, "schema": { "type": "string", "format": "uuid" } }],
            "requestBody": { "required": true, "content": {
                "application/xml": { "schema": { "type": "string", "description": "UTF-8 CAMT.053.001.01–.14 document, one statement, up to 20,000 booked entries and 5 MB" } },
                "text/xml": { "schema": { "type": "string", "description": "UTF-8 CAMT.053.001.01–.14 document, one statement, up to 20,000 booked entries and 5 MB" } }
            } },
            "responses": with_common(Map::from_iter([
                ("200".to_string(), json!({ "description": "Rows imported or skipped as exact idempotent replays" })),
                ("409".to_string(), err("Only a draft statement accepts imported rows")),
                ("413".to_string(), err("File exceeds 5 MB or has more than 20,000 entries")),
                ("422".to_string(), err("Invalid CAMT.053 document, currency, date, or duplicate reference"))
            ]))
        } }),
    );
    paths.insert(
        "/api/t/{tenantId}/reports/agriculture/crop-cycles/{cycleId}/input-costs".into(),
        json!({ "get": {
            "tags": ["agriculture", "inventory"], "summary": "Crop-cycle inventory input costs", "security": sec,
            "parameters": [tid, { "name": "cycleId", "in": "path", "required": true, "schema": { "type": "string", "format": "uuid" } }],
            "description": "Aggregates inventory issue total_cost values at the time each input was issued for fertilizer, pesticide, seed, and water product applications. Does not include labor, non-stocked water, or landed-cost adjustments posted later. The per-hectare amount is null when farm area is missing or zero. Requires agriculture.crop_cycle.read, agriculture.input_application.read, and inventory.stock_move.read.",
            "responses": with_common(Map::from_iter([
                ("200".to_string(), json!({ "description": "Base-currency material costs by application kind and per hectare" })),
                ("403".to_string(), err("Missing crop-cycle, input-application, or inventory stock-move read permission")),
                ("404".to_string(), err("Crop cycle not found in this tenant")),
                ("422".to_string(), err("Invalid cycleId UUID"))
            ]))
        } }),
    );
    paths.insert(
        "/api/t/{tenantId}/reports/asset/depreciation-schedule".into(),
        json!({ "get": {
            "tags": ["asset"], "summary": "Forecast monthly depreciation for active fixed assets", "security": sec,
            "parameters": [tid, { "name": "months", "in": "query", "description": "Forecast horizon in months (1–36, default 12)", "schema": { "type": "integer", "minimum": 1, "maximum": 36, "default": 12 } }],
            "description": "Uses the current posted accumulated depreciation and the same Rust depreciation policy as posting preparation. Existing draft periods are marked. Creates no depreciation documents or journals. Requires asset.asset.read.",
            "responses": with_common(Map::from_iter([
                ("200".to_string(), json!({ "description": "Per-asset monthly forecast and aggregate projected amount" })),
                ("403".to_string(), err("Requires asset.asset.read")),
                ("422".to_string(), err("Invalid horizon or inconsistent stored depreciation data"))
            ]))
        } }),
    );
    paths.insert(
        "/api/t/{tenantId}/reports/manufacturing/wip".into(),
        json!({ "get": {
            "tags": ["manufacturing"], "summary": "Open production work in process", "security": sec,
            "parameters": [tid, { "name": "asOf", "in": "query", "description": "Cost cutoff date, YYYY-MM-DD; defaults to today", "schema": { "type": "string", "format": "date" } }],
            "responses": with_common(Map::from_iter([("200".to_string(), json!({ "description": "Production-order WIP by as-of date with optional comparison against the tenant's posted general-ledger balance on account 154" })), ("403".to_string(), err("Requires manufacturing.production_order.read; account comparison also requires accounting.journal_entry.read")), ("422".to_string(), err("Invalid asOf date"))]))
        } }),
    );
    paths.insert(
        "/api/t/{tenantId}/reports/manufacturing/wip/reconciliation-journals".into(),
        json!({ "post": {
            "tags": ["manufacturing", "accounting"], "summary": "Create an idempotent draft WIP reconciliation journal", "security": sec,
            "parameters": [tid],
            "requestBody": { "required": true, "content": { "application/json": { "schema": { "type": "object", "required": ["asOf", "offsetAccountId", "memo"], "properties": {
                "asOf": { "type": "string", "format": "date" },
                "offsetAccountId": { "type": "string", "format": "uuid", "description": "Contra account selected by the accountant; must not be account 154" },
                "memo": { "type": "string", "maxLength": 300 }
            } } } } },
            "responses": with_common(Map::from_iter([("201".to_string(), json!({ "description": "Balanced draft journal created; normal journal review and posting are still required" })), ("200".to_string(), json!({ "description": "Existing idempotent journal returned" })), ("403".to_string(), err("Requires manufacturing.production_order.read, accounting.journal_entry.create, and accounting.account.read")), ("422".to_string(), err("Invalid date/account, closed period, or no remaining WIP variance"))]))
        } }),
    );
    paths.insert(
        "/api/t/{tenantId}/reports/inventory/replenishment".into(),
        json!({ "get": {
            "tags": ["inventory"], "summary": "Stock replenishment suggestions", "security": sec,
            "parameters": [tid],
            "responses": with_common(Map::from_iter([("200".to_string(), json!({ "description": "Items whose projected stock is below minimum, net of QC holds, open purchase-order quantities, unconverted requisitions, and confirmed tracked-product sales demand; response includes committedQty and projectedQty" })), ("403".to_string(), err("Missing inventory.reorder_rule.read permission"))]))
        } }),
    );
    paths.insert(
        "/api/t/{tenantId}/reports/inventory/location-stock".into(),
        json!({ "get": {
            "tags": ["inventory"], "summary": "Stock balance by warehouse and location", "security": sec,
            "parameters": [tid, { "name": "warehouse", "in": "query", "schema": { "type": "string", "format": "uuid" } }],
            "responses": with_common(Map::from_iter([("200".to_string(), json!({ "description": "Movement-derived quantity and value by warehouse location and product, including unassigned stock" })), ("422".to_string(), err("Invalid warehouse id"))]))
        } }),
    );
    paths.insert(
        "/api/t/{tenantId}/reports/inventory/lot-expiry".into(),
        json!({
            "get": {
                "tags": ["inventory"], "summary": "Expired and near-expiry lot stock", "security": sec,
                "parameters": [tid, { "name": "days", "in": "query", "schema": { "type": "integer", "minimum": 0, "maximum": 365, "default": 90 } }, { "name": "limit", "in": "query", "schema": { "type": "integer", "minimum": 1, "maximum": 500, "default": 100 } }, { "name": "offset", "in": "query", "schema": { "type": "integer", "minimum": 0, "maximum": 1000000, "default": 0 } }],
                "responses": with_common(Map::from_iter([("200".to_string(), json!({ "description": "Paginated positive movement-derived stock balances grouped by lot and warehouse, including expired lots and non-expired lots due within the selected horizon" })), ("403".to_string(), err("Requires inventory.lot.read and inventory.stock_move.read")), ("422".to_string(), err("Invalid days or pagination"))]))
            },
            "post": {
                "tags": ["inventory", "accounting"], "summary": "Create a draft stock count to write off expired lots", "security": sec,
                "parameters": [tid],
                "requestBody": { "required": true, "content": { "application/json": { "schema": { "type": "object", "required": ["warehouseId"], "properties": { "warehouseId": { "type": "string", "format": "uuid" } } } } } },
                "responses": with_common(Map::from_iter([("201".to_string(), json!({ "description": "Draft damage stock count created from expired lot balances by location; normal submission, review and approval are required before inventory and accounting are adjusted" })), ("200".to_string(), json!({ "description": "Existing open expiry write-off count returned idempotently" })), ("403".to_string(), err("Requires inventory.lot.read, inventory.stock_move.read and inventory.stock_count.create")), ("422".to_string(), err("No eligible expired stock, an active quality hold, or more than 5,000 lot/location rows")), ("404".to_string(), err("Warehouse not found for this tenant"))]))
            }
        }),
    );
    paths.insert(
        "/api/t/{tenantId}/reports/restaurant/kitchen-board".into(),
        json!({ "get": {
            "tags": ["restaurant"], "summary": "Active restaurant kitchen and bar tickets", "security": sec,
            "parameters": [tid, { "name": "station", "in": "query", "schema": { "type": "string", "enum": ["all", "kitchen", "bar"], "default": "all" } }],
            "responses": with_common(Map::from_iter([("200".to_string(), json!({ "description": "Oldest-first kitchen tickets attached to sent or served table orders; completed and cancelled orders are omitted. Result is capped at 500 rows." })), ("403".to_string(), err("Requires restaurant.kitchen_ticket.read")), ("422".to_string(), err("Invalid kitchen station"))]))
        } }),
    );
    paths.insert(
        "/api/t/{tenantId}/reports/logistics/delivery-board".into(),
        json!({ "get": {
            "tags": ["logistics"], "summary": "Open shipment dispatch and delivery board", "security": sec,
            "parameters": [tid],
            "responses": with_common(Map::from_iter([("200".to_string(), json!({ "description": "Tenant-scoped failed, short-delivered, created and dispatched shipments ordered by operational priority and age, with latest tracking event; result is capped at 500 rows" })), ("403".to_string(), err("Requires logistics.shipment.read")), ("404".to_string(), err("Logistics module is not enabled"))]))
        } }),
    );
    paths.insert(
        "/api/t/{tenantId}/reports/logistics/shipments/{shipmentId}/redeliver".into(),
        json!({ "post": {
            "tags": ["logistics"], "summary": "Create an idempotent retry shipment from a failed or short delivery", "security": sec,
            "parameters": [tid, { "name": "shipmentId", "in": "path", "required": true, "schema": { "type": "string", "format": "uuid" } }],
            "responses": with_common(Map::from_iter([("201".to_string(), json!({ "description": "New shipment created in created state; failed shipments retain their lines and short deliveries include only undelivered quantities. Original history is preserved." })), ("200".to_string(), json!({ "description": "Existing retry shipment returned idempotently, including retries already completed or in progress" })), ("403".to_string(), err("Requires logistics.shipment.read and logistics.shipment.create")), ("404".to_string(), err("Logistics module is not enabled")), ("422".to_string(), err("Shipment is not failed or short-delivered, has no remaining lines, or its source order is no longer open"))]))
        } }),
    );
    paths.insert(
        "/api/t/{tenantId}/reports/hotel/housekeeping-board".into(),
        json!({ "get": {
            "tags": ["hotel"], "summary": "Rooms awaiting housekeeping", "security": sec,
            "parameters": [tid],
            "responses": with_common(Map::from_iter([("200".to_string(), json!({ "description": "Tenant-scoped cleaning rooms prioritized by same-day arrivals, with previous checkout date and room readiness totals; guest identity is omitted and result is capped at 500 rooms" })), ("403".to_string(), err("Requires hotel.room.read")), ("404".to_string(), err("Hotel module is not enabled"))]))
        } }),
    );
    paths.insert(
        "/api/t/{tenantId}/reports/inventory/lots/{lotId}/traceability".into(),
        json!({ "get": {
            "tags": ["inventory"], "summary": "Lot traceability and remaining stock", "security": sec,
            "parameters": [tid, { "name": "lotId", "in": "path", "required": true, "schema": { "type": "string", "format": "uuid" } }, { "name": "limit", "in": "query", "schema": { "type": "integer", "minimum": 1, "maximum": 500, "default": 100 } }, { "name": "offset", "in": "query", "schema": { "type": "integer", "minimum": 0, "maximum": 1000000, "default": 0 } }],
            "responses": with_common(Map::from_iter([("200".to_string(), json!({ "description": "Tenant-scoped lot identity, expiry status, current quantity/value by warehouse, and a paginated movement chronology" })), ("403".to_string(), err("Requires inventory.lot.read and inventory.stock_move.read")), ("404".to_string(), err("Lot not found for this tenant")), ("422".to_string(), err("Invalid lot id or pagination"))]))
        } }),
    );
    paths.insert(
        "/api/t/{tenantId}/reports/inventory/quality-holds".into(),
        json!({ "get": {
            "tags": ["inventory", "quality"], "summary": "Held inventory by quality inspection and source stock layer", "security": sec,
            "parameters": [tid,
                { "name": "warehouse", "in": "query", "schema": { "type": "string", "format": "uuid" } },
                { "name": "status", "in": "query", "schema": { "type": "string", "enum": ["all", "pending", "failed"], "default": "all" } }
            ],
            "responses": with_common(Map::from_iter([("200".to_string(), json!({ "description": "Remaining quality-held quantity grouped by each product base unit, plus held value by inspection, lot, warehouse, and matched receipt stock movement layer" })), ("403".to_string(), err("Requires inventory.stock_move.read and quality.inspection.read permissions")), ("422".to_string(), err("Invalid warehouse or inspection status"))]))
        } }),
    );
    paths.insert(
        "/api/t/{tenantId}/reports/inventory/replenishment/purchase-requisitions".into(),
        json!({ "post": {
            "tags": ["inventory", "purchasing"], "summary": "Create a draft purchase requisition from current replenishment suggestions", "security": sec,
            "parameters": [tid],
            "requestBody": { "required": true, "content": { "application/json": { "schema": { "type": "object", "required": ["warehouseId"], "properties": { "warehouseId": { "type": "string", "format": "uuid" } } } } } },
            "responses": with_common(Map::from_iter([("201".to_string(), json!({ "description": "Draft requisition created from recalculated positive suggestions for the selected warehouse" })), ("403".to_string(), err("Requires inventory.reorder_rule.read and purchasing.purchase_requisition.create")), ("422".to_string(), err("Invalid warehouse or no current replenishment suggestions"))]))
        } }),
    );
    paths.insert(
        "/api/t/{tenantId}/reports/budget/variance".into(),
        json!({ "get": {
            "tags": ["budget"], "summary": "Budget versus actual", "security": sec,
            "parameters": [tid, { "name": "period", "in": "query", "description": "Optional period in YYYY or YYYY-MM format", "schema": { "type": "string" } }],
            "responses": with_common(Map::from_iter([("200".to_string(), json!({ "description": "Approved budget lines with ledger actuals, variance and utilization; when period is omitted, periodSummaries keeps annual and monthly totals separate and scalar totals are null" })), ("422".to_string(), err("period must use YYYY or YYYY-MM"))]))
        } }),
    );
    paths.insert(
        "/api/t/{tenantId}/reports/crm/pipeline".into(),
        json!({ "get": {
            "tags": ["crm"], "summary": "CRM opportunity pipeline forecast", "security": sec,
            "parameters": [tid, { "name": "from", "in": "query", "schema": { "type": "string", "format": "date" } }, { "name": "to", "in": "query", "schema": { "type": "string", "format": "date" } }],
            "responses": with_common(Map::from_iter([("200".to_string(), json!({ "description": "Open opportunities grouped by pipeline stage with stage-weighted forecast values" })), ("403".to_string(), err("Requires crm.deal.read")), ("422".to_string(), err("Invalid date range"))]))
        } }),
    );
    paths.insert(
        "/api/t/{tenantId}/reports/marketing/campaign-performance".into(),
        json!({ "get": {
            "tags": ["marketing"], "summary": "Campaign performance by attribution model", "security": sec,
            "parameters": [tid, { "name": "model", "in": "query", "schema": { "type": "string", "enum": ["first_touch", "last_touch", "linear"], "default": "first_touch" } }],
            "responses": with_common(Map::from_iter([("200".to_string(), json!({ "description": "Campaign plan budget, lead attribution by first touch, last touch, or linear credit, conversions, won revenue, and posted-bill costs net of debit notes" })), ("403".to_string(), err("Requires marketing.campaign.read")), ("422".to_string(), err("Unknown attribution model"))]))
        } }),
    );
    paths.insert(
        "/api/t/{tenantId}/reports/helpdesk/sla".into(),
        json!({ "get": {
            "tags": ["helpdesk"], "summary": "Helpdesk first response and resolution SLA", "security": sec,
            "parameters": [tid],
            "responses": with_common(Map::from_iter([("200".to_string(), json!({ "description": "SLA compliance summary and ticket deadlines, with the latest 500 tickets" })), ("403".to_string(), err("Requires helpdesk.ticket.read"))]))
        } }),
    );
    paths.insert(
        "/api/t/{tenantId}/reports/accounting/general-ledger/{accountId}".into(),
        json!({ "get": {
            "tags": ["accounting"], "summary": "Sổ cái theo tài khoản", "security": sec,
            "parameters": [tid, { "name": "accountId", "in": "path", "required": true, "schema": { "type": "string", "format": "uuid" } },
                { "name": "from", "in": "query", "schema": { "type": "string", "format": "date" } },
                { "name": "to", "in": "query", "schema": { "type": "string", "format": "date" } }],
            "responses": with_common(Map::from_iter([("200".to_string(), json!({ "description": "Các bút toán đã ghi sổ và số dư lũy kế theo thời gian" })), ("422".to_string(), err("Tài khoản hoặc khoảng ngày không hợp lệ"))]))
        } }),
    );
    let tags: Vec<Value> = reg
        .order
        .iter()
        .map(|id| json!({ "name": id, "description": reg.modules[id].name }))
        .collect();
    json!({
        "openapi": "3.1.0",
        "info": { "title": "OSP Suite API", "version": "0.3.0", "description": "API sinh tự động từ khai báo module. Xem docs/API.md cho các endpoint quản trị." },
        "servers": [{ "url": "/" }],
        "components": { "securitySchemes": { "bearer": { "type": "http", "scheme": "bearer" } }, "schemas": schemas },
        "tags": tags,
        "paths": paths,
    })
}
