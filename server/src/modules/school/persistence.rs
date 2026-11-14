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
        "class_session" => validate_class_session(tx, tenant, action, document).await,
        "attendance" => validate_attendance(tx, tenant, action, document).await,
        "grade" => validate_grade(tx, tenant, action, document).await,
        "fee" => validate_fee(tx, tenant, action, document).await,
        _ => Ok(Vec::new()),
    }
}

async fn validate_class_session(
    tx: &Tx<'_>,
    tenant: &Tenant,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    let Some(class) = parse_id(document, "class") else {
        return Ok(vec!["Buổi học cần lớp hợp lệ".into()]);
    };
    let Some(row) = tx.query_opt(
        "SELECT start_date::text FROM school__course_class WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
        &[&tenant.id, &class],
    ).await? else {
        return Ok(vec!["Lớp của buổi học không tồn tại trong doanh nghiệp".into()]);
    };
    let class_start: Option<String> = row.get(0);
    let starts_at = document
        .get("starts_at")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let ends_at = document
        .get("ends_at")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let id = parse_id(document, "id");
    let mut errors = Vec::new();
    if class_start
        .as_deref()
        .is_some_and(|date| starts_at.get(..10).is_some_and(|start| start < date))
    {
        errors.push("Buổi học không thể nằm trước ngày bắt đầu lớp".into());
    }
    if matches!(action, "created" | "updated")
        && tx.query_opt(
            "SELECT id FROM school__class_session WHERE tenant_id=$1 AND \"class\"=$2 AND status<>'cancelled' AND starts_at<$4::timestamptz AND ends_at>$3::timestamptz AND ($5::uuid IS NULL OR id<>$5) LIMIT 1 FOR UPDATE",
            &[&tenant.id, &class, &starts_at, &ends_at, &id],
        ).await?.is_some()
    {
        errors.push("Buổi học bị trùng giờ với buổi khác của cùng lớp".into());
    }
    if action == "completed" {
        let Some(session_id) = id else {
            return Ok(vec!["Không xác định được buổi học cần kết thúc".into()]);
        };
        let missing: i64 = tx.query_one_row(
            "SELECT count(*) FROM school__class_enrollment e WHERE e.tenant_id=$1 AND e.\"class\"=$2 AND e.status='active' AND NOT EXISTS (SELECT 1 FROM school__attendance a WHERE a.tenant_id=e.tenant_id AND a.session=$3 AND a.enrollment=e.id)",
            &[&tenant.id, &class, &session_id],
        ).await?.get(0);
        if missing > 0 {
            errors.push(format!(
                "Còn {missing} học viên đang học chưa được điểm danh"
            ));
        }
    }
    if matches!(action, "cancelled" | "removed") {
        if let Some(session_id) = id {
            if tx.query_opt(
                "SELECT id FROM school__attendance WHERE tenant_id=$1 AND session=$2 LIMIT 1 FOR UPDATE",
                &[&tenant.id, &session_id],
            ).await?.is_some() {
                errors.push("Không thể hủy hoặc xóa buổi học đã có điểm danh".into());
            }
        }
    }
    if action == "removed" && document.get("status").and_then(Value::as_str) != Some("scheduled") {
        errors.push("Chỉ được xóa buổi học đang lên lịch".into());
    }
    Ok(errors)
}

async fn validate_attendance(
    tx: &Tx<'_>,
    tenant: &Tenant,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    let (Some(session), Some(enrollment)) = (
        parse_id(document, "session"),
        parse_id(document, "enrollment"),
    ) else {
        return Ok(vec!["Điểm danh cần buổi học và ghi danh hợp lệ".into()]);
    };
    let Some(session_row) = tx.query_opt(
        "SELECT \"class\", status, starts_at FROM school__class_session WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
        &[&tenant.id, &session],
    ).await? else {
        return Ok(vec!["Buổi học không tồn tại trong doanh nghiệp".into()]);
    };
    let session_class: Uuid = session_row.get(0);
    let session_status: String = session_row.get(1);
    let starts_at: chrono::DateTime<chrono::Utc> = session_row.get(2);
    let Some(enrollment_row) = tx.query_opt(
        "SELECT \"class\", status FROM school__class_enrollment WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
        &[&tenant.id, &enrollment],
    ).await? else {
        return Ok(vec!["Ghi danh không tồn tại trong doanh nghiệp".into()]);
    };
    let enrollment_class: Uuid = enrollment_row.get(0);
    let enrollment_status: String = enrollment_row.get(1);
    let mut errors = Vec::new();
    if enrollment_class != session_class {
        errors.push("Học viên không thuộc lớp của buổi học này".into());
    }
    if enrollment_status != "active" {
        errors.push("Chỉ điểm danh học viên đang ghi danh".into());
    }
    if session_status == "cancelled" {
        errors.push("Không thể điểm danh buổi học đã hủy".into());
    }
    if action == "created" && session_status == "completed" {
        errors.push("Cannot add attendance to a completed session".into());
    }
    if matches!(action, "created" | "updated") && starts_at > chrono::Utc::now() {
        errors.push("Chỉ điểm danh từ thời điểm buổi học bắt đầu".into());
    }
    if action == "updated" && session_status != "scheduled" {
        errors.push("Điểm danh của buổi đã kết thúc không thể sửa".into());
    }
    let id = parse_id(document, "id");
    if tx.query_opt(
        "SELECT id FROM school__attendance WHERE tenant_id=$1 AND session=$2 AND enrollment=$3 AND ($4::uuid IS NULL OR id<>$4) LIMIT 1 FOR UPDATE",
        &[&tenant.id, &session, &enrollment, &id],
    ).await?.is_some() {
        errors.push("Học viên đã được điểm danh trong buổi học này".into());
    }
    if action == "removed" && session_status != "scheduled" {
        errors.push("Điểm danh của buổi đã kết thúc phải được giữ làm lịch sử".into());
    }
    Ok(errors)
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
        if let (Some(id), Some(start_date)) =
            (id, document.get("start_date").and_then(Value::as_str))
        {
            if tx.query_opt(
                "SELECT id FROM school__class_session WHERE tenant_id=$1 AND \"class\"=$2 AND status<>'cancelled' AND starts_at::date < $3::date LIMIT 1 FOR UPDATE",
                &[&tenant.id, &id, &start_date],
            ).await?.is_some() {
                errors.push("Cannot move class start date past a scheduled session".into());
            }
        }
    }
    if action == "removed" {
        if let Some(id) = id {
            if tx.query_opt(
                "SELECT 1 WHERE EXISTS (SELECT 1 FROM school__class_enrollment WHERE tenant_id = $1 AND \"class\" = $2) OR EXISTS (SELECT 1 FROM school__class_session WHERE tenant_id = $1 AND \"class\" = $2)",
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
