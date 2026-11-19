import { useEffect, useState } from 'react';
import { api, dataPath, session } from '../../../lib/api.js';
import { clearPersistentIdempotencyRequest, getPersistentIdempotencyRequest } from '../../../lib/idempotency.js';

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

  async function createRecord(qname, payload) {
    const scope = `${session.current()?.tenantId || ''}:create:${qname}`;
    const { key, fingerprint } = getPersistentIdempotencyRequest(scope, JSON.stringify(payload));
    const result = await api(dataPath(qname), {
      method: 'POST',
      body: payload,
      headers: { 'idempotency-key': key },
    });
    clearPersistentIdempotencyRequest(scope, fingerprint);
    return result;
  }

  useEffect(() => {
    setSiteForm((current) => ({ ...current, project: current.project || projects.find((row) => ['planned', 'active'].includes(row.status))?.id || '' }));
    setDiaryForm((current) => ({ ...current, site: current.site || sites.find((site) => site.project === projects[0]?.id)?.id || sites.find((site) => !site.project)?.id || '' }));
    setBoqForm((current) => ({ ...current, project: current.project || projects.find((row) => ['planned', 'active'].includes(row.status))?.id || '' }));
    setSubcontractForm((current) => ({ ...current, project: current.project || projects.find((row) => row.status === 'active')?.id || '', vendor: current.vendor || [...parties.keys()][0] || '' }));
    setClaimForm((current) => ({ ...current, subcontract: current.subcontract || subcontracts.find((row) => row.status === 'signed')?.id || '' }));
  }, [projects, sites, subcontracts, parties]);

  async function run(key, operation, success) {
    setBusy(key); setError(''); setNotice('');
    try { await operation(); setNotice(t(success)); await load(true); return true; }
    catch (reason) { setError(t(reason.message || 'Thao tác không thành công.')); await load(true); return false; }
    finally { setBusy(''); }
  }

  async function createSite(event) {
    event.preventDefault();
    const created = await run('site', () => createRecord('construction.site', { ...siteForm, project: projectId || undefined }), 'Đã tạo hồ sơ công trường.');
    if (created) setSiteForm((current) => ({ ...current, name: '', address: '' }));
  }

  async function createDiary(event) {
    event.preventDefault();
    const payload = { ...diaryForm, weather: diaryForm.weather || undefined, notes: diaryForm.notes || undefined };
    const created = await run('diary', () => createRecord('construction.site_diary', payload), 'Đã ghi nhật ký thi công. Nhật ký được lưu thành lịch sử không thể sửa.');
    if (created) setDiaryForm((current) => ({ ...current, weather: '', notes: '' }));
  }

  async function createBoq(event) {
    event.preventDefault();
    const created = await run('boq', async () => {
      const payload = {
        ...boqForm, project: boqForm.project, supersedes: boqForm.supersedes || undefined,
        revision_reason: boqForm.revision_reason || undefined,
        items: boqLines.map((line) => ({ description: line.description.trim(), unit: line.unit.trim(), qty: String(line.qty), unit_price: String(line.unit_price) })),
      };
      delete payload.revision;
      await createRecord('construction.boq', payload);
    }, 'Đã lập dự toán BOQ nháp; tổng giá trị được máy chủ tính từ khối lượng và đơn giá.');
    if (created) {
      setBoqLines([blankBoqLine()]);
      setBoqForm((current) => ({ ...current, supersedes: '', revision_reason: '' }));
    }
  }

  async function createSubcontract(event) {
    event.preventDefault();
    const payload = { ...subcontractForm, project: projectId, value: String(subcontractForm.value) };
    const created = await run('subcontract', () => createRecord('construction.subcontract', payload), 'Đã lập dự thảo hợp đồng thầu phụ.');
    if (created) setSubcontractForm((current) => ({ ...current, value: '', scope: '' }));
  }

  async function createClaim(event) {
    event.preventDefault();
    const contract = subcontracts.find((row) => row.id === claimForm.subcontract);
    if (!contract) return;
    const payload = { ...claimForm, vendor: contract.vendor, amount: String(claimForm.amount), notes: claimForm.notes || undefined };
    const created = await run('claim', () => createRecord('construction.progress_claim', payload), 'Đã lập hồ sơ nghiệm thu/đề nghị thanh toán nháp.');
    if (created) setClaimForm((current) => ({ ...current, amount: '', notes: '' }));
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
