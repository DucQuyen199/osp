import React from 'react';
import AttendanceEntriesTable from './AttendanceEntriesTable.jsx';

export default function AttendanceDayPanel({
  attendanceDate,
  punchEmployee,
  activeEmployees,
  attendance,
  employeeMap,
  loading,
  busy,
  canCreate,
  canPunchOut,
  punchInDisabled,
  onDateChange,
  onEmployeeChange,
  onPunchIn,
  onPunchOut,
  recordLabel,
  t,
}) {
  return <section className="card card-pad">
    <h2>{t('Chấm công trong ngày')}</h2>
    <div className="row wrap">
      <label className="field">
        <span className="label">{t('Ngày')}</span>
        <input className="input" type="date" value={attendanceDate} onChange={(event) => onDateChange(event.target.value)} />
      </label>
      <label className="field grow">
        <span className="label">{t('Nhân viên ghi nhận giờ vào')}</span>
        <select className="select" value={punchEmployee} onChange={(event) => onEmployeeChange(event.target.value)}>
          <option value="">{t('Chọn nhân viên')}</option>
          {activeEmployees.map((row) => <option key={row.id} value={row.id}>{recordLabel('hrm.employee', row)}</option>)}
        </select>
      </label>
      {canCreate && <button className="btn btn-primary" type="button" disabled={punchInDisabled} onClick={onPunchIn}>{t('Ghi giờ vào')}</button>}
    </div>
    {attendance.length > 0 && <AttendanceEntriesTable attendance={attendance} employees={employeeMap} busy={busy} canPunchOut={canPunchOut} onPunchOut={onPunchOut} />}
    {!attendance.length && !loading && <p className="small muted">{t('Chưa có bản ghi chấm công trong ngày đã chọn.')}</p>}
  </section>;
}
