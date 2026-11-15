//! Tenant-scoped project and work-item consistency.
use crate::{db::Tx, error::R, kernel::Tenant};
use serde_json::Value;
use uuid::Uuid;
fn id(document: &Value, field: &str) -> Option<Uuid> {
    document
        .get(field)
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
}

async fn lock_project(tx: &Tx<'_>, tenant: &Tenant, id: Uuid) -> R<Option<String>> {
    Ok(tx
        .query_opt(
            "SELECT status FROM project__project WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
            &[&tenant.id, &id],
        )
        .await?
        .map(|row| row.get(0)))
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
        ("project", "completed") => {
            let Some(project) = id(document, "id") else {
                return Ok(vec!["Không xác định được dự án cần hoàn tất".into()]);
            };
            if lock_project(tx, tenant, project).await?.as_deref() != Some("active") {
                return Ok(vec!["Chỉ hoàn tất dự án đang hoạt động".into()]);
            }
            if tx
                .query_opt(
                    "SELECT 1 FROM project__task WHERE tenant_id = $1 AND project = $2 AND status <> 'done' LIMIT 1",
                    &[&tenant.id, &project],
                )
                .await?
                .is_some()
            {
                errors.push("Chỉ hoàn tất dự án sau khi mọi công việc đã xong".into());
            }
        }
        ("project", "cancelled") | ("project", "updated") => {
            if let Some(project) = id(document, "id") {
                lock_project(tx, tenant, project).await?;
            }
        }
        ("project", "removed") => {
            let Some(project) = id(document, "id") else {
                return Ok(vec!["Không xác định được dự án cần xóa".into()]);
            };
            if tx
                .query_opt(
                    "SELECT 1 FROM project__task WHERE tenant_id = $1 AND project = $2 UNION ALL SELECT 1 FROM project__timesheet WHERE tenant_id = $1 AND project = $2 LIMIT 1",
                    &[&tenant.id, &project],
                )
                .await?
                .is_some()
            {
                errors.push("Hãy xóa các công việc và timesheet trước khi xóa dự án dự kiến".into());
            }
        }
        ("task", "created" | "updated") => {
            if let Some(employee) = id(document, "assignee_employee") {
                let Some(employee_row) = tx
                    .query_opt(
                        "SELECT name, status FROM hrm__employee WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                        &[&tenant.id, &employee],
                    )
                    .await?
                else {
                    return Ok(vec!["Nhân viên phụ trách không tồn tại trong doanh nghiệp".into()]);
                };
                let employee_name: String = employee_row.get(0);
                let employee_status: String = employee_row.get(1);
                let previous_assignment = if action == "updated" {
                    if let Some(task) = id(document, "id") {
                        tx.query_opt(
                            "SELECT assignee_employee, assignee FROM project__task WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                            &[&tenant.id, &task],
                        )
                        .await?
                        .map(|row| {
                            (
                                row.get::<_, Option<Uuid>>(0),
                                row.get::<_, Option<String>>(1),
                            )
                        })
                    } else {
                        None
                    }
                } else {
                    None
                };
                let current_assignee = document
                    .get("assignee")
                    .and_then(Value::as_str)
                    .map(str::trim);
                let assignment_changed = action == "created"
                    || previous_assignment.as_ref().is_none_or(
                        |(previous_employee, previous_name)| {
                            *previous_employee != Some(employee)
                                || previous_name.as_deref().map(str::trim) != current_assignee
                        },
                    );
                if assignment_changed && employee_status != "active" {
                    errors.push("Chỉ có thể giao việc cho nhân viên đang làm việc".into());
                }
                if assignment_changed && current_assignee != Some(employee_name.trim()) {
                    errors.push("Tên người phụ trách phải khớp với hồ sơ nhân viên".into());
                }
            }
            let Some(project) = id(document, "project") else {
                return Ok(vec!["Công việc cần tham chiếu dự án hợp lệ".into()]);
            };
            let Some(status) = lock_project(tx, tenant, project).await? else {
                return Ok(vec!["Không tìm thấy dự án trong doanh nghiệp".into()]);
            };
            if !matches!(status.as_str(), "planned" | "active") {
                errors.push(
                    "Chỉ được thêm hoặc sửa công việc trong dự án dự kiến/đang hoạt động".into(),
                );
            }
        }
        ("task", "started" | "done") => {
            if action == "started" {
                if let Some(employee) = id(document, "assignee_employee") {
                    let is_active = tx
                        .query_opt(
                            "SELECT 1 FROM hrm__employee WHERE tenant_id = $1 AND id = $2 AND status = 'active' FOR SHARE",
                            &[&tenant.id, &employee],
                        )
                        .await?
                        .is_some();
                    if !is_active {
                        errors.push(
                            "Hãy giao công việc cho nhân viên đang làm việc trước khi bắt đầu"
                                .into(),
                        );
                    }
                }
            }
            let Some(project) = id(document, "project") else {
                return Ok(vec!["Công việc cần tham chiếu dự án hợp lệ".into()]);
            };
            if lock_project(tx, tenant, project).await?.as_deref() != Some("active") {
                errors.push("Công việc chỉ được bắt đầu/hoàn tất khi dự án đang hoạt động".into());
            }
            if action == "done"
                && tx
                    .query_opt(
                        "SELECT 1 FROM project__task_dependency d JOIN project__task p ON p.tenant_id = d.tenant_id AND p.id = d.predecessor WHERE d.tenant_id = $1 AND d.successor = $2 AND p.status <> 'done' LIMIT 1",
                        &[&tenant.id, &id(document, "id")],
                    )
                    .await?
                    .is_some()
            {
                errors.push("Chỉ hoàn tất công việc sau khi mọi công việc tiên quyết đã xong".into());
            }
        }
        ("task", "removed") => {
            let Some(task) = id(document, "id") else {
                return Ok(vec!["Không xác định được công việc cần xóa".into()]);
            };
            let Some(project) = id(document, "project") else {
                return Ok(vec!["Công việc cần tham chiếu dự án hợp lệ".into()]);
            };
            if !matches!(
                lock_project(tx, tenant, project).await?.as_deref(),
                Some("planned" | "active")
            ) {
                return Ok(vec![
                    "Chỉ xóa công việc trong dự án dự kiến hoặc đang hoạt động".into(),
                ]);
            }
            if tx
                .query_opt(
                    "SELECT 1 FROM project__timesheet WHERE tenant_id = $1 AND task = $2 UNION ALL SELECT 1 FROM project__task_dependency WHERE tenant_id = $1 AND (predecessor = $2 OR successor = $2) LIMIT 1",
                    &[&tenant.id, &task],
                )
                .await?
                .is_some()
            {
                errors.push("Không xóa được công việc đang được timesheet hoặc quan hệ phụ thuộc tham chiếu".into());
            }
        }
        ("timesheet", "created" | "updated" | "removed") => {
            if let Some(employee) = id(document, "employee_ref") {
                let Some(employee_row) = tx
                    .query_opt(
                        "SELECT name, status FROM hrm__employee WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                        &[&tenant.id, &employee],
                    )
                    .await?
                else {
                    return Ok(vec!["Hồ sơ nhân viên không tồn tại trong doanh nghiệp".into()]);
                };
                let employee_name: String = employee_row.get(0);
                let employee_status: String = employee_row.get(1);
                let previous_assignment = if action == "updated" {
                    if let Some(timesheet) = id(document, "id") {
                        tx.query_opt(
                            "SELECT employee_ref, employee FROM project__timesheet WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                            &[&tenant.id, &timesheet],
                        )
                        .await?
                        .map(|row| {
                            (
                                row.get::<_, Option<Uuid>>(0),
                                row.get::<_, Option<String>>(1),
                            )
                        })
                    } else {
                        None
                    }
                } else {
                    None
                };
                let current_employee = document
                    .get("employee")
                    .and_then(Value::as_str)
                    .map(str::trim);
                let assignment_changed = action == "created"
                    || (action == "updated"
                        && previous_assignment.as_ref().is_none_or(
                            |(previous_employee, previous_name)| {
                                *previous_employee != Some(employee)
                                    || previous_name.as_deref().map(str::trim) != current_employee
                            },
                        ));
                if assignment_changed && employee_status != "active" {
                    errors.push("Chỉ ghi giờ công cho nhân viên đang làm việc".into());
                }
                if assignment_changed && current_employee != Some(employee_name.trim()) {
                    errors.push("Tên nhân viên phải khớp với hồ sơ đã chọn".into());
                }
            }
            let Some(project) = id(document, "project") else {
                return Ok(vec!["Timesheet cần tham chiếu dự án hợp lệ".into()]);
            };
            if let Some(task) = id(document, "task") {
                let task_row = tx
                    .query_opt(
                        "SELECT project, status FROM project__task WHERE tenant_id = $1 AND id = $2 FOR SHARE",
                        &[&tenant.id, &task],
                    )
                    .await?;
                if !task_row.is_some_and(|row| {
                    row.get::<_, Uuid>(0) == project && row.get::<_, String>(1) != "done"
                }) {
                    errors
                        .push("Công việc timesheet phải thuộc cùng dự án và chưa hoàn tất".into());
                }
            }
            let Some(status) = lock_project(tx, tenant, project).await? else {
                return Ok(vec!["Không tìm thấy dự án trong doanh nghiệp".into()]);
            };
            if status != "active" {
                errors.push("Chỉ được ghi hoặc sửa timesheet trong dự án đang hoạt động".into());
            }
        }
        ("task_dependency", "created" | "removed") => {
            let Some(predecessor) = id(document, "predecessor") else {
                return Ok(vec![
                    "Quan hệ cần tham chiếu công việc tiên quyết hợp lệ".into(),
                ]);
            };
            let Some(successor) = id(document, "successor") else {
                return Ok(vec![
                    "Quan hệ cần tham chiếu công việc kế tiếp hợp lệ".into(),
                ]);
            };
            if predecessor == successor {
                return Ok(vec!["Công việc không thể phụ thuộc vào chính nó".into()]);
            }
            let tasks = tx
                .query(
                    "SELECT id, project, status FROM project__task WHERE tenant_id = $1 AND id = ANY($2) ORDER BY id FOR UPDATE",
                    &[&tenant.id, &vec![predecessor, successor]],
                )
                .await?;
            if tasks.len() != 2 {
                return Ok(vec![
                    "Không tìm thấy đầy đủ công việc trong doanh nghiệp".into(),
                ]);
            }
            let project: Uuid = tasks[0].get(1);
            if tasks.iter().any(|task| task.get::<_, Uuid>(1) != project) {
                return Ok(vec!["Hai công việc phải thuộc cùng một dự án".into()]);
            }
            if lock_project(tx, tenant, project).await?.as_deref() != Some("active") {
                return Ok(vec![
                    "Chỉ cấu hình phụ thuộc trong dự án đang hoạt động".into(),
                ]);
            }
            if action == "created" {
                let cycle = tx
                    .query_opt(
                        "WITH RECURSIVE reachable(task_id) AS (SELECT successor FROM project__task_dependency WHERE tenant_id = $1 AND predecessor = $2 UNION SELECT d.successor FROM project__task_dependency d JOIN reachable r ON d.predecessor = r.task_id WHERE d.tenant_id = $1) SELECT 1 FROM reachable WHERE task_id = $3 LIMIT 1",
                        &[&tenant.id, &successor, &predecessor],
                    )
                    .await?
                    .is_some();
                if cycle {
                    errors.push("Quan hệ này tạo vòng lặp phụ thuộc giữa các công việc".into());
                }
                if tx
                    .query_opt(
                        "SELECT 1 FROM project__task_dependency WHERE tenant_id = $1 AND predecessor = $2 AND successor = $3 LIMIT 1",
                        &[&tenant.id, &predecessor, &successor],
                    )
                    .await?
                    .is_some()
                {
                    errors.push("Quan hệ phụ thuộc này đã tồn tại".into());
                }
                if tasks.iter().any(|task| task.get::<_, String>(2) == "done") {
                    errors.push("Không thêm phụ thuộc cho công việc đã hoàn tất".into());
                }
            }
        }
        _ => {}
    }
    Ok(errors)
}
