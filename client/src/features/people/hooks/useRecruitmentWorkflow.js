import { useEffect, useState } from 'react';
import { api, dataPath } from '../../../lib/api.js';

export const RECRUITMENT_STAGES = ['Sàng lọc hồ sơ', 'Phỏng vấn', 'Tham chiếu', 'Đề nghị tuyển dụng'];
const action = (entity, row, verb) => api(dataPath(entity, row.id, verb), { method: 'POST' });

export function useRecruitmentWorkflow({ jobs, candidates, candidateById, load, setSelectedId, setError, t }) {
  const [jobForm, setJobForm] = useState({ title: '', department: '', position: '', headcount: '' });
  const [candidateForm, setCandidateForm] = useState({ name: '', email: '', phone: '' });
  const [applicationForm, setApplicationForm] = useState({ job: '', candidate: '' });
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    setApplicationForm((form) => ({
      ...form,
      job: form.job || jobs.find((row) => row.status === 'open')?.id || '',
      candidate: form.candidate || candidates[0]?.id || '',
    }));
  }, [jobs, candidates]);

  async function run(key, operation, success) {
    setBusy(key); setError(''); setNotice('');
    try { await operation(); setNotice(t(success)); await load(true); }
    catch (reason) { setError(t(reason.message || 'Thao tác không thành công.')); await load(true); }
    finally { setBusy(''); }
  }
  async function saveJob(event) {
    event.preventDefault();
    const payload = { title: jobForm.title.trim(), department: jobForm.department || undefined, position: jobForm.position || undefined, headcount: jobForm.headcount ? Number(jobForm.headcount) : undefined };
    await run('job:create', async () => {
      const row = await api(dataPath('recruitment.job_opening'), { method: 'POST', body: payload });
      setJobForm({ title: '', department: '', position: '', headcount: '' });
      setApplicationForm((form) => ({ ...form, job: form.job || row.id }));
    }, 'Đã mở vị trí tuyển dụng.');
  }
  async function saveCandidate(event) {
    event.preventDefault();
    const payload = { name: candidateForm.name.trim(), email: candidateForm.email.trim() || undefined, phone: candidateForm.phone.trim() || undefined };
    await run('candidate:create', async () => {
      const row = await api(dataPath('recruitment.candidate'), { method: 'POST', body: payload });
      setCandidateForm({ name: '', email: '', phone: '' });
      setApplicationForm((form) => ({ ...form, candidate: form.candidate || row.id }));
    }, 'Đã lưu hồ sơ ứng viên.');
  }
  async function createApplication(event) {
    event.preventDefault();
    const candidate = candidateById.get(applicationForm.candidate);
    if (!candidate) return;
    await run('application:create', async () => {
      const row = await api(dataPath('recruitment.application'), { method: 'POST', body: { job: applicationForm.job, candidate: candidate.id, candidate_name: candidate.name, stage: RECRUITMENT_STAGES[0] } });
      await action('recruitment.application', row, 'applied');
      setSelectedId(row.id);
    }, 'Đã ghi nhận hồ sơ ứng tuyển ở vòng sàng lọc.');
  }
  async function updateStage(row, stage) {
    if (!stage || stage === row.stage) return;
    await run(`${row.id}:stage`, () => api(dataPath('recruitment.application', row.id), { method: 'PATCH', body: { stage } }), 'Đã cập nhật vòng tuyển dụng.');
  }
  async function decide(row, verb) {
    const messages = { hired: 'Đã tuyển ứng viên; hồ sơ nhân viên được tạo tự động trong HRM.', rejected: 'Đã từ chối hồ sơ và lưu lại lịch sử tuyển dụng.' };
    await run(`${row.id}:${verb}`, () => action('recruitment.application', row, verb), messages[verb]);
  }
  async function closeJob(row) {
    await run(`${row.id}:closed`, () => action('recruitment.job_opening', row, 'closed'), 'Đã đóng vị trí tuyển dụng.');
  }

  return {
    jobForm, setJobForm, candidateForm, setCandidateForm,
    applicationForm, setApplicationForm, busy, notice,
    saveJob, saveCandidate, createApplication, updateStage, decide, closeJob,
  };
}
