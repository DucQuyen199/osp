import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useDocumentTitle } from '../../lib/useDocumentTitle.js';
import { selectableTableRowProps } from '../../lib/accessibility.js';
import { api, dataPath } from '../../lib/api.js';
import { fmtDateTime, statusLabel, fmtNumber, uiTextWith } from '../../lib/i18n.js';
import { can, loadAllResponse, loadRefs, recordLabel } from '../../lib/state.js';
import lmsEnglish from './lms.en.js';
const t = (text) => uiTextWith(text, lmsEnglish);
const rows = (response) => Array.isArray(response?.items) ? response.items : [];
const courseStatus = { draft: 'Bản nháp', published: 'Đang mở học', archived: 'Đã lưu trữ' };
export default function LmsWorkbenchPage() {
  useDocumentTitle(`${t('Đào tạo trực tuyến')} · OSP Suite`);
  const [courses, setCourses] = useState([]);
  const [lessons, setLessons] = useState([]);
  const [enrollments, setEnrollments] = useState([]);
  const [progress, setProgress] = useState([]);
  const [certificates, setCertificates] = useState([]);
  const [parties, setParties] = useState(new Map());
  const [courseId, setCourseId] = useState('');
  const [courseForm, setCourseForm] = useState({ title: '', description: '' });
  const [lessonForm, setLessonForm] = useState({ title: '', content: '', required: true });
  const [learner, setLearner] = useState('');
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [certificateLookup, setCertificateLookup] = useState('');
  const [printingCertificate, setPrintingCertificate] = useState('');
  const load = useCallback(async (quiet = false) => {
    if (!quiet) { setLoading(true); setError(''); }
    try {
      const [courseRes, lessonRes, enrollmentRes, progressRes, certificateRes, partyMap] = await Promise.all([
        can('lms.course.read') ? loadAllResponse('lms.course') : Promise.resolve({ items: [] }),
        can('lms.lesson.read') ? loadAllResponse('lms.lesson') : Promise.resolve({ items: [] }),
        can('lms.enrollment.read') ? loadAllResponse('lms.enrollment') : Promise.resolve({ items: [] }),
        can('lms.lesson_progress.read') ? loadAllResponse('lms.lesson_progress') : Promise.resolve({ items: [] }),
        can('lms.certificate.read') ? loadAllResponse('lms.certificate') : Promise.resolve({ items: [] }),
        can('master-data.party.read') ? loadRefs('master-data.party') : Promise.resolve(new Map()),
      ]);
      const courseRows = rows(courseRes).sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));
      setCourses(courseRows); setLessons(rows(lessonRes)); setEnrollments(rows(enrollmentRes)); setProgress(rows(progressRes)); setCertificates(rows(certificateRes)); setParties(partyMap);
      setCourseId((id) => courseRows.some((course) => course.id === id) ? id : courseRows[0]?.id || '');
      setLearner((id) => id && partyMap.has(id) ? id : [...partyMap.keys()][0] || '');
    } catch (reason) { setError(t(reason.message || 'Không tải được dữ liệu đào tạo.')); }
    finally { if (!quiet) setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const selected = courses.find((course) => course.id === courseId);
  const courseLessons = useMemo(() => lessons.filter((lesson) => lesson.course === courseId).sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || ''))), [lessons, courseId]);
  const courseEnrollments = useMemo(() => enrollments.filter((row) => row.course === courseId).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))), [enrollments, courseId]);
  const completedByEnrollment = useMemo(() => {
    const map = new Map();
    for (const row of progress) { const set = map.get(row.enrollment) || new Set(); set.add(row.lesson); map.set(row.enrollment, set); }
    return map;
  }, [progress]);
  const certificateByEnrollment = useMemo(() => new Map(certificates.map((certificate) => [certificate.enrollment, certificate])), [certificates]);
  const matchedCertificate = certificates.find((certificate) => certificate.certificateNumber?.toLowerCase() === certificateLookup.trim().toLowerCase());
  const activeLearners = enrollments.filter((row) => row.status === 'active').length;
  const completedLearners = enrollments.filter((row) => row.status === 'completed').length;
  const learnerName = (id) => parties.has(id) ? recordLabel('master-data.party', parties.get(id)) : 'Học viên';
  async function run(key, operation, message) {
    setBusy(key); setError(''); setNotice('');
    try { await operation(); await load(true); setNotice(t(message)); }
    catch (reason) { setError(t(reason.message || 'Thao tác không thành công.')); }
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
  useEffect(() => {
    const clearPrinting = () => setPrintingCertificate('');
    window.addEventListener('afterprint', clearPrinting);
    return () => window.removeEventListener('afterprint', clearPrinting);
  }, []);
  function printCertificate(certificate) {
    setPrintingCertificate(certificate.id);
    window.setTimeout(() => window.print(), 50);
  }
  return <div className="page">
    <div className="page-head"><div><h1>{t('Đào tạo trực tuyến')}</h1><p className="sub">{t('Xây dựng khóa học, mở ghi danh, theo dõi tiến độ và lưu lịch sử hoàn thành tự động theo bài học bắt buộc.')}</p></div><button className="btn btn-secondary" type="button" disabled={loading || Boolean(busy)} onClick={() => load()}>{t('Làm mới')}</button></div>
    {error && <div className="alert danger" role="alert">{t(error)}</div>}{notice && <div className="alert success" role="status">{t(notice)}</div>}
    <div className="stats u-legacy-bf4a218e05" ><div className="card stat"><span className="stat-label">{t('Khóa học')}</span><strong className="stat-value">{courses.length}</strong></div><div className="card stat"><span className="stat-label">{t('Đang ghi danh')}</span><strong className="stat-value">{activeLearners}</strong></div><div className="card stat"><span className="stat-label">{t('Đã hoàn thành')}</span><strong className="stat-value">{completedLearners}</strong></div></div>
    {can('lms.course.create') && <section className="card card-pad"><h2>{t('Tạo khóa học')}</h2><form className="form-grid" onSubmit={createCourse}><label className="field"><span className="label">{t('Tên khóa học *')}</span><input className="input" required maxLength="240" value={courseForm.title} onChange={(event) => setCourseForm({ ...courseForm, title: event.target.value })}/></label><label className="field"><span className="label">{t('Mô tả')}</span><input className="input" maxLength="2000" value={courseForm.description} onChange={(event) => setCourseForm({ ...courseForm, description: event.target.value })}/></label><div className="row full"><span className="grow"/><button className="btn btn-primary" disabled={Boolean(busy)}>{t('Tạo bản nháp')}</button></div></form></section>}
    {!can('lms.course.read') ? <div className="empty">{t('Bạn chưa có quyền xem khóa học.')}</div> : loading ? <div className="skeleton" data-h="row"/> : !courses.length ? <div className="empty">{t('Chưa có khóa học.')}</div> : <div className="layout-split"><section className="card table-wrap"><table className="table"><thead><tr><th>{t('Khóa học')}</th><th>{t('Trạng thái')}</th></tr></thead><tbody>{courses.map((course) => <tr {...selectableTableRowProps} key={course.id} aria-selected={courseId === course.id} className={[courseId === course.id ? 'selected' : '', 'u-legacy-9463ff4798'].filter(Boolean).join(' ')} onClick={() => setCourseId(course.id)} ><td><strong>{course.title}</strong><div className="small muted">{lessons.filter((lesson) => lesson.course === course.id).length} {t('bài học')}</div></td><td><span className={`badge ${course.status === 'published' ? 'success' : course.status === 'archived' ? 'plain' : 'warning'}`}>{t(courseStatus[course.status] || statusLabel(course.status))}</span></td></tr>)}</tbody></table></section>
      {selected && <section className="card card-pad"><div className="row wrap"><div><h2>{selected.title}</h2><div className="small muted">{selected.description || t('Chưa có mô tả')} {t('· tạo ')}{fmtDateTime(selected.createdAt)}</div></div><span className="grow"/><span className={`badge ${selected.status === 'published' ? 'success' : selected.status === 'archived' ? 'plain' : 'warning'}`}>{t(courseStatus[selected.status] || statusLabel(selected.status))}</span></div>
        <div className="row wrap u-legacy-df928149c5" >{selected.status === 'draft' && can('lms.course.published') && <button className="btn btn-primary btn-sm" disabled={Boolean(busy) || requiredLessons.length === 0} onClick={() => courseAction(selected, 'published')}>{t('Xuất bản')}</button>}{selected.status === 'published' && can('lms.course.archived') && <button className="btn btn-secondary btn-sm" disabled={Boolean(busy) || courseEnrollments.some((row) => row.status === 'active')} onClick={() => courseAction(selected, 'archived')}>{t('Lưu trữ')}</button>}<span className="small muted">{t('Bài bắt buộc:')} {requiredLessons.length} · {t('Học viên:')} {courseEnrollments.length}</span></div>
        {canEditLessons && can('lms.lesson.create') && <form className="form-grid u-legacy-92c18f6bda"  onSubmit={createLesson}><h3 className="full">{t('Thêm bài học')}</h3><label className="field"><span className="label">{t('Tên bài học *')}</span><input className="input" required maxLength="240" value={lessonForm.title} onChange={(event) => setLessonForm({ ...lessonForm, title: event.target.value })}/></label><label className="field"><span className="label">{t('Nội dung / hướng dẫn')}</span><textarea className="input" rows="3" maxLength="10000" value={lessonForm.content} onChange={(event) => setLessonForm({ ...lessonForm, content: event.target.value })}/></label><label className="row"><input type="checkbox" checked={lessonForm.required} onChange={(event) => setLessonForm({ ...lessonForm, required: event.target.checked })}/> {t('Bài học bắt buộc để hoàn thành khóa')}</label><div className="row full"><span className="grow"/><button className="btn btn-secondary" disabled={Boolean(busy)}>{t('Thêm bài học')}</button></div></form>}
        <h3 className="u-legacy-2bdf8e45fd">{t('Nội dung khóa học')}</h3>{!courseLessons.length ? <div className="empty">{t('Chưa có bài học. Cần ít nhất một bài bắt buộc để xuất bản.')}</div> : <div className="stack-sm">{courseLessons.map((lesson, index) => <article className="card card-pad" key={lesson.id}><div className="row wrap"><strong>{index + 1}. {lesson.title}</strong><span className="grow"/><span className={`badge ${lesson.required === false ? 'plain' : 'warning'}`}>{lesson.required === false ? 'Tùy chọn' : 'Bắt buộc'}</span></div>{lesson.content && <p className="small u-legacy-092af903b2" >{lesson.content}</p>}</article>)}</div>}
        {activeCourse && can('lms.enrollment.create') && <form className="row wrap u-legacy-2bdf8e45fd"  onSubmit={enroll}><label className="field grow"><span className="label">{t('Ghi danh học viên')}</span><select className="select" required value={learner} onChange={(event) => setLearner(event.target.value)}><option value="">{t('Chọn người học')}</option>{[...parties.values()].filter((party) => !courseEnrollments.some((row) => row.learner === party.id)).map((party) => <option key={party.id} value={party.id}>{recordLabel('master-data.party', party)}</option>)}</select></label><button className="btn btn-primary" disabled={Boolean(busy) || !learner}>{t('Ghi danh')}</button></form>}
        <h3 className="u-legacy-2bdf8e45fd">{t('Học viên và tiến độ')}</h3>{!can('lms.enrollment.read') ? <div className="empty">{t('Bạn chưa có quyền xem danh sách ghi danh.')}</div> : !courseEnrollments.length ? <div className="empty">{t('Chưa có học viên ghi danh.')}</div> : <div className="stack-sm">{courseEnrollments.map((enrollment) => { const done = completedByEnrollment.get(enrollment.id) || new Set(); const nextLesson = courseLessons.find((lesson) => !done.has(lesson.id)); const certificate = certificateByEnrollment.get(enrollment.id); return <article className={`card card-pad ${printingCertificate === certificate?.id ? 'lms-certificate is-printing' : ''}`} key={enrollment.id}><div className="row wrap"><div><strong>{learnerName(enrollment.learner)}</strong><div className="small muted">{t('Ghi danh ')}{fmtDateTime(enrollment.createdAt)}</div></div><span className="grow"/><strong>{fmtNumber(Number(enrollment.progress || 0), { maximumFractionDigits: 1 })}%</strong><span className={`badge ${enrollment.status === 'completed' ? 'success' : 'warning'}`}>{t(enrollment.status === 'completed' ? 'Hoàn thành' : 'Đang học')}</span></div>{can('lms.lesson_progress.create') && enrollment.status === 'active' && nextLesson && <div className="row wrap u-legacy-43a97fe494" ><span className="small muted">{t('Bài tiếp theo:')} {nextLesson.title}</span><span className="grow"/><button className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => completeLesson(enrollment, nextLesson)}>{t('Ghi nhận hoàn thành')}</button></div>}{!nextLesson && enrollment.status === 'active' && <p className="small success-text u-legacy-43a97fe494" >{t('Đã ghi nhận toàn bộ bài học; trạng thái hoàn thành được cập nhật tự động.')}</p>}{certificate && <div className="lms-certificate-body"><div className="lms-certificate-kicker">{t('OSP SUITE · CHỨNG NHẬN HOÀN THÀNH')}</div><h2>{certificate.courseTitle}</h2><p>{t('Chứng nhận được cấp cho')}</p><strong className="lms-certificate-learner">{certificate.learnerName}</strong><p>{t('đã hoàn thành đầy đủ các bài học bắt buộc của khóa học.')}</p><div className="lms-certificate-number">{t('Số chứng chỉ:')} {certificate.certificateNumber}</div><div className="small muted">{t('Ngày cấp ')}{fmtDateTime(certificate.issuedAt)}</div></div>}{certificate && can('lms.certificate.read') && <div className="row lms-certificate-toolbar u-legacy-df928149c5" ><span className="small muted">{t('Chứng chỉ ')}{certificate.certificateNumber}</span><span className="grow"/><button className="btn btn-secondary btn-sm" type="button" onClick={() => printCertificate(certificate)}>{t('In chứng chỉ')}</button></div>}</article>; })}</div>}
        {can('lms.certificate.read') && <section className="card card-pad lms-certificate-lookup"><h3>{t('Tra cứu chứng chỉ')}</h3><div className="row wrap"><label className="field grow"><span className="label">{t('Số chứng chỉ')}</span><input className="input" value={certificateLookup} onChange={(event) => setCertificateLookup(event.target.value)} placeholder="OSP-LMS-…"/></label></div>{certificateLookup.trim() && <div className={matchedCertificate ? 'alert success' : 'alert'} role="status">{matchedCertificate ? <>{t('Chứng chỉ hợp lệ · ')}{matchedCertificate.learnerName} · {matchedCertificate.courseTitle} {t(' · cấp ')}{fmtDateTime(matchedCertificate.issuedAt)}</> : t('Không tìm thấy số chứng chỉ này.')}</div>}</section>}
      </section>}</div>}
  </div>;
}
