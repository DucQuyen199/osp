//! Normalize school commands and derive tuition billing from enrollment records.
use crate::{
    db::Tx,
    error::{ApiError, R},
    kernel::Tenant,
    money,
};
use serde_json::{Map, Value};
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
        "grade" => Ok(trim(document, &["term", "subject"])),
        "fee" => {
            trim(document, &["period", "note"]);
            prepare_fee(tx, tenant, document).await
        }
        _ => Ok(Vec::new()),
    }
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
        let Some(tuition) = tuition else {
            return Ok(vec!["Lớp chưa cấu hình học phí".into()]);
        };
        document.insert("student".into(), Value::String(student.to_string()));
        document.insert("party".into(), Value::String(party.to_string()));
        let amount = money::json_number(tuition).ok_or_else(|| {
            ApiError::validation(
                "school.fee.amount",
                vec!["Class tuition exceeds the supported decimal range".into()],
            )
        })?;
        document.insert("amount".into(), amount);
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
