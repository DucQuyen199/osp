//! Normalize school commands and derive tuition billing from enrollment records.
use crate::{
    db::Tx,
    error::{ApiError, R},
    kernel::{Actor, Kernel, Opts, Tenant},
    money,
};
use serde_json::{Map, Value, json};
use std::collections::HashSet;
use uuid::Uuid;

pub async fn prepare_document(
    tx: &Tx<'_>,
    tenant: &Tenant,
    entity: &str,
    document: &mut Map<String, Value>,
) -> R<Vec<String>> {
    match entity {
        "student" => Ok(trim(document, &["student_code", "guardian"])),
        "course_class" => Ok(trim(document, &["name", "subject", "teacher"])),
        "class_session" => prepare_session_teacher(tx, tenant, document).await,
        "grade" => Ok(trim(document, &["term", "subject"])),
        "fee" => {
            trim(document, &["period", "note"]);
            prepare_fee(tx, tenant, document).await
        }
        "tuition_batch" => Ok(trim(document, &["period"])),
        _ => Ok(Vec::new()),
    }
}

pub async fn handle_source_event(
    kernel: &Kernel,
    tx: &Tx<'_>,
    tenant: &Tenant,
    event_type: &str,
    document: &Value,
    event_id: Uuid,
    depth: u32,
) -> R<bool> {
    if !tenant.has_module("school") || event_type != "school.tuition_batch.generated" {
        return Ok(false);
    }
    let Some(batch) = document
        .get("id")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
    else {
        return Err(ApiError::validation(
            event_type,
            vec!["Đợt học phí cần mã hợp lệ".into()],
        ));
    };
    let Some(class) = document
        .get("class")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
    else {
        return Err(ApiError::validation(
            event_type,
            vec!["Đợt học phí cần lớp hợp lệ".into()],
        ));
    };
    let period = document
        .get("period")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|period| !period.is_empty())
        .ok_or_else(|| ApiError::validation(event_type, vec!["Thiếu kỳ học phí".into()]))?;
    let due_date = document
        .get("due_date")
        .and_then(Value::as_str)
        .filter(|date| date.len() == 10)
        .ok_or_else(|| ApiError::validation(event_type, vec!["Thiếu ngày đến hạn".into()]))?;
    let Some(class_row) = tx
        .query_opt(
            "SELECT name, tuition::text FROM school__course_class WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
            &[&tenant.id, &class],
        )
        .await?
    else {
        return Err(ApiError::not_found("Lớp của đợt học phí không tồn tại"));
    };
    let class_name: String = class_row.get(0);
    let tuition_text: Option<String> = class_row.get(1);
    let tuition = tuition_text
        .as_deref()
        .and_then(money::decimal_str)
        .filter(|amount| *amount > rust_decimal::Decimal::ZERO)
        .ok_or_else(|| {
            ApiError::validation(
                event_type,
                vec!["Lớp cần học phí lớn hơn 0 trước khi tạo đợt thu".into()],
            )
        })?;
    let existing_rows = tx
        .query(
            "SELECT fee.enrollment FROM school__fee fee JOIN school__class_enrollment enrollment ON enrollment.tenant_id = fee.tenant_id AND enrollment.id = fee.enrollment WHERE fee.tenant_id = $1 AND enrollment.\"class\" = $2 AND lower(btrim(fee.period)) = lower($3)",
            &[&tenant.id, &class, &period],
        )
        .await?;
    let existing: HashSet<Uuid> = existing_rows
        .iter()
        .filter_map(|row| row.get::<_, Option<Uuid>>(0))
        .collect();
    let enrollment_rows = tx
        .query(
            "SELECT enrollment.id, enrollment.student, student.party FROM school__class_enrollment enrollment JOIN school__student student ON student.tenant_id = enrollment.tenant_id AND student.id = enrollment.student WHERE enrollment.tenant_id = $1 AND enrollment.\"class\" = $2 AND enrollment.status = 'active' ORDER BY enrollment.id FOR UPDATE OF enrollment",
            &[&tenant.id, &class],
        )
        .await?;
    let fee_entity = kernel.ent(tenant, "school.fee")?;
    let mut generated = 0i64;
    let mut skipped = 0i64;
    for row in enrollment_rows {
        let enrollment: Uuid = row.get(0);
        if existing.contains(&enrollment) {
            skipped += 1;
            continue;
        }
        let student: Uuid = row.get(1);
        let party: Uuid = row.get(2);
        let mut fee = Map::new();
        fee.insert("student".into(), json!(student));
        fee.insert("party".into(), json!(party));
        fee.insert("enrollment".into(), json!(enrollment));
        fee.insert(
            "amount".into(),
            money::json_number(tuition).ok_or_else(|| {
                ApiError::validation(event_type, vec!["Học phí vượt giới hạn số tiền".into()])
            })?,
        );
        fee.insert("period".into(), json!(period));
        fee.insert("due_date".into(), json!(due_date));
        fee.insert(
            "note".into(),
            json!(format!("Học phí {} · {period}", class_name.trim())),
        );
        kernel
            .create_in(
                tx,
                &Actor::System,
                tenant,
                &fee_entity,
                fee,
                &Opts {
                    depth: Some(depth + 1),
                    causation: Some(event_id),
                    silent: false,
                },
            )
            .await?;
        generated += 1;
    }
    let batch_entity = kernel.ent(tenant, "school.tuition_batch")?;
    kernel
        .update_in(
            tx,
            &Actor::System,
            tenant,
            &batch_entity,
            &batch.to_string(),
            Map::from_iter([
                ("generated_count".into(), json!(generated)),
                ("skipped_count".into(), json!(skipped)),
            ]),
            &Opts {
                depth: Some(depth + 1),
                causation: Some(event_id),
                silent: false,
            },
        )
        .await?;
    Ok(true)
}

async fn prepare_session_teacher(
    tx: &Tx<'_>,
    tenant: &Tenant,
    document: &mut Map<String, Value>,
) -> R<Vec<String>> {
    let Some(class) = parse_id(document, "class") else {
        return Ok(Vec::new());
    };
    let row = tx
        .query_opt(
            "SELECT course_class.teacher, course_class.teacher_employee, staff.name FROM school__course_class course_class LEFT JOIN hrm__employee staff ON staff.tenant_id = course_class.tenant_id AND staff.id = course_class.teacher_employee WHERE course_class.tenant_id = $1 AND course_class.id = $2 FOR SHARE OF course_class",
            &[&tenant.id, &class],
        )
        .await?;
    let Some(row) = row else {
        return Ok(Vec::new());
    };
    let teacher: Option<String> = row.get(0);
    let teacher_employee: Option<Uuid> = row.get(1);
    let employee_name: Option<String> = row.get(2);
    let teacher_name = employee_name
        .or(teacher)
        .filter(|name| !name.trim().is_empty());
    document.insert(
        "teacher_employee".into(),
        teacher_employee.map_or(Value::Null, |id| Value::String(id.to_string())),
    );
    document.insert(
        "teacher_name".into(),
        teacher_name.map_or(Value::Null, Value::String),
    );
    Ok(Vec::new())
}

fn trim(document: &mut Map<String, Value>, fields: &[&str]) -> Vec<String> {
    let mut errors = Vec::new();
    for field in fields {
        if let Some(value) = document
            .get(*field)
            .and_then(Value::as_str)
            .map(|value| value.trim().to_owned())
        {
            document.insert((*field).into(), Value::String(value.clone()));
            if value.is_empty() && matches!(*field, "student_code" | "name") {
                errors.push(format!("Trường {field} không được để trống"));
            }
        }
    }
    errors
}

async fn prepare_fee(
    tx: &Tx<'_>,
    tenant: &Tenant,
    document: &mut Map<String, Value>,
) -> R<Vec<String>> {
    if let Some(enrollment) = parse_id(document, "enrollment") {
        let Some(row) = tx.query_opt(
            "SELECT e.student, e.status, c.tuition::text, s.party FROM school__class_enrollment e JOIN school__course_class c ON c.tenant_id = e.tenant_id AND c.id = e.\"class\" JOIN school__student s ON s.tenant_id = e.tenant_id AND s.id = e.student WHERE e.tenant_id = $1 AND e.id = $2 FOR UPDATE OF e, c, s",
            &[&tenant.id, &enrollment],
        ).await? else {
            return Ok(vec!["Ghi danh học phí không tồn tại trong doanh nghiệp".into()]);
        };
        let student: Uuid = row.get(0);
        let status: String = row.get(1);
        let tuition_text: Option<String> = row.get(2);
        let tuition = tuition_text
            .map(|value| {
                money::decimal_str(&value).ok_or_else(|| {
                    ApiError::validation(
                        "school.course_class.tuition",
                        vec!["Stored class tuition is not a valid decimal amount".into()],
                    )
                })
            })
            .transpose()?;
        let party: Uuid = row.get(3);
        if status == "dropped" {
            return Ok(vec![
                "Không thể lập học phí mới cho ghi danh đã thôi học".into(),
            ]);
        }
        document.insert("student".into(), Value::String(student.to_string()));
        document.insert("party".into(), Value::String(party.to_string()));
        let Some(tuition) = tuition else {
            if document.get("id").is_some()
                && document
                    .get("amount")
                    .and_then(money::decimal)
                    .is_some_and(|amount| amount > rust_decimal::Decimal::ZERO)
            {
                return Ok(Vec::new());
            }
            return Ok(vec!["Lớp chưa cấu hình học phí".into()]);
        };
        let amount = money::json_number(tuition).ok_or_else(|| {
            ApiError::validation(
                "school.fee.amount",
                vec!["Class tuition exceeds the supported decimal range".into()],
            )
        })?;
        if document.get("id").is_none() {
            document.insert("amount".into(), amount);
        }
        return Ok(Vec::new());
    }

    let Some(student) = parse_id(document, "student") else {
        return Ok(vec!["Học phí cần học viên hợp lệ".into()]);
    };
    let Some(row) = tx
        .query_opt(
            "SELECT party FROM school__student WHERE tenant_id = $1 AND id = $2 FOR SHARE",
            &[&tenant.id, &student],
        )
        .await?
    else {
        return Ok(vec!["Học viên không tồn tại trong doanh nghiệp".into()]);
    };
    let party: Uuid = row.get(0);
    document.insert("party".into(), Value::String(party.to_string()));
    Ok(Vec::new())
}

pub(crate) fn parse_id(document: &Map<String, Value>, field: &str) -> Option<Uuid> {
    document
        .get(field)
        .and_then(Value::as_str)
        .and_then(|id| Uuid::parse_str(id).ok())
}
