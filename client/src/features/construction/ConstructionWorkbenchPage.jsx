import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useDocumentTitle } from '../../lib/useDocumentTitle.js';
import { localDate } from '../../lib/dates.js';
import { api, dataPath } from '../../lib/api.js';
import { fmtDate, fmtMoney, statusLabel, uiTextWith } from '../../lib/i18n.js';
import { addDecimals } from '../../lib/decimal.js';
import { can, loadRefs, loadIndependentData, recordLabel, loadAllResponse } from '../../lib/state.js';
import { boqLineValue, boqTotal } from './domain/boqTotals.js';
import constructionEnglish from './construction.en.js';
const t = (text) => uiTextWith(text, constructionEnglish);
const today = localDate;
const itemsOf = (response) => Array.isArray(response?.items) ? response.items : [];
const blankBoqLine = () => ({ rowId: crypto.randomUUID(), description: '', unit: '', qty: '1', unit_price: '' });
const runAction = (entity, row, action) => api(dataPath(entity, row.id, action), { method: 'POST' });
export default function ConstructionWorkbenchPage() {
  useDocumentTitle(`${t('Điều hành công trường')} · OSP Suite`);
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
  const [boqLines, setBoqLines] = useState(() => [blankBoqLine()]);
  const [subcontractForm, setSubcontractForm] = useState({ project: '', vendor: '', value: '', scope: '' });
  const [claimForm, setClaimForm] = useState({ subcontract: '', period: today(), amount: '', notes: '' });
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const load = useCallback(async (quiet = false) => {
    if (!quiet) { setLoading(true); setError(''); }
    try {
      const emptyResponse = () => ({ items: [] });
      const emptyMap = () => new Map();
      const { data, errors } = await loadIndependentData({
        projectRes: can('project.project.read') ? loadAllResponse('project.project') : Promise.resolve(emptyResponse()),
        siteRes: can('construction.site.read') ? loadAllResponse('construction.site') : Promise.resolve(emptyResponse()),
        diaryRes: can('construction.site_diary.read') ? loadAllResponse('construction.site_diary') : Promise.resolve(emptyResponse()),
        boqRes: can('construction.boq.read') ? loadAllResponse('construction.boq') : Promise.resolve(emptyResponse()),
        subcontractRes: can('construction.subcontract.read') ? loadAllResponse('construction.subcontract') : Promise.resolve(emptyResponse()),
        claimRes: can('construction.progress_claim.read') ? loadAllResponse('construction.progress_claim') : Promise.resolve(emptyResponse()),
        billRes: can('accounting.bill.read') ? loadAllResponse('accounting.bill') : Promise.resolve(emptyResponse()),
        partyMap: can('master-data.party.read') ? loadRefs('master-data.party') : Promise.resolve(emptyMap()),
      }, {
        projectRes: emptyResponse(), siteRes: emptyResponse(), diaryRes: emptyResponse(), boqRes: emptyResponse(), subcontractRes: emptyResponse(), claimRes: emptyResponse(), billRes: emptyResponse(), partyMap: emptyMap(),
      });
      const { projectRes, siteRes, diaryRes, boqRes, subcontractRes, claimRes, billRes, partyMap } = data;
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
      if (errors.length) setError(errors[0]?.message || t('Một số dữ liệu công trường không tải được.'));
    } catch (reason) { setError(t(reason.message || 'Không tải được dữ liệu công trường.')); }
    finally { if (!quiet) setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const selectedProject = projects.find((row) => row.id === projectId);
  const projectBoqs = useMemo(() => boqs.filter((row) => row.project === projectId).sort((a, b) => Number(b.revision) - Number(a.revision)), [boqs, projectId]);
  const projectSites = useMemo(() => sites.filter((row) => !row.project || row.project === projectId), [sites, projectId]);
  const projectSubcontracts = useMemo(() => subcontracts.filter((row) => row.project === projectId), [subcontracts, projectId]);
  const committedValue = addDecimals(projectSubcontracts.filter((row) => ['signed', 'completed'].includes(row.status)).map((row) => row.value));
  const currentBoq = projectBoqs.find((row) => row.status === 'approved');
  const billBySubcontract = useMemo(() => new Map(bills.filter((row) => row.source === 'subcontract').map((row) => [row.source_id, row])), [bills]);
  const billByClaim = useMemo(() => new Map(bills.filter((row) => row.source === 'progress_claim').map((row) => [row.source_id, row])), [bills]);
  const projectClaims = useMemo(() => claims.filter((row) => projectSubcontracts.some((contract) => contract.id === row.subcontract)), [claims, projectSubcontracts]);
  const revisionSource = boqs.find((row) => row.id === boqForm.supersedes);
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
      const payload = { ...boqForm, project: boqForm.project, supersedes: boqForm.supersedes || undefined, revision_reason: boqForm.revision_reason || undefined, items: boqLines.map((line) => ({ description: line.description.trim(), unit: line.unit.trim(), qty: String(line.qty), unit_price: String(line.unit_price) })) };
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
    await run(`${row.id}:${verb}`, () => runAction(entity, row, verb), success);
  }
  const addBoqLine = () => setBoqLines((current) => [...current, blankBoqLine()]);
  const updateBoqLine = (index, field, value) => setBoqLines((current) => current.map((line, i) => i === index ? { ...line, [field]: value } : line));
  return <div className="page">
    <div className="page-head"><div><h1>{t("Điều hành công trường")}</h1><p className="sub">{t("Quản lý tiến độ dự án, dự toán BOQ theo phiên bản, nhật ký công trường và cam kết chi phí thầu phụ.")}</p></div><button className="btn btn-secondary" type="button" disabled={loading || Boolean(busy)} onClick={() => load()}>{t("Làm mới")}</button></div>
    {error && <div className="alert danger" role="alert">{t(error)}</div>}{notice && <div className="alert success" role="status">{t(notice)}</div>}
    {loading ? <div className="skeleton" data-h="row" /> : !projects.length ? <div className="card card-pad empty">{t("Chưa có dự án. Hãy tạo dự án trong module Quản lý dự án trước khi lập dự toán hoặc công trường.")}</div> : <>
      <section className="card card-pad"><div className="form-grid"><label className="field"><span className="label">{t("Công trình đang xem")}</span><select className="select" value={projectId} onChange={(e) => { const id = e.target.value; setProjectId(id); setSiteForm((current) => ({ ...current, project: id })); setSubcontractForm((current) => ({ ...current, project: id })); setDiaryForm((current) => ({ ...current, site: sites.find((site) => site.project === id)?.id || sites.find((site) => !site.project)?.id || '' })); }}>{projects.map((project) => <option key={project.id} value={project.id}>{project.name} · {statusLabel(project.status)}</option>)}</select></label><div className="field"><span className="label">{t("Ngân sách dự án")}</span><strong>{fmtMoney(selectedProject?.budget || 0)}</strong></div><div className="field"><span className="label">{t("Cam kết thầu phụ")}</span><strong>{fmtMoney(committedValue)}</strong></div><div className="field"><span className="label">{t("Dự toán đã duyệt")}</span><strong>{currentBoq ? fmtMoney(currentBoq.total || 0) : t('Chưa có baseline')}</strong></div></div>
        {selectedProject?.status === 'planned' && can('project.project.started') && <button className="btn btn-primary btn-sm u-legacy-0ee7f66ad9"  disabled={Boolean(busy)} onClick={() => transition('project.project', selectedProject, 'started', 'Đã khởi công dự án; có thể ký hợp đồng thầu phụ.')}>{t("Khởi công dự án")}</button>}
      </section>
      <div className="layout-split u-legacy-92c18f6bda" >
        <section className="card card-pad"><h2>{t("BOQ · Dự toán và phiên bản")}</h2>
          {can('construction.boq.create') && <form onSubmit={createBoq}>
            <div className="form-grid"><label className="field"><span className="label">{t("Phiên bản cho công trình")}</span><select className="select" required value={boqForm.project} onChange={(e) => setBoqForm({ ...boqForm, project: e.target.value, supersedes: '' })}>{projects.filter((project) => ['planned', 'active'].includes(project.status)).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label><label className="field"><span className="label">{t("Điều chỉnh baseline")}</span><select className="select" value={boqForm.supersedes} onChange={(e) => setBoqForm({ ...boqForm, supersedes: e.target.value })}><option value="">{t("BOQ gốc · phiên bản 1")}</option>{boqs.filter((row) => row.project === boqForm.project && row.status === 'approved').map((row) => <option key={row.id} value={row.id}>{row.number} · rev {row.revision}</option>)}</select></label>
              {revisionSource && <label className="field full"><span className="label">{t("Lý do điều chỉnh *")}</span><input className="input" required value={boqForm.revision_reason} onChange={(e) => setBoqForm({ ...boqForm, revision_reason: e.target.value })}/></label>}
            </div>
            <div className="row wrap u-legacy-0ee7f66ad9" ><strong>{t("Hạng mục")}</strong><span className="grow"/><button className="btn btn-secondary btn-sm" type="button" onClick={addBoqLine}>{t("Thêm hạng mục")}</button></div>
            {boqLines.map((line, index) => <div className="row wrap u-legacy-43a97fe494" key={line.rowId} ><input className="input" aria-label={t('Mô tả hạng mục')} placeholder={t('Mô tả công tác / vật tư')} required value={line.description} onChange={(e) => updateBoqLine(index, 'description', e.target.value)}/><input className="input" aria-label={t('Đơn vị tính')} placeholder={t('m², m³, m, kg, ngày công')} required maxLength={32} value={line.unit} onChange={(e) => updateBoqLine(index, 'unit', e.target.value)}/><input className="input num u-legacy-63a66a1f1b" aria-label={t('Khối lượng')} type="number" min="0.001" step="any" required value={line.qty} onChange={(e) => updateBoqLine(index, 'qty', e.target.value)} /><input className="input num u-legacy-5e96948257" aria-label={t('Đơn giá')} type="number" min="0" step="any" required value={line.unit_price} onChange={(e) => updateBoqLine(index, 'unit_price', e.target.value)} /><strong>{fmtMoney(boqLineValue(line))}</strong>{boqLines.length > 1 && <button className="btn btn-ghost btn-sm" type="button" aria-label={t('Xóa hạng mục')} onClick={() => setBoqLines((current) => current.filter((_, i) => i !== index))}>{t("Bỏ")}</button>}</div>)}
            <div className="row u-legacy-df928149c5" ><span className="grow"/><strong>Ước tính: {fmtMoney(boqTotal(boqLines))}</strong><button className="btn btn-primary" disabled={Boolean(busy) || !boqForm.project}>{t("Lưu BOQ nháp")}</button></div>
          </form>}
          <div className="table-wrap u-legacy-92c18f6bda" ><table className="table"><thead><tr><th>{t("Mã BOQ")}</th><th>{t("Phiên bản")}</th><th>{t("Tổng dự toán")}</th><th>{t("Trạng thái")}</th><th>{t("Thao tác")}</th></tr></thead><tbody>{projectBoqs.map((row) => <tr key={row.id}><td><strong>{row.number}</strong>{Number(row.revision) > 1 && <div className="small muted">{row.revision_reason}</div>}{(row.items || []).map((item, index) => <div className="small muted" key={index}>{item.description} {'\u00b7'} {item.qty} {item.unit} {'\u00d7'} {fmtMoney(item.unit_price)}</div>)}</td><td>R{row.revision}</td><td>{fmtMoney(row.total || 0)}</td><td>{statusLabel(row.status)}</td><td>{row.status === 'draft' && can('construction.boq.approved') && <button className="btn btn-primary btn-sm" disabled={Boolean(busy)} onClick={() => transition('construction.boq', row, 'approved', 'Đã duyệt BOQ và xác lập baseline dự toán cho công trình.')}>{t("Duyệt baseline")}</button>}{row.status === 'approved' && can('construction.boq.create') && <button className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => { setBoqForm({ project: row.project, supersedes: row.id, revision_reason: '' }); setBoqLines((row.items || []).map((item) => ({ ...blankBoqLine(), description: item.description || '', unit: item.unit || '', qty: String(item.qty || 1), unit_price: String(item.unit_price || 0) }))); }}>{t("Lập phiên bản điều chỉnh")}</button>}</td></tr>)}</tbody></table></div>
        </section>
        <section className="card card-pad"><h2>{t("Nhật ký công trường")}</h2>
          {can('construction.site.create') && <form className="form-grid" onSubmit={createSite}><h3 className="full">{t("Tạo công trường")}</h3><label className="field"><span className="label">{t("Tên công trường *")}</span><input className="input" required value={siteForm.name} onChange={(e) => setSiteForm({ ...siteForm, name: e.target.value })}/></label><label className="field"><span className="label">{t("Địa chỉ")}</span><input className="input" value={siteForm.address} onChange={(e) => setSiteForm({ ...siteForm, address: e.target.value })}/></label><label className="field full"><span className="label">{t("Dự án")}</span><select className="select" value={siteForm.project} onChange={(e) => setSiteForm({ ...siteForm, project: e.target.value })}><option value="">{t("Không gắn dự án")}</option>{projects.filter((project) => ['planned','active'].includes(project.status)).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label><div className="row full"><span className="grow"/><button className="btn btn-secondary" disabled={Boolean(busy) || !['planned','active'].includes(selectedProject?.status)}>{t("Tạo công trường")}</button></div></form>}
          {can('construction.site_diary.create') && projectSites.length > 0 && ['planned', 'active'].includes(selectedProject?.status) && <form className="form-grid u-legacy-c53ea1da23"  onSubmit={createDiary}><h3 className="full">{t("Ghi nhật ký thi công")}</h3><label className="field"><span className="label">{t("Công trường *")}</span><select className="select" required value={diaryForm.site} onChange={(e) => setDiaryForm({ ...diaryForm, site: e.target.value })}>{projectSites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label><label className="field"><span className="label">{t("Ngày *")}</span><input className="input" required type="date" max={today()} value={diaryForm.date} onChange={(e) => setDiaryForm({ ...diaryForm, date: e.target.value })}/></label><label className="field"><span className="label">{t("Thời tiết")}</span><input className="input" value={diaryForm.weather} onChange={(e) => setDiaryForm({ ...diaryForm, weather: e.target.value })}/></label><label className="field"><span className="label">{t("Diễn biến, nhân lực, thiết bị")}</span><textarea className="input" rows="3" value={diaryForm.notes} onChange={(e) => setDiaryForm({ ...diaryForm, notes: e.target.value })}/></label><div className="row full"><span className="grow"/><button className="btn btn-primary" disabled={Boolean(busy)}>{t("Ghi nhật ký")}</button></div></form>}
          <div className="table-wrap u-legacy-92c18f6bda" ><table className="table"><thead><tr><th>{t("Ngày")}</th><th>{t("Công trường")}</th><th>{t("Thời tiết")}</th><th>{t("Ghi nhận")}</th></tr></thead><tbody>{diaries.filter((row) => projectSites.some((site) => site.id === row.site)).sort((a,b) => String(b.date).localeCompare(String(a.date))).map((row) => <tr key={row.id}><td>{fmtDate(row.date)}</td><td>{sites.find((site) => site.id === row.site)?.name || '—'}</td><td>{row.weather || '—'}</td><td>{row.notes || '—'}</td></tr>)}</tbody></table></div>
        </section>
      </div>
      <section className="card card-pad u-legacy-92c18f6bda" ><h2>{t("Thầu phụ · Cam kết chi phí")}</h2>
        {can('construction.subcontract.create') && <form className="form-grid" onSubmit={createSubcontract}><label className="field"><span className="label">{t("Nhà thầu *")}</span><select className="select" required value={subcontractForm.vendor} onChange={(e) => setSubcontractForm({ ...subcontractForm, vendor: e.target.value })}><option value="">{t("Chọn nhà thầu")}</option>{[...parties.values()].map((party) => <option key={party.id} value={party.id}>{recordLabel('master-data.party', party)}</option>)}</select></label><label className="field"><span className="label">{t("Giá trị hợp đồng *")}</span><input className="input" type="number" required min="0.01" step="any" value={subcontractForm.value} onChange={(e) => setSubcontractForm({ ...subcontractForm, value: e.target.value })}/></label><label className="field full"><span className="label">{t("Phạm vi công việc")}</span><textarea className="input" rows="2" value={subcontractForm.scope} onChange={(e) => setSubcontractForm({ ...subcontractForm, scope: e.target.value })}/></label><div className="row full"><span className="grow"/><button className="btn btn-secondary" disabled={Boolean(busy) || !['planned','active'].includes(selectedProject?.status) || !subcontractForm.vendor}>{t("Lập dự thảo thầu phụ")}</button></div></form>}
        <p className="muted">{t("Ký hợp đồng ghi nhận cam kết chi phí và kiểm tra ngân sách. Hóa đơn phải trả được lập riêng khi có khối lượng nghiệm thu hoặc hồ sơ thanh toán.")}</p>
        <div className="table-wrap u-legacy-c53ea1da23" ><table className="table"><thead><tr><th>{t("Nhà thầu")}</th><th>{t("Phạm vi")}</th><th>{t("Giá trị")}</th><th>{t("Trạng thái")}</th><th>{t("Thao tác / chứng từ")}</th></tr></thead><tbody>{projectSubcontracts.map((row) => <tr key={row.id}><td>{parties.has(row.vendor) ? recordLabel('master-data.party', parties.get(row.vendor)) : '—'}</td><td>{row.scope || '—'}</td><td>{fmtMoney(row.value)}</td><td>{statusLabel(row.status)}</td><td>{row.status === 'draft' && can('construction.subcontract.signed') && <button className="btn btn-primary btn-sm" disabled={Boolean(busy) || selectedProject?.status !== 'active'} onClick={() => transition('construction.subcontract', row, 'signed', 'Đã ký thầu phụ và ghi nhận cam kết chi phí trong hạn mức ngân sách.')}>{t("Ký hợp đồng")}</button>}{row.status === 'signed' && can('construction.subcontract.completed') && <button className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => transition('construction.subcontract', row, 'completed', 'Đã xác nhận hoàn thành phạm vi thầu phụ.')}>{t("Hoàn thành")}</button>}{billBySubcontract.has(row.id) && <a className="btn btn-ghost btn-sm u-legacy-4b17347c23"  href={`#/e/accounting/bill/${billBySubcontract.get(row.id).id}`}>{t("Mở hóa đơn phải trả")}</a>}</td></tr>)}</tbody></table></div>
      </section>
      <section className="card card-pad u-legacy-92c18f6bda" ><h2>{t("Nghiệm thu và thanh toán theo đợt")}</h2>
        <p className="muted">{t("Mỗi hồ sơ được duyệt sẽ tạo một hóa đơn phải trả theo giá trị nghiệm thu. Máy chủ khóa hợp đồng và chặn lũy kế vượt giá trị hợp đồng.")}</p>
        {can('construction.progress_claim.create') && <form className="form-grid" onSubmit={createClaim}><label className="field"><span className="label">{t("Hợp đồng thầu phụ *")}</span><select className="select" required value={claimForm.subcontract} onChange={(e) => setClaimForm({ ...claimForm, subcontract: e.target.value })}><option value="">{t("Chọn hợp đồng đã ký")}</option>{projectSubcontracts.filter((row) => ['signed','completed'].includes(row.status)).map((row) => <option key={row.id} value={row.id}>{parties.has(row.vendor) ? recordLabel('master-data.party', parties.get(row.vendor)) : t('Nhà thầu')} · {fmtMoney(row.value)}</option>)}</select></label><label className="field"><span className="label">{t("Ngày nghiệm thu *")}</span><input className="input" type="date" required max={today()} value={claimForm.period} onChange={(e) => setClaimForm({ ...claimForm, period: e.target.value })}/></label><label className="field"><span className="label">{t("Giá trị đề nghị thanh toán *")}</span><input className="input" type="number" required min="0.01" step="any" value={claimForm.amount} onChange={(e) => setClaimForm({ ...claimForm, amount: e.target.value })}/></label><label className="field"><span className="label">{t("Ghi chú / số biên bản")}</span><input className="input" value={claimForm.notes} onChange={(e) => setClaimForm({ ...claimForm, notes: e.target.value })}/></label><div className="row full"><span className="grow"/><button className="btn btn-secondary" disabled={Boolean(busy) || !claimForm.subcontract}>{t("Lập hồ sơ nháp")}</button></div></form>}
        <div className="table-wrap u-legacy-c53ea1da23" ><table className="table"><thead><tr><th>{t("Ngày")}</th><th>{t("Nhà thầu / hợp đồng")}</th><th>{t("Hồ sơ")}</th><th>{t("Giá trị")}</th><th>{t("Trạng thái")}</th><th>{t("Thao tác")}</th></tr></thead><tbody>{projectClaims.sort((a,b) => String(b.period).localeCompare(String(a.period))).map((row) => { const contract = subcontracts.find((item) => item.id === row.subcontract); const bill = billByClaim.get(row.id); return <tr key={row.id}><td>{fmtDate(row.period)}</td><td>{parties.has(row.vendor) ? recordLabel('master-data.party', parties.get(row.vendor)) : '—'}<div className="muted">{contract?.scope || t('Thầu phụ')}</div></td><td>{row.notes || '—'}</td><td>{fmtMoney(row.amount)}</td><td>{statusLabel(row.status)}</td><td>{row.status === 'draft' && can('construction.progress_claim.approved') && <button className="btn btn-primary btn-sm" disabled={Boolean(busy)} onClick={() => transition('construction.progress_claim', row, 'approved', 'Đã duyệt nghiệm thu và tạo hóa đơn phải trả theo giá trị đợt.')}>{t("Duyệt và lập hóa đơn")}</button>}{bill && <a className="btn btn-ghost btn-sm u-legacy-4b17347c23"  href={`#/e/accounting/bill/${bill.id}`}>{t("Mở hóa đơn")}</a>}</td></tr>; })}</tbody></table></div>
      </section>
    </>}
  </div>;
}
