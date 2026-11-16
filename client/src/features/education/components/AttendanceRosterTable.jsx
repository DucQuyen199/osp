import React from 'react';
import { statusLabel } from '../../../lib/i18n.js';
import { can, recordLabel } from '../../../lib/state.js';

const attendanceStatuses = ['present', 'absent', 'late', 'excused'];

export default function AttendanceRosterTable({ roster, marks, parties, busy, sessionStatus, attendanceLabels, onSave, t }) {
  return <div className="table-wrap"><table className="table">
    <thead><tr><th>{t('Mã học viên')}</th><th>{t('Học viên')}</th><th>{t('Trạng thái điểm danh')}</th><th>{t('Ghi nhận')}</th></tr></thead>
    <tbody>{roster.map(({ enrollment, student }) => {
      const mark = marks.get(enrollment.id);
      const canSaveMark = mark ? can('school.attendance.update') : can('school.attendance.create');
      const party = parties.get(student?.party);
      return <tr key={enrollment.id}>
        <td>{student?.student_code || '—'}</td>
        <td>{party ? recordLabel('master-data.party', party) : t('Học viên')}</td>
        <td>{mark ? attendanceLabels[mark.status] || statusLabel(mark.status) : t('Chưa điểm danh')}</td>
        <td><div className="row wrap">{attendanceStatuses.map((status) => <button key={status} className={`btn btn-sm ${mark?.status === status ? 'btn-primary' : 'btn-secondary'}`} type="button" disabled={busy || sessionStatus !== 'scheduled' || !canSaveMark} onClick={() => onSave(enrollment.id, status)}>{attendanceLabels[status]}</button>)}</div></td>
      </tr>;
    })}</tbody>
  </table></div>;
}
