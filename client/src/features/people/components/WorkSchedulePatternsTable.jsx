import React from 'react';
import { uiText } from '../../../lib/i18n.js';

const employeesForPattern = (pattern) => Array.isArray(pattern?.employees)
  ? pattern.employees
  : pattern?.employee ? [pattern.employee] : [];

export default function WorkSchedulePatternsTable({
  patterns,
  employeeMap,
  busy,
  canApply,
  canDelete,
  onApply,
  onDelete,
  formatDate,
  statusLabel,
  recordLabel,
}) {
  return <div className="table-wrap u-legacy-2bdf8e45fd">
    <table className="table">
      <thead><tr>
        <th scope="col">{uiText('Nhân viên')}</th>
        <th scope="col">{uiText('Khoảng ngày')}</th>
        <th scope="col">{uiText('Chu kỳ / múi giờ')}</th>
        <th scope="col">{uiText('Trạng thái')}</th>
        <th scope="col">{uiText('Thao tác')}</th>
      </tr></thead>
      <tbody>{patterns.map((pattern) => <tr key={pattern.id}>
        <td>{employeesForPattern(pattern).map((id) => employeeMap.get(id)
          ? recordLabel('hrm.employee', employeeMap.get(id))
          : uiText('Nhân viên')).join(', ')}</td>
        <td>{formatDate(pattern.start_date)} – {formatDate(pattern.end_date)}</td>
        <td>{Array.isArray(pattern.cycle) ? `${pattern.cycle.length} ${uiText('ngày')}` : '—'} · {pattern.timezone}</td>
        <td>{statusLabel(pattern.status)}</td>
        <td><div className="row wrap">
          {pattern.status === 'draft' && canApply && <button className="btn btn-primary btn-sm" disabled={Boolean(busy)} onClick={() => onApply(pattern)}>{uiText('Áp dụng')}</button>}
          {pattern.status === 'draft' && canDelete && <button className="btn btn-ghost btn-sm" disabled={Boolean(busy)} onClick={() => onDelete(pattern)}>{uiText('Xóa nháp')}</button>}
        </div></td>
      </tr>)}</tbody>
    </table>
    {!patterns.length && <p className="small muted">{uiText('Chưa có mẫu ca luân phiên.')}</p>}
  </div>;
}
