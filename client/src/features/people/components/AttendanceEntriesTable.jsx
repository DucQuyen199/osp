import React from 'react';
import { fmtTime, uiText } from '../../../lib/i18n.js';
import { recordLabel } from '../../../lib/state.js';

export default function AttendanceEntriesTable({ attendance, employees, busy, canPunchOut, onPunchOut }) {
  return <div className="table-wrap" style={{ marginTop: 12 }}><table className="table">
    <thead><tr><th>{uiText('Nhân viên')}</th><th>{uiText('Giờ vào')}</th><th>{uiText('Giờ ra')}</th><th scope="col">{uiText('Thao tác')}</th></tr></thead>
    <tbody>{attendance.map((row) => <tr key={row.id}>
      <td>{employees.get(row.employee) ? recordLabel('hrm.employee', employees.get(row.employee)) : uiText('Nhân viên')}</td>
      <td>{row.check_in ? fmtTime(row.check_in) : uiText('Chưa ghi')}</td>
      <td>{row.check_out ? fmtTime(row.check_out) : uiText('Chưa ghi')}</td>
      <td>{row.check_in && !row.check_out && canPunchOut && <button className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => onPunchOut(row)}>{uiText('Ghi giờ ra')}</button>}</td>
    </tr>)}</tbody>
  </table></div>;
}
