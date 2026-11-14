//! Tenant-scoped student, class-capacity, grade, and tuition checks.
use crate::{
    db::Tx,
    error::{ApiError, R},
    kernel::Tenant,
    money,
};
use rust_decimal::Decimal;
use serde_json::Value;
use uuid::Uuid;

pub async fn validate_persistence(
    tx: &Tx<'_>,
    tenant: &Tenant,
    entity: &str,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    match entity {
        "student" => validate_student(tx, tenant, action, document).await,
        "course_class" => validate_class(tx, tenant, action, document).await,
        "class_enrollment" => validate_enrollment(tx, tenant, action, document).await,
        "grade" => validate_grade(tx, tenant, action, document).await,
        "fee" => validate_fee(tx, tenant, action, document).await,
        _ => Ok(Vec::new()),
    }
}

async fn validate_student(
    tx: &Tx<'_>,
    tenant: &Tenant,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    let Some(party) = parse_id(document, "party") else {
        return Ok(vec!["Học viên cần đối tác hợp lệ".into()]);
    };
    let id = parse_id(document, "id");
    let mut errors = Vec::new();
    if tx
        .query_opt(
            "SELECT id FROM master_data__party WHERE tenant_id = $1 AND id = $2 FOR SHARE",
            &[&tenant.id, &party],
        )
        .await?
        .is_none()
    {
        errors.push("Đối tác học viên không tồn tại trong doanh nghiệp".into());
    }
    if tx.query_opt(
        "SELECT id FROM school__student WHERE tenant_id = $1 AND party = $2 AND ($3::uuid IS NULL OR id <> $3) LIMIT 1 FOR UPDATE",
        &[&tenant.id, &party, &id],
    ).await?.is_some() {
        errors.push("Đối tác đã có hồ sơ học viên".into());
    }
    if let Some(code) = document
        .get("student_code")
        .and_then(Value::as_str)
        .filter(|code| !code.is_empty())
    {
        if tx.query_opt(
            "SELECT id FROM school__student WHERE tenant_id = $1 AND lower(btrim(student_code)) = lower($2) AND ($3::uuid IS NULL OR id <> $3) LIMIT 1 FOR UPDATE",
            &[&tenant.id, &code, &id],
        ).await?.is_some() {
            errors.push("Mã học viên đã tồn tại trong doanh nghiệp".into());
        }
    }
    if action == "updated" {
        if let Some(id) = id {
            let has_history = tx.query_opt(
                "SELECT id FROM school__class_enrollment WHERE tenant_id = $1 AND student = $2 UNION ALL SELECT id FROM school__fee WHERE tenant_id = $1 AND student = $2 LIMIT 1",
                &[&tenant.id, &id],
            ).await?.is_some();
            if has_history {
                if let Some(old) = tx.query_opt(
                    "SELECT party FROM school__student WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
                    &[&tenant.id, &id],
                ).await? {
                    let old_party: Uuid = old.get(0);
                    if party != old_party {
                        errors.push("Không thể đổi danh tính đối tác sau khi học viên đã có ghi danh hoặc học phí".into());
                    }
                }
            }
        }
    }
    if action == "removed" {
        if let Some(id) = id {
            if tx.query_opt(
                "SELECT id FROM school__class_enrollment WHERE tenant_id = $1 AND student = $2 UNION ALL SELECT id FROM school__fee WHERE tenant_id = $1 AND student = $2 LIMIT 1",
                &[&tenant.id, &id],
            ).await?.is_some() {
                errors.push("Học viên đã có ghi danh hoặc học phí nên không thể xóa".into());
            }
        }
    }
    Ok(errors)
}

async fn validate_class(
    tx: &Tx<'_>,
    tenant: &Tenant,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    let id = parse_id(document, "id");
    let name = document
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim();
    let mut errors = Vec::new();
    if tx.query_opt(
        "SELECT id FROM school__course_class WHERE tenant_id = $1 AND lower(btrim(name)) = lower($2) AND ($3::uuid IS NULL OR id <> $3) LIMIT 1 FOR UPDATE",
        &[&tenant.id, &name, &id],
    ).await?.is_some() {
        errors.push("Tên lớp học đã tồn tại trong doanh nghiệp".into());
    }
    if action == "updated" {
        if let (Some(id), Some(capacity)) = (id, document.get("capacity").and_then(Value::as_i64)) {
            let active: i64 = tx.query_opt(
                "SELECT count(*) FROM school__class_enrollment WHERE tenant_id = $1 AND \"class\" = $2 AND status = 'active'",
                &[&tenant.id, &id],
            ).await?.map(|row| row.get(0)).unwrap_or_default();
            if active > capacity {
                errors.push("Không thể giảm sức chứa thấp hơn số học viên đang ghi danh".into());
            }
        }
    }
    if action == "removed" {
        if let Some(id) = id {
            if tx.query_opt(
                "SELECT id FROM school__class_enrollment WHERE tenant_id = $1 AND \"class\" = $2 LIMIT 1 FOR UPDATE",
                &[&tenant.id, &id],
            ).await?.is_some() {
                errors.push("Lớp học đã có ghi danh nên không thể xóa".into());
            }
        }
    }
    Ok(errors)
}

async fn validate_enrollment(
    tx: &Tx<'_>,
    tenant: &Tenant,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    let Some(student) = parse_id(document, "student") else {
        return Ok(vec!["Ghi danh cần học viên hợp lệ".into()]);
    };
    let Some(class) = parse_id(document, "class") else {
        return Ok(vec!["Ghi danh cần lớp học hợp lệ".into()]);
    };
    if tx
        .query_opt(
            "SELECT id FROM school__student WHERE tenant_id = $1 AND id = $2 FOR SHARE",
            &[&tenant.id, &student],
        )
        .await?
        .is_none()
    {
        return Ok(vec!["Học viên không tồn tại trong doanh nghiệp".into()]);
    }
    let Some(class_row) = tx
        .query_opt(
            "SELECT capacity::bigint FROM school__course_class WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
            &[&tenant.id, &class],
        )
        .await?
    else {
        return Ok(vec!["Lớp học không tồn tại trong doanh nghiệp".into()]);
    };
    let capacity: Option<i64> = class_row.get(0);
    let mut errors = Vec::new();
    let id = parse_id(document, "id");
    if action == "created" {
        if tx.query_opt(
            "SELECT id FROM school__class_enrollment WHERE tenant_id = $1 AND student = $2 AND \"class\" = $3 AND status = 'active' LIMIT 1 FOR UPDATE",
            &[&tenant.id, &student, &class],
        ).await?.is_some() {
            errors.push("Học viên đã có ghi danh đang hoạt động ở lớp này".into());
        }
        if let Some(capacity) = capacity {
            let active: i64 = tx.query_opt(
                "SELECT count(*) FROM school__class_enrollment WHERE tenant_id = $1 AND \"class\" = $2 AND status = 'active'",
                &[&tenant.id, &class],
            ).await?.map(|row| row.get(0)).unwrap_or_default();
            if active >= capacity {
                errors.push("Lớp học đã đủ sức chứa".into());
            }
        }
    }
    if action == "removed" {
        if let Some(id) = id {
            if tx.query_opt(
                "SELECT id FROM school__grade WHERE tenant_id = $1 AND enrollment = $2 UNION ALL SELECT id FROM school__fee WHERE tenant_id = $1 AND enrollment = $2 LIMIT 1",
                &[&tenant.id, &id],
            ).await?.is_some() {
                errors.push("Ghi danh đã có điểm hoặc học phí nên không thể xóa".into());
            }
        }
    }
    Ok(errors)
}

async fn validate_grade(
    tx: &Tx<'_>,
    tenant: &Tenant,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    let Some(enrollment) = parse_id(document, "enrollment") else {
        return Ok(vec!["Điểm cần ghi danh hợp lệ".into()]);
    };
    let Some(row) = tx.query_opt(
        "SELECT status FROM school__class_enrollment WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
        &[&tenant.id, &enrollment],
    ).await? else {
        return Ok(vec!["Ghi danh của điểm không tồn tại trong doanh nghiệp".into()]);
    };
    let enrollment_status: String = row.get(0);
    if enrollment_status != "active" {
        return Ok(vec![
            "Chỉ ghi hoặc sửa điểm của ghi danh đang hoạt động".into(),
        ]);
    }
    let term = document
        .get("term")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim();
    let subject = document
        .get("subject")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim();
    let id = parse_id(document, "id");
    if tx.query_opt(
        "SELECT id FROM school__grade WHERE tenant_id = $1 AND enrollment = $2 AND lower(btrim(term)) = lower($3) AND lower(btrim(subject)) = lower($4) AND ($5::uuid IS NULL OR id <> $5) LIMIT 1 FOR UPDATE",
        &[&tenant.id, &enrollment, &term, &subject, &id],
    ).await?.is_some() {
        return Ok(vec!["Mỗi môn học chỉ có một điểm cho mỗi kỳ và ghi danh".into()]);
    }
    if action == "removed" {
        return Ok(vec!["Điểm đã ghi nhận không thể xóa khỏi lịch sử".into()]);
    }
    Ok(Vec::new())
}

async fn validate_fee(
    tx: &Tx<'_>,
    tenant: &Tenant,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    let Some(student) = parse_id(document, "student") else {
        return Ok(vec!["Học phí cần học viên hợp lệ".into()]);
    };
    let Some(student_row) = tx
        .query_opt(
            "SELECT party FROM school__student WHERE tenant_id = $1 AND id = $2 FOR SHARE",
            &[&tenant.id, &student],
        )
        .await?
    else {
        return Ok(vec!["Học viên không tồn tại trong doanh nghiệp".into()]);
    };
    let party: Uuid = student_row.get(0);
    let mut errors = Vec::new();
    if parse_id(document, "party") != Some(party) {
        errors.push("Khách hàng trên học phí phải trùng đối tác của học viên".into());
    }
    if tx
        .query_opt(
            "SELECT id FROM master_data__party WHERE tenant_id = $1 AND id = $2 FOR SHARE",
            &[&tenant.id, &party],
        )
        .await?
        .is_none()
    {
        errors.push("Đối tác của học viên không tồn tại trong doanh nghiệp".into());
    }
    if let Some(enrollment) = parse_id(document, "enrollment") {
        let Some(row) = tx.query_opt(
            "SELECT e.student, e.status, c.tuition::text FROM school__class_enrollment e JOIN school__course_class c ON c.tenant_id = e.tenant_id AND c.id = e.\"class\" WHERE e.tenant_id = $1 AND e.id = $2 FOR UPDATE OF e, c",
            &[&tenant.id, &enrollment],
        ).await? else {
            return Ok(vec!["Ghi danh của học phí không tồn tại trong doanh nghiệp".into()]);
        };
        let enrolled_student: Uuid = row.get(0);
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
        if enrolled_student != student {
            errors.push("Học phí và ghi danh phải cùng học viên".into());
        }
        if status == "dropped" {
            errors.push("Không thể phát sinh học phí từ ghi danh đã thôi học".into());
        }
        if let Some(tuition) = tuition {
            let amount = document
                .get("amount")
                .and_then(money::decimal)
                .unwrap_or_default();
            if !money::within_tolerance(amount, tuition, Decimal::new(5, 3)) {
                errors.push("Số tiền học phí phải bằng học phí đã cấu hình cho lớp".into());
            }
        }
        let period = document
            .get("period")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim();
        let id = parse_id(document, "id");
        if tx.query_opt(
            "SELECT id FROM school__fee WHERE tenant_id = $1 AND enrollment = $2 AND lower(btrim(period)) = lower($3) AND ($4::uuid IS NULL OR id <> $4) LIMIT 1 FOR UPDATE",
            &[&tenant.id, &enrollment, &period, &id],
        ).await?.is_some() {
            errors.push("Học phí cho kỳ này đã tồn tại ở ghi danh".into());
        }
    }
    if action == "paid" {
        let Some(id) = parse_id(document, "id") else {
            return Ok(vec!["Không xác định được khoản học phí".into()]);
        };
        if tx.query_opt(
            "SELECT id FROM accounting__invoice WHERE tenant_id = $1 AND source = 'school_fee' AND source_id = $2 AND status = 'paid' LIMIT 1 FOR UPDATE",
            &[&tenant.id, &id.to_string()],
        ).await?.is_none() {
            errors.push("Chỉ đánh dấu đã thu sau khi hóa đơn kế toán đã thanh toán đủ".into());
        }
    }
    Ok(errors)
}

fn parse_id(document: &Value, field: &str) -> Option<Uuid> {
    document
        .get(field)
        .and_then(Value::as_str)
        .and_then(|id| Uuid::parse_str(id).ok())
}
