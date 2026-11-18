import React, { useEffect, useState } from 'react';
import { statusLabel } from '../../../lib/i18n.js';
import { recordLabel } from '../../../lib/state.js';

export default function GradebookSection({ canRead, canCreate, canUpdate, classes, gradeClass, gradeTerm, gradeSubject, gradeRoster, gradeMap, parties, busy, onGradeClassChange, onGradeTermChange, onGradeSubjectChange, onSave, t }) {
  if (!canRead) return null;
  return (
<section className="card card-pad u-mt-20" ><div className="row wrap"><div><h2>{t("Sổ điểm")}</h2><p className="small muted">{t("Quản lý điểm theo lớp, học kỳ và môn; mỗi học viên có một điểm cho từng môn trong mỗi kỳ.")}</p></div></div>
      <div className="form-grid u-mb-14" >
        <label className="field"><span className="label">{t("Lớp *")}</span><select className="select" value={gradeClass} onChange={(event) => onGradeClassChange(event.target.value)}><option value="">{t("Chọn lớp")}</option>{classes.map((item) => <option key={item.id} value={item.id}>{item.name}{item.subject ? ` · ${item.subject}` : ''}</option>)}</select></label>
        <label className="field"><span className="label">{t("Học kỳ *")}</span><input className="input" required value={gradeTerm} onChange={(event) => onGradeTermChange(event.target.value)} placeholder={t('Ví dụ: 2026-2027 / HK1')} /></label>
        <label className="field"><span className="label">{t("Môn học *")}</span><input className="input" required value={gradeSubject} onChange={(event) => onGradeSubjectChange(event.target.value)} placeholder={t('Ví dụ: Toán')} /></label>
      </div>
      {!gradeClass ? <div className="empty">{t("Chọn lớp để mở sổ điểm.")}</div> : gradeRoster.length === 0 ? <div className="empty">{t("Lớp chưa có học viên đang hoặc đã hoàn thành ghi danh.")}</div> : <div className="table-wrap"><table className="table"><thead><tr><th>{t("Mã học viên")}</th><th>{t("Học viên")}</th><th>{t("Trạng thái ghi danh")}</th><th>{t("Điểm (0–100)")}</th><th>{t("Thao tác")}</th></tr></thead><tbody>{gradeRoster.map(({ enrollment, student }) => { const party = parties.get(student?.party); const grade = gradeMap.get(enrollment.id); return <GradeRow key={enrollment.id} enrollment={enrollment} student={student} party={party} grade={grade} busy={busy} canCreate={canCreate} canUpdate={canUpdate} onSave={onSave} t={t} />; })}</tbody></table></div>}
    </section>
  );
}

function GradeRow({ enrollment, student, party, grade, busy, canCreate, canUpdate, onSave, t }) {
  const [score, setScore] = useState(grade?.score == null ? '' : String(grade.score));
  useEffect(() => setScore(grade?.score == null ? '' : String(grade.score)), [grade?.id, grade?.score]);
  const allowed = enrollment.status === 'active' && (grade ? canUpdate : canCreate);
  return <tr><td>{student?.student_code || '—'}</td><td>{party ? recordLabel('master-data.party', party) : t('Học viên')}</td><td>{statusLabel(enrollment.status)}</td><td><input className="input num" aria-label={`${t('Điểm')} ${student?.student_code || ''}`} type="number" min="0" max="100" step="any" value={score} disabled={!allowed} onChange={(event) => setScore(event.target.value)} /></td><td>{allowed ? <button className="btn btn-primary btn-sm" type="button" disabled={busy || !score.trim()} onClick={() => onSave(enrollment.id, score)}>{grade ? t('Cập nhật điểm') : t('Lưu điểm')}</button> : grade ? <span className="small muted">{t("Chỉ xem")}</span> : <span className="small muted">{t("Không thể nhập điểm")}</span>}</td></tr>;
}
