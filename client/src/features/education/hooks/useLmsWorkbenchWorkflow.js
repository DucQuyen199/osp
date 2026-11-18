import { useEffect, useState } from 'react';
import { api, dataPath } from '../../../lib/api.js';

export function useLmsWorkbenchWorkflow({ courses, parties, load, setError, t }) {
  const [courseId, setCourseId] = useState('');
  const [courseForm, setCourseForm] = useState({ title: '', description: '' });
  const [lessonForm, setLessonForm] = useState({ title: '', content: '', required: true });
  const [learner, setLearner] = useState('');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [certificateLookup, setCertificateLookup] = useState('');
  const [printingCertificate, setPrintingCertificate] = useState('');

  useEffect(() => {
    setCourseId((id) => courses.some((course) => course.id === id) ? id : courses[0]?.id || '');
  }, [courses]);
  useEffect(() => {
    setLearner((id) => id && parties.has(id) ? id : [...parties.keys()][0] || '');
  }, [parties]);
  useEffect(() => {
    const clearPrinting = () => setPrintingCertificate('');
    window.addEventListener('afterprint', clearPrinting);
    return () => window.removeEventListener('afterprint', clearPrinting);
  }, []);

  async function run(key, operation, message) {
    setBusy(key); setError(''); setNotice('');
    try { await operation(); await load(true); setNotice(t(message)); }
    catch (reason) { setError(t(reason.message || 'Thao tÃ¡c khÃ´ng thÃ nh cÃ´ng.')); }
    finally { setBusy(''); }
  }
  async function createCourse(event) {
    event.preventDefault();
    await run('course:create', async () => {
      const created = await api(dataPath('lms.course'), { method: 'POST', body: { title: courseForm.title.trim(), ...(courseForm.description.trim() ? { description: courseForm.description.trim() } : {}) } });
      setCourseId(created.id); setCourseForm({ title: '', description: '' });
    }, 'ÄÃ£ táº¡o khÃ³a há»c nhÃ¡p.');
  }
  async function createLesson(event) {
    event.preventDefault();
    const selected = courses.find((course) => course.id === courseId);
    if (!selected) return;
    await run(`${courseId}:lesson`, async () => {
      await api(dataPath('lms.lesson'), { method: 'POST', body: { course: courseId, title: lessonForm.title.trim(), ...(lessonForm.content.trim() ? { content: lessonForm.content.trim() } : {}), required: lessonForm.required } });
      setLessonForm({ title: '', content: '', required: true });
    }, 'ÄÃ£ thÃªm bÃ i há»c.');
  }
  async function courseAction(course, action) {
    const message = action === 'published' ? 'ÄÃ£ má»Ÿ khÃ³a há»c Ä‘á»ƒ ghi danh.' : 'ÄÃ£ lÆ°u trá»¯ khÃ³a há»c.';
    await run(`${course.id}:${action}`, () => api(dataPath('lms.course', course.id, action), { method: 'POST' }), message);
  }
  async function enroll(event) {
    event.preventDefault();
    const selected = courses.find((course) => course.id === courseId);
    if (!selected || !learner) return;
    await run(`${courseId}:enroll`, () => api(dataPath('lms.enrollment'), { method: 'POST', body: { course: courseId, learner } }), 'ÄÃ£ ghi danh há»c viÃªn.');
  }
  async function completeLesson(enrollment, lesson) {
    await run(`${enrollment.id}:${lesson.id}`, () => api(dataPath('lms.lesson_progress'), { method: 'POST', body: { enrollment: enrollment.id, lesson: lesson.id } }), 'ÄÃ£ ghi nháº­n hoÃ n thÃ nh bÃ i há»c; tiáº¿n Ä‘á»™ khÃ³a há»c Ä‘Æ°á»£c cáº­p nháº­t tá»± Ä‘á»™ng.');
  }
  function printCertificate(certificate) {
    setPrintingCertificate(certificate.id);
    window.setTimeout(() => window.print(), 50);
  }

  return {
    courseId, setCourseId, courseForm, setCourseForm, lessonForm, setLessonForm, learner, setLearner,
    busy, notice, certificateLookup, setCertificateLookup, printingCertificate,
    createCourse, createLesson, courseAction, enroll, completeLesson, printCertificate,
  };
}
