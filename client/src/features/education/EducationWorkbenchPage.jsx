import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { localDate as formatLocalDate, localDateTime as businessDateTime, localDateTimeToIso } from '../../lib/dates.js';
import { api, dataPath } from '../../lib/api.js';
import { fmtDate, fmtDateTime, fmtMoney, statusLabel, uiTextWith } from '../../lib/i18n.js';
import { can, loadRefs, recordLabel, loadAllResponse } from '../../lib/state.js';
import educationEnglish from './education.en.js';
import AttendanceRosterTable from './components/AttendanceRosterTable.jsx';
import StudentIntakeForm from './components/StudentIntakeForm.jsx';
import TuitionLedgerTable from './components/TuitionLedgerTable.jsx';
import GradebookSection from './components/GradebookSection.jsx';

const t = (text) => uiTextWith(text, educationEnglish);

const localDate = formatLocalDate;
const attendanceLabels = { present: t("Có mặt"), absent: t("Vắng"), late: t("Đi muộn"), excused: t("Có phép") };
const sessionDate = () => businessDateTime(new Date(Date.now() + 60 * 60 * 1000));

export default function EducationWorkbenchPage() {
  const [classes, setClasses] = useState([]);
  const [enrollments, setEnrollments] = useState([]);
  const [students, setStudents] = useState(new Map());
  const [parties, setParties] = useState(new Map());
  const [employees, setEmployees] = useState(new Map());
  const [sessions, setSessions] = useState([]);
  const [attendance, setAttendance] = useState([]);
  const [grades, setGrades] = useState([]);
  const [fees, setFees] = useState([]);
  const [tuitionBatches, setTuitionBatches] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [enrollmentForm, setEnrollmentForm] = useState({ class: '', student: '' });
  const [enrollmentClass, setEnrollmentClass] = useState('');
  const [gradeClass, setGradeClass] = useState('');
  const [gradeTerm, setGradeTerm] = useState('');
  const [gradeSubject, setGradeSubject] = useState('');
  const [feeForm, setFeeForm] = useState({ student: '', enrollment: '', period: '', amount: '', due_date: '', note: '' });
  const [tuitionBatchForm, setTuitionBatchForm] = useState({ class: '', period: '', due_date: localDate() });
  const [classForm, setClassForm] = useState({ name: '', subject: '', teacher: '', teacher_employee: '', start_date: '', capacity: '', tuition: '' });
  const [studentForm, setStudentForm] = useState({ name: '', student_code: '', dob: '', guardian: '', phone: '', email: '' });
  const [pendingStudentParty, setPendingStudentParty] = useState(null);
  const [form, setForm] = useState({ class: '', topic: '', starts_at: sessionDate(), ends_at: businessDateTime(new Date(Date.now() + 2 * 60 * 60 * 1000)) });
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [classRes, enrollmentRes, studentRes, partyMap, employeeMap, sessionRes, attendanceRes, gradeRes, feeRes, tuitionBatchRes, invoiceRes] = await Promise.all([
        can('school.course_class.read') ? loadAllResponse('school.course_class') : Promise.resolve({ items: [] }),
        can('school.class_enrollment.read') ? loadAllResponse('school.class_enrollment') : Promise.resolve({ items: [] }),
        can('school.student.read') ? loadAllResponse('school.student') : Promise.resolve({ items: [] }),
        can('master-data.party.read') ? loadRefs('master-data.party') : Promise.resolve(new Map()),
        can('hrm.employee.read') ? loadRefs('hrm.employee') : Promise.resolve(new Map()),
        can('school.class_session.read') ? loadAllResponse('school.class_session') : Promise.resolve({ items: [] }),
        can('school.attendance.read') ? loadAllResponse('school.attendance') : Promise.resolve({ items: [] }),
        can('school.grade.read') ? loadAllResponse('school.grade') : Promise.resolve({ items: [] }),
        can('school.fee.read') ? loadAllResponse('school.fee') : Promise.resolve({ items: [] }),
        can('school.tuition_batch.read') ? loadAllResponse('school.tuition_batch') : Promise.resolve({ items: [] }),
        can('accounting.invoice.read') ? loadAllResponse('accounting.invoice') : Promise.resolve({ items: [] }),
      ]);
      const classItems = classRes.items || []; const sessionItems = sessionRes.items || [];
      setClasses(classItems); setEnrollments(enrollmentRes.items || []); setStudents(new Map((studentRes.items || []).map((x) => [x.id, x])));
      setParties(partyMap); setEmployees(employeeMap); setSessions(sessionItems.sort((a, b) => String(b.starts_at).localeCompare(String(a.starts_at))));
      setAttendance(attendanceRes.items || []);
      setGrades(gradeRes.items || []);
      setFees(feeRes.items || []); setTuitionBatches(tuitionBatchRes.items || []); setInvoices(invoiceRes.items || []);
      setForm((current) => ({ ...current, class: current.class || classItems[0]?.id || '' }));
      setEnrollmentForm((current) => ({ ...current, class: current.class || classItems[0]?.id || '', student: current.student || studentRes.items?.[0]?.id || '' }));
      setEnrollmentClass((current) => current || classItems[0]?.id || '');
      setGradeClass((current) => current || classItems[0]?.id || '');
      setSelectedId((current) => current && sessionItems.some((x) => x.id === current) ? current : sessionItems[0]?.id || '');
      setFeeForm((current) => ({ ...current, student: current.student || studentRes.items?.[0]?.id || '' }));
      setTuitionBatchForm((current) => ({ ...current, class: classItems.some((item) => item.id === current.class) ? current.class : classItems.find((item) => Number(item.tuition) > 0)?.id || '' }));
    } catch (reason) { setError(reason.message || t("Không tải được dữ liệu lớp học.")); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { document.title = t("Lịch lớp và điểm danh · OSP Suite"); load(); }, [load]);
  const selected = sessions.find((session) => session.id === selectedId);
  const selectedClass = classes.find((item) => item.id === selected?.class);
  const roster = useMemo(() => enrollments.filter((item) => item.class === selected?.class && item.status === 'active')
    .map((enrollment) => ({ enrollment, student: students.get(enrollment.student) }))
    .sort((a, b) => studentName(a.student, parties).localeCompare(studentName(b.student, parties), 'vi')), [enrollments, parties, selected, students]);
  const marks = useMemo(() => new Map(attendance.filter((item) => item.session === selectedId).map((item) => [item.enrollment, item])), [attendance, selectedId]);
  const gradeRoster = useMemo(() => enrollments.filter((item) => item.class === gradeClass && ['active', 'completed'].includes(item.status))
    .map((enrollment) => ({ enrollment, student: students.get(enrollment.student) }))
    .sort((a, b) => studentName(a.student, parties).localeCompare(studentName(b.student, parties), 'vi')), [enrollments, gradeClass, parties, students]);
  const gradeMap = useMemo(() => new Map(grades.filter((grade) => grade.term?.trim().toLocaleLowerCase() === gradeTerm.trim().toLocaleLowerCase()
    && grade.subject?.trim().toLocaleLowerCase() === gradeSubject.trim().toLocaleLowerCase()).map((grade) => [grade.enrollment, grade])), [grades, gradeSubject, gradeTerm]);
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

  async function createFee(event) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      const body = {
        student: selectedFeeEnrollment?.student || feeForm.student,
        ...(feeForm.enrollment ? { enrollment: feeForm.enrollment, period: feeForm.period.trim() } : { amount: Number(feeForm.amount) }),
        ...(feeForm.due_date ? { due_date: feeForm.due_date } : {}),
        ...(feeForm.note.trim() ? { note: feeForm.note.trim() } : {}),
      };
      await api(dataPath('school.fee'), { method: 'POST', body });
      setNotice(t("Đã tạo khoản học phí nháp. Kiểm tra thông tin rồi phát hành để tạo hóa đơn kế toán."));
      setFeeForm((current) => ({ ...current, period: '', amount: '', note: '' })); await load();
    } catch (reason) { setError(reason.message || t("Không thể tạo khoản học phí.")); }
    finally { setBusy(false); }
  }

  async function createTuitionBatch(event) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      await api(dataPath('school.tuition_batch'), { method: 'POST', body: { ...tuitionBatchForm, period: tuitionBatchForm.period.trim(), status: 'draft' } });
      setNotice(t("Đã tạo đợt học phí nháp. Rà soát rồi chạy để tạo các khoản thu còn thiếu."));
      setTuitionBatchForm((current) => ({ ...current, period: '' })); await load();
    } catch (reason) { setError(reason.message || t("Không thể tạo đợt học phí.")); }
    finally { setBusy(false); }
  }

  async function generateTuitionBatch(batch) {
    setBusy(batch.id); setError(''); setNotice('');
    try {
      await api(dataPath('school.tuition_batch', batch.id, 'generated'), { method: 'POST' });
      setNotice(t("Đã tạo khoản học phí nháp cho các học viên đang ghi danh; khoản đã có được bỏ qua.")); await load();
    } catch (reason) { setError(reason.message || t("Không thể chạy đợt học phí.")); await load(); }
    finally { setBusy(false); }
  }

  async function createClass(event) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      const body = {
        name: classForm.name.trim(),
        ...(classForm.subject.trim() ? { subject: classForm.subject.trim() } : {}),
        ...(classForm.teacher.trim() ? { teacher: classForm.teacher.trim() } : {}),
        ...(classForm.teacher_employee ? { teacher_employee: classForm.teacher_employee } : {}),
        ...(classForm.start_date ? { start_date: classForm.start_date } : {}),
        ...(classForm.capacity ? { capacity: Number(classForm.capacity) } : {}),
        ...(classForm.tuition ? { tuition: Number(classForm.tuition) } : {}),
      };
      await api(dataPath('school.course_class'), { method: 'POST', body });
      setNotice(t("Đã tạo lớp học.")); setClassForm({ name: '', subject: '', teacher: '', teacher_employee: '', start_date: '', capacity: '', tuition: '' }); await load();
    } catch (reason) { setError(reason.message || t("Không thể tạo lớp học.")); }
    finally { setBusy(false); }
  }

  async function createStudent(event) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      let partyId = pendingStudentParty?.id;
      if (!partyId) {
        const party = await api(dataPath('master-data.party'), { method: 'POST', body: {
          name: studentForm.name.trim(), kind: 'person', is_customer: true,
          ...(studentForm.phone.trim() ? { phone: studentForm.phone.trim() } : {}),
          ...(studentForm.email.trim() ? { email: studentForm.email.trim() } : {}),
        } });
        partyId = party.id;
        setPendingStudentParty({ id: party.id, name: party.name || studentForm.name.trim() });
      }
      await api(dataPath('school.student'), { method: 'POST', body: {
        party: partyId,
        ...(studentForm.student_code.trim() ? { student_code: studentForm.student_code.trim() } : {}),
        ...(studentForm.dob ? { dob: studentForm.dob } : {}),
        ...(studentForm.guardian.trim() ? { guardian: studentForm.guardian.trim() } : {}),
      } });
      setPendingStudentParty(null); setNotice(t("Đã tạo hồ sơ học viên."));
      setStudentForm({ name: '', student_code: '', dob: '', guardian: '', phone: '', email: '' }); await load();
    } catch (reason) { setError(reason.message || t("Không thể tạo hồ sơ học viên.")); }
    finally { setBusy(false); }
  }

  async function issueFee(fee) {
    setBusy(fee.id); setError(''); setNotice('');
    try {
      await api(dataPath('school.fee', fee.id, 'issued'), { method: 'POST' });
      setNotice(t("Đã phát hành học phí và tạo hóa đơn phải thu trong cùng giao dịch.")); await load();
    } catch (reason) { setError(reason.message || t("Không thể phát hành học phí.")); await load(); }
    finally { setBusy(false); }
  }

  async function createSession(event) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      const startsAt = localDateTimeToIso(form.starts_at);
      const endsAt = localDateTimeToIso(form.ends_at);
      if (!startsAt || !endsAt) throw new Error(t("Giờ học không hợp lệ trong múi giờ kinh doanh."));
      await api(dataPath('school.class_session'), { method: 'POST', body: { ...form, starts_at: startsAt, ends_at: endsAt, status: 'scheduled' } });
      setNotice(t("Đã lên lịch buổi học.")); setForm((current) => ({ ...current, topic: '' })); await load();
    } catch (reason) { setError(reason.message || t("Không thể lên lịch buổi học.")); }
    finally { setBusy(false); }
  }

  async function createEnrollment(event) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      await api(dataPath('school.class_enrollment'), { method: 'POST', body: { class: enrollmentForm.class, student: enrollmentForm.student, status: 'active' } });
      setNotice(t("Student enrolled in the selected class."));
      setEnrollmentForm((current) => ({ ...current, student: '' })); await load();
    } catch (reason) { setError(reason.message || t("Could not enroll this student.")); }
    finally { setBusy(false); }
  }

  async function changeEnrollment(enrollment, action) {
    setBusy(enrollment.id); setError(''); setNotice('');
    try {
      await api(dataPath('school.class_enrollment', enrollment.id, action), { method: 'POST' });
      setNotice(action === 'dropped' ? t('Enrollment withdrawn.') : t('Enrollment completed.')); await load();
    } catch (reason) { setError(reason.message || t("Could not update this enrollment.")); }
    finally { setBusy(false); }
  }

  async function saveMark(enrollmentId, status) {
    setBusy(true); setError(''); setNotice('');
    try {
      const existing = marks.get(enrollmentId);
      if (existing) await api(dataPath('school.attendance', existing.id), { method: 'PATCH', body: { status } });
      else await api(dataPath('school.attendance'), { method: 'POST', body: { session: selectedId, enrollment: enrollmentId, status } });
      setNotice(t("Đã lưu điểm danh.")); await load();
    } catch (reason) { setError(reason.message || t("Không thể lưu điểm danh.")); }
    finally { setBusy(false); }
  }

  async function saveGrade(enrollmentId, score) {
    const term = gradeTerm.trim(); const subject = gradeSubject.trim(); const numericScore = Number(score);
    if (!term || !subject || score === '' || !Number.isFinite(numericScore) || numericScore < 0 || numericScore > 100) {
      setError(t("Hãy nhập học kỳ, môn học và điểm từ 0 đến 100.")); return;
    }
    setBusy(true); setError(''); setNotice('');
    try {
      const existing = gradeMap.get(enrollmentId);
      const body = { enrollment: enrollmentId, term, subject, score: numericScore };
      if (existing) await api(dataPath('school.grade', existing.id), { method: 'PATCH', body: { term, subject, score: numericScore } });
      else await api(dataPath('school.grade'), { method: 'POST', body });
      setNotice(t("Đã lưu điểm học viên.")); await load();
    } catch (reason) { setError(reason.message || t("Không thể lưu điểm học viên.")); }
    finally { setBusy(false); }
  }

  async function transition(session, action) {
    setBusy(true); setError(''); setNotice('');
    try {
      await api(dataPath('school.class_session', session.id, action), { method: 'POST' });
      setNotice(action === 'completed' ? t('Đã chốt buổi học.') : t('Buổi học đã hủy.')); await load();
    } catch (reason) { setError(reason.message || t("Không thể cập nhật buổi học.")); }
    finally { setBusy(false); }
  }

  return <div className="page">
    <div className="page-head"><div><h1>{t("Lịch lớp và điểm danh")}</h1><p className="sub">{t("Lên lịch buổi học, ghi nhận từng học viên và chốt danh sách sau khi buổi học kết thúc.")}</p></div><button className="btn btn-secondary" type="button" disabled={loading || busy} onClick={load}>{t("Làm mới")}</button></div>
    {error && <div className="alert danger" role="alert">{t(error)}</div>}{notice && <div className="alert success" role="status">{t(notice)}</div>}
    <div className="grid-2 u-legacy-eee3f850c9" >
      {can('school.course_class.create') && <section className="card card-pad"><h2>{t("Tạo lớp học")}</h2><form className="form-grid" onSubmit={createClass}>
        <label className="field"><span className="label">{t("Tên lớp *")}</span><input className="input" required maxLength="160" value={classForm.name} onChange={(event) => setClassForm((current) => ({ ...current, name: event.target.value }))} /></label>
        <label className="field"><span className="label">{t("Môn / chương trình")}</span><input className="input" maxLength="160" value={classForm.subject} onChange={(event) => setClassForm((current) => ({ ...current, subject: event.target.value }))} /></label>
        <label className="field"><span className="label">{t("Giáo viên cộng tác")}</span><input className="input" maxLength="160" value={classForm.teacher} onChange={(event) => setClassForm((current) => ({ ...current, teacher: event.target.value }))} /><span className="small muted">{t("Nhập cùng một cách viết để phát hiện lịch trùng khi chưa có hồ sơ nhân sự.")}</span></label>
        {can('hrm.employee.read') && <label className="field"><span className="label">{t("Giáo viên thuộc nhân sự")}</span><select className="select" value={classForm.teacher_employee} onChange={(event) => setClassForm((current) => ({ ...current, teacher_employee: event.target.value }))}><option value="">{t("Không liên kết hồ sơ")}</option>{[...employees.values()].filter((employee) => employee.status === 'active').map((employee) => <option key={employee.id} value={employee.id}>{recordLabel('hrm.employee', employee)}</option>)}</select><span className="small muted">{t("Lịch của nhân viên được đối chiếu chính xác giữa các lớp.")}</span></label>}
        <label className="field"><span className="label">{t("Ngày bắt đầu")}</span><input className="input" type="date" value={classForm.start_date} onChange={(event) => setClassForm((current) => ({ ...current, start_date: event.target.value }))} /></label>
        <label className="field"><span className="label">{t("Sức chứa")}</span><input className="input num" type="number" min="1" step="1" value={classForm.capacity} onChange={(event) => setClassForm((current) => ({ ...current, capacity: event.target.value }))} /></label>
        <label className="field"><span className="label">{t("Học phí mỗi kỳ")}</span><input className="input num" type="number" min="0.01" step="any" value={classForm.tuition} onChange={(event) => setClassForm((current) => ({ ...current, tuition: event.target.value }))} /></label>
        <div className="row full"><span className="grow"/><button className="btn btn-primary" disabled={busy || loading}>{t("Tạo lớp")}</button></div>
      </form></section>}
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
    {can('school.class_session.create') && <section className="card card-pad"><h2>{t("Lên lịch buổi học")}</h2>
      <form className="form-grid" onSubmit={createSession}>
        <label className="field"><span className="label">{t("Lớp *")}</span><select className="select" required value={form.class} onChange={(e) => setForm((x) => ({ ...x, class: e.target.value }))}><option value="">{t("Chọn lớp")}</option>{classes.map((item) => <option key={item.id} value={item.id}>{item.name}{item.subject ? ` · ${item.subject}` : ''}{item.teacher_employee && employees.has(item.teacher_employee) ? ` · ${recordLabel('hrm.employee', employees.get(item.teacher_employee))}` : item.teacher ? ` · ${item.teacher}` : ''}</option>)}</select></label>
        <label className="field"><span className="label">{t("Chủ đề buổi học *")}</span><input className="input" required value={form.topic} onChange={(e) => setForm((x) => ({ ...x, topic: e.target.value }))} /></label>
        <label className="field"><span className="label">{t("Bắt đầu *")}</span><input className="input" type="datetime-local" required value={form.starts_at} onChange={(e) => setForm((x) => ({ ...x, starts_at: e.target.value }))} /></label>
        <label className="field"><span className="label">{t("Kết thúc *")}</span><input className="input" type="datetime-local" required min={form.starts_at} value={form.ends_at} onChange={(e) => setForm((x) => ({ ...x, ends_at: e.target.value }))} /></label>
        <div className="row full"><span className="grow" /><button className="btn btn-primary" disabled={busy || loading || !form.class || !can('school.class_session.create')}>{t("Lên lịch")}</button></div>
      </form>
    </section>}
    {can('school.class_enrollment.read') && <section className="card card-pad u-legacy-eee3f850c9" ><div className="row wrap"><div><h2>{t("Ghi danh lớp học")}</h2><p className="small muted">{t("Quản lý sĩ số, rút ghi danh hoặc chốt hoàn thành khóa học.")}</p></div><span className="grow"/><select className="select" aria-label={t('Lớp cần quản lý ghi danh')} value={enrollmentClass} onChange={(event) => setEnrollmentClass(event.target.value)}><option value="">{t("Chọn lớp")}</option>{classes.map((item) => <option key={item.id} value={item.id}>{item.name}{item.subject ? ` · ${item.subject}` : ''}</option>)}</select></div>
      {can('school.class_enrollment.create') && can('school.course_class.read') && can('school.student.read') && <form className="form-grid u-legacy-9f9b3e4d30"  onSubmit={createEnrollment}><label className="field"><span className="label">{t("Lớp *")}</span><select className="select" required value={enrollmentForm.class} onChange={(event) => setEnrollmentForm((current) => ({ ...current, class: event.target.value, student: '' }))}><option value="">{t("Chọn lớp")}</option>{classes.map((item) => { const count = enrollments.filter((row) => row.class === item.id && row.status === 'active').length; return <option key={item.id} value={item.id}>{item.name}{item.capacity ? ` · ${count}/${item.capacity}` : ''}</option>; })}</select></label><label className="field"><span className="label">{t("Học viên *")}</span><select className="select" required value={enrollmentForm.student} onChange={(event) => setEnrollmentForm((current) => ({ ...current, student: event.target.value }))}><option value="">{t("Chọn học viên")}</option>{eligibleEnrollmentStudents.map((student) => <option key={student.id} value={student.id}>{parties.get(student.party) ? recordLabel('master-data.party', parties.get(student.party)) : student.student_code || t('Học viên')}{student.student_code ? ` · ${student.student_code}` : ''}</option>)}</select></label><div className="row full"><span className="grow small muted">{enrollmentForm.class && selectedEnrollmentClass?.capacity ? `Sĩ số hiện tại: ${enrollments.filter((row) => row.class === enrollmentForm.class && row.status === 'active').length}/${selectedEnrollmentClass.capacity}` : 'Hệ thống sẽ kiểm tra trùng ghi danh và sức chứa khi lưu.'}</span><button className="btn btn-primary" type="submit" disabled={busy || loading || !enrollmentForm.class || !enrollmentForm.student}>Ghi danh</button></div></form>}
      {!enrollmentClass ? <div className="empty">{t("Chọn lớp để xem danh sách ghi danh.")}</div> : !enrollmentRoster.length ? <div className="empty">{t("Lớp chưa có ghi danh.")}</div> : <div className="table-wrap"><table className="table"><thead><tr><th>{t("Mã học viên")}</th><th>{t("Học viên")}</th><th>{t("Trạng thái")}</th><th>{t("Thao tác")}</th></tr></thead><tbody>{enrollmentRoster.map(({ enrollment, student }) => <tr key={enrollment.id}><td>{student?.student_code || '—'}</td><td>{student && parties.get(student.party) ? recordLabel('master-data.party', parties.get(student.party)) : 'Học viên'}</td><td>{statusLabel(enrollment.status)}</td><td><div className="row wrap">{enrollment.status === 'active' && can('school.class_enrollment.dropped') && <button className="btn btn-ghost btn-sm" type="button" disabled={busy} onClick={() => changeEnrollment(enrollment, 'dropped')}>{t("Rút ghi danh")}</button>}{enrollment.status === 'active' && can('school.class_enrollment.completed') && <button className="btn btn-secondary btn-sm" type="button" disabled={busy} onClick={() => changeEnrollment(enrollment, 'completed')}>{t("Hoàn thành khóa học")}</button>}</div></td></tr>)}</tbody></table></div>}
    </section>}
    <section className="card card-pad u-legacy-eee3f850c9" ><div className="row wrap"><h2>{t("Danh sách buổi học")}</h2><span className="grow" /><select className="select" aria-label={t('Chọn buổi học')} value={selectedId} onChange={(e) => setSelectedId(e.target.value)}><option value="">{t("Chọn buổi học")}</option>{sessions.map((item) => <option key={item.id} value={item.id}>{classes.find((c) => c.id === item.class)?.name || t('Lớp')} · {fmtDateTime(item.starts_at)} · {item.topic}</option>)}</select></div>
      {loading ? <div className="skeleton" data-h="row" /> : !selected ? <div className="empty">{t("Chưa có buổi học.")}</div> : <>
        <div className="row wrap u-legacy-0e001e227c" ><div><strong>{selectedClass?.name || t('Lớp học')} · {selected.topic}</strong><div className="small muted">{fmtDateTime(selected.starts_at)} – {fmtDateTime(selected.ends_at)} · {statusLabel(selected.status)}{selected.teacher_name ? ` · Giáo viên: ${selected.teacher_name}` : ''}</div></div><span className="grow" />{selected.status === 'scheduled' && can('school.class_session.completed') && <button className="btn btn-primary btn-sm" type="button" disabled={busy} onClick={() => transition(selected, 'completed')}>{t("Chốt buổi học")}</button>}{selected.status === 'scheduled' && can('school.class_session.cancelled') && <button className="btn btn-ghost btn-sm" type="button" disabled={busy} onClick={() => transition(selected, 'cancelled')}>{t("Hủy buổi")}</button>}</div>
        {selected.status === 'cancelled' ? <div className="empty">{t("Buổi học đã hủy.")}</div> : roster.length === 0 ? <div className="empty">{t("Lớp chưa có học viên đang ghi danh.")}</div> : <AttendanceRosterTable roster={roster} marks={marks} parties={parties} busy={busy} sessionStatus={selected.status} attendanceLabels={attendanceLabels} onSave={saveMark} t={t} />}
        <p className="small muted">{t('Đã ghi nhận {marked}/{total} học viên. Chỉ có thể điểm danh từ giờ bắt đầu; cần ghi nhận đủ học viên để chốt buổi.').replace('{marked}', String(roster.filter(({ enrollment }) => marks.has(enrollment.id)).length)).replace('{total}', String(roster.length))}</p>
      </>}
    </section>
    <GradebookSection canRead={can('school.grade.read')} canCreate={can('school.grade.create')} canUpdate={can('school.grade.update')} classes={classes} gradeClass={gradeClass} gradeTerm={gradeTerm} gradeSubject={gradeSubject} gradeRoster={gradeRoster} gradeMap={gradeMap} parties={parties} busy={busy} onGradeClassChange={setGradeClass} onGradeTermChange={setGradeTerm} onGradeSubjectChange={setGradeSubject} onSave={saveGrade} t={t} />
    {can('school.fee.read') && <section className="card card-pad u-legacy-eee3f850c9" ><div className="row wrap"><div><h2>{t("Sổ học phí")}</h2><p className="small muted">{t("Học phí phát hành sẽ tạo hóa đơn phải thu. Khi hóa đơn được thanh toán đủ, trạng thái khoản học phí tự chuyển sang đã thu.")}</p></div><span className="grow"/><span className="badge warning">{fees.filter((fee) => fee.status === 'issued').length} {t('chưa thu đủ')}</span></div>
      {can('school.tuition_batch.create') && <section className="card card-pad u-legacy-c53ea1da23" ><h3>{t("Lập đợt học phí theo lớp")}</h3><p className="small muted">{t("Tạo khoản thu nháp cho toàn bộ học viên đang ghi danh. Học phí hiện tại của lớp được lưu thành số tiền từng khoản; có thể rà soát và phát hành hóa đơn riêng sau đó.")}</p><form className="form-grid" onSubmit={createTuitionBatch}>
        <label className="field"><span className="label">{t("Lớp *")}</span><select className="select" required value={tuitionBatchForm.class} onChange={(event) => setTuitionBatchForm((current) => ({ ...current, class: event.target.value }))}><option value="">{t("Chọn lớp có học phí")}</option>{classes.filter((item) => Number(item.tuition) > 0).map((item) => <option key={item.id} value={item.id}>{item.name} · {fmtMoney(item.tuition)} · {enrollments.filter((row) => row.class === item.id && row.status === 'active').length} {t('học viên')}</option>)}</select></label>
        <label className="field"><span className="label">{t("Kỳ học phí *")}</span><input className="input" required maxLength="80" value={tuitionBatchForm.period} onChange={(event) => setTuitionBatchForm((current) => ({ ...current, period: event.target.value }))} placeholder={t('Ví dụ: 2026-HK1 hoặc 2026-11')} /></label>
        <label className="field"><span className="label">{t("Hạn thanh toán *")}</span><input className="input" required type="date" value={tuitionBatchForm.due_date} onChange={(event) => setTuitionBatchForm((current) => ({ ...current, due_date: event.target.value }))} /></label>
        <div className="row full"><span className="grow"/><button className="btn btn-secondary" disabled={busy || loading || !tuitionBatchForm.class || !tuitionBatchForm.period.trim()}>{t("Tạo đợt nháp")}</button></div>
       </form>{can('school.tuition_batch.read') && <div className="stack-sm u-legacy-0ee7f66ad9" >{tuitionBatches.length === 0 ? <div className="small muted">{t("Chưa có đợt tạo học phí.")}</div> : [...tuitionBatches].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))).map((batch) => <div className="row wrap card card-pad" key={batch.id}><div><strong>{classById.get(batch.class)?.name || t('Lớp')} · {batch.period}</strong><div className="small muted">{batch.status === 'generated' ? t('Hạn {date} · Tạo {generated} khoản · Bỏ qua {skipped} khoản đã có').replace('{date}', fmtDate(batch.due_date)).replace('{generated}', String(batch.generated_count || 0)).replace('{skipped}', String(batch.skipped_count || 0)) : t('Hạn {date} · Chưa chạy').replace('{date}', fmtDate(batch.due_date))}</div></div><span className="grow"/><span className={`badge ${batch.status === 'generated' ? 'success' : 'warning'}`}>{statusLabel(batch.status)}</span>{batch.status === 'draft' && can('school.tuition_batch.generated') && <button className="btn btn-primary btn-sm" disabled={Boolean(busy) || loading} onClick={() => generateTuitionBatch(batch)}>{t("Tạo khoản thu")}</button>}</div>)}</div>}</section>}
      {can('school.fee.create') && <form className="form-grid u-legacy-9f9b3e4d30"  onSubmit={createFee}>
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
