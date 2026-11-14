import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api, dataPath } from './lib/api.js';
import { fmtDateTime, statusLabel } from './lib/i18n.js';
import { can, loadRefs, recordLabel } from './lib/state.js';

const localDateTime = (value) => {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const attendanceLabels = { present: 'Có mặt', absent: 'Vắng', late: 'Đi muộn', excused: 'Có phép' };
const sessionDate = () => localDateTime(new Date(Date.now() + 60 * 60 * 1000).toISOString());

export default function EducationWorkbenchPage() {
  const [classes, setClasses] = useState([]);
  const [enrollments, setEnrollments] = useState([]);
  const [students, setStudents] = useState(new Map());
  const [parties, setParties] = useState(new Map());
  const [sessions, setSessions] = useState([]);
  const [attendance, setAttendance] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [form, setForm] = useState({ class: '', topic: '', starts_at: sessionDate(), ends_at: localDateTime(new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()) });
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [classRes, enrollmentRes, studentRes, partyMap, sessionRes, attendanceRes] = await Promise.all([
        api(`${dataPath('school.course_class')}?limit=1000`), api(`${dataPath('school.class_enrollment')}?limit=1000`),
        api(`${dataPath('school.student')}?limit=1000`), loadRefs('master-data.party'),
        api(`${dataPath('school.class_session')}?limit=1000`), api(`${dataPath('school.attendance')}?limit=1000`),
      ]);
      const classItems = classRes.items || []; const sessionItems = sessionRes.items || [];
      setClasses(classItems); setEnrollments(enrollmentRes.items || []); setStudents(new Map((studentRes.items || []).map((x) => [x.id, x])));
      setParties(partyMap); setSessions(sessionItems.sort((a, b) => String(b.starts_at).localeCompare(String(a.starts_at))));
      setAttendance(attendanceRes.items || []);
      setForm((current) => ({ ...current, class: current.class || classItems[0]?.id || '' }));
      setSelectedId((current) => current && sessionItems.some((x) => x.id === current) ? current : sessionItems[0]?.id || '');
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

  async function createSession(event) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      await api(dataPath('school.class_session'), { method: 'POST', body: { ...form, starts_at: new Date(form.starts_at).toISOString(), ends_at: new Date(form.ends_at).toISOString(), status: 'scheduled' } });
      setNotice('Đã lên lịch buổi học.'); setForm((current) => ({ ...current, topic: '' })); await load();
    } catch (reason) { setError(reason.message || 'Không thể lên lịch buổi học.'); }
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
    <section className="card card-pad" style={{ marginTop: 20 }}><div className="row wrap"><h2>Danh sách buổi học</h2><span className="grow" /><select className="select" aria-label="Chọn buổi học" value={selectedId} onChange={(e) => setSelectedId(e.target.value)}><option value="">Chọn buổi học</option>{sessions.map((item) => <option key={item.id} value={item.id}>{classes.find((c) => c.id === item.class)?.name || 'Lớp'} · {fmtDateTime(item.starts_at)} · {item.topic}</option>)}</select></div>
      {loading ? <div className="skeleton" data-h="row" /> : !selected ? <div className="empty">Chưa có buổi học.</div> : <>
        <div className="row wrap" style={{ margin: '12px 0' }}><div><strong>{selectedClass?.name || 'Lớp học'} · {selected.topic}</strong><div className="small muted">{fmtDateTime(selected.starts_at)} – {fmtDateTime(selected.ends_at)} · {statusLabel(selected.status)}</div></div><span className="grow" />{selected.status === 'scheduled' && can('school.class_session.completed') && <button className="btn btn-primary btn-sm" type="button" disabled={busy} onClick={() => transition(selected, 'completed')}>Chốt buổi học</button>}{selected.status === 'scheduled' && can('school.class_session.cancelled') && <button className="btn btn-ghost btn-sm" type="button" disabled={busy} onClick={() => transition(selected, 'cancelled')}>Hủy buổi</button>}</div>
        {selected.status === 'cancelled' ? <div className="empty">Buổi học đã hủy.</div> : roster.length === 0 ? <div className="empty">Lớp chưa có học viên đang ghi danh.</div> : <div className="table-wrap"><table className="table"><thead><tr><th>Mã học viên</th><th>Học viên</th><th>Trạng thái điểm danh</th><th>Ghi nhận</th></tr></thead><tbody>{roster.map(({ enrollment, student }) => { const mark = marks.get(enrollment.id); const party = parties.get(student?.party); return <tr key={enrollment.id}><td>{student?.student_code || '—'}</td><td>{party ? recordLabel('master-data.party', party) : 'Học viên'}</td><td>{mark ? attendanceLabels[mark.status] || statusLabel(mark.status) : 'Chưa điểm danh'}</td><td><div className="row wrap">{['present', 'absent', 'late', 'excused'].map((status) => <button key={status} className={`btn btn-sm ${mark?.status === status ? 'btn-primary' : 'btn-secondary'}`} type="button" disabled={busy || selected.status !== 'scheduled' || !can('school.attendance.create')} onClick={() => saveMark(enrollment.id, status)}>{attendanceLabels[status]}</button>)}</div></td></tr>; })}</tbody></table></div>}
        <p className="small muted">Đã ghi nhận {roster.filter(({ enrollment }) => marks.has(enrollment.id)).length}/{roster.length} học viên. Chỉ có thể điểm danh từ giờ bắt đầu; cần ghi nhận đủ học viên để chốt buổi.</p>
      </>}
    </section>
  </div>;
}

function studentName(student, parties) {
  const party = student && parties.get(student.party);
  return party ? recordLabel('master-data.party', party) : student?.student_code || '';
}
