import React from 'react';
import { useDocumentTitle } from '../../lib/useDocumentTitle.js';
import { localDate } from '../../lib/dates.js';
import { fmtDate, fmtMoney, statusLabel, uiTextWith } from '../../lib/i18n.js';
import { multiplyDecimals } from '../../lib/decimal.js';
import { can, recordLabel } from '../../lib/state.js';
import MaintenancePartsEditor from './components/MaintenancePartsEditor.jsx';
import MaintenanceRequestQueue from './components/MaintenanceRequestQueue.jsx';
import maintenanceEnglish from './maintenance.en.js';
import { useMaintenanceWorkbenchData } from './hooks/useMaintenanceWorkbenchData.js';
import { useMaintenanceWorkbenchWorkflow } from './hooks/useMaintenanceWorkbenchWorkflow.js';
const t = (text) => uiTextWith(text, maintenanceEnglish);
const today = localDate;
export default function MaintenanceWorkbenchPage() {
  useDocumentTitle(`${t('Bảo trì tài sản')} · OSP Suite`);
  const { plans, requests, assets, products, units, warehouses, technicians, loading, error, setError, load } = useMaintenanceWorkbenchData();
  const workflow = useMaintenanceWorkbenchWorkflow({ requests, assets, products, warehouses, load, setError, t });
  const {
    selectedId, setSelectedId, selected, assetId, setAssetId, description, setDescription, priority, setPriority,
    warehouse, setWarehouse, technician, setTechnician, assignedTechnician, setAssignedTechnician,
    technicianForm, setTechnicianForm, parts, resolution, setResolution, laborHours, setLaborHours,
    laborRate, setLaborRate, busy, notice,
    createRequest, createTechnician, saveAssignment, runPlan, startRequest, completeRequest,
    addPart, updatePart, removePart,
  } = workflow;
  const openRequests = requests.filter((row) => ['open', 'in_progress'].includes(row.status));
  const requestForPlan = (plan) => requests.find((request) => request.source_plan === plan.id
    && request.scheduled_for === plan.next_due
    && ['open', 'in_progress'].includes(request.status));
  const overduePlans = plans.filter((row) => row.status === 'active' && row.next_due && row.next_due <= today() && !requestForPlan(row));
  const requestRows = requests.map((row) => ({
    id: row.id,
    assetName: assets.get(row.asset) ? recordLabel('asset.asset', assets.get(row.asset)) : t('Tài sản'),
    description: row.description || (row.source_plan ? t('Bảo trì định kỳ') : t('Yêu cầu mới')),
    technicianName: technicians.get(row.technician)?.name || t('Chưa phân công'),
    priorityLabel: statusLabel(row.priority),
    dateLabel: fmtDate(row.scheduled_for || row.created_at),
    statusLabel: statusLabel(row.status),
  }));
  const unitsFor = (productId) => {
    const baseUnit = products.get(productId)?.uom;
    return baseUnit ? [...units.values()].filter((unit) => unit.id === baseUnit || unit.base_uom === baseUnit) : [];
  };
  return <div className="page">
    <div className="page-head"><div><h1>{t('Bảo trì tài sản và thiết bị')}</h1><p className="sub">{t('Theo dõi lịch bảo trì định kỳ, tiếp nhận sự cố, phân công kỹ thuật, xuất vật tư và lưu kết quả sửa chữa.')}</p></div><button className="btn btn-secondary" type="button" disabled={loading || Boolean(busy)} onClick={() => load()}>{t('Làm mới')}</button></div>
    {error && <div className="alert danger" role="alert">{t(error)}</div>}{notice && <div className="alert success" role="status">{t(notice)}</div>}
    <div className="stats u-mb-16" ><div className="card stat"><span className="stat-label">{t('Lịch đã đến hạn')}</span><strong className="stat-value">{overduePlans.length}</strong></div><div className="card stat"><span className="stat-label">{t('Lệnh đang mở')}</span><strong className="stat-value">{openRequests.length}</strong></div><div className="card stat"><span className="stat-label">{t('Đang xử lý')}</span><strong className="stat-value">{requests.filter((row) => row.status === 'in_progress').length}</strong></div><div className="card stat"><span className="stat-label">{t('Đã hoàn tất')}</span><strong className="stat-value">{requests.filter((row) => row.status === 'done').length}</strong></div></div>
    {can('maintenance.maintenance_technician.create') && <section className="card card-pad u-mb-16" ><h2>{t('Danh mục kỹ thuật viên')}</h2><form className="form-grid" onSubmit={createTechnician}><label className="field"><span className="label">{t('Tên *')}</span><input className="input" required maxLength="200" value={technicianForm.name} onChange={(event) => setTechnicianForm((form) => ({ ...form, name: event.target.value }))}/></label><label className="field"><span className="label">{t('Loại')}</span><select className="select" value={technicianForm.kind} onChange={(event) => setTechnicianForm((form) => ({ ...form, kind: event.target.value }))}><option value="internal">{t('Nội bộ')}</option><option value="contractor">{t('Nhà thầu')}</option></select></label><label className="field"><span className="label">{t('Chuyên môn')}</span><input className="input" maxLength="200" value={technicianForm.specialty} onChange={(event) => setTechnicianForm((form) => ({ ...form, specialty: event.target.value }))}/></label><label className="field"><span className="label">{t('Điện thoại')}</span><input className="input" maxLength="50" value={technicianForm.phone} onChange={(event) => setTechnicianForm((form) => ({ ...form, phone: event.target.value }))}/></label><div className="row"><span className="grow"/><button className="btn btn-secondary" disabled={Boolean(busy)}>{t('Thêm kỹ thuật viên')}</button></div></form></section>}
    {can('maintenance.maintenance_request.create') && <section className="card card-pad"><h2>{t('Tiếp nhận yêu cầu bảo trì')}</h2><form onSubmit={createRequest}><div className="form-grid">
      <label className="field"><span className="label">{t('Tài sản / thiết bị *')}</span><select className="select" required value={assetId} onChange={(event) => setAssetId(event.target.value)}><option value="">{t('Chọn tài sản')}</option>{[...assets.values()].filter((row) => row.status === 'active').map((row) => <option key={row.id} value={row.id}>{recordLabel('asset.asset', row)}</option>)}</select></label>
      <label className="field"><span className="label">{t('Mức ưu tiên')}</span><select className="select" value={priority} onChange={(event) => setPriority(event.target.value)}><option value="low">{t('Thấp')}</option><option value="normal">{t('Bình thường')}</option><option value="high">{t('Cao')}</option></select></label>
      <label className="field"><span className="label">{t('Kho xuất vật tư')}</span><select className="select" value={warehouse} onChange={(event) => setWarehouse(event.target.value)}><option value="">{t('Chọn kho khi có vật tư')}</option>{[...warehouses.values()].map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
      {can('maintenance.maintenance_technician.read') && <label className="field"><span className="label">{t('Kỹ thuật viên phụ trách')}</span><select className="select" value={technician} onChange={(event) => setTechnician(event.target.value)}><option value="">{t('Chưa phân công')}</option>{[...technicians.values()].filter((row) => row.active !== false).map((row) => <option key={row.id} value={row.id}>{row.name}{row.specialty ? ` · ${row.specialty}` : ''}</option>)}</select></label>}
      </div><label className="field u-mt-10" ><span className="label">{t('Mô tả sự cố / công việc')}</span><textarea className="input" rows="2" value={description} onChange={(event) => setDescription(event.target.value)} placeholder={t("Triệu chứng, vị trí, điều kiện vận hành…")}/></label>
      <MaintenancePartsEditor parts={parts} products={products} unitsFor={unitsFor} onAdd={addPart} onUpdate={updatePart} onRemove={removePart} t={t} />
      <div className="row u-mt-12" ><span className="grow"/><button className="btn btn-primary" disabled={Boolean(busy) || !assetId}>{t('Ghi nhận yêu cầu')}</button></div>
    </form></section>}
    <div className="layout-split u-mt-16" >
      <section className="card card-pad"><h2>{t('Kế hoạch định kỳ')}</h2>{loading ? <div className="skeleton" data-h="row"/> : !plans.length ? <div className="empty">{t('Chưa có kế hoạch bảo trì. Tạo kế hoạch trong module Tài sản và bảo trì.')}</div> : <div className="table-wrap"><table className="table"><thead><tr><th>{t('Kế hoạch / tài sản')}</th><th>{t('Đến hạn')}</th><th>{t('Trạng thái')}</th><th/></tr></thead><tbody>{plans.map((row) => { const activeRequest = requestForPlan(row); return <tr key={row.id}><td><strong>{row.title}</strong><div className="small muted">{assets.get(row.asset) ? recordLabel('asset.asset', assets.get(row.asset)) : t('Tài sản')}</div></td><td>{fmtDate(row.next_due)}</td><td>{statusLabel(row.status)}{row.status === 'active' && row.next_due && row.next_due <= today() && <span className="badge danger u-ml-6" >{t('Quá hạn')}</span>}</td><td>{activeRequest ? <button className="btn btn-secondary btn-sm" type="button" onClick={() => setSelectedId(activeRequest.id)}>{t('Mở lệnh ·')} {statusLabel(activeRequest.status)}</button> : row.status === 'active' && can('maintenance.maintenance_plan.due') && <button className="btn btn-primary btn-sm" disabled={Boolean(busy) || !row.next_due || row.next_due > today()} onClick={() => runPlan(row)}>{t('Tạo lệnh')}</button>}</td></tr>; })}</tbody></table></div>}</section>
      <MaintenanceRequestQueue loading={loading} requests={requestRows} selectedId={selectedId} onSelect={setSelectedId} t={t} />
    </div>
    {selected && <section className="card card-pad u-mt-16" ><div className="row wrap"><div><h2>{assets.get(selected.asset) ? recordLabel('asset.asset', assets.get(selected.asset)) : t('Lệnh bảo trì')}</h2><p className="small muted">{selected.description || t('Không có mô tả')} · {t("Ưu tiên")} {statusLabel(selected.priority)} · {t("Kho vật tư")} {warehouses.get(selected.warehouse)?.name || t('chưa chọn')}</p></div><span className="grow"/><span className="badge warning">{statusLabel(selected.status)}</span></div>
      {can('maintenance.maintenance_request.update') && ['open', 'in_progress'].includes(selected.status) && can('maintenance.maintenance_technician.read') && <div className="row wrap u-margin-10-0" ><label className="field grow"><span className="label">{t('Kỹ thuật viên phụ trách')}</span><select className="select" value={assignedTechnician} onChange={(event) => setAssignedTechnician(event.target.value)}><option value="">{t('Chưa phân công')}</option>{[...technicians.values()].filter((row) => row.active !== false).map((row) => <option key={row.id} value={row.id}>{row.name}{row.specialty ? ` · ${row.specialty}` : ''}</option>)}</select></label><button className="btn btn-secondary btn-sm" type="button" disabled={Boolean(busy) || assignedTechnician === (selected.technician || '')} onClick={() => saveAssignment(selected)}>{t('Lưu phân công')}</button></div>}
      {!!selected.parts?.length && <div className="table-wrap"><table className="table"><thead><tr><th>{t('Vật tư')}</th><th>{t('Số lượng dự kiến')}</th></tr></thead><tbody>{selected.parts.map((line, index) => <tr key={`${line.product}-${index}`}><td>{products.get(line.product)?.name || t('Vật tư')}</td><td>{line.qty} {line.uom_name || units.get(line.uom)?.name || ''}</td></tr>)}</tbody></table></div>}
      {selected.status === 'open' && can('maintenance.maintenance_request.started') && <button className="btn btn-primary btn-sm" disabled={Boolean(busy)} onClick={() => startRequest(selected)}>{t('Bắt đầu xử lý')}</button>}
      {selected.status === 'in_progress' && can('maintenance.maintenance_request.update') && can('maintenance.maintenance_request.done') && <form className="card card-pad u-mt-12"  onSubmit={(event) => completeRequest(event, selected)}><h3>{t('Ghi nhận hoàn tất')}</h3><label className="field"><span className="label">{t('Kết quả xử lý *')}</span><textarea className="input" required rows="3" value={resolution} onChange={(event) => setResolution(event.target.value)} placeholder={t("Nguyên nhân, công việc đã làm, tình trạng sau sửa chữa…")}/></label><div className="form-grid u-mt-10" ><label className="field"><span className="label">{t('Giờ công (nhập cùng đơn giá)')}</span><input className="input num" type="number" min="0" step="0.25" value={laborHours} onChange={(event) => setLaborHours(event.target.value)}/></label><label className="field"><span className="label">{t('Đơn giá giờ công')}</span><input className="input num" type="number" min="0" step="any" value={laborRate} onChange={(event) => setLaborRate(event.target.value)}/></label></div><div className="row u-mt-10" ><span className="grow"/><button className="btn btn-primary" disabled={Boolean(busy)}>{t('Hoàn tất lệnh')}</button></div></form>}
      {selected.resolution && <div className="alert success u-mt-12" ><strong>{t('Kết quả:')}</strong> {selected.resolution}{selected.labor_hours != null && <span> · {selected.labor_hours} {t("giờ công")} · {fmtMoney(multiplyDecimals([selected.labor_hours, selected.labor_rate || 0]))}</span>}</div>}
    </section>}
    <p className="small muted u-mt-12" >{t('Kế hoạch đến hạn chỉ phát sinh một lệnh đang mở cho mỗi kỳ; nếu lệnh bị hủy, có thể tạo lại. Khi hoàn tất lệnh, hệ thống kiểm tra tồn kho, ghi xuất vật tư, lưu ngày bảo trì và tính kỳ kế tiếp từ ngày hoàn tất.')}</p>
  </div>;
}
