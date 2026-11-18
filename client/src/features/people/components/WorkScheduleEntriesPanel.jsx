import React from 'react';
import { uiText } from '../../../lib/i18n.js';

export default function WorkScheduleEntriesPanel({
  canCreate,
  canRead,
  canDelete,
  scheduleForm,
  existingEntry,
  scheduleEntriesThisMonth,
  activeEmployees,
  employeeMap,
  recordLabel,
  busy,
  onFormChange,
  onSubmit,
  onRemoveEntry,
  formatDate,
  formatTime,
}) {
  return <section className="card card-pad u-mt-16">
    <h2>{uiText('Lịch ca theo ngày')}</h2>
    <p className="small muted">{uiText('Mỗi dòng ghi đè lịch tuần của nhân viên trong đúng một ngày. Bỏ lịch để trở về lịch tuần; ca qua đêm được hỗ trợ.')}</p>
    {canCreate && <form className="form-grid" onSubmit={onSubmit}>
      <label className="field">
        <span className="label">{uiText('Nhân viên *')}</span>
        <select className="select" required value={scheduleForm.employee} onChange={(event) => onFormChange('employee', event.target.value)}>
          <option value="">{uiText('Chọn nhân viên')}</option>
          {activeEmployees.map((row) => <option key={row.id} value={row.id}>{recordLabel('hrm.employee', row)}</option>)}
        </select>
      </label>
      <label className="field">
        <span className="label">{uiText('Ngày làm việc *')}</span>
        <input className="input" required type="date" value={scheduleForm.work_date} onChange={(event) => onFormChange('work_date', event.target.value)} />
      </label>
      <label className="row small u-align-end-pb-10">
        <input type="checkbox" checked={scheduleForm.is_working} onChange={(event) => onFormChange('is_working', event.target.checked)} />
        {uiText('Có ca làm việc trong ngày này')}
      </label>
      {scheduleForm.is_working && <>
        <label className="field">
          <span className="label">{uiText('Bắt đầu *')}</span>
          <input className="input" required type="time" value={scheduleForm.start_time} onChange={(event) => onFormChange('start_time', event.target.value)} />
        </label>
        <label className="field">
          <span className="label">{uiText('Kết thúc *')}</span>
          <input className="input" required type="time" value={scheduleForm.end_time} onChange={(event) => onFormChange('end_time', event.target.value)} />
        </label>
        <label className="field">
          <span className="label">{uiText('Nghỉ không tính giờ (phút)')}</span>
          <input className="input num" type="number" min="0" max="1439" step="1" value={scheduleForm.break_minutes} onChange={(event) => onFormChange('break_minutes', event.target.value)} />
        </label>
      </>}
      <div className="row">
        <span className="grow" />
        <button className="btn btn-primary" disabled={Boolean(busy) || !scheduleForm.employee || !scheduleForm.work_date}>
          {uiText(existingEntry ? 'Cập nhật lịch ngày' : 'Lưu lịch ngày')}
        </button>
      </div>
    </form>}
    {canRead && <>
      <h3 className="u-mt-18">{uiText('Ngoại lệ trong tháng')} {scheduleForm.work_date.slice(0, 7)}</h3>
      {scheduleEntriesThisMonth.length ? <div className="table-wrap">
        <table className="table">
          <thead><tr><th scope="col">{uiText('Ngày')}</th><th scope="col">{uiText('Nhân viên')}</th><th scope="col">{uiText('Lịch áp dụng')}</th><th scope="col"><span className={canDelete ? '' : 'sr-only'}>{uiText('Thao tác')}</span></th></tr></thead>
          <tbody>{scheduleEntriesThisMonth.map((row) => <tr key={row.id}>
            <td>{formatDate(row.work_date)}</td>
            <td>{employeeMap.get(row.employee) ? recordLabel('hrm.employee', employeeMap.get(row.employee)) : uiText('Nhân viên')}</td>
            <td>{row.is_working ? `${formatTime(row.start_at)}–${formatTime(row.end_at)} · ${uiText('nghỉ')} ${row.break_minutes || 0} ${uiText('phút')}` : uiText('Ngày nghỉ')}</td>
            <td>{canDelete && <button className="btn btn-ghost btn-sm" disabled={Boolean(busy)} onClick={() => onRemoveEntry(row)}>{uiText('Xóa ngoại lệ')}</button>}</td>
          </tr>)}</tbody>
        </table>
      </div> : <p className="small muted">{uiText('Chưa có ngoại lệ lịch trong tháng này.')}</p>}
    </>}
  </section>;
}
