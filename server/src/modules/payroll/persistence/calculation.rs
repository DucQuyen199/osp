//! Payroll run calculation persistence checks.
use super::*;

pub(super) async fn validate_calculated(
    tx: &Tx<'_>,
    tenant: &Tenant,
    document: &Value,
) -> R<Vec<String>> {
    let mut errors = Vec::new();
    let Some(run) = document
        .get("id")
        .and_then(Value::as_str)
        .and_then(|id| Uuid::parse_str(id).ok())
    else {
        return Ok(vec!["Không xác định được bảng lương cần tính".into()]);
    };
    let Some(period) = document.get("period").and_then(Value::as_str) else {
        return Ok(vec!["Bảng lương chưa có kỳ hợp lệ".into()]);
    };
    let Some(first_day) = NaiveDate::parse_from_str(&format!("{period}-01"), "%Y-%m-%d").ok()
    else {
        return Ok(vec!["Kỳ lương phải có định dạng YYYY-MM hợp lệ".into()]);
    };
    let (year, month) = if first_day.month() == 12 {
        (first_day.year() + 1, 1)
    } else {
        (first_day.year(), first_day.month() + 1)
    };
    let Some(next_month) = NaiveDate::from_ymd_opt(year, month, 1) else {
        return Ok(vec!["Kỳ lương không hợp lệ".into()]);
    };
    let run_row = tx
                .query_opt(
                    "SELECT status, period, COALESCE(hours_per_day, 8)::text FROM payroll__payroll_run WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
                    &[&tenant.id, &run],
                )
                .await?;
    if !run_row
        .as_ref()
        .is_some_and(|row| row.get::<_, String>(0) == "draft")
    {
        errors.push("Chỉ được tính bảng lương đang ở trạng thái nháp".into());
    }
    if tx
        .query_opt(
            "SELECT 1 FROM payroll__payslip WHERE tenant_id = $1 AND run = $2 LIMIT 1",
            &[&tenant.id, &run],
        )
        .await?
        .is_some()
    {
        errors.push("Bảng lương đã có phiếu; không thể tính lại để tránh nhân đôi".into());
    }
    if tx
                .query_opt(
                    "SELECT 1 FROM hrm__employee e WHERE e.tenant_id = $1 AND e.status IN ('active', 'terminated') AND (e.hire_date IS NULL OR e.hire_date < $3) AND (e.termination_date IS NULL OR e.termination_date >= $2) AND COALESCE((SELECT sr.base_salary::numeric FROM hrm__salary_revision sr WHERE sr.tenant_id = e.tenant_id AND sr.employee = e.id AND sr.status = 'approved' AND sr.effective_from <= $2 ORDER BY sr.effective_from DESC LIMIT 1), e.base_salary::numeric, 0) > 0 AND (EXISTS (SELECT 1 FROM hrm__attendance a WHERE a.tenant_id = e.tenant_id AND a.employee = e.id AND a.date >= $2 AND a.date < $3 AND a.date >= COALESCE(e.hire_date, $2) AND a.date <= COALESCE(e.termination_date, $3 - 1) AND EXTRACT(ISODOW FROM a.date) <= 5 AND a.check_in IS NOT NULL AND a.check_out IS NOT NULL) OR EXISTS (SELECT 1 FROM hrm__leave_request lr CROSS JOIN LATERAL generate_series(GREATEST(lr.start_date, $2::date, COALESCE(e.hire_date, $2::date))::timestamp, LEAST(lr.end_date, $3::date - 1, COALESCE(e.termination_date, $3::date - 1))::timestamp, interval '1 day') AS leave_day(work_date) WHERE lr.tenant_id = e.tenant_id AND lr.employee = e.id AND lr.status = 'approved' AND COALESCE(lr.pay_treatment, CASE WHEN lr.kind = 'unpaid' THEN 'unpaid' ELSE 'paid' END) = 'paid' AND lr.start_date < $3 AND lr.end_date >= $2 AND lr.end_date >= COALESCE(e.hire_date, $2) AND lr.start_date <= COALESCE(e.termination_date, $3 - 1) AND EXTRACT(ISODOW FROM leave_day.work_date) <= 5) OR EXISTS (SELECT 1 FROM hrm__holiday h WHERE h.tenant_id = e.tenant_id AND h.date >= $2 AND h.date < $3 AND h.date >= COALESCE(e.hire_date, $2) AND h.date <= COALESCE(e.termination_date, $3 - 1) AND h.pay_treatment = 'paid' AND EXTRACT(ISODOW FROM h.date) <= 5)) LIMIT 1",
                    &[&tenant.id, &first_day, &next_month],
                )
                .await?
                .is_none()
                && tx
                    .query_opt(
                        "SELECT 1 FROM hrm__employee e WHERE e.tenant_id = $1 AND e.status IN ('active', 'terminated') AND COALESCE((SELECT sr.base_salary::numeric FROM hrm__salary_revision sr WHERE sr.tenant_id = e.tenant_id AND sr.employee = e.id AND sr.status = 'approved' AND sr.effective_from <= $2 ORDER BY sr.effective_from DESC LIMIT 1), e.base_salary::numeric, 0) > 0 AND EXISTS (SELECT 1 FROM payroll__overtime_entry oe WHERE oe.tenant_id = e.tenant_id AND oe.employee = e.id AND oe.date >= $2 AND oe.date < $3 AND oe.status = 'approved') LIMIT 1",
                        &[&tenant.id, &first_day, &next_month],
                    )
                    .await?
                    .is_none()
            {
                errors.push("Không có nhân viên có lương cơ bản cùng ngày công, nghỉ hưởng lương hoặc giờ làm thêm đã duyệt trong kỳ".into());
            }
    Ok(errors)
}
