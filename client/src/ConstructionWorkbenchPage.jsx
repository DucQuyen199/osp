import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { localDate } from './lib/dates.js';
import { api, dataPath } from './lib/api.js';
import { fmtDate, fmtMoney, statusLabel } from './lib/i18n.js';
import { can, loadRefs, recordLabel } from './lib/state.js';

const today = localDate;
const itemsOf = (response) => Array.isArray(response?.items) ? response.items : [];
const runAction = (entity, row, action) => api(dataPath(entity, row.id, action), { method: 'POST' });
const lineValue = (line) => (Number(line.qty) || 0) * (Number(line.unit_price) || 0);
const totalOf = (lines) => lines.reduce((sum, line) => sum + lineValue(line), 0);

export default function ConstructionWorkbenchPage() {
  const [projects, setProjects] = useState([]);
  const [sites, setSites] = useState([]);
  const [diaries, setDiaries] = useState([]);
  const [boqs, setBoqs] = useState([]);
  const [subcontracts, setSubcontracts] = useState([]);
  const [claims, setClaims] = useState([]);
  const [bills, setBills] = useState([]);
  const [parties, setParties] = useState(new Map());
  const [projectId, setProjectId] = useState('');
  const [siteForm, setSiteForm] = useState({ name: '', project: '', address: '' });
  const [diaryForm, setDiaryForm] = useState({ site: '', date: today(), weather: '', notes: '' });
  const [boqForm, setBoqForm] = useState({ project: '', supersedes: '', revision_reason: '' });
  const [boqLines, setBoqLines] = useState([{ description: '', qty: '1', unit_price: '' }]);
  const [subcontractForm, setSubcontractForm] = useState({ project: '', vendor: '', value: '', scope: '' });
  const [claimForm, setClaimForm] = useState({ subcontract: '', period: today(), amount: '', notes: '' });
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async (quiet = false) => {
    if (!quiet) { setLoading(true); setError(''); }
    try {
      const [projectRes, siteRes, diaryRes, boqRes, subcontractRes, claimRes, billRes, partyMap] = await Promise.all([
        can('project.project.read') ? api(`${dataPath('project.project')}?limit=1000`) : Promise.resolve({ items: [] }),
        can('construction.site.read') ? api(`${dataPath('construction.site')}?limit=1000`) : Promise.resolve({ items: [] }),
        can('construction.site_diary.read') ? api(`${dataPath('construction.site_diary')}?limit=1000`) : Promise.resolve({ items: [] }),
        can('construction.boq.read') ? api(`${dataPath('construction.boq')}?limit=1000`) : Promise.resolve({ items: [] }),
        can('construction.subcontract.read') ? api(`${dataPath('construction.subcontract')}?limit=1000`) : Promise.resolve({ items: [] }),
        can('construction.progress_claim.read') ? api(`${dataPath('construction.progress_claim')}?limit=1000`) : Promise.resolve({ items: [] }),
        can('accounting.bill.read') ? api(`${dataPath('accounting.bill')}?limit=1000`) : Promise.resolve({ items: [] }),
        can('master-data.party.read') ? loadRefs('master-data.party') : Promise.resolve(new Map()),
      ]);
      const projectRows = itemsOf(projectRes);
      const siteRows = itemsOf(siteRes);
      const boqRows = itemsOf(boqRes);
      setProjects(projectRows); setSites(siteRows); setDiaries(itemsOf(diaryRes)); setBoqs(boqRows);
      setSubcontracts(itemsOf(subcontractRes)); setClaims(itemsOf(claimRes)); setBills(itemsOf(billRes)); setParties(partyMap);
      setProjectId((current) => projectRows.some((row) => row.id === current) ? current : projectRows[0]?.id || '');
      setSiteForm((current) => ({ ...current, project: current.project || projectRows.find((row) => ['planned', 'active'].includes(row.status))?.id || '' }));
      setDiaryForm((current) => ({ ...current, site: current.site || siteRows.find((site) => site.project === projectRows[0]?.id)?.id || siteRows.find((site) => !site.project)?.id || '' }));
      setBoqForm((current) => ({ ...current, project: current.project || projectRows.find((row) => ['planned', 'active'].includes(row.status))?.id || '' }));
      setSubcontractForm((current) => ({ ...current, project: current.project || projectRows.find((row) => row.status === 'active')?.id || '', vendor: current.vendor || [...partyMap.keys()][0] || '' }));
      setClaimForm((current) => ({ ...current, subcontract: current.subcontract || itemsOf(subcontractRes).find((row) => row.status === 'signed')?.id || '' }));
    } catch (reason) { setError(reason.message || 'Không tải được dữ liệu công trường.'); }
    finally { if (!quiet) setLoading(false); }
  }, []);

  useEffect(() => { document.title = 'Điều hành công trường · OSP Suite'; load(); }, [load]);
  const selectedProject = projects.find((row) => row.id === projectId);
  const projectBoqs = useMemo(() => boqs.filter((row) => row.project === projectId).sort((a, b) => Number(b.revision) - Number(a.revision)), [boqs, projectId]);
  const projectSites = useMemo(() => sites.filter((row) => !row.project || row.project === projectId), [sites, projectId]);
  const projectSubcontracts = useMemo(() => subcontracts.filter((row) => row.project === projectId), [subcontracts, projectId]);
  const committedValue = projectSubcontracts.filter((row) => ['signed', 'completed'].includes(row.status)).reduce((sum, row) => sum + Number(row.value || 0), 0);
  const currentBoq = projectBoqs.find((row) => row.status === 'approved');
  const billBySubcontract = useMemo(() => new Map(bills.filter((row) => row.source === 'subcontract').map((row) => [row.source_id, row])), [bills]);
  const billByClaim = useMemo(() => new Map(bills.filter((row) => row.source === 'progress_claim').map((row) => [row.source_id, row])), [bills]);
  const projectClaims = useMemo(() => claims.filter((row) => projectSubcontracts.some((contract) => contract.id === row.subcontract)), [claims, projectSubcontracts]);
  const revisionSource = boqs.find((row) => row.id === boqForm.supersedes);

  async function run(key, operation, success) {
    setBusy(key); setError(''); setNotice('');
    try { await operation(); setNotice(success); await load(true); }
    catch (reason) { setError(reason.message || 'Thao tác không thành công.'); await load(true); }
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
      const payload = { ...boqForm, project: boqForm.project, supersedes: boqForm.supersedes || undefined, revision_reason: boqForm.revision_reason || undefined, items: boqLines.map((line) => ({ description: line.description.trim(), qty: Number(line.qty), unit_price: Number(line.unit_price) })) };
      delete payload.revision;
      await api(dataPath('construction.boq'), { method: 'POST', body: payload });
    }, 'Đã lập dự toán BOQ nháp; tổng giá trị được máy chủ tính từ khối lượng và đơn giá.');
    setBoqLines([{ description: '', qty: '1', unit_price: '' }]);
    setBoqForm((current) => ({ ...current, supersedes: '', revision_reason: '' }));
  }

  async function createSubcontract(event) {
    event.preventDefault();
    await run('subcontract', () => api(dataPath('construction.subcontract'), { method: 'POST', body: { ...subcontractForm, project: projectId, value: Number(subcontractForm.value) } }), 'Đã lập dự thảo hợp đồng thầu phụ.');
    setSubcontractForm((current) => ({ ...current, value: '', scope: '' }));
  }

  async function createClaim(event) {
    event.preventDefault();
    const contract = subcontracts.find((row) => row.id === claimForm.subcontract);
    if (!contract) return;
    await run('claim', () => api(dataPath('construction.progress_claim'), { method: 'POST', body: { ...claimForm, vendor: contract.vendor, amount: Number(claimForm.amount), notes: claimForm.notes || undefined } }), 'Đã lập hồ sơ nghiệm thu/đề nghị thanh toán nháp.');
    setClaimForm((current) => ({ ...current, amount: '', notes: '' }));
  }

  async function transition(entity, row, verb, success) {
    await run(`${row.id}:${verb}`, () => runAction(entity, row, verb), success);
  }

  const addBoqLine = () => setBoqLines((current) => [...current, { description: '', qty: '1', unit_price: '' }]);
  const updateBoqLine = (index, field, value) => setBoqLines((current) => current.map((line, i) => i === index ? { ...line, [field]: value } : line));

  return <div className="page">
    <div className="page-head"><div><h1>Điều hành công trường</h1><p className="sub">Quản lý tiến độ dự án, dự toán BOQ theo phiên bản, nhật ký công trường và cam kết chi phí thầu phụ.</p></div><button className="btn btn-secondary" type="button" disabled={loading || Boolean(busy)} onClick={() => load()}>Làm mới</button></div>
    {error && <div className="alert danger" role="alert">{error}</div>}{notice && <div className="alert success" role="status">{notice}</div>}
    {loading ? <div className="skeleton" data-h="row" /> : !projects.length ? <div className="card card-pad empty">Chưa có dự án. Hãy tạo dự án trong module Quản lý dự án trước khi lập dự toán hoặc công trường.</div> : <>
      <section className="card card-pad"><div className="form-grid"><label className="field"><span className="label">Công trình đang xem</span><select className="select" value={projectId} onChange={(e) => { const id = e.target.value; setProjectId(id); setSiteForm((current) => ({ ...current, project: id })); setSubcontractForm((current) => ({ ...current, project: id })); setDiaryForm((current) => ({ ...current, site: sites.find((site) => site.project === id)?.id || sites.find((site) => !site.project)?.id || '' })); }}>{projects.map((project) => <option key={project.id} value={project.id}>{project.name} · {statusLabel(project.status)}</option>)}</select></label><div className="field"><span className="label">Ngân sách dự án</span><strong>{fmtMoney(selectedProject?.budget || 0)}</strong></div><div className="field"><span className="label">Cam kết thầu phụ</span><strong>{fmtMoney(committedValue)}</strong></div><div className="field"><span className="label">Dự toán đã duyệt</span><strong>{currentBoq ? fmtMoney(currentBoq.total || 0) : 'Chưa có baseline'}</strong></div></div>
        {selectedProject?.status === 'planned' && can('project.project.started') && <button className="btn btn-primary btn-sm" style={{ marginTop: 12 }} disabled={Boolean(busy)} onClick={() => transition('project.project', selectedProject, 'started', 'Đã khởi công dự án; có thể ký hợp đồng thầu phụ.')}>Khởi công dự án</button>}
      </section>

      <div className="layout-split" style={{ marginTop: 16 }}>
        <section className="card card-pad"><h2>BOQ · Dự toán và phiên bản</h2>
          {can('construction.boq.create') && <form onSubmit={createBoq}>
            <div className="form-grid"><label className="field"><span className="label">Phiên bản cho công trình</span><select className="select" required value={boqForm.project} onChange={(e) => setBoqForm({ ...boqForm, project: e.target.value, supersedes: '' })}>{projects.filter((project) => ['planned', 'active'].includes(project.status)).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label><label className="field"><span className="label">Điều chỉnh baseline</span><select className="select" value={boqForm.supersedes} onChange={(e) => setBoqForm({ ...boqForm, supersedes: e.target.value })}><option value="">BOQ gốc · phiên bản 1</option>{boqs.filter((row) => row.project === boqForm.project && row.status === 'approved').map((row) => <option key={row.id} value={row.id}>{row.number} · rev {row.revision}</option>)}</select></label>
              {revisionSource && <label className="field full"><span className="label">Lý do điều chỉnh *</span><input className="input" required value={boqForm.revision_reason} onChange={(e) => setBoqForm({ ...boqForm, revision_reason: e.target.value })}/></label>}
            </div>
            <div className="row wrap" style={{ marginTop: 12 }}><strong>Hạng mục</strong><span className="grow"/><button className="btn btn-secondary btn-sm" type="button" onClick={addBoqLine}>Thêm hạng mục</button></div>
            {boqLines.map((line, index) => <div className="row wrap" key={index} style={{ marginTop: 8 }}><input className="input" aria-label="Mô tả hạng mục" placeholder="Mô tả công tác / vật tư" required value={line.description} onChange={(e) => updateBoqLine(index, 'description', e.target.value)}/><input className="input num" aria-label="Khối lượng" type="number" min="0.001" step="any" required value={line.qty} onChange={(e) => updateBoqLine(index, 'qty', e.target.value)} style={{ maxWidth: 110 }}/><input className="input num" aria-label="Đơn giá" type="number" min="0" step="any" required value={line.unit_price} onChange={(e) => updateBoqLine(index, 'unit_price', e.target.value)} style={{ maxWidth: 150 }}/><strong>{fmtMoney(lineValue(line))}</strong>{boqLines.length > 1 && <button className="btn btn-ghost btn-sm" type="button" aria-label="Xóa hạng mục" onClick={() => setBoqLines((current) => current.filter((_, i) => i !== index))}>Bỏ</button>}</div>)}
            <div className="row" style={{ marginTop: 10 }}><span className="grow"/><strong>Ước tính: {fmtMoney(totalOf(boqLines))}</strong><button className="btn btn-primary" disabled={Boolean(busy) || !boqForm.project}>Lưu BOQ nháp</button></div>
          </form>}
          <div className="table-wrap" style={{ marginTop: 16 }}><table className="table"><thead><tr><th>Mã BOQ</th><th>Phiên bản</th><th>Tổng dự toán</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>{projectBoqs.map((row) => <tr key={row.id}><td><strong>{row.number}</strong>{Number(row.revision) > 1 && <div className="small muted">{row.revision_reason}</div>}</td><td>R{row.revision}</td><td>{fmtMoney(row.total || 0)}</td><td>{statusLabel(row.status)}</td><td>{row.status === 'draft' && can('construction.boq.approved') && <button className="btn btn-primary btn-sm" disabled={Boolean(busy)} onClick={() => transition('construction.boq', row, 'approved', 'Đã duyệt BOQ và xác lập baseline dự toán cho công trình.')}>Duyệt baseline</button>}{row.status === 'approved' && can('construction.boq.create') && <button className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => { setBoqForm({ project: row.project, supersedes: row.id, revision_reason: '' }); setBoqLines((row.items || []).map((item) => ({ description: item.description || '', qty: String(item.qty || 1), unit_price: String(item.unit_price || 0) }))); }}>Lập phiên bản điều chỉnh</button>}</td></tr>)}</tbody></table></div>
        </section>

        <section className="card card-pad"><h2>Nhật ký công trường</h2>
          {can('construction.site.create') && <form className="form-grid" onSubmit={createSite}><h3 className="full">Tạo công trường</h3><label className="field"><span className="label">Tên công trường *</span><input className="input" required value={siteForm.name} onChange={(e) => setSiteForm({ ...siteForm, name: e.target.value })}/></label><label className="field"><span className="label">Địa chỉ</span><input className="input" value={siteForm.address} onChange={(e) => setSiteForm({ ...siteForm, address: e.target.value })}/></label><label className="field full"><span className="label">Dự án</span><select className="select" value={siteForm.project} onChange={(e) => setSiteForm({ ...siteForm, project: e.target.value })}><option value="">Không gắn dự án</option>{projects.filter((project) => ['planned','active'].includes(project.status)).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label><div className="row full"><span className="grow"/><button className="btn btn-secondary" disabled={Boolean(busy) || !['planned','active'].includes(selectedProject?.status)}>Tạo công trường</button></div></form>}
          {can('construction.site_diary.create') && projectSites.length > 0 && ['planned', 'active'].includes(selectedProject?.status) && <form className="form-grid" style={{ marginTop: 14 }} onSubmit={createDiary}><h3 className="full">Ghi nhật ký thi công</h3><label className="field"><span className="label">Công trường *</span><select className="select" required value={diaryForm.site} onChange={(e) => setDiaryForm({ ...diaryForm, site: e.target.value })}>{projectSites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label><label className="field"><span className="label">Ngày *</span><input className="input" required type="date" max={today()} value={diaryForm.date} onChange={(e) => setDiaryForm({ ...diaryForm, date: e.target.value })}/></label><label className="field"><span className="label">Thời tiết</span><input className="input" value={diaryForm.weather} onChange={(e) => setDiaryForm({ ...diaryForm, weather: e.target.value })}/></label><label className="field"><span className="label">Diễn biến, nhân lực, thiết bị</span><textarea className="input" rows="3" value={diaryForm.notes} onChange={(e) => setDiaryForm({ ...diaryForm, notes: e.target.value })}/></label><div className="row full"><span className="grow"/><button className="btn btn-primary" disabled={Boolean(busy)}>Ghi nhật ký</button></div></form>}
          <div className="table-wrap" style={{ marginTop: 16 }}><table className="table"><thead><tr><th>Ngày</th><th>Công trường</th><th>Thời tiết</th><th>Ghi nhận</th></tr></thead><tbody>{diaries.filter((row) => projectSites.some((site) => site.id === row.site)).sort((a,b) => String(b.date).localeCompare(String(a.date))).map((row) => <tr key={row.id}><td>{fmtDate(row.date)}</td><td>{sites.find((site) => site.id === row.site)?.name || '—'}</td><td>{row.weather || '—'}</td><td>{row.notes || '—'}</td></tr>)}</tbody></table></div>
        </section>
      </div>

      <section className="card card-pad" style={{ marginTop: 16 }}><h2>Thầu phụ · Cam kết chi phí</h2>
        {can('construction.subcontract.create') && <form className="form-grid" onSubmit={createSubcontract}><label className="field"><span className="label">Nhà thầu *</span><select className="select" required value={subcontractForm.vendor} onChange={(e) => setSubcontractForm({ ...subcontractForm, vendor: e.target.value })}><option value="">Chọn nhà thầu</option>{[...parties.values()].map((party) => <option key={party.id} value={party.id}>{recordLabel('master-data.party', party)}</option>)}</select></label><label className="field"><span className="label">Giá trị hợp đồng *</span><input className="input" type="number" required min="0.01" step="any" value={subcontractForm.value} onChange={(e) => setSubcontractForm({ ...subcontractForm, value: e.target.value })}/></label><label className="field full"><span className="label">Phạm vi công việc</span><textarea className="input" rows="2" value={subcontractForm.scope} onChange={(e) => setSubcontractForm({ ...subcontractForm, scope: e.target.value })}/></label><div className="row full"><span className="grow"/><button className="btn btn-secondary" disabled={Boolean(busy) || !['planned','active'].includes(selectedProject?.status) || !subcontractForm.vendor}>Lập dự thảo thầu phụ</button></div></form>}
        <p className="muted">Ký hợp đồng ghi nhận cam kết chi phí và kiểm tra ngân sách. Hóa đơn phải trả được lập riêng khi có khối lượng nghiệm thu hoặc hồ sơ thanh toán.</p>
        <div className="table-wrap" style={{ marginTop: 14 }}><table className="table"><thead><tr><th>Nhà thầu</th><th>Phạm vi</th><th>Giá trị</th><th>Trạng thái</th><th>Thao tác / chứng từ</th></tr></thead><tbody>{projectSubcontracts.map((row) => <tr key={row.id}><td>{parties.has(row.vendor) ? recordLabel('master-data.party', parties.get(row.vendor)) : '—'}</td><td>{row.scope || '—'}</td><td>{fmtMoney(row.value)}</td><td>{statusLabel(row.status)}</td><td>{row.status === 'draft' && can('construction.subcontract.signed') && <button className="btn btn-primary btn-sm" disabled={Boolean(busy) || selectedProject?.status !== 'active'} onClick={() => transition('construction.subcontract', row, 'signed', 'Đã ký thầu phụ và ghi nhận cam kết chi phí trong hạn mức ngân sách.')}>Ký hợp đồng</button>}{row.status === 'signed' && can('construction.subcontract.completed') && <button className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => transition('construction.subcontract', row, 'completed', 'Đã xác nhận hoàn thành phạm vi thầu phụ.')}>Hoàn thành</button>}{billBySubcontract.has(row.id) && <a className="btn btn-ghost btn-sm" style={{ marginLeft: 6 }} href={`#/e/accounting/bill/${billBySubcontract.get(row.id).id}`}>Mở hóa đơn phải trả</a>}</td></tr>)}</tbody></table></div>
      </section>
      <section className="card card-pad" style={{ marginTop: 16 }}><h2>Nghiệm thu và thanh toán theo đợt</h2>
        <p className="muted">Mỗi hồ sơ được duyệt sẽ tạo một hóa đơn phải trả theo giá trị nghiệm thu. Máy chủ khóa hợp đồng và chặn lũy kế vượt giá trị hợp đồng.</p>
        {can('construction.progress_claim.create') && <form className="form-grid" onSubmit={createClaim}><label className="field"><span className="label">Hợp đồng thầu phụ *</span><select className="select" required value={claimForm.subcontract} onChange={(e) => setClaimForm({ ...claimForm, subcontract: e.target.value })}><option value="">Chọn hợp đồng đã ký</option>{projectSubcontracts.filter((row) => ['signed','completed'].includes(row.status)).map((row) => <option key={row.id} value={row.id}>{parties.has(row.vendor) ? recordLabel('master-data.party', parties.get(row.vendor)) : 'Nhà thầu'} · {fmtMoney(row.value)}</option>)}</select></label><label className="field"><span className="label">Ngày nghiệm thu *</span><input className="input" type="date" required max={today()} value={claimForm.period} onChange={(e) => setClaimForm({ ...claimForm, period: e.target.value })}/></label><label className="field"><span className="label">Giá trị đề nghị thanh toán *</span><input className="input" type="number" required min="0.01" step="any" value={claimForm.amount} onChange={(e) => setClaimForm({ ...claimForm, amount: e.target.value })}/></label><label className="field"><span className="label">Ghi chú / số biên bản</span><input className="input" value={claimForm.notes} onChange={(e) => setClaimForm({ ...claimForm, notes: e.target.value })}/></label><div className="row full"><span className="grow"/><button className="btn btn-secondary" disabled={Boolean(busy) || !claimForm.subcontract}>Lập hồ sơ nháp</button></div></form>}
        <div className="table-wrap" style={{ marginTop: 14 }}><table className="table"><thead><tr><th>Ngày</th><th>Nhà thầu / hợp đồng</th><th>Hồ sơ</th><th>Giá trị</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>{projectClaims.sort((a,b) => String(b.period).localeCompare(String(a.period))).map((row) => { const contract = subcontracts.find((item) => item.id === row.subcontract); const bill = billByClaim.get(row.id); return <tr key={row.id}><td>{fmtDate(row.period)}</td><td>{parties.has(row.vendor) ? recordLabel('master-data.party', parties.get(row.vendor)) : '—'}<div className="muted">{contract?.scope || 'Thầu phụ'}</div></td><td>{row.notes || '—'}</td><td>{fmtMoney(row.amount)}</td><td>{statusLabel(row.status)}</td><td>{row.status === 'draft' && can('construction.progress_claim.approved') && <button className="btn btn-primary btn-sm" disabled={Boolean(busy)} onClick={() => transition('construction.progress_claim', row, 'approved', 'Đã duyệt nghiệm thu và tạo hóa đơn phải trả theo giá trị đợt.')}>Duyệt và lập hóa đơn</button>}{bill && <a className="btn btn-ghost btn-sm" style={{ marginLeft: 6 }} href={`#/e/accounting/bill/${bill.id}`}>Mở hóa đơn</a>}</td></tr>; })}</tbody></table></div>
      </section>
    </>}
  </div>;
}
