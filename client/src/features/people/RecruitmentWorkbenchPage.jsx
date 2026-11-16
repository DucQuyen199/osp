import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useDocumentTitle } from '../../lib/useDocumentTitle.js';
import { selectableTableRowProps } from '../../lib/accessibility.js';
import { api, dataPath } from '../../lib/api.js';
import { statusLabel, uiTextWith } from '../../lib/i18n.js';
import { app, can, loadRefs, recordLabel, loadAllResponse } from '../../lib/state.js';
import recruitmentEnglish from './recruitment.en.js';
const t = (text) => uiTextWith(text, recruitmentEnglish);
const itemsOf = (response) => Array.isArray(response?.items) ? response.items : [];
const action = (entity, row, verb) => api(dataPath(entity, row.id, verb), { method: 'POST' });
const stages = ['Sàng lọc hồ sơ', 'Phỏng vấn', 'Tham chiếu', 'Đề nghị tuyển dụng'];
export default function RecruitmentWorkbenchPage() {
  useDocumentTitle(`${t('Tuyển dụng')} · OSP Suite`);
  const [jobs, setJobs] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [applications, setApplications] = useState([]);
  const [departments, setDepartments] = useState(new Map());
  const [positions, setPositions] = useState(new Map());
  const [jobForm, setJobForm] = useState({ title: '', department: '', position: '', headcount: '' });
  const [candidateForm, setCandidateForm] = useState({ name: '', email: '', phone: '' });
  const [applicationForm, setApplicationForm] = useState({ job: '', candidate: '' });
  const [selectedId, setSelectedId] = useState('');
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const load = useCallback(async (quiet = false) => {
    if (!quiet) { setLoading(true); setError(''); }
    try {
      const [jobRes, candidateRes, applicationRes, departmentMap, positionMap] = await Promise.all([
        can('recruitment.job_opening.read') ? loadAllResponse('recruitment.job_opening') : Promise.resolve({ items: [] }),
        can('recruitment.candidate.read') ? loadAllResponse('recruitment.candidate') : Promise.resolve({ items: [] }),
        can('recruitment.application.read') ? loadAllResponse('recruitment.application') : Promise.resolve({ items: [] }),
        can('hrm.department.read') ? loadRefs('hrm.department') : Promise.resolve(new Map()),
        can('hrm.position.read') ? loadRefs('hrm.position') : Promise.resolve(new Map()),
      ]);
      const jobRows = itemsOf(jobRes).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
      const candidateRows = itemsOf(candidateRes).sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'vi'));
      const applicationRows = itemsOf(applicationRes).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
      setJobs(jobRows); setCandidates(candidateRows); setApplications(applicationRows); setDepartments(departmentMap); setPositions(positionMap);
      setSelectedId((id) => applicationRows.some((row) => row.id === id) ? id : applicationRows[0]?.id || '');
      setApplicationForm((form) => ({ ...form, job: form.job || jobRows.find((row) => row.status === 'open')?.id || '', candidate: form.candidate || candidateRows[0]?.id || '' }));
    } catch (reason) { setError(t(reason.message || 'Không tải được dữ liệu tuyển dụng.')); }
    finally { if (!quiet) setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const jobById = useMemo(() => new Map(jobs.map((row) => [row.id, row])), [jobs]);
  const candidateById = useMemo(() => new Map(candidates.map((row) => [row.id, row])), [candidates]);
  const selected = applications.find((row) => row.id === selectedId);
  const openJobs = jobs.filter((row) => row.status === 'open');
  const activeApplications = applications.filter((row) => row.status === 'applied');
  const hiredApplications = applications.filter((row) => row.status === 'hired');
  const rejectedApplications = applications.filter((row) => row.status === 'rejected');
  async function run(key, operation, success) {
    setBusy(key); setError(''); setNotice('');
    try { await operation(); setNotice(t(success)); await load(true); }
    catch (reason) { setError(t(reason.message || 'Thao tác không thành công.')); await load(true); }
    finally { setBusy(''); }
  }
  async function saveJob(event) {
    event.preventDefault();
    const payload = { title: jobForm.title.trim(), department: jobForm.department || undefined, position: jobForm.position || undefined, headcount: jobForm.headcount ? Number(jobForm.headcount) : undefined };
    await run('job:create', async () => { const row = await api(dataPath('recruitment.job_opening'), { method: 'POST', body: payload }); setJobForm({ title: '', department: '', position: '', headcount: '' }); setApplicationForm((form) => ({ ...form, job: form.job || row.id })); }, 'Đã mở vị trí tuyển dụng.');
  }
  async function saveCandidate(event) {
    event.preventDefault();
    const payload = { name: candidateForm.name.trim(), email: candidateForm.email.trim() || undefined, phone: candidateForm.phone.trim() || undefined };
    await run('candidate:create', async () => { const row = await api(dataPath('recruitment.candidate'), { method: 'POST', body: payload }); setCandidateForm({ name: '', email: '', phone: '' }); setApplicationForm((form) => ({ ...form, candidate: form.candidate || row.id })); }, 'Đã lưu hồ sơ ứng viên.');
  }
  async function createApplication(event) {
    event.preventDefault();
    const candidate = candidateById.get(applicationForm.candidate);
    if (!candidate) return;
    await run('application:create', async () => {
      const row = await api(dataPath('recruitment.application'), { method: 'POST', body: { job: applicationForm.job, candidate: candidate.id, candidate_name: candidate.name, stage: stages[0] } });
      await action('recruitment.application', row, 'applied'); setSelectedId(row.id);
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
  const hiredFor = (jobId) => applications.filter((row) => row.job === jobId && row.status === 'hired').length;
  return <div className="page">
    <div className="page-head"><div><h1>{t('Tuyển dụng và quản lý ứng viên')}</h1><p className="sub">{t('Mở vị trí, lưu hồ sơ ứng viên, theo dõi từng vòng tuyển và chuyển ứng viên trúng tuyển thành nhân viên.')}</p></div><button className="btn btn-secondary" type="button" disabled={loading || Boolean(busy)} onClick={() => load()}>{t('Làm mới')}</button></div>
    {error && <div className="alert danger" role="alert">{t(error)}</div>}{notice && <div className="alert success" role="status">{t(notice)}</div>}
    <div className="stats u-legacy-bf4a218e05" ><div className="card stat"><span className="stat-label">{t('Vị trí đang mở')}</span><strong className="stat-value">{openJobs.length}</strong></div><div className="card stat"><span className="stat-label">{t('Hồ sơ đang xét')}</span><strong className="stat-value">{activeApplications.length}</strong></div><div className="card stat"><span className="stat-label">{t('Đã tuyển')}</span><strong className="stat-value">{hiredApplications.length}</strong></div><div className="card stat"><span className="stat-label">{t('Đã từ chối')}</span><strong className="stat-value">{rejectedApplications.length}</strong></div></div>
    <div className="layout-split">
      {can('recruitment.job_opening.create') && <section className="card card-pad"><h2>{t('Mở vị trí tuyển dụng')}</h2><form onSubmit={saveJob}><label className="field"><span className="label">{t('Tên vị trí *')}</span><input className="input" required value={jobForm.title} onChange={(event) => setJobForm({ ...jobForm, title: event.target.value })} placeholder={t("Ví dụ: Kế toán tổng hợp")}/></label><div className="form-grid u-legacy-df928149c5" ><label className="field"><span className="label">{t('Phòng ban')}</span><select className="select" value={jobForm.department} onChange={(event) => setJobForm({ ...jobForm, department: event.target.value })}><option value="">{t('Chọn phòng ban')}</option>{[...departments.values()].map((row) => <option key={row.id} value={row.id}>{recordLabel('hrm.department', row)}</option>)}</select></label><label className="field"><span className="label">{t('Chức danh')}</span><select className="select" value={jobForm.position} onChange={(event) => setJobForm({ ...jobForm, position: event.target.value })}><option value="">{t('Chọn chức danh')}</option>{[...positions.values()].map((row) => <option key={row.id} value={row.id}>{recordLabel('hrm.position', row)}</option>)}</select></label><label className="field"><span className="label">{t('Số lượng cần tuyển')}</span><input className="input num" type="number" min="1" step="1" value={jobForm.headcount} onChange={(event) => setJobForm({ ...jobForm, headcount: event.target.value })}/></label></div><button className="btn btn-primary u-legacy-0ee7f66ad9"  disabled={Boolean(busy)}>{t('Mở vị trí')}</button></form></section>}
      {can('recruitment.candidate.create') && <section className="card card-pad"><h2>{t('Tiếp nhận ứng viên')}</h2><form onSubmit={saveCandidate}><label className="field"><span className="label">{t('Họ và tên *')}</span><input className="input" required value={candidateForm.name} onChange={(event) => setCandidateForm({ ...candidateForm, name: event.target.value })}/></label><div className="form-grid u-legacy-df928149c5" ><label className="field"><span className="label">Email</span><input className="input" type="email" value={candidateForm.email} onChange={(event) => setCandidateForm({ ...candidateForm, email: event.target.value })}/></label><label className="field"><span className="label">{t('Điện thoại')}</span><input className="input" type="tel" value={candidateForm.phone} onChange={(event) => setCandidateForm({ ...candidateForm, phone: event.target.value })}/></label></div><button className="btn btn-primary u-legacy-0ee7f66ad9"  disabled={Boolean(busy)}>{t('Lưu ứng viên')}</button></form></section>}
    </div>
    {can('recruitment.application.create') && <section className="card card-pad u-legacy-92c18f6bda" ><h2>{t('Tạo hồ sơ ứng tuyển')}</h2><form className="form-grid" onSubmit={createApplication}><label className="field"><span className="label">{t('Vị trí *')}</span><select className="select" required value={applicationForm.job} onChange={(event) => setApplicationForm({ ...applicationForm, job: event.target.value })}><option value="">{t('Chọn vị trí đang mở')}</option>{openJobs.map((row) => <option key={row.id} value={row.id}>{row.title} · còn {row.headcount == null ? t('không giới hạn') : Math.max(0, Number(row.headcount) - hiredFor(row.id))} {t('chỗ')}</option>)}</select></label><label className="field"><span className="label">{t('Ứng viên *')}</span><select className="select" required value={applicationForm.candidate} onChange={(event) => setApplicationForm({ ...applicationForm, candidate: event.target.value })}><option value="">{t('Chọn ứng viên')}</option>{candidates.map((row) => <option key={row.id} value={row.id}>{row.name}{row.email ? ` · ${row.email}` : ''}</option>)}</select></label><div className="row"><span className="grow"/><button className="btn btn-primary" disabled={Boolean(busy) || !openJobs.length || !candidates.length}>{t('Tạo và đưa vào sàng lọc')}</button></div></form></section>}
    <div className="layout-split u-legacy-92c18f6bda" >
      <section className="card card-pad"><h2>{t('Vị trí tuyển dụng')}</h2>{loading ? <div className="skeleton" data-h="row"/> : !jobs.length ? <div className="empty">{t('Chưa có vị trí tuyển dụng.')}</div> : <div className="table-wrap"><table className="table"><thead><tr><th>{t('Vị trí / phòng ban')}</th><th>{t('Ứng viên')}</th><th>{t('Trạng thái')}</th><th/></tr></thead><tbody>{jobs.map((row) => <tr key={row.id}><td><strong>{row.title}</strong><div className="small muted">{departments.get(row.department) ? recordLabel('hrm.department', departments.get(row.department)) : t('Chưa gắn phòng ban')}{positions.get(row.position) ? ` · ${recordLabel('hrm.position', positions.get(row.position))}` : ''}</div></td><td>{hiredFor(row.id)} / {row.headcount ?? '∞'} {t('đã tuyển')}</td><td>{statusLabel(row.status)}</td><td>{row.status === 'open' && can('recruitment.job_opening.closed') && <button className="btn btn-secondary btn-sm" disabled={Boolean(busy) || applications.some((item) => item.job === row.id && item.status === 'applied')} onClick={() => closeJob(row)}>{t('Đóng vị trí')}</button>}</td></tr>)}</tbody></table></div>}</section>
      <section className="card card-pad"><h2>{t('Hồ sơ ứng tuyển')}</h2>{loading ? <div className="skeleton" data-h="row"/> : !applications.length ? <div className="empty">{t('Chưa có hồ sơ ứng tuyển.')}</div> : <div className="table-wrap"><table className="table"><thead><tr><th>{t('Ứng viên / vị trí')}</th><th>{t('Vòng tuyển')}</th><th>{t('Trạng thái')}</th></tr></thead><tbody>{applications.map((row) => <tr {...selectableTableRowProps} key={row.id} aria-selected={selectedId === row.id} className={[selectedId === row.id ? 'selected' : '', 'u-legacy-9463ff4798'].filter(Boolean).join(' ')} onClick={() => setSelectedId(row.id)} ><td><strong>{candidateById.get(row.candidate)?.name || row.candidate_name}</strong><div className="small muted">{jobById.get(row.job)?.title || t('Vị trí')}</div></td><td>{row.stage || t('Chưa phân loại')}</td><td>{statusLabel(row.status)}</td></tr>)}</tbody></table></div>}</section>
    </div>
    {selected && <section className="card card-pad u-legacy-92c18f6bda" ><div className="row wrap"><div><h2>{candidateById.get(selected.candidate)?.name || selected.candidate_name}</h2><div className="small muted">{candidateById.get(selected.candidate)?.email || t('Không có email')} · {jobById.get(selected.job)?.title || t('Vị trí tuyển dụng')}</div></div><span className="grow"/><span className="badge warning">{statusLabel(selected.status)}</span></div>
      {selected.status === 'applied' && <><label className="field u-legacy-dead288792" ><span className="label">{t('Vòng tuyển dụng')}</span><select className="select" value={stages.includes(selected.stage) ? selected.stage : stages[0]} disabled={!can('recruitment.application.update') || Boolean(busy)} onChange={(event) => updateStage(selected, event.target.value)}>{stages.map((stage) => <option key={stage} value={stage}>{t(stage)}</option>)}</select></label><div className="row wrap u-legacy-0ee7f66ad9" ><span className="grow"/>{can('recruitment.application.rejected') && <button className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => decide(selected, 'rejected')}>{t('Từ chối')}</button>}{can('recruitment.application.hired') && <button className="btn btn-primary btn-sm" disabled={Boolean(busy) || (jobById.get(selected.job)?.headcount != null && hiredFor(selected.job) >= Number(jobById.get(selected.job).headcount))} onClick={() => decide(selected, 'hired')}>{t('Tuyển và tạo hồ sơ nhân viên')}</button>}</div></>}
      {selected.status === 'hired' && <p className="alert success u-legacy-0ee7f66ad9" >{t('Ứng viên đã được tuyển. Hồ sơ nhân viên được tạo tự động trong module HRM.')}</p>}
    </section>}
    <p className="small muted u-legacy-0ee7f66ad9" >{t('Mỗi ứng viên chỉ được ứng tuyển một lần cho cùng vị trí. Số lượng tuyển và email ứng viên được kiểm tra ở máy chủ; khi tuyển thành công, hồ sơ nhân viên được tạo trong cùng luồng sự kiện.')}</p>
  </div>;
}
