import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api, dataPath } from './lib/api.js';
import { fmtDateTime, statusLabel } from './lib/i18n.js';
import { can, loadAllResponse, loadRefs, recordLabel } from './lib/state.js';

const rows = (response) => Array.isArray(response?.items) ? response.items : [];
const courseStatus = { draft: 'Bản nháp', published: 'Đang mở học', archived: 'Đã lưu trữ' };

export default function LmsWorkbenchPage() {
  const [courses, setCourses] = useState([]);
  const [lessons, setLessons] = useState([]);
  const [enrollments, setEnrollments] = useState([]);
  const [progress, setProgress] = useState([]);
  const [parties, setParties] = useState(new Map());
  const [courseId, setCourseId] = useState('');
  const [courseForm, setCourseForm] = useState({ title: '', description: '' });
  const [lessonForm, setLessonForm] = useState({ title: '', content: '', required: true });
  const [learner, setLearner] = useState('');
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async (quiet = false) => {
    if (!quiet) { setLoading(true); setError(''); }
    try {
      const [courseRes, lessonRes, enrollmentRes, progressRes, partyMap] = await Promise.all([
        can('lms.course.read') ? loadAllResponse('lms.course') : Promise.resolve({ items: [] }),
        can('lms.lesson.read') ? loadAllResponse('lms.lesson') : Promise.resolve({ items: [] }),
        can('lms.enrollment.read') ? loadAllResponse('lms.enrollment') : Promise.resolve({ items: [] }),
        can('lms.lesson_progress.read') ? loadAllResponse('lms.lesson_progress') : Promise.resolve({ items: [] }),
        can('master-data.party.read') ? loadRefs('master-data.party') : Promise.resolve(new Map()),
      ]);
      const courseRows = rows(courseRes).sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));
      setCourses(courseRows); setLessons(rows(lessonRes)); setEnrollments(rows(enrollmentRes)); setProgress(rows(progressRes)); setParties(partyMap);
      setCourseId((id) => courseRows.some((course) => course.id === id) ? id : courseRows[0]?.id || '');
      setLearner((id) => id && partyMap.has(id) ? id : [...partyMap.keys()][0] || '');
    } catch (reason) { setError(reason.message || 'Không tải được dữ liệu đào tạo.'); }
    finally { if (!quiet) setLoading(false); }
  }, []);

  useEffect(() => { document.title = 'Đào tạo trực tuyến · OSP Suite'; load(); }, [load]);

  const selected = courses.find((course) => course.id === courseId);
  const courseLessons = useMemo(() => lessons.filter((lesson) => lesson.course === courseId).sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || ''))), [lessons, courseId]);
  const courseEnrollments = useMemo(() => enrollments.filter((row) => row.course === courseId).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))), [enrollments, courseId]);
  const completedByEnrollment = useMemo(() => {
    const map = new Map();
    for (const row of progress) { const set = map.get(row.enrollment) || new Set(); set.add(row.lesson); map.set(row.enrollment, set); }
    return map;
  }, [progress]);
  const activeLearners = enrollments.filter((row) => row.status === 'active').length;
  const completedLearners = enrollments.filter((row) => row.status === 'completed').length;
  const learnerName = (id) => parties.has(id) ? recordLabel('master-data.party', parties.get(id)) : 'Học viên';

  async function run(key, operation, message) {
    setBusy(key); setError(''); setNotice('');
    try { await operation(); await load(true); setNotice(message); }
    catch (reason) { setError(reason.message || 'Thao tác không thành công.'); }
    finally { setBusy(''); }
  }

  async function createCourse(event) {
    event.preventDefault();
    await run('course:create', async () => {
      const created = await api(dataPath('lms.course'), { method: 'POST', body: { title: courseForm.title.trim(), ...(courseForm.description.trim() ? { description: courseForm.description.trim() } : {}) } });
      setCourseId(created.id); setCourseForm({ title: '', description: '' });
    }, 'Đã tạo khóa học nháp.');
  }

  async function createLesson(event) {
    event.preventDefault(); if (!selected) return;
    await run(`${courseId}:lesson`, async () => {
      await api(dataPath('lms.lesson'), { method: 'POST', body: { course: courseId, title: lessonForm.title.trim(), ...(lessonForm.content.trim() ? { content: lessonForm.content.trim() } : {}), required: lessonForm.required } });
      setLessonForm({ title: '', content: '', required: true });
    }, 'Đã thêm bài học.');
  }

  async function courseAction(course, action) {
    const message = action === 'published' ? 'Đã mở khóa học để ghi danh.' : 'Đã lưu trữ khóa học.';
    await run(`${course.id}:${action}`, () => api(dataPath('lms.course', course.id, action), { method: 'POST' }), message);
  }

  async function enroll(event) {
    event.preventDefault(); if (!selected || !learner) return;
    await run(`${courseId}:enroll`, () => api(dataPath('lms.enrollment'), { method: 'POST', body: { course: courseId, learner } }), 'Đã ghi danh học viên.');
  }

  async function completeLesson(enrollment, lesson) {
    await run(`${enrollment.id}:${lesson.id}`, () => api(dataPath('lms.lesson_progress'), { method: 'POST', body: { enrollment: enrollment.id, lesson: lesson.id } }), 'Đã ghi nhận hoàn thành bài học; tiến độ khóa học được cập nhật tự động.');
  }

  const requiredLessons = courseLessons.filter((lesson) => lesson.required !== false);
  const activeCourse = selected?.status === 'published';
  const canEditLessons = selected?.status === 'draft' && !courseEnrollments.length;

  return <div className="page">
    <div className="page-head"><div><h1>Đào tạo trực tuyến</h1><p className="sub">Xây dựng khóa học, mở ghi danh, theo dõi tiến độ và lưu lịch sử hoàn thành tự động theo bài học bắt buộc.</p></div><button className="btn btn-secondary" type="button" disabled={loading || Boolean(busy)} onClick={() => load()}>Làm mới</button></div>
    {error && <div className="alert danger" role="alert">{error}</div>}{notice && <div className="alert success" role="status">{notice}</div>}
    <div className="stats" style={{ marginBottom: 16 }}><div className="card stat"><span className="stat-label">Khóa học</span><strong className="stat-value">{courses.length}</strong></div><div className="card stat"><span className="stat-label">Đang ghi danh</span><strong className="stat-value">{activeLearners}</strong></div><div className="card stat"><span className="stat-label">Đã hoàn thành</span><strong className="stat-value">{completedLearners}</strong></div></div>
    {can('lms.course.create') && <section className="card card-pad"><h2>Tạo khóa học</h2><form className="form-grid" onSubmit={createCourse}><label className="field"><span className="label">Tên khóa học *</span><input className="input" required maxLength="240" value={courseForm.title} onChange={(event) => setCourseForm({ ...courseForm, title: event.target.value })}/></label><label className="field"><span className="label">Mô tả</span><input className="input" maxLength="2000" value={courseForm.description} onChange={(event) => setCourseForm({ ...courseForm, description: event.target.value })}/></label><div className="row full"><span className="grow"/><button className="btn btn-primary" disabled={Boolean(busy)}>Tạo bản nháp</button></div></form></section>}
    {!can('lms.course.read') ? <div className="empty">Bạn chưa có quyền xem khóa học.</div> : loading ? <div className="skeleton" data-h="row"/> : !courses.length ? <div className="empty">Chưa có khóa học.</div> : <div className="layout-split"><section className="card table-wrap"><table className="table"><thead><tr><th>Khóa học</th><th>Trạng thái</th></tr></thead><tbody>{courses.map((course) => <tr key={course.id} className={courseId === course.id ? 'selected' : ''} onClick={() => setCourseId(course.id)} style={{ cursor: 'pointer' }}><td><strong>{course.title}</strong><div className="small muted">{lessons.filter((lesson) => lesson.course === course.id).length} bài học</div></td><td><span className={`badge ${course.status === 'published' ? 'success' : course.status === 'archived' ? 'plain' : 'warning'}`}>{courseStatus[course.status] || statusLabel(course.status)}</span></td></tr>)}</tbody></table></section>
      {selected && <section className="card card-pad"><div className="row wrap"><div><h2>{selected.title}</h2><div className="small muted">{selected.description || 'Chưa có mô tả'} · tạo {fmtDateTime(selected.createdAt)}</div></div><span className="grow"/><span className={`badge ${selected.status === 'published' ? 'success' : selected.status === 'archived' ? 'plain' : 'warning'}`}>{courseStatus[selected.status] || statusLabel(selected.status)}</span></div>
        <div className="row wrap" style={{ marginTop: 10 }}>{selected.status === 'draft' && can('lms.course.published') && <button className="btn btn-primary btn-sm" disabled={Boolean(busy) || requiredLessons.length === 0} onClick={() => courseAction(selected, 'published')}>Xuất bản</button>}{selected.status === 'published' && can('lms.course.archived') && <button className="btn btn-secondary btn-sm" disabled={Boolean(busy) || courseEnrollments.some((row) => row.status === 'active')} onClick={() => courseAction(selected, 'archived')}>Lưu trữ</button>}<span className="small muted">Bài bắt buộc: {requiredLessons.length} · Học viên: {courseEnrollments.length}</span></div>
        {canEditLessons && can('lms.lesson.create') && <form className="form-grid" style={{ marginTop: 16 }} onSubmit={createLesson}><h3 className="full">Thêm bài học</h3><label className="field"><span className="label">Tên bài học *</span><input className="input" required maxLength="240" value={lessonForm.title} onChange={(event) => setLessonForm({ ...lessonForm, title: event.target.value })}/></label><label className="field"><span className="label">Nội dung / hướng dẫn</span><textarea className="input" rows="3" maxLength="10000" value={lessonForm.content} onChange={(event) => setLessonForm({ ...lessonForm, content: event.target.value })}/></label><label className="row"><input type="checkbox" checked={lessonForm.required} onChange={(event) => setLessonForm({ ...lessonForm, required: event.target.checked })}/> Bài học bắt buộc để hoàn thành khóa</label><div className="row full"><span className="grow"/><button className="btn btn-secondary" disabled={Boolean(busy)}>Thêm bài học</button></div></form>}
        <h3 style={{ marginTop: 18 }}>Nội dung khóa học</h3>{!courseLessons.length ? <div className="empty">Chưa có bài học. Cần ít nhất một bài bắt buộc để xuất bản.</div> : <div className="stack-sm">{courseLessons.map((lesson, index) => <article className="card card-pad" key={lesson.id}><div className="row wrap"><strong>{index + 1}. {lesson.title}</strong><span className="grow"/><span className={`badge ${lesson.required === false ? 'plain' : 'warning'}`}>{lesson.required === false ? 'Tùy chọn' : 'Bắt buộc'}</span></div>{lesson.content && <p className="small" style={{ whiteSpace: 'pre-wrap' }}>{lesson.content}</p>}</article>)}</div>}
        {activeCourse && can('lms.enrollment.create') && <form className="row wrap" style={{ marginTop: 18 }} onSubmit={enroll}><label className="field grow"><span className="label">Ghi danh học viên</span><select className="select" required value={learner} onChange={(event) => setLearner(event.target.value)}><option value="">Chọn người học</option>{[...parties.values()].filter((party) => !courseEnrollments.some((row) => row.learner === party.id)).map((party) => <option key={party.id} value={party.id}>{recordLabel('master-data.party', party)}</option>)}</select></label><button className="btn btn-primary" disabled={Boolean(busy) || !learner}>Ghi danh</button></form>}
        <h3 style={{ marginTop: 18 }}>Học viên và tiến độ</h3>{!can('lms.enrollment.read') ? <div className="empty">Bạn chưa có quyền xem danh sách ghi danh.</div> : !courseEnrollments.length ? <div className="empty">Chưa có học viên ghi danh.</div> : <div className="stack-sm">{courseEnrollments.map((enrollment) => { const done = completedByEnrollment.get(enrollment.id) || new Set(); const nextLesson = courseLessons.find((lesson) => !done.has(lesson.id)); return <article className="card card-pad" key={enrollment.id}><div className="row wrap"><div><strong>{learnerName(enrollment.learner)}</strong><div className="small muted">Ghi danh {fmtDateTime(enrollment.createdAt)}</div></div><span className="grow"/><strong>{Number(enrollment.progress || 0).toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%</strong><span className={`badge ${enrollment.status === 'completed' ? 'success' : 'warning'}`}>{enrollment.status === 'completed' ? 'Hoàn thành' : 'Đang học'}</span></div>{can('lms.lesson_progress.create') && enrollment.status === 'active' && nextLesson && <div className="row wrap" style={{ marginTop: 8 }}><span className="small muted">Bài tiếp theo: {nextLesson.title}</span><span className="grow"/><button className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => completeLesson(enrollment, nextLesson)}>Ghi nhận hoàn thành</button></div>}{!nextLesson && enrollment.status === 'active' && <p className="small success-text" style={{ marginTop: 8 }}>Đã ghi nhận toàn bộ bài học; trạng thái hoàn thành được cập nhật tự động.</p>}</article>; })}</div>}
      </section>}</div>}
  </div>;
}
