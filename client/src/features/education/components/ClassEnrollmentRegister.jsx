import React from 'react';

export default function ClassEnrollmentRegister({
  classes,
  enrollmentClassOptions,
  eligibleEnrollmentStudents,
  parties,
  recordLabel,
  enrollmentForm,
  enrollmentClass,
  enrollmentRoster,
  enrollmentRosterHint,
  busy,
  loading,
  canCreateEnrollment,
  enrollmentActions,
  statusLabel,
  onEnrollmentClassChange,
  onFormClassChange,
  onFormStudentChange,
  onCreateEnrollment,
  onChangeEnrollment,
  t,
}) {
  return <section className="card card-pad u-mt-20" ><div className="row wrap"><div><h2>{t("Ghi danh lớp học")}</h2><p className="small muted">{t("Quản lý sĩ số, rút ghi danh hoặc chốt hoàn thành khóa học.")}</p></div><span className="grow"/><select className="select" aria-label={t('Lớp cần quản lý ghi danh')} value={enrollmentClass} onChange={(event) => onEnrollmentClassChange(event.target.value)}><option value="">{t("Chọn lớp")}</option>{classes.map((item) => <option key={item.id} value={item.id}>{item.name}{item.subject ? ` · ${item.subject}` : ''}</option>)}</select></div>
      {canCreateEnrollment && <form className="form-grid u-margin-14-0-20"  onSubmit={onCreateEnrollment}><label className="field"><span className="label">{t("Lớp *")}</span><select className="select" required value={enrollmentForm.class} onChange={(event) => onFormClassChange(event.target.value)}><option value="">{t("Chọn lớp")}</option>{enrollmentClassOptions.map((item) => <option key={item.id} value={item.id}>{item.name}{item.capacity ? ` · ${item.activeCount}/${item.capacity}` : ''}</option>)}</select></label><label className="field"><span className="label">{t("Học viên *")}</span><select className="select" required value={enrollmentForm.student} onChange={(event) => onFormStudentChange(event.target.value)}><option value="">{t("Chọn học viên")}</option>{eligibleEnrollmentStudents.map((student) => <option key={student.id} value={student.id}>{parties.get(student.party) ? recordLabel('master-data.party', parties.get(student.party)) : student.student_code || t('Học viên')}{student.student_code ? ` · ${student.student_code}` : ''}</option>)}</select></label><div className="row full"><span className="grow small muted">{enrollmentRosterHint}</span><button className="btn btn-primary" type="submit" disabled={busy || loading || !enrollmentForm.class || !enrollmentForm.student}>Ghi danh</button></div></form>}
      {!enrollmentClass ? <div className="empty">{t("Chọn lớp để xem danh sách ghi danh.")}</div> : !enrollmentRoster.length ? <div className="empty">{t("Lớp chưa có ghi danh.")}</div> : <div className="table-wrap"><table className="table"><thead><tr><th>{t("Mã học viên")}</th><th>{t("Học viên")}</th><th>{t("Trạng thái")}</th><th>{t("Thao tác")}</th></tr></thead><tbody>{enrollmentRoster.map(({ enrollment, student }) => <tr key={enrollment.id}><td>{student?.student_code || '—'}</td><td>{student && parties.get(student.party) ? recordLabel('master-data.party', parties.get(student.party)) : t('Học viên')}</td><td>{statusLabel(enrollment.status)}</td><td><div className="row wrap">{enrollmentActions(enrollment).canDrop && <button className="btn btn-ghost btn-sm" type="button" disabled={busy} onClick={() => onChangeEnrollment(enrollment, 'dropped')}>{t("Rút ghi danh")}</button>}{enrollmentActions(enrollment).canComplete && <button className="btn btn-secondary btn-sm" type="button" disabled={busy} onClick={() => onChangeEnrollment(enrollment, 'completed')}>{t("Hoàn thành khóa học")}</button>}</div></td></tr>)}</tbody></table></div>}
    </section>
;}