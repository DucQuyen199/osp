import React from 'react';
import { fmtDateTime, statusLabel } from '../../../lib/i18n.js';
import AttendanceRosterTable from './AttendanceRosterTable.jsx';

export default function ClassSessionRegister({
  sessions,
  classes,
  selectedId,
  selected,
  selectedClass,
  loading,
  busy,
  roster,
  marks,
  parties,
  attendanceLabels,
  canComplete,
  canCancel,
  markedCount,
  onSelect,
  onTransition,
  onSaveAttendance,
  t,
}) {
  return <section className="card card-pad u-mt-20">
    <div className="row wrap">
      <h2>{t("Danh sách buổi học")}</h2>
      <span className="grow" />
      <select className="select" aria-label={t('Chọn buổi học')} value={selectedId} onChange={(event) => onSelect(event.target.value)}>
        <option value="">{t("Chọn buổi học")}</option>
        {sessions.map((item) => <option key={item.id} value={item.id}>{classes.find((courseClass) => courseClass.id === item.class)?.name || t('Lớp')} · {fmtDateTime(item.starts_at)} · {item.topic}</option>)}
      </select>
    </div>
    {loading ? <div className="skeleton" data-h="row" /> : !selected ? <div className="empty">{t("Chưa có buổi học.")}</div> : <>
      <div className="row wrap u-margin-12-0">
        <div>
          <strong>{selectedClass?.name || t('Lớp học')} · {selected.topic}</strong>
          <div className="small muted">{fmtDateTime(selected.starts_at)} – {fmtDateTime(selected.ends_at)} · {statusLabel(selected.status)}{selected.teacher_name ? ` · Giáo viên: ${selected.teacher_name}` : ''}</div>
        </div>
        <span className="grow" />
        {selected.status === 'scheduled' && canComplete && <button className="btn btn-primary btn-sm" type="button" disabled={busy} onClick={() => onTransition(selected, 'completed')}>{t("Chốt buổi học")}</button>}
        {selected.status === 'scheduled' && canCancel && <button className="btn btn-ghost btn-sm" type="button" disabled={busy} onClick={() => onTransition(selected, 'cancelled')}>{t("Hủy buổi")}</button>}
      </div>
      {selected.status === 'cancelled' ? <div className="empty">{t("Buổi học đã hủy.")}</div> : roster.length === 0 ? <div className="empty">{t("Lớp chưa có học viên đang ghi danh.")}</div> : <AttendanceRosterTable roster={roster} marks={marks} parties={parties} busy={busy} sessionStatus={selected.status} attendanceLabels={attendanceLabels} onSave={onSaveAttendance} t={t} />}
      <p className="small muted">{t('Đã ghi nhận {marked}/{total} học viên. Chỉ có thể điểm danh từ giờ bắt đầu; cần ghi nhận đủ học viên để chốt buổi.').replace('{marked}', String(markedCount)).replace('{total}', String(roster.length))}</p>
    </>}
  </section>;
}
