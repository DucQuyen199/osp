//! Tenant-scoped hiring pipeline and candidate uniqueness checks.
use crate::{
    db::Tx,
    error::{ApiError, R},
    kernel::Tenant,
    money,
};
use rust_decimal::Decimal;
use serde_json::Value;
use uuid::Uuid;

fn id(document: &Value, field: &str) -> Option<Uuid> {
    document
        .get(field)
        .and_then(Value::as_str)
        .and_then(|id| Uuid::parse_str(id).ok())
}

fn email(document: &Value) -> Option<&str> {
    document
        .get("email")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|email| !email.is_empty())
}

async fn lock_job(tx: &Tx<'_>, tenant: &Tenant, job: Uuid) -> R<Option<(String, Option<Decimal>)>> {
    let Some(row) = tx
        .query_opt(
            "SELECT status, headcount::text FROM recruitment__job_opening WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
            &[&tenant.id, &job],
        )
        .await?
    else {
        return Ok(None);
    };
    let headcount_text: Option<String> = row.get(1);
    let headcount = headcount_text
        .map(|value| {
            money::decimal_str(&value)
                .ok_or_else(|| ApiError::internal("invalid stored recruitment headcount"))
        })
        .transpose()?;
    Ok(Some((row.get(0), headcount)))
}

async fn lock_email(tx: &Tx<'_>, tenant: &Tenant, value: &str) -> R<()> {
    let key = format!("{}:{}", tenant.id, value.trim().to_lowercase());
    tx.query_opt(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        &[&key],
    )
    .await?;
    Ok(())
}

pub async fn validate_persistence(
    tx: &Tx<'_>,
    tenant: &Tenant,
    entity: &str,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    let mut errors = Vec::new();
    match (entity, action) {
        ("candidate", "created" | "updated") => {
            if let Some(value) = email(document) {
                lock_email(tx, tenant, value).await?;
                let candidate = id(document, "id").unwrap_or(Uuid::nil());
                if tx
                    .query_opt(
                        "SELECT 1 FROM recruitment__candidate WHERE tenant_id = $1 AND lower(btrim(email)) = lower(btrim($2)) AND id <> $3 LIMIT 1",
                        &[&tenant.id, &value, &candidate],
                    )
                    .await?
                    .is_some()
                {
                    errors.push("Email đã được dùng bởi một ứng viên khác".into());
                }
                if tx
                    .query_opt(
                        "SELECT 1 FROM hrm__employee WHERE tenant_id = $1 AND lower(btrim(email)) = lower(btrim($2)) AND NOT (source = 'recruitment' AND source_id = $3) LIMIT 1",
                        &[&tenant.id, &value, &candidate.to_string()],
                    )
                    .await?
                    .is_some()
                {
                    errors.push("Email đã thuộc về một nhân viên trong doanh nghiệp".into());
                }
            }
        }
        ("candidate", "removed") => {
            let Some(candidate) = id(document, "id") else {
                return Ok(vec!["Không xác định được ứng viên cần xóa".into()]);
            };
            if tx
                .query_opt(
                    "SELECT 1 FROM recruitment__application WHERE tenant_id = $1 AND candidate = $2 LIMIT 1",
                    &[&tenant.id, &candidate],
                )
                .await?
                .is_some()
            {
                errors.push("Ứng viên đã có hồ sơ, không thể xóa khỏi lịch sử tuyển dụng".into());
            }
        }
        ("job_opening", "updated") => {
            let Some(job) = id(document, "id") else {
                return Ok(vec![
                    "Không xác định được tin tuyển dụng cần cập nhật".into(),
                ]);
            };
            let Some((status, headcount)) = lock_job(tx, tenant, job).await? else {
                return Ok(vec![
                    "Không tìm thấy tin tuyển dụng trong doanh nghiệp".into(),
                ]);
            };
            if status != "open" {
                errors.push("Tin tuyển dụng đã đóng không được cập nhật".into());
            }
            if let Some(headcount) = headcount {
                let hired: i64 = tx
                    .query_opt(
                        "SELECT count(*) FROM recruitment__application WHERE tenant_id = $1 AND job = $2 AND status = 'hired'",
                        &[&tenant.id, &job],
                    )
                    .await?
                    .map(|row| row.get(0))
                    .unwrap_or_default();
                if headcount < Decimal::from(hired) {
                    errors.push(
                        "Số lượng tuyển không được nhỏ hơn số ứng viên đã trúng tuyển".into(),
                    );
                }
            }
        }
        ("job_opening", "closed") => {
            let Some(job) = id(document, "id") else {
                return Ok(vec!["Không xác định được tin tuyển dụng cần đóng".into()]);
            };
            if lock_job(tx, tenant, job).await?.is_none() {
                return Ok(vec![
                    "Không tìm thấy tin tuyển dụng trong doanh nghiệp".into(),
                ]);
            }
            if tx
                .query_opt(
                    "SELECT 1 FROM recruitment__application WHERE tenant_id = $1 AND job = $2 AND status = 'applied' LIMIT 1",
                    &[&tenant.id, &job],
                )
                .await?
                .is_some()
            {
                errors.push("Hãy duyệt hoặc từ chối các hồ sơ đang chờ trước khi đóng tin tuyển dụng".into());
            }
        }
        ("job_opening", "removed") => {
            let Some(job) = id(document, "id") else {
                return Ok(vec!["Không xác định được tin tuyển dụng cần xóa".into()]);
            };
            if tx
                .query_opt(
                    "SELECT 1 FROM recruitment__application WHERE tenant_id = $1 AND job = $2 LIMIT 1",
                    &[&tenant.id, &job],
                )
                .await?
                .is_some()
            {
                errors.push("Tin tuyển dụng có hồ sơ liên quan phải được giữ làm lịch sử".into());
            }
        }
        ("application", "created" | "updated" | "applied" | "hired") => {
            let Some(job) = id(document, "job") else {
                return Ok(vec!["Hồ sơ ứng tuyển cần tin tuyển dụng hợp lệ".into()]);
            };
            let Some(candidate) = id(document, "candidate") else {
                return Ok(vec!["Hồ sơ ứng tuyển cần ứng viên hợp lệ".into()]);
            };
            let Some((job_status, headcount)) = lock_job(tx, tenant, job).await? else {
                return Ok(vec![
                    "Không tìm thấy tin tuyển dụng trong doanh nghiệp".into(),
                ]);
            };
            if job_status != "open" {
                errors.push("Chỉ nhận hoặc tuyển hồ sơ cho tin đang mở".into());
            }
            let candidate_lock = if action == "hired" {
                "FOR UPDATE"
            } else {
                "FOR SHARE"
            };
            let candidate_record = tx
                .query_opt(
                    &format!("SELECT name, email FROM recruitment__candidate WHERE tenant_id = $1 AND id = $2 {candidate_lock}"),
                    &[&tenant.id, &candidate],
                )
                .await?;
            let candidate_name = candidate_record.as_ref().map(|row| row.get::<_, String>(0));
            let candidate_email = candidate_record
                .as_ref()
                .and_then(|row| row.get::<_, Option<String>>(1));
            if candidate_name.as_deref() != document.get("candidate_name").and_then(Value::as_str) {
                errors.push("Tên trong hồ sơ phải khớp tên ứng viên đã đăng ký".into());
            }
            let application = id(document, "id").unwrap_or(Uuid::nil());
            if matches!(action, "created" | "updated")
                && tx
                    .query_opt(
                        "SELECT 1 FROM recruitment__application WHERE tenant_id = $1 AND job = $2 AND candidate = $3 AND id <> $4 LIMIT 1",
                        &[&tenant.id, &job, &candidate, &application],
                    )
                    .await?
                    .is_some()
            {
                errors.push("Mỗi ứng viên chỉ được có một hồ sơ cho cùng vị trí".into());
            }
            if action == "hired" {
                if let Some(headcount) = headcount {
                    let hired: i64 = tx
                        .query_opt(
                            "SELECT count(*) FROM recruitment__application WHERE tenant_id = $1 AND job = $2 AND status = 'hired' AND id <> $3",
                            &[&tenant.id, &job, &application],
                        )
                        .await?
                        .map(|row| row.get(0))
                        .unwrap_or_default();
                    if Decimal::from(hired) >= headcount {
                        errors.push("Đã tuyển đủ số lượng của tin tuyển dụng".into());
                    }
                }
                if tx
                    .query_opt(
                        "SELECT 1 FROM hrm__employee WHERE tenant_id = $1 AND source = 'recruitment' AND source_id = $2 LIMIT 1",
                        &[&tenant.id, &candidate.to_string()],
                    )
                    .await?
                    .is_some()
                {
                    errors.push("Ứng viên đã được chuyển thành hồ sơ nhân viên".into());
                }
                if let Some(value) = candidate_email.filter(|value| !value.trim().is_empty()) {
                    lock_email(tx, tenant, &value).await?;
                    if tx
                        .query_opt(
                            "SELECT 1 FROM hrm__employee WHERE tenant_id = $1 AND lower(btrim(email)) = lower(btrim($2)) LIMIT 1",
                            &[&tenant.id, &value],
                        )
                        .await?
                        .is_some()
                    {
                        errors.push("Đã có hồ sơ nhân viên sử dụng email của ứng viên".into());
                    }
                }
            }
        }
        _ => {}
    }
    Ok(errors)
}
