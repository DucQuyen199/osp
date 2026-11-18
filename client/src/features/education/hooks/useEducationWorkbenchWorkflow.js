import { useEffect, useMemo, useState } from 'react';
import { localDate as formatLocalDate, localDateTime as businessDateTime, localDateTimeToIso } from '../../../lib/dates.js';
import { api, dataPath } from '../../../lib/api.js';

const localDate = formatLocalDate;
const sessionDate = () => businessDateTime(new Date(Date.now() + 60 * 60 * 1000));

export function useEducationWorkbenchWorkflow({ data, t }) {
  const { classes, enrollments, students, sessions, attendance, grades, load } = data;
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
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    setForm((current) => ({ ...current, class: current.class || classes[0]?.id || '' }));
    setEnrollmentForm((current) => ({ ...current, class: current.class || classes[0]?.id || '', student: current.student || students.keys().next().value || '' }));
    setEnrollmentClass((current) => current || classes[0]?.id || '');
    setGradeClass((current) => current || classes[0]?.id || '');
    setSelectedId((current) => current && sessions.some((item) => item.id === current) ? current : sessions[0]?.id || '');
    setFeeForm((current) => ({ ...current, student: current.student || students.keys().next().value || '' }));
    setTuitionBatchForm((current) => ({ ...current, class: classes.some((item) => item.id === current.class) ? current.class : classes.find((item) => Number(item.tuition) > 0)?.id || '' }));
  }, [classes, sessions, students]);
  const marks = useMemo(() => new Map(attendance.filter((item) => item.session === selectedId).map((item) => [item.enrollment, item])), [attendance, selectedId]);
  const gradeMap = useMemo(() => new Map(grades.filter((grade) => grade.term?.trim().toLocaleLowerCase() === gradeTerm.trim().toLocaleLowerCase()
    && grade.subject?.trim().toLocaleLowerCase() === gradeSubject.trim().toLocaleLowerCase()).map((grade) => [grade.enrollment, grade])), [grades, gradeSubject, gradeTerm]);

  async function createFee(event) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      const enrollment = enrollments.find((item) => item.id === feeForm.enrollment);
      const body = {
        student: enrollment?.student || feeForm.student,
        ...(feeForm.enrollment ? { enrollment: feeForm.enrollment, period: feeForm.period.trim() } : { amount: String(feeForm.amount) }),
        ...(feeForm.due_date ? { due_date: feeForm.due_date } : {}),
        ...(feeForm.note.trim() ? { note: feeForm.note.trim() } : {}),
      };
      await api(dataPath('school.fee'), { method: 'POST', body });
      setNotice(t('Đã tạo khoản học phí nháp. Kiểm tra thông tin rồi phát hành để tạo hóa đơn kế toán.'));
      setFeeForm((current) => ({ ...current, period: '', amount: '', note: '' })); await load();
    } catch (reason) { setError(reason.message || t('Không thể tạo khoản học phí.')); }
    finally { setBusy(false); }
  }
  async function createTuitionBatch(event) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      await api(dataPath('school.tuition_batch'), { method: 'POST', body: { ...tuitionBatchForm, period: tuitionBatchForm.period.trim(), status: 'draft' } });
      setNotice(t('Đã tạo đợt học phí nháp. Rà soát rồi chạy để tạo các khoản thu còn thiếu.'));
      setTuitionBatchForm((current) => ({ ...current, period: '' })); await load();
    } catch (reason) { setError(reason.message || t('Không thể tạo đợt học phí.')); }
    finally { setBusy(false); }
  }
  async function generateTuitionBatch(batch) {
    setBusy(batch.id); setError(''); setNotice('');
    try {
      await api(dataPath('school.tuition_batch', batch.id, 'generated'), { method: 'POST' });
      setNotice(t('Đã tạo khoản học phí nháp cho các học viên đang ghi danh; khoản đã có được bỏ qua.')); await load();
    } catch (reason) { setError(reason.message || t('Không thể chạy đợt học phí.')); await load(); }
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
      setNotice(t('Đã tạo lớp học.')); setClassForm({ name: '', subject: '', teacher: '', teacher_employee: '', start_date: '', capacity: '', tuition: '' }); await load();
    } catch (reason) { setError(reason.message || t('Không thể tạo lớp học.')); }
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
        partyId = party.id; setPendingStudentParty({ id: party.id, name: party.name || studentForm.name.trim() });
      }
      await api(dataPath('school.student'), { method: 'POST', body: {
        party: partyId,
        ...(studentForm.student_code.trim() ? { student_code: studentForm.student_code.trim() } : {}),
        ...(studentForm.dob ? { dob: studentForm.dob } : {}),
        ...(studentForm.guardian.trim() ? { guardian: studentForm.guardian.trim() } : {}),
      } });
      setPendingStudentParty(null); setNotice(t('Đã tạo hồ sơ học viên.'));
      setStudentForm({ name: '', student_code: '', dob: '', guardian: '', phone: '', email: '' }); await load();
    } catch (reason) { setError(reason.message || t('Không thể tạo hồ sơ học viên.')); }
    finally { setBusy(false); }
  }
  async function issueFee(fee) {
    setBusy(fee.id); setError(''); setNotice('');
    try { await api(dataPath('school.fee', fee.id, 'issued'), { method: 'POST' }); setNotice(t('Đã phát hành học phí và tạo hóa đơn phải thu trong cùng giao dịch.')); await load(); }
    catch (reason) { setError(reason.message || t('Không thể phát hành học phí.')); await load(); }
    finally { setBusy(false); }
  }
  async function createSession(event) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      const startsAt = localDateTimeToIso(form.starts_at); const endsAt = localDateTimeToIso(form.ends_at);
      if (!startsAt || !endsAt) throw new Error(t('Giờ học không hợp lệ trong múi giờ kinh doanh.'));
      await api(dataPath('school.class_session'), { method: 'POST', body: { ...form, starts_at: startsAt, ends_at: endsAt, status: 'scheduled' } });
      setNotice(t('Đã lên lịch buổi học.')); setForm((current) => ({ ...current, topic: '' })); await load();
    } catch (reason) { setError(reason.message || t('Không thể lên lịch buổi học.')); }
    finally { setBusy(false); }
  }
  async function createEnrollment(event) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      await api(dataPath('school.class_enrollment'), { method: 'POST', body: { class: enrollmentForm.class, student: enrollmentForm.student, status: 'active' } });
      setNotice(t('Student enrolled in the selected class.')); setEnrollmentForm((current) => ({ ...current, student: '' })); await load();
    } catch (reason) { setError(reason.message || t('Could not enroll this student.')); }
    finally { setBusy(false); }
  }
  async function changeEnrollment(enrollment, action) {
    setBusy(enrollment.id); setError(''); setNotice('');
    try {
      await api(dataPath('school.class_enrollment', enrollment.id, action), { method: 'POST' });
      setNotice(action === 'dropped' ? t('Enrollment withdrawn.') : t('Enrollment completed.')); await load();
    } catch (reason) { setError(reason.message || t('Could not update this enrollment.')); }
    finally { setBusy(false); }
  }
  async function saveMark(enrollmentId, status) {
    setBusy(true); setError(''); setNotice('');
    try {
      const existing = marks.get(enrollmentId);
      if (existing) await api(dataPath('school.attendance', existing.id), { method: 'PATCH', body: { status } });
      else await api(dataPath('school.attendance'), { method: 'POST', body: { session: selectedId, enrollment: enrollmentId, status } });
      setNotice(t('Đã lưu điểm danh.')); await load();
    } catch (reason) { setError(reason.message || t('Không thể lưu điểm danh.')); }
    finally { setBusy(false); }
  }
  async function saveGrade(enrollmentId, score) {
    const term = gradeTerm.trim(); const subject = gradeSubject.trim(); const numericScore = Number(score);
    if (!term || !subject || score === '' || !Number.isFinite(numericScore) || numericScore < 0 || numericScore > 100) { setError(t('Hãy nhập học kỳ, môn học và điểm từ 0 đến 100.')); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      const existing = gradeMap.get(enrollmentId); const body = { enrollment: enrollmentId, term, subject, score: numericScore };
      if (existing) await api(dataPath('school.grade', existing.id), { method: 'PATCH', body: { term, subject, score: numericScore } });
      else await api(dataPath('school.grade'), { method: 'POST', body });
      setNotice(t('Đã lưu điểm học viên.')); await load();
    } catch (reason) { setError(reason.message || t('Không thể lưu điểm học viên.')); }
    finally { setBusy(false); }
  }
  async function transition(session, action) {
    setBusy(true); setError(''); setNotice('');
    try {
      await api(dataPath('school.class_session', session.id, action), { method: 'POST' });
      setNotice(action === 'completed' ? t('Đã chốt buổi học.') : t('Buổi học đã hủy.')); await load();
    } catch (reason) { setError(reason.message || t('Không thể cập nhật buổi học.')); }
    finally { setBusy(false); }
  }

  return {
    selectedId, setSelectedId, enrollmentForm, setEnrollmentForm, enrollmentClass, setEnrollmentClass, gradeClass, setGradeClass,
    gradeTerm, setGradeTerm, gradeSubject, setGradeSubject, feeForm, setFeeForm, tuitionBatchForm, setTuitionBatchForm,
    classForm, setClassForm, studentForm, setStudentForm, pendingStudentParty, form, setForm,
    busy, error, notice, marks, gradeMap, createFee, createTuitionBatch, generateTuitionBatch, createClass, createStudent,
    issueFee, createSession, createEnrollment, changeEnrollment, saveMark, saveGrade, transition,
  };
}
