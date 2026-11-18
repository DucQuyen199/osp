import React, { useMemo } from 'react';
import { useDocumentTitle } from '../../lib/useDocumentTitle.js';
import { localDate as formatLocalDate } from '../../lib/dates.js';
import { fmtDate, fmtMoney, statusLabel, uiTextWith } from '../../lib/i18n.js';
import { can, recordLabel } from '../../lib/state.js';
import educationEnglish from './education.en.js';
import ClassSessionRegister from './components/ClassSessionRegister.jsx';
import StudentIntakeForm from './components/StudentIntakeForm.jsx';
import TuitionLedgerTable from './components/TuitionLedgerTable.jsx';
import GradebookSection from './components/GradebookSection.jsx';
import CourseClassForm from './components/CourseClassForm.jsx';
import ClassSessionForm from './components/ClassSessionForm.jsx';
import TuitionBatchPanel from './components/TuitionBatchPanel.jsx';
import ClassEnrollmentRegister from './components/ClassEnrollmentRegister.jsx';
import { useEducationWorkbenchData } from './hooks/useEducationWorkbenchData.js';
import { useEducationWorkbenchWorkflow } from './hooks/useEducationWorkbenchWorkflow.js';
const t = (text) => uiTextWith(text, educationEnglish);
const localDate = formatLocalDate;
const attendanceLabels = { present: t("Có mặt"), absent: t("Vắng"), late: t("Đi muộn"), excused: t("Có phép") };
export default function EducationWorkbenchPage() {
  useDocumentTitle(t("Lịch lớp và điểm danh · OSP Suite"));
  const data = useEducationWorkbenchData();
  const { classes, enrollments, students, parties, employees, sessions, attendance, grades, fees, tuitionBatches, invoices, loading, error: dataError, load } = data;
  const {
    selectedId, setSelectedId, enrollmentForm, setEnrollmentForm, enrollmentClass, setEnrollmentClass,
    gradeClass, setGradeClass, gradeTerm, setGradeTerm, gradeSubject, setGradeSubject,
    feeForm, setFeeForm, tuitionBatchForm, setTuitionBatchForm, classForm, setClassForm,
    studentForm, setStudentForm, pendingStudentParty, form, setForm, busy, error, notice,
    marks, gradeMap, createFee, createTuitionBatch, generateTuitionBatch, createClass, createStudent,
    issueFee, createSession, createEnrollment, changeEnrollment, saveMark, saveGrade, transition,
  } = useEducationWorkbenchWorkflow({ data, t });
  const selected = sessions.find((session) => session.id === selectedId);
  const selectedClass = classes.find((item) => item.id === selected?.class);
  const roster = useMemo(() => enrollments.filter((item) => item.class === selected?.class && item.status === 'active')
    .map((enrollment) => ({ enrollment, student: students.get(enrollment.student) }))
    .sort((a, b) => studentName(a.student, parties).localeCompare(studentName(b.student, parties), 'vi')), [enrollments, parties, selected, students]);
  const gradeRoster = useMemo(() => enrollments.filter((item) => item.class === gradeClass && ['active', 'completed'].includes(item.status))
    .map((enrollment) => ({ enrollment, student: students.get(enrollment.student) }))
    .sort((a, b) => studentName(a.student, parties).localeCompare(studentName(b.student, parties), 'vi')), [enrollments, gradeClass, parties, students]);
  const studentById = useMemo(() => new Map([...students.values()].map((student) => [student.id, student])), [students]);
  const enrollmentById = useMemo(() => new Map(enrollments.map((enrollment) => [enrollment.id, enrollment])), [enrollments]);
  const classById = useMemo(() => new Map(classes.map((courseClass) => [courseClass.id, courseClass])), [classes]);
  const invoiceByFee = useMemo(() => new Map(invoices.filter((invoice) => invoice.source === 'school_fee').map((invoice) => [invoice.source_id, invoice])), [invoices]);
  const selectedFeeEnrollment = enrollmentById.get(feeForm.enrollment);
  const selectedFeeClass = classById.get(selectedFeeEnrollment?.class);
  const selectedEnrollmentClass = classById.get(enrollmentForm.class);
  const enrollmentRoster = useMemo(() => enrollments.filter((item) => item.class === enrollmentClass)
    .map((enrollment) => ({ enrollment, student: students.get(enrollment.student) }))
    .sort((a, b) => studentName(a.student, parties).localeCompare(studentName(b.student, parties), 'vi')), [enrollments, enrollmentClass, parties, students]);
  const activeEnrollmentStudents = new Set(enrollments.filter((item) => item.class === enrollmentForm.class && item.status === 'active').map((item) => item.student));
  const eligibleEnrollmentStudents = [...students.values()].filter((item) => !activeEnrollmentStudents.has(item.id));
  const enrollmentClassOptions = classes.map((item) => ({
    ...item,
    activeCount: enrollments.filter((row) => row.class === item.id && row.status === 'active').length,
  }));
  const enrollmentRosterHint = enrollmentForm.class && selectedEnrollmentClass?.capacity
    ? `Sĩ số hiện tại: ${enrollments.filter((row) => row.class === enrollmentForm.class && row.status === 'active').length}/${selectedEnrollmentClass.capacity}`
    : t('Hệ thống sẽ kiểm tra trùng ghi danh và sức chứa khi lưu.');
  const enrollmentActions = (enrollment) => ({
    canDrop: enrollment.status === 'active' && can('school.class_enrollment.dropped'),
    canComplete: enrollment.status === 'active' && can('school.class_enrollment.completed'),
  });
  return <div className="page">
    <div className="page-head"><div><h1>{t("Lịch lớp và điểm danh")}</h1><p className="sub">{t("Lên lịch buổi học, ghi nhận từng học viên và chốt danh sách sau khi buổi học kết thúc.")}</p></div><button className="btn btn-secondary" type="button" disabled={loading || busy} onClick={load}>{t("Làm mới")}</button></div>
    {(error || dataError) && <div className="alert danger" role="alert">{t(error || dataError)}</div>}{notice && <div className="alert success" role="status">{t(notice)}</div>}
    <div className="grid-2 u-mt-20" >
      {can('school.course_class.create') && <CourseClassForm
        classForm={classForm}
        employees={employees}
        showEmployee={can('hrm.employee.read')}
        busy={busy}
        loading={loading}
        recordLabel={recordLabel}
        onChange={(field, value) => setClassForm((current) => ({ ...current, [field]: value }))}
        onSubmit={createClass}
        t={t}
      />}
      {can('school.student.create') && can('master-data.party.create') && <StudentIntakeForm
        student={studentForm}
        pendingParty={pendingStudentParty}
        busy={busy}
        loading={loading}
        onChange={(field, value) => setStudentForm((current) => ({ ...current, [field]: value }))}
        onSubmit={createStudent}
        t={t}
      />}
    </div>
    {can('school.class_session.create') && <ClassSessionForm
      classes={classes}
      employees={employees}
      recordLabel={recordLabel}
      form={form}
      busy={busy}
      loading={loading}
      onChange={(field, value) => setForm((current) => ({ ...current, [field]: value }))}
      onSubmit={createSession}
      t={t}
    />}
    {can('school.class_enrollment.read') && <ClassEnrollmentRegister
      classes={classes} enrollmentClassOptions={enrollmentClassOptions}
      eligibleEnrollmentStudents={eligibleEnrollmentStudents} parties={parties} recordLabel={recordLabel}
      enrollmentForm={enrollmentForm} enrollmentClass={enrollmentClass} enrollmentRoster={enrollmentRoster}
      enrollmentRosterHint={enrollmentRosterHint} busy={busy} loading={loading}
      canCreateEnrollment={can('school.class_enrollment.create') && can('school.course_class.read') && can('school.student.read')}
      enrollmentActions={enrollmentActions} statusLabel={statusLabel}
      onEnrollmentClassChange={setEnrollmentClass}
      onFormClassChange={(classId) => setEnrollmentForm((current) => ({ ...current, class: classId, student: '' }))}
      onFormStudentChange={(studentId) => setEnrollmentForm((current) => ({ ...current, student: studentId }))}
      onCreateEnrollment={createEnrollment} onChangeEnrollment={changeEnrollment} t={t}
    />}
    <ClassSessionRegister
      sessions={sessions}
      classes={classes}
      selectedId={selectedId}
      selected={selected}
      selectedClass={selectedClass}
      loading={loading}
      busy={busy}
      roster={roster}
      marks={marks}
      parties={parties}
      attendanceLabels={attendanceLabels}
      canComplete={can('school.class_session.completed')}
      canCancel={can('school.class_session.cancelled')}
      markedCount={roster.filter(({ enrollment }) => marks.has(enrollment.id)).length}
      onSelect={setSelectedId}
      onTransition={transition}
      onSaveAttendance={saveMark}
      t={t}
    />
    <GradebookSection canRead={can('school.grade.read')} canCreate={can('school.grade.create')} canUpdate={can('school.grade.update')} classes={classes} gradeClass={gradeClass} gradeTerm={gradeTerm} gradeSubject={gradeSubject} gradeRoster={gradeRoster} gradeMap={gradeMap} parties={parties} busy={busy} onGradeClassChange={setGradeClass} onGradeTermChange={setGradeTerm} onGradeSubjectChange={setGradeSubject} onSave={saveGrade} t={t} />
    {can('school.fee.read') && <section className="card card-pad u-mt-20" ><div className="row wrap"><div><h2>{t("Sổ học phí")}</h2><p className="small muted">{t("Học phí phát hành sẽ tạo hóa đơn phải thu. Khi hóa đơn được thanh toán đủ, trạng thái khoản học phí tự chuyển sang đã thu.")}</p></div><span className="grow"/><span className="badge warning">{fees.filter((fee) => fee.status === 'issued').length} {t('chưa thu đủ')}</span></div>
      {can('school.tuition_batch.create') && <TuitionBatchPanel
        classes={classes.filter((item) => Number(item.tuition) > 0)}
        enrollments={enrollments}
        tuitionBatches={tuitionBatches}
        classById={classById}
        form={tuitionBatchForm}
        canCreate={can('school.tuition_batch.create')}
        canRead={can('school.tuition_batch.read')}
        canGenerate={can('school.tuition_batch.generated')}
        busy={busy}
        loading={loading}
        onFormChange={(field, value) => setTuitionBatchForm((current) => ({ ...current, [field]: value }))}
        onSubmit={createTuitionBatch}
        onGenerate={generateTuitionBatch}
        fmtDate={fmtDate}
        fmtMoney={fmtMoney}
        statusLabel={statusLabel}
        t={t}
      />}
      {can('school.fee.create') && <form className="form-grid u-margin-14-0-20"  onSubmit={createFee}>
        <label className="field"><span className="label">{t("Ghi danh (tùy chọn)")}</span><select className="select" value={feeForm.enrollment} onChange={(event) => { const enrollment = enrollmentById.get(event.target.value); setFeeForm((current) => ({ ...current, enrollment: event.target.value, student: enrollment?.student || current.student })); }}><option value="">{t("Khoản thu khác / chưa gắn lớp")}</option>{enrollments.filter((item) => item.status === 'active').map((item) => { const student = studentById.get(item.student); const party = parties.get(student?.party); const courseClass = classById.get(item.class); return <option key={item.id} value={item.id}>{party ? recordLabel('master-data.party', party) : student?.student_code || t('Học viên')} · {courseClass?.name || t('Lớp')}</option>; })}</select></label>
        {!feeForm.enrollment && <label className="field"><span className="label">{t("Học viên *")}</span><select className="select" required value={feeForm.student} onChange={(event) => setFeeForm((current) => ({ ...current, student: event.target.value }))}><option value="">{t("Chọn học viên")}</option>{[...students.values()].map((student) => <option key={student.id} value={student.id}>{parties.get(student.party) ? recordLabel('master-data.party', parties.get(student.party)) : student.student_code || t('Học viên')}</option>)}</select></label>}
        {feeForm.enrollment ? <label className="field"><span className="label">{t("Học phí lớp")}</span><input className="input num" readOnly value={selectedFeeClass?.tuition == null ? t('Chưa cấu hình') : fmtMoney(selectedFeeClass.tuition)} /></label> : <label className="field"><span className="label">{t("Số tiền *")}</span><input className="input num" type="number" min="0.01" step="any" required value={feeForm.amount} onChange={(event) => setFeeForm((current) => ({ ...current, amount: event.target.value }))} /></label>}
        {feeForm.enrollment && <label className="field"><span className="label">{t("Kỳ học phí *")}</span><input className="input" required value={feeForm.period} onChange={(event) => setFeeForm((current) => ({ ...current, period: event.target.value }))} placeholder={t('Ví dụ: 2026-HK1 hoặc 2026-11')} /></label>}
        <label className="field"><span className="label">{t("Hạn thanh toán")}</span><input className="input" type="date" min={localDate()} value={feeForm.due_date} onChange={(event) => setFeeForm((current) => ({ ...current, due_date: event.target.value }))} /></label>
        <label className="field"><span className="label">{t("Nội dung thu")}</span><input className="input" maxLength="240" value={feeForm.note} onChange={(event) => setFeeForm((current) => ({ ...current, note: event.target.value }))} placeholder={feeForm.enrollment ? t('Học phí lớp {class}').replace('{class}', selectedFeeClass?.name || t('lớp học')) : t('Ví dụ: tài liệu học tập')} /></label>
        <div className="row full"><span className="grow"/><button className="btn btn-primary" disabled={busy || loading || !feeForm.student || (feeForm.enrollment && !selectedFeeClass?.tuition)}>{t("Tạo khoản học phí nháp")}</button></div>
      </form>}
      <TuitionLedgerTable fees={fees} loading={loading} studentById={studentById} parties={parties} invoiceByFee={invoiceByFee} busy={busy} canIssue={can('school.fee.issued')} onIssue={issueFee} recordLabel={recordLabel} t={t} />
    </section>}
  </div>;
}
function studentName(student, parties) {
  const party = student && parties.get(student.party);
  return party ? recordLabel('master-data.party', party) : student?.student_code || '';
}
