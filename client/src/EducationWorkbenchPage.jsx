import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { localDate as formatLocalDate } from './lib/dates.js';
import { api, dataPath } from './lib/api.js';
import { fmtDate, fmtDateTime, fmtMoney, statusLabel } from './lib/i18n.js';
import { can, loadRefs, recordLabel, loadAllResponse } from './lib/state.js';

const localDateTime = (value) => {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const localDate = formatLocalDate;
const attendanceLabels = { present: 'Có mặt', absent: 'Vắng', late: 'Đi muộn', excused: 'Có phép' };
const sessionDate = () => localDateTime(new Date(Date.now() + 60 * 60 * 1000).toISOString());

export default function EducationWorkbenchPage() {
  const [classes, setClasses] = useState([]);
  const [enrollments, setEnrollments] = useState([]);
  const [students, setStudents] = useState(new Map());
  const [parties, setParties] = useState(new Map());
  const [sessions, setSessions] = useState([]);
  const [attendance, setAttendance] = useState([]);
  const [grades, setGrades] = useState([]);
  const [fees, setFees] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [enrollmentForm, setEnrollmentForm] = useState({ class: '', student: '' });
  const [enrollmentClass, setEnrollmentClass] = useState('');
  const [gradeClass, setGradeClass] = useState('');
  const [gradeTerm, setGradeTerm] = useState('');
  const [gradeSubject, setGradeSubject] = useState('');
  const [feeForm, setFeeForm] = useState({ student: '', enrollment: '', period: '', amount: '', due_date: '', note: '' });
  const [form, setForm] = useState({ class: '', topic: '', starts_at: sessionDate(), ends_at: localDateTime(new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()) });
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [classRes, enrollmentRes, studentRes, partyMap, sessionRes, attendanceRes, gradeRes, feeRes, invoiceRes] = await Promise.all([
        can('school.course_class.read') ? loadAllResponse('school.course_class') : Promise.resolve({ items: [] }),
        can('school.class_enrollment.read') ? loadAllResponse('school.class_enrollment') : Promise.resolve({ items: [] }),
        can('school.student.read') ? loadAllResponse('school.student') : Promise.resolve({ items: [] }),
        can('master-data.party.read') ? loadRefs('master-data.party') : Promise.resolve(new Map()),
        can('school.class_session.read') ? loadAllResponse('school.class_session') : Promise.resolve({ items: [] }),
        can('school.attendance.read') ? loadAllResponse('school.attendance') : Promise.resolve({ items: [] }),
        can('school.grade.read') ? loadAllResponse('school.grade') : Promise.resolve({ items: [] }),
        can('school.fee.read') ? loadAllResponse('school.fee') : Promise.resolve({ items: [] }),
        can('accounting.invoice.read') ? loadAllResponse('accounting.invoice') : Promise.resolve({ items: [] }),
      ]);
      const classItems = classRes.items || []; const sessionItems = sessionRes.items || [];
      setClasses(classItems); setEnrollments(enrollmentRes.items || []); setStudents(new Map((studentRes.items || []).map((x) => [x.id, x])));
      setParties(partyMap); setSessions(sessionItems.sort((a, b) => String(b.starts_at).localeCompare(String(a.starts_at))));
      setAttendance(attendanceRes.items || []);
      setGrades(gradeRes.items || []);
      setFees(feeRes.items || []); setInvoices(invoiceRes.items || []);
      setForm((current) => ({ ...current, class: current.class || classItems[0]?.id || '' }));
      setEnrollmentForm((current) => ({ ...current, class: current.class || classItems[0]?.id || '', student: current.student || studentRes.items?.[0]?.id || '' }));
      setEnrollmentClass((current) => current || classItems[0]?.id || '');
      setGradeClass((current) => current || classItems[0]?.id || '');
      setSelectedId((current) => current && sessionItems.some((x) => x.id === current) ? current : sessionItems[0]?.id || '');
      setFeeForm((current) => ({ ...current, student: current.student || studentRes.items?.[0]?.id || '' }));
    } catch (reason) { setError(reason.message || 'Không tải được dữ liệu lớp học.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { document.title = 'Lịch lớp và điểm danh · OSP Suite'; load(); }, [load]);
  const selected = sessions.find((session) => session.id === selectedId);
  const selectedClass = classes.find((item) => item.id === selected?.class);
  const roster = useMemo(() => enrollments.filter((item) => item.class === selected?.class && item.status === 'active')
    .map((enrollment) => ({ enrollment, student: students.get(enrollment.student) }))
    .sort((a, b) => studentName(a.student, parties).localeCompare(studentName(b.student, parties), 'vi')), [enrollments, parties, selected, students]);
  const marks = useMemo(() => new Map(attendance.filter((item) => item.session === selectedId).map((item) => [item.enrollment, item])), [attendance, selectedId]);
  const gradeRoster = useMemo(() => enrollments.filter((item) => item.class === gradeClass && item.status === 'active')
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
      setNotice('Đã tạo khoản học phí nháp. Kiểm tra thông tin rồi phát hành để tạo hóa đơn kế toán.');
      setFeeForm((current) => ({ ...current, period: '', amount: '', note: '' })); await load();
    } catch (reason) { setError(reason.message || 'Không thể tạo khoản học phí.'); }
    finally { setBusy(false); }
  }

  async function issueFee(fee) {
    setBusy(fee.id); setError(''); setNotice('');
    try {
      await api(dataPath('school.fee', fee.id, 'issued'), { method: 'POST' });
      setNotice('Đã phát hành học phí và tạo hóa đơn phải thu trong cùng giao dịch.'); await load();
    } catch (reason) { setError(reason.message || 'Không thể phát hành học phí.'); await load(); }
    finally { setBusy(false); }
  }

  async function createSession(event) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      await api(dataPath('school.class_session'), { method: 'POST', body: { ...form, starts_at: new Date(form.starts_at).toISOString(), ends_at: new Date(form.ends_at).toISOString(), status: 'scheduled' } });
      setNotice('Đã lên lịch buổi học.'); setForm((current) => ({ ...current, topic: '' })); await load();
    } catch (reason) { setError(reason.message || 'Không thể lên lịch buổi học.'); }
    finally { setBusy(false); }
  }

  async function createEnrollment(event) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      await api(dataPath('school.class_enrollment'), { method: 'POST', body: { class: enrollmentForm.class, student: enrollmentForm.student, status: 'active' } });
      setNotice('Student enrolled in the selected class.');
      setEnrollmentForm((current) => ({ ...current, student: '' })); await load();
    } catch (reason) { setError(reason.message || 'Could not enroll this student.'); }
    finally { setBusy(false); }
  }

  async function changeEnrollment(enrollment, action) {
    setBusy(enrollment.id); setError(''); setNotice('');
    try {
      await api(dataPath('school.class_enrollment', enrollment.id, action), { method: 'POST' });
      setNotice(action === 'dropped' ? 'Enrollment withdrawn.' : 'Enrollment completed.'); await load();
    } catch (reason) { setError(reason.message || 'Could not update this enrollment.'); }
    finally { setBusy(false); }
  }

  async function saveMark(enrollmentId, status) {
    setBusy(true); setError(''); setNotice('');
    try {
      const existing = marks.get(enrollmentId);
      if (existing) await api(dataPath('school.attendance', existing.id), { method: 'PATCH', body: { status } });
      else await api(dataPath('school.attendance'), { method: 'POST', body: { session: selectedId, enrollment: enrollmentId, status } });
      setNotice('Đã lưu điểm danh.'); await load();
    } catch (reason) { setError(reason.message || 'Không thể lưu điểm danh.'); }
    finally { setBusy(false); }
  }

  async function saveGrade(enrollmentId, score) {
    const term = gradeTerm.trim(); const subject = gradeSubject.trim(); const numericScore = Number(score);
    if (!term || !subject || score === '' || !Number.isFinite(numericScore) || numericScore < 0 || numericScore > 100) {
      setError('Hãy nhập học kỳ, môn học và điểm từ 0 đến 100.'); return;
    }
    setBusy(true); setError(''); setNotice('');
    try {
      const existing = gradeMap.get(enrollmentId);
      const body = { enrollment: enrollmentId, term, subject, score: numericScore };
      if (existing) await api(dataPath('school.grade', existing.id), { method: 'PATCH', body: { term, subject, score: numericScore } });
      else await api(dataPath('school.grade'), { method: 'POST', body });
      setNotice('Đã lưu điểm học viên.'); await load();
    } catch (reason) { setError(reason.message || 'Không thể lưu điểm học viên.'); }
    finally { setBusy(false); }
  }

  async function transition(session, action) {
    setBusy(true); setError(''); setNotice('');
    try {
      await api(dataPath('school.class_session', session.id, action), { method: 'POST' });
      setNotice(action === 'completed' ? 'Đã chốt buổi học.' : 'Đã hủy buổi học.'); await load();
    } catch (reason) { setError(reason.message || 'Không thể cập nhật buổi học.'); }
    finally { setBusy(false); }
  }

  return <div className="page">
    <div className="page-head"><div><h1>Lịch lớp và điểm danh</h1><p className="sub">Lên lịch buổi học, ghi nhận từng học viên và chốt danh sách sau khi buổi học kết thúc.</p></div><button className="btn btn-secondary" type="button" disabled={loading || busy} onClick={load}>Làm mới</button></div>
    {error && <div className="alert danger" role="alert">{error}</div>}{notice && <div className="alert success" role="status">{notice}</div>}
    {can('school.class_session.create') && <section className="card card-pad"><h2>Lên lịch buổi học</h2>
      <form className="form-grid" onSubmit={createSession}>
        <label className="field"><span className="label">Lớp *</span><select className="select" required value={form.class} onChange={(e) => setForm((x) => ({ ...x, class: e.target.value }))}><option value="">Chọn lớp</option>{classes.map((item) => <option key={item.id} value={item.id}>{item.name}{item.subject ? ` · ${item.subject}` : ''}</option>)}</select></label>
        <label className="field"><span className="label">Chủ đề buổi học *</span><input className="input" required value={form.topic} onChange={(e) => setForm((x) => ({ ...x, topic: e.target.value }))} /></label>
        <label className="field"><span className="label">Bắt đầu *</span><input className="input" type="datetime-local" required value={form.starts_at} onChange={(e) => setForm((x) => ({ ...x, starts_at: e.target.value }))} /></label>
        <label className="field"><span className="label">Kết thúc *</span><input className="input" type="datetime-local" required min={form.starts_at} value={form.ends_at} onChange={(e) => setForm((x) => ({ ...x, ends_at: e.target.value }))} /></label>
        <div className="row full"><span className="grow" /><button className="btn btn-primary" disabled={busy || loading || !form.class || !can('school.class_session.create')}>Lên lịch</button></div>
      </form>
    </section>}
    {can('school.class_enrollment.read') && <section className="card card-pad" style={{ marginTop: 20 }}><div className="row wrap"><div><h2>Ghi danh lớp học</h2><p className="small muted">Quản lý sĩ số, rút ghi danh hoặc chốt hoàn thành khóa học.</p></div><span className="grow"/><select className="select" aria-label="Lớp cần quản lý ghi danh" value={enrollmentClass} onChange={(event) => setEnrollmentClass(event.target.value)}><option value="">Chọn lớp</option>{classes.map((item) => <option key={item.id} value={item.id}>{item.name}{item.subject ? ` · ${item.subject}` : ''}</option>)}</select></div>
      {can('school.class_enrollment.create') && can('school.course_class.read') && can('school.student.read') && <form className="form-grid" style={{ margin: '14px 0 20px' }} onSubmit={createEnrollment}><label className="field"><span className="label">Lớp *</span><select className="select" required value={enrollmentForm.class} onChange={(event) => setEnrollmentForm((current) => ({ ...current, class: event.target.value, student: '' }))}><option value="">Chọn lớp</option>{classes.map((item) => { const count = enrollments.filter((row) => row.class === item.id && row.status === 'active').length; return <option key={item.id} value={item.id}>{item.name}{item.capacity ? ` · ${count}/${item.capacity}` : ''}</option>; })}</select></label><label className="field"><span className="label">Học viên *</span><select className="select" required value={enrollmentForm.student} onChange={(event) => setEnrollmentForm((current) => ({ ...current, student: event.target.value }))}><option value="">Chọn học viên</option>{eligibleEnrollmentStudents.map((student) => <option key={student.id} value={student.id}>{parties.get(student.party) ? recordLabel('master-data.party', parties.get(student.party)) : student.student_code || 'Học viên'}{student.student_code ? ` · ${student.student_code}` : ''}</option>)}</select></label><div className="row full"><span className="grow small muted">{enrollmentForm.class && selectedEnrollmentClass?.capacity ? `Sĩ số hiện tại: ${enrollments.filter((row) => row.class === enrollmentForm.class && row.status === 'active').length}/${selectedEnrollmentClass.capacity}` : 'Hệ thống sẽ kiểm tra trùng ghi danh và sức chứa khi lưu.'}</span><button className="btn btn-primary" type="submit" disabled={busy || loading || !enrollmentForm.class || !enrollmentForm.student}>Ghi danh</button></div></form>}
      {!enrollmentClass ? <div className="empty">Chọn lớp để xem danh sách ghi danh.</div> : !enrollmentRoster.length ? <div className="empty">Lớp chưa có ghi danh.</div> : <div className="table-wrap"><table className="table"><thead><tr><th>Mã học viên</th><th>Học viên</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>{enrollmentRoster.map(({ enrollment, student }) => <tr key={enrollment.id}><td>{student?.student_code || '—'}</td><td>{student && parties.get(student.party) ? recordLabel('master-data.party', parties.get(student.party)) : 'Học viên'}</td><td>{statusLabel(enrollment.status)}</td><td><div className="row wrap">{enrollment.status === 'active' && can('school.class_enrollment.dropped') && <button className="btn btn-ghost btn-sm" type="button" disabled={busy} onClick={() => changeEnrollment(enrollment, 'dropped')}>Rút ghi danh</button>}{enrollment.status === 'active' && can('school.class_enrollment.completed') && <button className="btn btn-secondary btn-sm" type="button" disabled={busy} onClick={() => changeEnrollment(enrollment, 'completed')}>Hoàn thành khóa học</button>}</div></td></tr>)}</tbody></table></div>}
    </section>}
    <section className="card card-pad" style={{ marginTop: 20 }}><div className="row wrap"><h2>Danh sách buổi học</h2><span className="grow" /><select className="select" aria-label="Chọn buổi học" value={selectedId} onChange={(e) => setSelectedId(e.target.value)}><option value="">Chọn buổi học</option>{sessions.map((item) => <option key={item.id} value={item.id}>{classes.find((c) => c.id === item.class)?.name || 'Lớp'} · {fmtDateTime(item.starts_at)} · {item.topic}</option>)}</select></div>
      {loading ? <div className="skeleton" data-h="row" /> : !selected ? <div className="empty">Chưa có buổi học.</div> : <>
        <div className="row wrap" style={{ margin: '12px 0' }}><div><strong>{selectedClass?.name || 'Lớp học'} · {selected.topic}</strong><div className="small muted">{fmtDateTime(selected.starts_at)} – {fmtDateTime(selected.ends_at)} · {statusLabel(selected.status)}</div></div><span className="grow" />{selected.status === 'scheduled' && can('school.class_session.completed') && <button className="btn btn-primary btn-sm" type="button" disabled={busy} onClick={() => transition(selected, 'completed')}>Chốt buổi học</button>}{selected.status === 'scheduled' && can('school.class_session.cancelled') && <button className="btn btn-ghost btn-sm" type="button" disabled={busy} onClick={() => transition(selected, 'cancelled')}>Hủy buổi</button>}</div>
        {selected.status === 'cancelled' ? <div className="empty">Buổi học đã hủy.</div> : roster.length === 0 ? <div className="empty">Lớp chưa có học viên đang ghi danh.</div> : <div className="table-wrap"><table className="table"><thead><tr><th>Mã học viên</th><th>Học viên</th><th>Trạng thái điểm danh</th><th>Ghi nhận</th></tr></thead><tbody>{roster.map(({ enrollment, student }) => { const mark = marks.get(enrollment.id); const party = parties.get(student?.party); return <tr key={enrollment.id}><td>{student?.student_code || '—'}</td><td>{party ? recordLabel('master-data.party', party) : 'Học viên'}</td><td>{mark ? attendanceLabels[mark.status] || statusLabel(mark.status) : 'Chưa điểm danh'}</td><td><div className="row wrap">{['present', 'absent', 'late', 'excused'].map((status) => <button key={status} className={`btn btn-sm ${mark?.status === status ? 'btn-primary' : 'btn-secondary'}`} type="button" disabled={busy || selected.status !== 'scheduled' || !can('school.attendance.create')} onClick={() => saveMark(enrollment.id, status)}>{attendanceLabels[status]}</button>)}</div></td></tr>; })}</tbody></table></div>}
        <p className="small muted">Đã ghi nhận {roster.filter(({ enrollment }) => marks.has(enrollment.id)).length}/{roster.length} học viên. Chỉ có thể điểm danh từ giờ bắt đầu; cần ghi nhận đủ học viên để chốt buổi.</p>
      </>}
    </section>
    {can('school.grade.read') && <section className="card card-pad" style={{ marginTop: 20 }}><div className="row wrap"><div><h2>Sổ điểm</h2><p className="small muted">Quản lý điểm theo lớp, học kỳ và môn; mỗi học viên có một điểm cho từng môn trong mỗi kỳ.</p></div></div>
      <div className="form-grid" style={{ marginBottom: 14 }}>
        <label className="field"><span className="label">Lớp *</span><select className="select" value={gradeClass} onChange={(event) => setGradeClass(event.target.value)}><option value="">Chọn lớp</option>{classes.map((item) => <option key={item.id} value={item.id}>{item.name}{item.subject ? ` · ${item.subject}` : ''}</option>)}</select></label>
        <label className="field"><span className="label">Học kỳ *</span><input className="input" required value={gradeTerm} onChange={(event) => setGradeTerm(event.target.value)} placeholder="Ví dụ: 2026-2027 / HK1" /></label>
        <label className="field"><span className="label">Môn học *</span><input className="input" required value={gradeSubject} onChange={(event) => setGradeSubject(event.target.value)} placeholder="Ví dụ: Toán" /></label>
      </div>
      {!gradeClass ? <div className="empty">Chọn lớp để mở sổ điểm.</div> : gradeRoster.length === 0 ? <div className="empty">Lớp chưa có học viên đang ghi danh.</div> : <div className="table-wrap"><table className="table"><thead><tr><th>Mã học viên</th><th>Học viên</th><th>Điểm (0–100)</th><th>Thao tác</th></tr></thead><tbody>{gradeRoster.map(({ enrollment, student }) => { const party = parties.get(student?.party); const grade = gradeMap.get(enrollment.id); return <GradeRow key={enrollment.id} enrollment={enrollment} student={student} party={party} grade={grade} busy={busy} canCreate={can('school.grade.create')} canUpdate={can('school.grade.update')} onSave={saveGrade} />; })}</tbody></table></div>}
    </section>}
    {can('school.fee.read') && <section className="card card-pad" style={{ marginTop: 20 }}><div className="row wrap"><div><h2>Sổ học phí</h2><p className="small muted">Học phí phát hành sẽ tạo hóa đơn phải thu. Khi hóa đơn được thanh toán đủ, trạng thái khoản học phí tự chuyển sang đã thu.</p></div><span className="grow"/><span className="badge warning">{fees.filter((fee) => fee.status === 'issued').length} chưa thu đủ</span></div>
      {can('school.fee.create') && <form className="form-grid" style={{ margin: '14px 0 20px' }} onSubmit={createFee}>
        <label className="field"><span className="label">Ghi danh (tùy chọn)</span><select className="select" value={feeForm.enrollment} onChange={(event) => { const enrollment = enrollmentById.get(event.target.value); setFeeForm((current) => ({ ...current, enrollment: event.target.value, student: enrollment?.student || current.student })); }}><option value="">Khoản thu khác / chưa gắn lớp</option>{enrollments.filter((item) => item.status === 'active').map((item) => { const student = studentById.get(item.student); const party = parties.get(student?.party); const courseClass = classById.get(item.class); return <option key={item.id} value={item.id}>{party ? recordLabel('master-data.party', party) : student?.student_code || 'Học viên'} · {courseClass?.name || 'Lớp'}</option>; })}</select></label>
        {!feeForm.enrollment && <label className="field"><span className="label">Học viên *</span><select className="select" required value={feeForm.student} onChange={(event) => setFeeForm((current) => ({ ...current, student: event.target.value }))}><option value="">Chọn học viên</option>{[...students.values()].map((student) => <option key={student.id} value={student.id}>{parties.get(student.party) ? recordLabel('master-data.party', parties.get(student.party)) : student.student_code || 'Học viên'}</option>)}</select></label>}
        {feeForm.enrollment ? <label className="field"><span className="label">Học phí lớp</span><input className="input num" readOnly value={selectedFeeClass?.tuition == null ? 'Chưa cấu hình' : fmtMoney(selectedFeeClass.tuition)} /></label> : <label className="field"><span className="label">Số tiền *</span><input className="input num" type="number" min="0.01" step="any" required value={feeForm.amount} onChange={(event) => setFeeForm((current) => ({ ...current, amount: event.target.value }))} /></label>}
        {feeForm.enrollment && <label className="field"><span className="label">Kỳ học phí *</span><input className="input" required value={feeForm.period} onChange={(event) => setFeeForm((current) => ({ ...current, period: event.target.value }))} placeholder="Ví dụ: 2026-HK1 hoặc 2026-11" /></label>}
        <label className="field"><span className="label">Hạn thanh toán</span><input className="input" type="date" min={localDate()} value={feeForm.due_date} onChange={(event) => setFeeForm((current) => ({ ...current, due_date: event.target.value }))} /></label>
        <label className="field"><span className="label">Nội dung thu</span><input className="input" maxLength="240" value={feeForm.note} onChange={(event) => setFeeForm((current) => ({ ...current, note: event.target.value }))} placeholder={feeForm.enrollment ? `Học phí ${selectedFeeClass?.name || 'lớp học'}` : 'Ví dụ: tài liệu học tập'} /></label>
        <div className="row full"><span className="grow"/><button className="btn btn-primary" disabled={busy || loading || !feeForm.student || (feeForm.enrollment && !selectedFeeClass?.tuition)}>Tạo khoản học phí nháp</button></div>
      </form>}
      {loading ? <div className="skeleton" data-h="row"/> : fees.length === 0 ? <div className="empty">Chưa có khoản học phí. Tạo khoản nháp ở trên rồi phát hành để sinh hóa đơn.</div> : <div className="table-wrap"><table className="table"><thead><tr><th>Học viên</th><th>Kỳ / nội dung</th><th>Số tiền</th><th>Hạn thu</th><th>Trạng thái / hóa đơn</th><th>Thao tác</th></tr></thead><tbody>{[...fees].sort((a, b) => String(b.due_date || b.created_at || '').localeCompare(String(a.due_date || a.created_at || ''))).map((fee) => { const student = studentById.get(fee.student); const party = parties.get(student?.party); const invoice = invoiceByFee.get(fee.id); return <tr key={fee.id}><td>{party ? recordLabel('master-data.party', party) : student?.student_code || 'Học viên'}<div className="small muted">{student?.student_code || ''}</div></td><td>{fee.period || fee.note || 'Khoản thu'}</td><td className="num">{fmtMoney(fee.amount || 0)}</td><td>{fee.due_date ? fmtDate(fee.due_date) : '—'}</td><td><span className={`badge ${fee.status === 'paid' ? 'success' : fee.status === 'issued' ? 'warning' : 'plain'}`}>{statusLabel(fee.status)}</span>{invoice && <div><a className="btn btn-ghost btn-sm" href={`#/e/accounting/invoice/${invoice.id}`}>{statusLabel(invoice.status)} · mở hóa đơn</a></div>}</td><td>{fee.status === 'draft' && can('school.fee.issued') && <button className="btn btn-primary btn-sm" disabled={Boolean(busy) || !fee.party || Number(fee.amount) <= 0} onClick={() => issueFee(fee)}>Phát hành</button>}{fee.status === 'issued' && !invoice && <span className="small muted">Đang tạo hóa đơn</span>}</td></tr>; })}</tbody></table></div>}
    </section>}
  </div>;
}

function GradeRow({ enrollment, student, party, grade, busy, canCreate, canUpdate, onSave }) {
  const [score, setScore] = useState(grade?.score == null ? '' : String(grade.score));
  useEffect(() => setScore(grade?.score == null ? '' : String(grade.score)), [grade?.id, grade?.score]);
  const allowed = grade ? canUpdate : canCreate;
  return <tr><td>{student?.student_code || '—'}</td><td>{party ? recordLabel('master-data.party', party) : 'Học viên'}</td><td><input className="input num" aria-label={`Điểm ${student?.student_code || ''}`} type="number" min="0" max="100" step="any" value={score} disabled={!allowed} onChange={(event) => setScore(event.target.value)} /></td><td><button className="btn btn-primary btn-sm" type="button" disabled={busy || !allowed || !score.trim()} onClick={() => onSave(enrollment.id, score)}>{grade ? 'Cập nhật điểm' : 'Lưu điểm'}</button></td></tr>;
}

function studentName(student, parties) {
  const party = student && parties.get(student.party);
  return party ? recordLabel('master-data.party', party) : student?.student_code || '';
}
