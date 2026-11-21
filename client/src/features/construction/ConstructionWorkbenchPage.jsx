import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useDocumentTitle } from '../../lib/useDocumentTitle.js';
import { useLatestRequest } from '../../lib/useLatestRequest.js';
import { localDate } from '../../lib/dates.js';
import { fmtDate, fmtMoney, statusLabel, uiTextWith } from '../../lib/i18n.js';
import { addDecimals } from '../../lib/decimal.js';
import { can, loadRefs, loadIndependentData, recordLabel, loadAllResponse } from '../../lib/state.js';
import { recordHref } from '../../lib/routes.js';
import { boqLineValue, boqTotal } from './domain/boqTotals.js';
import constructionEnglish from './construction.en.js';
import ConstructionSiteDiaryPanel from './components/ConstructionSiteDiaryPanel.jsx';
import ProgressClaimsPanel from './components/ProgressClaimsPanel.jsx';
import { useConstructionWorkflow } from './hooks/useConstructionWorkflow.js';
const t = (text) => uiTextWith(text, constructionEnglish);
const today = localDate;
const itemsOf = (response) => Array.isArray(response?.items) ? response.items : [];
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
  const [products, setProducts] = useState(new Map());
  const [units, setUnits] = useState(new Map());
  const [warehouses, setWarehouses] = useState(new Map());
  const [materialRequests, setMaterialRequests] = useState([]);
  const [purchaseRequisitions, setPurchaseRequisitions] = useState([]);
  const [projectId, setProjectId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const latestRequest = useLatestRequest();
  const load = useCallback(async (quiet = false) => {
    const isLatest = latestRequest();
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
        productMap: can('master-data.product.read') ? loadRefs('master-data.product') : Promise.resolve(emptyMap()),
        unitMap: can('master-data.uom.read') ? loadRefs('master-data.uom') : Promise.resolve(emptyMap()),
        warehouseMap: can('inventory.warehouse.read') ? loadRefs('inventory.warehouse') : Promise.resolve(emptyMap()),
        materialRequestRes: can('construction.material_request.read') ? loadAllResponse('construction.material_request') : Promise.resolve(emptyResponse()),
        purchaseRequisitionRes: can('purchasing.purchase_requisition.read') ? loadAllResponse('purchasing.purchase_requisition') : Promise.resolve(emptyResponse()),
      }, {
        projectRes: emptyResponse(), siteRes: emptyResponse(), diaryRes: emptyResponse(), boqRes: emptyResponse(), subcontractRes: emptyResponse(), claimRes: emptyResponse(), billRes: emptyResponse(), partyMap: emptyMap(), productMap: emptyMap(), unitMap: emptyMap(), warehouseMap: emptyMap(), materialRequestRes: emptyResponse(), purchaseRequisitionRes: emptyResponse(),
      });
      const { projectRes, siteRes, diaryRes, boqRes, subcontractRes, claimRes, billRes, partyMap, productMap, unitMap, warehouseMap, materialRequestRes, purchaseRequisitionRes } = data;
      const projectRows = itemsOf(projectRes);
      const siteRows = itemsOf(siteRes);
      const boqRows = itemsOf(boqRes);
      if (isLatest()) {
        setProjects(projectRows); setSites(siteRows); setDiaries(itemsOf(diaryRes)); setBoqs(boqRows);
        setSubcontracts(itemsOf(subcontractRes)); setClaims(itemsOf(claimRes)); setBills(itemsOf(billRes)); setParties(partyMap);
        setProducts(productMap); setUnits(unitMap); setWarehouses(warehouseMap);
        setMaterialRequests(itemsOf(materialRequestRes)); setPurchaseRequisitions(itemsOf(purchaseRequisitionRes));
        setProjectId((current) => projectRows.some((row) => row.id === current) ? current : projectRows[0]?.id || '');
        if (errors.length) setError(errors[0]?.message || t('Một số dữ liệu công trường không tải được.'));
      }
    } catch (reason) { if (isLatest()) setError(t(reason.message || 'Không tải được dữ liệu công trường.')); }
    finally { if (isLatest()) setLoading(false); }
  }, [latestRequest]);
  useEffect(() => { load(); }, [load]);
  const selectedProject = projects.find((row) => row.id === projectId);
  const projectBoqs = useMemo(() => boqs.filter((row) => row.project === projectId).sort((a, b) => Number(b.revision) - Number(a.revision)), [boqs, projectId]);
  const projectSites = useMemo(() => sites.filter((row) => !row.project || row.project === projectId), [sites, projectId]);
  const projectDiaries = useMemo(() => diaries.filter((row) => projectSites.some((site) => site.id === row.site)).sort((a, b) => String(b.date).localeCompare(String(a.date))), [diaries, projectSites]);
  const projectSubcontracts = useMemo(() => subcontracts.filter((row) => row.project === projectId), [subcontracts, projectId]);
  const committedValue = addDecimals(projectSubcontracts.filter((row) => ['signed', 'completed'].includes(row.status)).map((row) => row.value));
  const currentBoq = projectBoqs.find((row) => row.status === 'approved');
  const currentBoqMaterialLines = (currentBoq?.items || []).filter((line) => line.product && line.uom);
  const materialUnitsFor = (productId) => {
    const base = products.get(productId)?.uom;
    return base ? [...units.values()].filter((unit) => unit.id === base || unit.base_uom === base) : [];
  };
  const billBySubcontract = useMemo(() => new Map(bills.filter((row) => row.source === 'subcontract').map((row) => [row.source_id, row])), [bills]);
  const billByClaim = useMemo(() => new Map(bills.filter((row) => row.source === 'progress_claim').map((row) => [row.source_id, row])), [bills]);
  const projectClaims = useMemo(() => claims.filter((row) => projectSubcontracts.some((contract) => contract.id === row.subcontract)), [claims, projectSubcontracts]);
  const claimableContracts = projectSubcontracts.filter((row) => ['signed', 'completed'].includes(row.status)).map((row) => ({
    ...row,
    vendorLabel: parties.has(row.vendor) ? recordLabel('master-data.party', parties.get(row.vendor)) : t('Nhà thầu'),
  }));
  const claimRows = [...projectClaims].sort((a, b) => String(b.period).localeCompare(String(a.period))).map((row) => {
    const contract = subcontracts.find((item) => item.id === row.subcontract);
    return {
      row,
      vendorLabel: parties.has(row.vendor) ? recordLabel('master-data.party', parties.get(row.vendor)) : '—',
      scopeLabel: contract?.scope || '',
      bill: billByClaim.get(row.id),
    };
  });
  const revisionSource = boqs.find((row) => row.id === boqForm.supersedes);
  const workflow = useConstructionWorkflow({ load, projectId, setProjectId, projects, sites, subcontracts, parties, products, units, warehouses: [...warehouses.values()], setError, t, today });
  const {
    siteForm, setSiteForm, diaryForm, setDiaryForm, boqForm, setBoqForm, boqLines,
    materialRequestForm, setMaterialRequestForm,
    createdMaterialRequests,
    subcontractForm, setSubcontractForm, claimForm, setClaimForm, busy, notice,
    createSite, createDiary, createBoq, createSubcontract, createClaim, createMaterialRequest, transition,
    selectProject, addBoqLine, updateBoqLine, removeBoqLine, reviseBoq,
  } = workflow;
  const currentMaterialRequest = materialRequests
    .filter((request) => request.boq === currentBoq?.id)
    .find((request) => purchaseRequisitions.find((row) => row.id === request.purchase_requisition)?.status !== 'cancelled')
    || createdMaterialRequests[currentBoq?.id];
  const currentPurchaseRequisition = currentMaterialRequest
    ? purchaseRequisitions.find((row) => row.id === currentMaterialRequest.purchase_requisition)
    : null;
  return <div className="page">
    <div className="page-head"><div><h1>{t("Điều hành công trường")}</h1><p className="sub">{t("Quản lý tiến độ dự án, dự toán BOQ theo phiên bản, nhật ký công trường và cam kết chi phí thầu phụ.")}</p></div><button className="btn btn-secondary" type="button" disabled={loading || Boolean(busy)} onClick={() => load()}>{t("Làm mới")}</button></div>
    {error && <div className="alert danger" role="alert">{t(error)}</div>}{notice && <div className="alert success" role="status">{t(notice)}</div>}
    {loading ? <div className="skeleton" data-h="row" /> : !projects.length ? <div className="card card-pad empty">{t("Chưa có dự án. Hãy tạo dự án trong module Quản lý dự án trước khi lập dự toán hoặc công trường.")}</div> : <>
      <section className="card card-pad"><div className="form-grid"><label className="field"><span className="label">{t("Công trình đang xem")}</span><select className="select" value={projectId} onChange={(e) => selectProject(e.target.value)}>{projects.map((project) => <option key={project.id} value={project.id}>{project.name} · {statusLabel(project.status)}</option>)}</select></label><div className="field"><span className="label">{t("Ngân sách dự án")}</span><strong>{fmtMoney(selectedProject?.budget || 0)}</strong></div><div className="field"><span className="label">{t("Cam kết thầu phụ")}</span><strong>{fmtMoney(committedValue)}</strong></div><div className="field"><span className="label">{t("Dự toán đã duyệt")}</span><strong>{currentBoq ? fmtMoney(currentBoq.total || 0) : t('Chưa có baseline')}</strong></div></div>
        {selectedProject?.status === 'planned' && can('project.project.started') && <button className="btn btn-primary btn-sm u-mt-12"  disabled={Boolean(busy)} onClick={() => transition('project.project', selectedProject, 'started', 'Đã khởi công dự án; có thể ký hợp đồng thầu phụ.')}>{t("Khởi công dự án")}</button>}
      </section>
      <div className="layout-split u-mt-16" >
        <section className="card card-pad"><h2>{t("BOQ · Dự toán và phiên bản")}</h2>
          {can('construction.boq.create') && <form onSubmit={createBoq}>
            <div className="form-grid"><label className="field"><span className="label">{t("Phiên bản cho công trình")}</span><select className="select" required value={boqForm.project} onChange={(e) => setBoqForm({ ...boqForm, project: e.target.value, supersedes: '' })}>{projects.filter((project) => ['planned', 'active'].includes(project.status)).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label><label className="field"><span className="label">{t("Điều chỉnh baseline")}</span><select className="select" value={boqForm.supersedes} onChange={(e) => setBoqForm({ ...boqForm, supersedes: e.target.value })}><option value="">{t("BOQ gốc · phiên bản 1")}</option>{boqs.filter((row) => row.project === boqForm.project && row.status === 'approved').map((row) => <option key={row.id} value={row.id}>{row.number} · rev {row.revision}</option>)}</select></label>
              {revisionSource && <label className="field full"><span className="label">{t("Lý do điều chỉnh *")}</span><input className="input" required value={boqForm.revision_reason} onChange={(e) => setBoqForm({ ...boqForm, revision_reason: e.target.value })}/></label>}
            </div>
            <div className="row wrap u-mt-12" ><strong>{t("Hạng mục")}</strong><span className="grow"/><button className="btn btn-secondary btn-sm" type="button" onClick={addBoqLine}>{t("Thêm hạng mục")}</button></div>
            {boqLines.map((line, index) => <div className="row wrap u-mt-8" key={line.rowId} >
              <select className="select u-max-w-220" aria-label={`${t('Sản phẩm vật tư liên kết')} ${index + 1}`} value={line.product} disabled={!products.size} onChange={(event) => updateBoqLine(index, 'product', event.target.value)}>
                <option value="">{t('Công tác / dịch vụ, không quản lý tồn kho')}</option>
                {[...products.values()].filter((product) => product.active !== false && product.uom && (!product.kind || product.kind === 'goods')).map((product) => <option key={product.id} value={product.id}>{recordLabel('master-data.product', product)}</option>)}
              </select>
              <input className="input" aria-label={t('Mô tả hạng mục')} placeholder={t('Mô tả công tác / vật tư')} required value={line.description} onChange={(e) => updateBoqLine(index, 'description', e.target.value)}/>
              {line.product ? <select className="select u-max-w-180" aria-label={`${t('Đơn vị vật tư')} ${index + 1}`} required value={line.uom} onChange={(event) => updateBoqLine(index, 'uom', event.target.value)}>
                <option value="">{t('Chọn đơn vị')}</option>{materialUnitsFor(line.product).map((unit) => <option key={unit.id} value={unit.id}>{unit.name}{unit.base_uom ? ` · ${unit.ratio} × ${t('đơn vị gốc')}` : ` · ${t('đơn vị gốc')}`}</option>)}
              </select> : <input className="input u-max-w-150" aria-label={t('Đơn vị tính')} placeholder={t('m², m³, m, kg, ngày công')} required maxLength={32} value={line.unit} onChange={(e) => updateBoqLine(index, 'unit', e.target.value)}/>}
              <input className="input num u-max-w-110" aria-label={t('Khối lượng')} type="number" min="0.001" step="any" required value={line.qty} onChange={(e) => updateBoqLine(index, 'qty', e.target.value)} />
              <input className="input num u-max-w-150" aria-label={t('Đơn giá')} type="number" min="0" step="any" required value={line.unit_price} onChange={(e) => updateBoqLine(index, 'unit_price', e.target.value)} />
              <strong>{fmtMoney(boqLineValue(line))}</strong>{boqLines.length > 1 && <button className="btn btn-ghost btn-sm" type="button" aria-label={t('Xóa hạng mục')} onClick={() => removeBoqLine(index)}>{t("Bỏ")}</button>}
            </div>)}
            <div className="row u-mt-10" ><span className="grow"/><strong>Ước tính: {fmtMoney(boqTotal(boqLines))}</strong><button className="btn btn-primary" disabled={Boolean(busy) || !boqForm.project}>{t("Lưu BOQ nháp")}</button></div>
          </form>}
          <div className="table-wrap u-mt-16" ><table className="table"><thead><tr><th>{t("Mã BOQ")}</th><th>{t("Phiên bản")}</th><th>{t("Tổng dự toán")}</th><th>{t("Trạng thái")}</th><th>{t("Thao tác")}</th></tr></thead><tbody>{projectBoqs.map((row) => <tr key={row.id}><td><strong>{row.number}</strong>{Number(row.revision) > 1 && <div className="small muted">{row.revision_reason}</div>}{(row.items || []).map((item, index) => <div className="small muted" key={index}>{item.description} {'\u00b7'} {item.qty} {item.unit}{item.product ? ` · ${products.get(item.product)?.name || t('Vật tư liên kết')}` : ''} {'\u00d7'} {fmtMoney(item.unit_price)}</div>)}</td><td>R{row.revision}</td><td>{fmtMoney(row.total || 0)}</td><td>{statusLabel(row.status)}</td><td>{row.status === 'draft' && can('construction.boq.approved') && <button className="btn btn-primary btn-sm" disabled={Boolean(busy)} onClick={() => transition('construction.boq', row, 'approved', 'Đã duyệt BOQ và xác lập baseline dự toán cho công trình.')}>{t("Duyệt baseline")}</button>}{row.status === 'approved' && can('construction.boq.create') && <button className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => reviseBoq(row)}>{t("Lập phiên bản điều chỉnh")}</button>}</td></tr>)}</tbody></table></div>
          {currentBoq && currentBoqMaterialLines.length > 0 && can('construction.material_request.create') && can('purchasing.purchase_requisition.create') && <section className="card card-pad u-mt-16">
            <h3>{t('Yêu cầu mua vật tư theo BOQ')}</h3>
            <p className="small muted">{t('Chỉ các dòng BOQ liên kết sản phẩm mới được đưa vào đề nghị mua. Hàng vẫn cần rà soát, gửi duyệt và nhận qua quy trình mua hàng.')}</p>
            {currentMaterialRequest ? <div className="alert success" role="status">{t('Đã có đề nghị mua vật tư cho BOQ này.')}{currentPurchaseRequisition && can('purchasing.purchase_requisition.read') && <> <a href={recordHref('purchasing.purchase_requisition', currentPurchaseRequisition.id)}>{t('Mở đề nghị mua')} · {statusLabel(currentPurchaseRequisition.status)}</a></>}</div> : <>
              <div className="table-wrap"><table className="table"><thead><tr><th>{t('Vật tư')}</th><th>{t('Khối lượng theo BOQ')}</th></tr></thead><tbody>{currentBoqMaterialLines.map((line, index) => <tr key={`${line.product}-${index}`}><td>{products.get(line.product)?.name || t('Vật tư')}<div className="small muted">{line.description}</div></td><td>{line.qty} {units.get(line.uom)?.name || line.unit}</td></tr>)}</tbody></table></div>
              <form className="form-grid u-mt-12" onSubmit={(event) => createMaterialRequest(event, currentBoq)}>
                <label className="field"><span className="label">{t('Kho nhận vật tư')} *</span><select className="select" required value={materialRequestForm.warehouse} onChange={(event) => setMaterialRequestForm({ ...materialRequestForm, warehouse: event.target.value })}><option value="">{t('Chọn kho')}</option>{[...warehouses.values()].map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{recordLabel('inventory.warehouse', warehouse)}</option>)}</select></label>
                <label className="field"><span className="label">{t('Phương thức mua')} *</span><select className="select" value={materialRequestForm.sourcing_method} onChange={(event) => setMaterialRequestForm({ ...materialRequestForm, sourcing_method: event.target.value, supplier: '' })}><option value="competitive">{t('So sánh báo giá')}</option><option value="direct">{t('Mua trực tiếp')}</option></select></label>
                {materialRequestForm.sourcing_method === 'direct' && <label className="field"><span className="label">{t('Nhà cung cấp')} *</span><select className="select" required value={materialRequestForm.supplier} onChange={(event) => setMaterialRequestForm({ ...materialRequestForm, supplier: event.target.value })}><option value="">{t('Chọn nhà cung cấp')}</option>{[...parties.values()].filter((party) => party.is_supplier !== false).map((party) => <option key={party.id} value={party.id}>{recordLabel('master-data.party', party)}</option>)}</select></label>}
                <label className="field"><span className="label">{t('Người yêu cầu')}</span><input className="input" maxLength="160" value={materialRequestForm.requested_by} onChange={(event) => setMaterialRequestForm({ ...materialRequestForm, requested_by: event.target.value })}/></label>
                <label className="field full"><span className="label">{t('Lý do / ghi chú')}</span><input className="input" maxLength="500" value={materialRequestForm.reason} onChange={(event) => setMaterialRequestForm({ ...materialRequestForm, reason: event.target.value })}/></label>
                <div className="row full"><span className="grow"/><button className="btn btn-primary" disabled={Boolean(busy) || !materialRequestForm.warehouse}>{t('Tạo đề nghị mua nháp')}</button></div>
              </form>
            </>}
          </section>}
        </section>
        <ConstructionSiteDiaryPanel
          projects={projects} projectSites={projectSites} projectDiaries={projectDiaries}
          selectedProject={selectedProject} siteForm={siteForm} diaryForm={diaryForm}
          busy={busy} canCreateSite={can('construction.site.create')}
          canCreateDiary={can('construction.site_diary.create')} today={today}
          fmtDate={fmtDate}
          onSiteFieldChange={(field, value) => setSiteForm((current) => ({ ...current, [field]: value }))}
          onDiaryFieldChange={(field, value) => setDiaryForm((current) => ({ ...current, [field]: value }))}
          onCreateSite={createSite} onCreateDiary={createDiary} t={t}
        />
      </div>
      <section className="card card-pad u-mt-16" ><h2>{t("Thầu phụ · Cam kết chi phí")}</h2>
        {can('construction.subcontract.create') && <form className="form-grid" onSubmit={createSubcontract}><label className="field"><span className="label">{t("Nhà thầu *")}</span><select className="select" required value={subcontractForm.vendor} onChange={(e) => setSubcontractForm({ ...subcontractForm, vendor: e.target.value })}><option value="">{t("Chọn nhà thầu")}</option>{[...parties.values()].map((party) => <option key={party.id} value={party.id}>{recordLabel('master-data.party', party)}</option>)}</select></label><label className="field"><span className="label">{t("Giá trị hợp đồng *")}</span><input className="input" type="number" required min="0.01" step="any" value={subcontractForm.value} onChange={(e) => setSubcontractForm({ ...subcontractForm, value: e.target.value })}/></label><label className="field full"><span className="label">{t("Phạm vi công việc")}</span><textarea className="input" rows="2" value={subcontractForm.scope} onChange={(e) => setSubcontractForm({ ...subcontractForm, scope: e.target.value })}/></label><div className="row full"><span className="grow"/><button className="btn btn-secondary" disabled={Boolean(busy) || !['planned','active'].includes(selectedProject?.status) || !subcontractForm.vendor}>{t("Lập dự thảo thầu phụ")}</button></div></form>}
        <p className="muted">{t("Ký hợp đồng ghi nhận cam kết chi phí và kiểm tra ngân sách. Hóa đơn phải trả được lập riêng khi có khối lượng nghiệm thu hoặc hồ sơ thanh toán.")}</p>
        <div className="table-wrap u-mt-14" ><table className="table"><thead><tr><th>{t("Nhà thầu")}</th><th>{t("Phạm vi")}</th><th>{t("Giá trị")}</th><th>{t("Trạng thái")}</th><th>{t("Thao tác / chứng từ")}</th></tr></thead><tbody>{projectSubcontracts.map((row) => <tr key={row.id}><td>{parties.has(row.vendor) ? recordLabel('master-data.party', parties.get(row.vendor)) : '—'}</td><td>{row.scope || '—'}</td><td>{fmtMoney(row.value)}</td><td>{statusLabel(row.status)}</td><td>{row.status === 'draft' && can('construction.subcontract.signed') && <button className="btn btn-primary btn-sm" disabled={Boolean(busy) || selectedProject?.status !== 'active'} onClick={() => transition('construction.subcontract', row, 'signed', 'Đã ký thầu phụ và ghi nhận cam kết chi phí trong hạn mức ngân sách.')}>{t("Ký hợp đồng")}</button>}{row.status === 'signed' && can('construction.subcontract.completed') && <button className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => transition('construction.subcontract', row, 'completed', 'Đã xác nhận hoàn thành phạm vi thầu phụ.')}>{t("Hoàn thành")}</button>}{billBySubcontract.has(row.id) && <a className="btn btn-ghost btn-sm u-ml-6"  href={`#/e/accounting/bill/${billBySubcontract.get(row.id).id}`}>{t("Mở hóa đơn phải trả")}</a>}</td></tr>)}</tbody></table></div>
      </section>
      <ProgressClaimsPanel
        claimForm={claimForm}
        claimableContracts={claimableContracts}
        claimRows={claimRows}
        canCreate={can('construction.progress_claim.create')}
        canApprove={can('construction.progress_claim.approved')}
        busy={busy}
        today={today()}
        onFieldChange={(field, value) => setClaimForm((current) => ({ ...current, [field]: value }))}
        onCreateClaim={createClaim}
        onApproveClaim={(row) => transition('construction.progress_claim', row, 'approved', 'Đã duyệt nghiệm thu và tạo hóa đơn phải trả theo giá trị đợt.')}
        t={t}
        fmtDate={fmtDate}
        fmtMoney={fmtMoney}
        statusLabel={statusLabel}
      />
    </>}
  </div>;
}
