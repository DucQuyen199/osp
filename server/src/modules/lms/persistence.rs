//! Tenant-scoped course lifecycle, learner, and lesson progress invariants.
use crate::{db::Tx, error::R, kernel::Tenant};
use serde_json::Value;
use uuid::Uuid;

pub async fn validate_persistence(
    tx: &Tx<'_>,
    tenant: &Tenant,
    entity: &str,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    match (entity, action) {
        ("lesson", "created" | "updated" | "removed") => {
            validate_lesson(tx, tenant, action, document).await
        }
        ("enrollment", "created" | "updated" | "completed") => {
            validate_enrollment(tx, tenant, action, document).await
        }
        ("lesson_progress", "created") => validate_lesson_progress(tx, tenant, document).await,
        ("certificate", "created") => validate_certificate(tx, tenant, document).await,
        ("course", _) => validate_course(tx, tenant, action, document).await,
        _ => Ok(Vec::new()),
    }
}

async fn validate_course(
    tx: &Tx<'_>,
    tenant: &Tenant,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    let Some(course) = parse_id(document, "id") else {
        return Ok(Vec::new());
    };
    // Serialize lifecycle changes with lesson edits and new enrollments. Those
    // workflows lock this same course row before changing dependent records.
    tx.query_opt(
        "SELECT id FROM lms__course WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
        &[&tenant.id, &course],
    )
    .await?;
    match action {
        "published" => {
            let required: i64 = tx
                .query_one_row(
                    "SELECT count(*) FROM lms__lesson WHERE tenant_id = $1 AND course = $2 AND COALESCE(required, true)",
                    &[&tenant.id, &course],
                )
                .await?
                .get(0);
            if required == 0 {
                return Ok(vec![
                    "A course needs at least one required lesson before it can be published".into(),
                ]);
            }
        }
        "archived" => {
            if tx
                .query_opt(
                    "SELECT id FROM lms__enrollment WHERE tenant_id = $1 AND course = $2 AND status = 'active' LIMIT 1 FOR UPDATE",
                    &[&tenant.id, &course],
                )
                .await?
                .is_some()
            {
                return Ok(vec![
                    "A course cannot be archived while learners are still enrolled".into(),
                ]);
            }
        }
        "updated" => {
            if tx
                .query_opt(
                    "SELECT id FROM lms__enrollment WHERE tenant_id = $1 AND course = $2 LIMIT 1 FOR UPDATE",
                    &[&tenant.id, &course],
                )
                .await?
                .is_some()
            {
                return Ok(vec![
                    "Course details are frozen after the first learner enrolls".into(),
                ]);
            }
        }
        "removed" => {
            if tx
                .query_opt(
                    "SELECT id FROM lms__lesson WHERE tenant_id = $1 AND course = $2 UNION ALL SELECT id FROM lms__enrollment WHERE tenant_id = $1 AND course = $2 LIMIT 1",
                    &[&tenant.id, &course],
                )
                .await?
                .is_some()
            {
                return Ok(vec![
                    "A course with lessons or learner history cannot be deleted".into(),
                ]);
            }
        }
        _ => {}
    }
    Ok(Vec::new())
}

async fn validate_lesson(
    tx: &Tx<'_>,
    tenant: &Tenant,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    let Some(course) = parse_id(document, "course") else {
        return Ok(vec!["Lesson requires a valid course".into()]);
    };
    let course_row = tx
        .query_opt(
            "SELECT status FROM lms__course WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
            &[&tenant.id, &course],
        )
        .await?;
    let Some(course_row) = course_row else {
        return Ok(vec!["Lesson course does not exist in this tenant".into()]);
    };
    if course_row.get::<_, String>(0) == "archived" {
        return Ok(vec![
            "Lessons cannot be changed in an archived course".into(),
        ]);
    }
    if tx
        .query_opt(
            "SELECT id FROM lms__enrollment WHERE tenant_id = $1 AND course = $2 LIMIT 1 FOR UPDATE",
            &[&tenant.id, &course],
        )
        .await?
        .is_some()
    {
        return Ok(vec!["Lessons are frozen after learners enroll in the course".into()]);
    }
    if action == "removed" || action == "updated" {
        let course_status = tx
            .query_opt(
                "SELECT status FROM lms__course WHERE tenant_id = $1 AND id = $2",
                &[&tenant.id, &course],
            )
            .await?
            .map(|row| row.get::<_, String>(0));
        if course_status.as_deref() == Some("published") {
            let lesson = parse_id(document, "id");
            let retained_required: i64 = tx
                .query_opt(
                    "SELECT count(*) FROM lms__lesson WHERE tenant_id = $1 AND course = $2 AND COALESCE(required, true) AND ($3::uuid IS NULL OR id <> $3)",
                    &[&tenant.id, &course, &lesson],
                )
                .await?
                .map(|row| row.get(0))
                .unwrap_or_default();
            let remains_required = action == "updated"
                && document
                    .get("required")
                    .and_then(Value::as_bool)
                    .unwrap_or(true);
            if retained_required == 0 && !remains_required {
                return Ok(vec![
                    "A published course must keep at least one required lesson".into(),
                ]);
            }
        }
    }
    if action == "removed"
        && let Some(lesson) = parse_id(document, "id")
        && tx
            .query_opt(
                "SELECT id FROM lms__lesson_progress WHERE tenant_id = $1 AND lesson = $2 LIMIT 1 FOR SHARE",
                &[&tenant.id, &lesson],
            )
            .await?
            .is_some()
    {
        return Ok(vec!["A lesson with learner progress cannot be deleted".into()]);
    }
    Ok(Vec::new())
}

async fn validate_enrollment(
    tx: &Tx<'_>,
    tenant: &Tenant,
    action: &str,
    document: &Value,
) -> R<Vec<String>> {
    let Some(course) = parse_id(document, "course") else {
        return Ok(vec!["Enrollment requires a valid course".into()]);
    };
    let Some(learner) = parse_id(document, "learner") else {
        return Ok(vec!["Enrollment requires a valid learner".into()]);
    };
    let course_row = tx
        .query_opt(
            "SELECT status FROM lms__course WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
            &[&tenant.id, &course],
        )
        .await?;
    let Some(course_row) = course_row else {
        return Ok(vec!["Course does not exist in this tenant".into()]);
    };
    if action == "created" && course_row.get::<_, String>(0) != "published" {
        return Ok(vec!["Learners can enroll only in published courses".into()]);
    }
    if tx
        .query_opt(
            "SELECT id FROM master_data__party WHERE tenant_id = $1 AND id = $2 FOR SHARE",
            &[&tenant.id, &learner],
        )
        .await?
        .is_none()
    {
        return Ok(vec!["Learner does not exist in this tenant".into()]);
    }
    if action == "created"
        && tx
            .query_opt(
                "SELECT id FROM lms__enrollment WHERE tenant_id = $1 AND course = $2 AND learner = $3 LIMIT 1 FOR UPDATE",
                &[&tenant.id, &course, &learner],
            )
            .await?
            .is_some()
    {
        return Ok(vec!["Learner is already enrolled in this course".into()]);
    }
    Ok(Vec::new())
}

async fn validate_lesson_progress(
    tx: &Tx<'_>,
    tenant: &Tenant,
    document: &Value,
) -> R<Vec<String>> {
    let Some(enrollment) = parse_id(document, "enrollment") else {
        return Ok(vec!["Lesson progress requires a valid enrollment".into()]);
    };
    let Some(lesson) = parse_id(document, "lesson") else {
        return Ok(vec!["Lesson progress requires a valid lesson".into()]);
    };
    let Some(enrollment_row) = tx
        .query_opt(
            "SELECT course, status FROM lms__enrollment WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
            &[&tenant.id, &enrollment],
        )
        .await?
    else {
        return Ok(vec!["Enrollment does not exist in this tenant".into()]);
    };
    let course: Uuid = enrollment_row.get(0);
    let enrollment_status: String = enrollment_row.get(1);
    let lesson_row = tx
        .query_opt(
            "SELECT COALESCE(l.required, true), c.status FROM lms__lesson l JOIN lms__course c ON c.tenant_id = l.tenant_id AND c.id = l.course WHERE l.tenant_id = $1 AND l.id = $2 AND l.course = $3 FOR SHARE OF l, c",
            &[&tenant.id, &lesson, &course],
        )
        .await?;
    let Some(lesson_row) = lesson_row else {
        return Ok(vec![
            "Lesson does not belong to the learner's course".into(),
        ]);
    };
    let required: bool = lesson_row.get(0);
    let course_status: String = lesson_row.get(1);
    if course_status == "archived" {
        return Ok(vec![
            "Archived courses cannot accept new lesson progress".into(),
        ]);
    }
    if !matches!(enrollment_status.as_str(), "active" | "completed")
        || (enrollment_status == "completed" && required)
    {
        return Ok(vec![
            "This enrollment cannot record the selected lesson".into(),
        ]);
    }
    if tx
        .query_opt(
            "SELECT id FROM lms__lesson_progress WHERE tenant_id = $1 AND enrollment = $2 AND lesson = $3 LIMIT 1 FOR UPDATE",
            &[&tenant.id, &enrollment, &lesson],
        )
        .await?
        .is_some()
    {
        return Ok(vec!["This lesson is already completed in the enrollment".into()]);
    }
    Ok(Vec::new())
}

async fn validate_certificate(tx: &Tx<'_>, tenant: &Tenant, document: &Value) -> R<Vec<String>> {
    let Some(enrollment) = parse_id(document, "enrollment") else {
        return Ok(vec!["Certificate requires a valid enrollment".into()]);
    };
    let row = tx
        .query_opt(
            "SELECT party.name, course.title, enrollment.status FROM lms__enrollment enrollment JOIN master_data__party party ON party.tenant_id = enrollment.tenant_id AND party.id = enrollment.learner JOIN lms__course course ON course.tenant_id = enrollment.tenant_id AND course.id = enrollment.course WHERE enrollment.tenant_id = $1 AND enrollment.id = $2 FOR SHARE OF enrollment, party, course",
            &[&tenant.id, &enrollment],
        )
        .await?;
    let Some(row) = row else {
        return Ok(vec![
            "Certificate enrollment does not exist in this tenant".into(),
        ]);
    };
    let status: String = row.get(2);
    if status != "completed" {
        return Ok(vec![
            "A certificate can be issued only for a completed enrollment".into(),
        ]);
    }
    let learner_name: String = row.get(0);
    let course_title: String = row.get(1);
    if document.get("learner_name").and_then(Value::as_str) != Some(learner_name.as_str())
        || document.get("course_title").and_then(Value::as_str) != Some(course_title.as_str())
    {
        return Ok(vec![
            "Certificate learner and course snapshots must match the enrollment".into(),
        ]);
    }
    if tx
        .query_opt(
            "SELECT id FROM lms__certificate WHERE tenant_id = $1 AND (enrollment = $2 OR certificate_number = $3) LIMIT 1 FOR UPDATE",
            &[&tenant.id, &enrollment, &document.get("certificate_number").and_then(Value::as_str).unwrap_or_default()],
        )
        .await?
        .is_some()
    {
        return Ok(vec!["This enrollment already has a certificate or the certificate number is in use".into()]);
    }
    Ok(Vec::new())
}

fn parse_id(document: &Value, field: &str) -> Option<Uuid> {
    document
        .get(field)
        .and_then(Value::as_str)
        .and_then(|id| Uuid::parse_str(id).ok())
}
