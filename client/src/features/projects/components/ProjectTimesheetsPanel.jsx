import React from 'react';

export default function ProjectTimesheetsPanel({
  timesheets,
  tasks,
  taskById,
  employees,
  activeEmployees,
  form,
  busy,
  canCreate,
  canReadEmployees,
  today,
  fmtDate,
  fmtNumber,
  fmtMoney,
  recordLabel,
  onFieldChange,
  onEmployeeRefChange,
  onCreate,
  t,
}) {
  return <section className="card card-pad u-mt-16">
    <h2>Timesheet</h2>
    {canCreate && <form className="form-grid u-margin-12-0" onSubmit={onCreate}>
      <label className="field"><span className="label">{t('Công việc')}</span><select className="select" value={form.task} onChange={(event) => onFieldChange('task', event.target.value)}><option value="">{t('Giờ công chung cho dự án')}</option>{tasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}</select></label>
      {canReadEmployees && <label className="field"><span className="label">{t('Nhân viên nội bộ')}</span><select className="select" value={form.employee_ref} onChange={(event) => onEmployeeRefChange(event.target.value)}><option value="">{t('Nhà thầu / nhân viên ngoài')}</option>{activeEmployees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select></label>}
      <label className="field"><span className="label">{t('Người thực hiện ngoài')}</span><input className="input" maxLength="160" readOnly={Boolean(form.employee_ref)} value={form.employee} onChange={(event) => onFieldChange('employee', event.target.value)} /></label>
      <label className="field"><span className="label">{t('Ngày *')}</span><input className="input" type="date" required max={today} value={form.date} onChange={(event) => onFieldChange('date', event.target.value)} /></label>
      <label className="field"><span className="label">{t('Số giờ *')}</span><input className="input num" type="number" min="0.001" max="24" step="any" required value={form.hours} onChange={(event) => onFieldChange('hours', event.target.value)} /></label>
      <label className="field"><span className="label">{t('Đơn giá giờ công')}</span><input className="input num" type="number" min="0" step="any" value={form.rate} onChange={(event) => onFieldChange('rate', event.target.value)} /></label>
      <div className="row full"><span className="grow"/><button className="btn btn-primary" disabled={busy === 'timesheet'}>{t('Ghi giờ công')}</button></div>
    </form>}
    {!timesheets.length ? <div className="empty">{t('Chưa ghi nhận giờ công.')}</div> : <div className="table-wrap"><table className="table">
      <thead><tr><th>{t('Ngày')}</th><th>{t('Nhân viên')}</th><th>{t('Công việc')}</th><th>{t('Số giờ')}</th><th>{t('Thành tiền')}</th></tr></thead>
      <tbody>{timesheets.map((entry) => <tr key={entry.id}>
        <td>{fmtDate(entry.date)}</td>
        <td>{employees.get(entry.employee_ref) ? recordLabel('hrm.employee', employees.get(entry.employee_ref)) : entry.employee || '—'}</td>
        <td>{taskById.get(entry.task)?.title || t('Dự án chung')}</td>
        <td>{fmtNumber(entry.hours)}</td>
        <td>{fmtMoney(entry.amount || 0)}</td>
      </tr>)}</tbody>
    </table></div>}
  </section>;
}
