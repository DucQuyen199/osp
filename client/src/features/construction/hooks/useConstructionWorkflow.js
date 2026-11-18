import { useEffect, useState } from 'react';
import { api, dataPath } from '../../../lib/api.js';

const blankBoqLine = () => ({ rowId: crypto.randomUUID(), description: '', unit: '', qty: '1', unit_price: '' });

export function useConstructionWorkflow({
  load, projectId, setProjectId, projects, sites, subcontracts, parties, setError, t, today,
}) {
  const [siteForm, setSiteForm] = useState({ name: '', project: '', address: '' });
  const [diaryForm, setDiaryForm] = useState({ site: '', date: today(), weather: '', notes: '' });
  const [boqForm, setBoqForm] = useState({ project: '', supersedes: '', revision_reason: '' });
  const [boqLines, setBoqLines] = useState([blankBoqLine()]);
  const [subcontractForm, setSubcontractForm] = useState({ project: '', vendor: '', value: '', scope: '' });
  const [claimForm, setClaimForm] = useState({ subcontract: '', period: today(), amount: '', notes: '' });
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    setSiteForm((current) => ({ ...current, project: current.project || projects.find((row) => ['planned', 'active'].includes(row.status))?.id || '' }));
    setDiaryForm((current) => ({ ...current, site: current.site || sites.find((site) => site.project === projects[0]?.id)?.id || sites.find((site) => !site.project)?.id || '' }));
    setBoqForm((current) => ({ ...current, project: current.project || projects.find((row) => ['planned', 'active'].includes(row.status))?.id || '' }));
    setSubcontractForm((current) => ({ ...current, project: current.project || projects.find((row) => row.status === 'active')?.id || '', vendor: current.vendor || [...parties.keys()][0] || '' }));
    setClaimForm((current) => ({ ...current, subcontract: current.subcontract || subcontracts.find((row) => row.status === 'signed')?.id || '' }));
  }, [projects, sites, subcontracts, parties]);

  async function run(key, operation, success) {
    setBusy(key); setError(''); setNotice('');
    try { await operation(); setNotice(t(success)); await load(true); }
    catch (reason) { setError(t(reason.message || 'Thao tác không thành công.')); await load(true); }
    finally { setBusy(''); }
  }

  async function createSite(event) {
    event.preventDefault();
    await run('site', () => api(dataPath('construction.site'), { method: 'POST', body: { ...siteForm, project: projectId || undefined } }), 'Đã tạo hồ sơ công trường.');
    setSiteForm((current) => ({ ...current, name: '', address: '' }));
  }

  async function createDiary(event) {
    event.preventDefault();
    await run('diary', () => api(dataPath('construction.site_diary'), { method: 'POST', body: { ...diaryForm, weather: diaryForm.weather || undefined, notes: diaryForm.notes || undefined } }), 'Đã ghi nhật ký thi công. Nhật ký được lưu thành lịch sử không thể sửa.');
    setDiaryForm((current) => ({ ...current, weather: '', notes: '' }));
  }

  async function createBoq(event) {
    event.preventDefault();
    await run('boq', async () => {
      const payload = {
        ...boqForm, project: boqForm.project, supersedes: boqForm.supersedes || undefined,
        revision_reason: boqForm.revision_reason || undefined,
        items: boqLines.map((line) => ({ description: line.description.trim(), unit: line.unit.trim(), qty: String(line.qty), unit_price: String(line.unit_price) })),
      };
      delete payload.revision;
      await api(dataPath('construction.boq'), { method: 'POST', body: payload });
    }, 'Đã lập dự toán BOQ nháp; tổng giá trị được máy chủ tính từ khối lượng và đơn giá.');
    setBoqLines([blankBoqLine()]);
    setBoqForm((current) => ({ ...current, supersedes: '', revision_reason: '' }));
  }

  async function createSubcontract(event) {
    event.preventDefault();
    await run('subcontract', () => api(dataPath('construction.subcontract'), { method: 'POST', body: { ...subcontractForm, project: projectId, value: String(subcontractForm.value) } }), 'Đã lập dự thảo hợp đồng thầu phụ.');
    setSubcontractForm((current) => ({ ...current, value: '', scope: '' }));
  }

  async function createClaim(event) {
    event.preventDefault();
    const contract = subcontracts.find((row) => row.id === claimForm.subcontract);
    if (!contract) return;
    await run('claim', () => api(dataPath('construction.progress_claim'), { method: 'POST', body: { ...claimForm, vendor: contract.vendor, amount: String(claimForm.amount), notes: claimForm.notes || undefined } }), 'Đã lập hồ sơ nghiệm thu/đề nghị thanh toán nháp.');
    setClaimForm((current) => ({ ...current, amount: '', notes: '' }));
  }

  async function transition(entity, row, verb, success) {
    await run(`${row.id}:${verb}`, () => api(dataPath(entity, row.id, verb), { method: 'POST' }), success);
  }

  function selectProject(id) {
    setProjectId(id);
    setSiteForm((current) => ({ ...current, project: id }));
    setSubcontractForm((current) => ({ ...current, project: id }));
    setDiaryForm((current) => ({ ...current, site: sites.find((site) => site.project === id)?.id || sites.find((site) => !site.project)?.id || '' }));
  }

  function addBoqLine() { setBoqLines((current) => [...current, blankBoqLine()]); }
  function updateBoqLine(index, field, value) { setBoqLines((current) => current.map((line, i) => i === index ? { ...line, [field]: value } : line)); }
  function removeBoqLine(index) { setBoqLines((current) => current.filter((_, i) => i !== index)); }
  function reviseBoq(row) {
    setBoqForm({ project: row.project, supersedes: row.id, revision_reason: '' });
    setBoqLines((row.items || []).map((item) => ({ ...blankBoqLine(), description: item.description || '', unit: item.unit || '', qty: String(item.qty || 1), unit_price: String(item.unit_price || 0) })));
  }

  return {
    siteForm, setSiteForm, diaryForm, setDiaryForm, boqForm, setBoqForm, boqLines, setBoqLines,
    subcontractForm, setSubcontractForm, claimForm, setClaimForm,
    busy, notice, createSite, createDiary, createBoq, createSubcontract, createClaim, transition,
    selectProject, addBoqLine, updateBoqLine, removeBoqLine, reviseBoq,
  };
}
