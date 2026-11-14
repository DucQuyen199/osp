import React, { useCallback, useEffect, useState } from 'react';
import { api, dataPath } from './lib/api.js';
import { fmtDate, fmtMoney, statusLabel } from './lib/i18n.js';
import { app, can, loadRefs, recordLabel } from './lib/state.js';

const itemsOf = (response) => Array.isArray(response?.items) ? response.items : [];
const action = (entity, row, verb) => api(dataPath(entity, row.id, verb), { method: 'POST' });
const today = () => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; };

export default function MaintenanceWorkbenchPage() {
  const [plans, setPlans] = useState([]);
  const [requests, setRequests] = useState([]);
  const [assets, setAssets] = useState(new Map());
  const [products, setProducts] = useState(new Map());
  const [warehouses, setWarehouses] = useState(new Map());
  const [selectedId, setSelectedId] = useState('');
  const [assetId, setAssetId] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('normal');
  const [warehouse, setWarehouse] = useState('');
  const [parts, setParts] = useState([]);
  const [resolution, setResolution] = useState('');
  const [laborHours, setLaborHours] = useState('');
  const [laborRate, setLaborRate] = useState('');
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async (quiet = false) => {
    if (!quiet) { setLoading(true); setError(''); }
    try {
      const [planRes, requestRes, assetMap, productMap, warehouseMap] = await Promise.all([
        can('maintenance.maintenance_plan.read') ? api(`${dataPath('maintenance.maintenance_plan')}?limit=1000`) : Promise.resolve({ items: [] }),
        can('maintenance.maintenance_request.read') ? api(`${dataPath('maintenance.maintenance_request')}?limit=1000`) : Promise.resolve({ items: [] }),
        can('asset.asset.read') ? loadRefs('asset.asset') : Promise.resolve(new Map()),
        can('master-data.product.read') ? loadRefs('master-data.product') : Promise.resolve(new Map()),
        can('inventory.warehouse.read') ? loadRefs('inventory.warehouse') : Promise.resolve(new Map()),
      ]);
      const planRows = itemsOf(planRes).sort((a, b) => String(a.next_due || '9999').localeCompare(String(b.next_due || '9999')));
      const requestRows = itemsOf(requestRes).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
      setPlans(planRows); setRequests(requestRows); setAssets(assetMap); setProducts(productMap); setWarehouses(warehouseMap);
      setSelectedId((id) => requestRows.some((row) => row.id === id) ? id : requestRows[0]?.id || '');
      setAssetId((id) => id || [...assetMap.keys()][0] || '');
      setWarehouse((id) => id || [...warehouseMap.keys()][0] || '');
    } catch (reason) { setError(reason.message || 'Không tải được lịch bảo trì và lệnh công việc.'); }
    finally { if (!quiet) setLoading(false); }
  }, []);

  useEffect(() => { document.title = 'Bảo trì tài sản · OSP Suite'; load(); }, [load]);
  const selected = requests.find((row) => row.id === selectedId);
  const openRequests = requests.filter((row) => ['open', 'in_progress'].includes(row.status));
  const requestForPlan = (plan) => requests.find((request) => request.source_plan === plan.id
    && request.scheduled_for === plan.next_due
    && ['open', 'in_progress'].includes(request.status));
  const overduePlans = plans.filter((row) => row.status === 'active' && row.next_due && row.next_due <= today() && !requestForPlan(row));

  async function run(key, operation, success) {
    setBusy(key); setError(''); setNotice('');
    try { await operation(); setNotice(success); await load(true); }
    catch (reason) { setError(reason.message || 'Thao tác không thành công.'); await load(true); }
    finally { setBusy(''); }
  }

  async function createRequest(event) {
    event.preventDefault();
    const materialLines = parts.filter((line) => line.product && Number(line.qty) > 0).map((line) => ({ product: line.product, qty: Number(line.qty) }));
    await run('create', async () => {
      const row = await api(dataPath('maintenance.maintenance_request'), { method: 'POST', body: {
        asset: assetId, description: description.trim() || undefined, priority,
        warehouse: materialLines.length ? warehouse : undefined, parts: materialLines.length ? materialLines : undefined,
        requested_by: app.user?.name || app.user?.email || undefined,
      } });
      setSelectedId(row.id); setDescription(''); setPriority('normal'); setParts([]);
    }, 'Đã ghi nhận yêu cầu bảo trì. Lệnh được đưa vào hàng đợi để kỹ thuật viên tiếp nhận.');
  }

  async function runPlan(plan) {
    await run(`${plan.id}:due`, () => action('maintenance.maintenance_plan', plan, 'due'), 'Đã đưa lệnh bảo trì định kỳ vào hàng đợi. Kỳ kế tiếp sẽ tính sau khi lệnh được hoàn tất.');
  }

  async function startRequest(row) {
    await run(`${row.id}:started`, () => action('maintenance.maintenance_request', row, 'started'), 'Kỹ thuật viên đã bắt đầu xử lý lệnh.');
  }

  async function completeRequest(event, row) {
    event.preventDefault();
    await run(`${row.id}:done`, async () => {
      const updated = await api(dataPath('maintenance.maintenance_request', row.id), { method: 'PATCH', body: {
        resolution: resolution.trim(), labor_hours: laborHours === '' ? undefined : Number(laborHours),
        labor_rate: laborRate === '' ? undefined : Number(laborRate),
      } });
      await action('maintenance.maintenance_request', updated, 'done');
      setResolution(''); setLaborHours(''); setLaborRate('');
    }, 'Đã hoàn tất lệnh. Vật tư được xuất khỏi kho đã chọn và kế hoạch định kỳ được cập nhật.');
  }

  const addPart = () => setParts((current) => [...current, { product: [...products.keys()][0] || '', qty: '1' }]);
  const updatePart = (index, field, value) => setParts((current) => current.map((row, i) => i === index ? { ...row, [field]: value } : row));

  return <div className="page">
    <div className="page-head"><div><h1>Bảo trì tài sản và thiết bị</h1><p className="sub">Theo dõi lịch bảo trì định kỳ, tiếp nhận sự cố, phân công kỹ thuật, xuất vật tư và lưu kết quả sửa chữa.</p></div><button className="btn btn-secondary" type="button" disabled={loading || Boolean(busy)} onClick={() => load()}>Làm mới</button></div>
    {error && <div className="alert danger" role="alert">{error}</div>}{notice && <div className="alert success" role="status">{notice}</div>}
    <div className="stats" style={{ marginBottom: 16 }}><div className="card stat"><span className="stat-label">Lịch đã đến hạn</span><strong className="stat-value">{overduePlans.length}</strong></div><div className="card stat"><span className="stat-label">Lệnh đang mở</span><strong className="stat-value">{openRequests.length}</strong></div><div className="card stat"><span className="stat-label">Đang xử lý</span><strong className="stat-value">{requests.filter((row) => row.status === 'in_progress').length}</strong></div><div className="card stat"><span className="stat-label">Đã hoàn tất</span><strong className="stat-value">{requests.filter((row) => row.status === 'done').length}</strong></div></div>

    {can('maintenance.maintenance_request.create') && <section className="card card-pad"><h2>Tiếp nhận yêu cầu bảo trì</h2><form onSubmit={createRequest}><div className="form-grid">
      <label className="field"><span className="label">Tài sản / thiết bị *</span><select className="select" required value={assetId} onChange={(event) => setAssetId(event.target.value)}><option value="">Chọn tài sản</option>{[...assets.values()].filter((row) => row.active !== false).map((row) => <option key={row.id} value={row.id}>{recordLabel('asset.asset', row)}</option>)}</select></label>
      <label className="field"><span className="label">Mức ưu tiên</span><select className="select" value={priority} onChange={(event) => setPriority(event.target.value)}><option value="low">Thấp</option><option value="normal">Bình thường</option><option value="high">Cao</option></select></label>
      <label className="field"><span className="label">Kho xuất vật tư</span><select className="select" value={warehouse} onChange={(event) => setWarehouse(event.target.value)}><option value="">Chọn kho khi có vật tư</option>{[...warehouses.values()].map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
      </div><label className="field" style={{ marginTop: 10 }}><span className="label">Mô tả sự cố / công việc</span><textarea className="input" rows="2" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Triệu chứng, vị trí, điều kiện vận hành…"/></label>
      <div className="row wrap" style={{ marginTop: 12 }}><strong>Vật tư dự kiến</strong><span className="grow"/><button className="btn btn-secondary btn-sm" type="button" disabled={!products.size} onClick={addPart}>Thêm vật tư</button></div>
      {parts.map((line, index) => <div className="row wrap" key={index} style={{ marginTop: 8 }}><select className="select" required value={line.product} onChange={(event) => updatePart(index, 'product', event.target.value)}><option value="">Chọn vật tư</option>{[...products.values()].filter((row) => row.active !== false && (row.tracked ?? row.kind === 'goods')).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select><input className="input num" aria-label="Số lượng vật tư" type="number" min="0.000001" step="any" required value={line.qty} onChange={(event) => updatePart(index, 'qty', event.target.value)} style={{ maxWidth: 140 }}/><button className="btn btn-ghost btn-sm" type="button" onClick={() => setParts((current) => current.filter((_, i) => i !== index))}>Bỏ</button></div>)}
      <div className="row" style={{ marginTop: 12 }}><span className="grow"/><button className="btn btn-primary" disabled={Boolean(busy) || !assetId}>Ghi nhận yêu cầu</button></div>
    </form></section>}

    <div className="layout-split" style={{ marginTop: 16 }}>
      <section className="card card-pad"><h2>Kế hoạch định kỳ</h2>{loading ? <div className="skeleton" data-h="row"/> : !plans.length ? <div className="empty">Chưa có kế hoạch bảo trì. Tạo kế hoạch trong module Tài sản và bảo trì.</div> : <div className="table-wrap"><table className="table"><thead><tr><th>Kế hoạch / tài sản</th><th>Đến hạn</th><th>Trạng thái</th><th/></tr></thead><tbody>{plans.map((row) => { const activeRequest = requestForPlan(row); return <tr key={row.id}><td><strong>{row.title}</strong><div className="small muted">{assets.get(row.asset) ? recordLabel('asset.asset', assets.get(row.asset)) : 'Tài sản'}</div></td><td>{fmtDate(row.next_due)}</td><td>{statusLabel(row.status)}{row.status === 'active' && row.next_due && row.next_due <= today() && <span className="badge danger" style={{ marginLeft: 6 }}>Quá hạn</span>}</td><td>{activeRequest ? <button className="btn btn-secondary btn-sm" type="button" onClick={() => setSelectedId(activeRequest.id)}>Mở lệnh · {statusLabel(activeRequest.status)}</button> : row.status === 'active' && can('maintenance.maintenance_plan.due') && <button className="btn btn-primary btn-sm" disabled={Boolean(busy) || !row.next_due || row.next_due > today()} onClick={() => runPlan(row)}>Tạo lệnh</button>}</td></tr>; })}</tbody></table></div>}</section>
      <section className="card card-pad"><h2>Hàng đợi lệnh bảo trì</h2>{loading ? <div className="skeleton" data-h="row"/> : !requests.length ? <div className="empty">Chưa có lệnh bảo trì.</div> : <div className="table-wrap"><table className="table"><thead><tr><th>Tài sản / mô tả</th><th>Ưu tiên</th><th>Ngày</th><th>Trạng thái</th></tr></thead><tbody>{requests.map((row) => <tr key={row.id} className={selectedId === row.id ? 'selected' : ''} onClick={() => setSelectedId(row.id)} style={{ cursor: 'pointer' }}><td><strong>{assets.get(row.asset) ? recordLabel('asset.asset', assets.get(row.asset)) : 'Tài sản'}</strong><div className="small muted">{row.description || (row.source_plan ? 'Bảo trì định kỳ' : 'Yêu cầu mới')}</div></td><td>{statusLabel(row.priority)}</td><td>{fmtDate(row.scheduled_for || row.created_at)}</td><td>{statusLabel(row.status)}</td></tr>)}</tbody></table></div>}</section>
    </div>
    {selected && <section className="card card-pad" style={{ marginTop: 16 }}><div className="row wrap"><div><h2>{assets.get(selected.asset) ? recordLabel('asset.asset', assets.get(selected.asset)) : 'Lệnh bảo trì'}</h2><p className="small muted">{selected.description || 'Không có mô tả'} · Ưu tiên {statusLabel(selected.priority)} · Kho vật tư {warehouses.get(selected.warehouse)?.name || 'chưa chọn'}</p></div><span className="grow"/><span className="badge warning">{statusLabel(selected.status)}</span></div>
      {!!selected.parts?.length && <div className="table-wrap"><table className="table"><thead><tr><th>Vật tư</th><th>Số lượng dự kiến</th></tr></thead><tbody>{selected.parts.map((line, index) => <tr key={`${line.product}-${index}`}><td>{products.get(line.product)?.name || 'Vật tư'}</td><td>{line.qty}</td></tr>)}</tbody></table></div>}
      {selected.status === 'open' && can('maintenance.maintenance_request.started') && <button className="btn btn-primary btn-sm" disabled={Boolean(busy)} onClick={() => startRequest(selected)}>Bắt đầu xử lý</button>}
      {selected.status === 'in_progress' && can('maintenance.maintenance_request.update') && can('maintenance.maintenance_request.done') && <form className="card card-pad" style={{ marginTop: 12 }} onSubmit={(event) => completeRequest(event, selected)}><h3>Ghi nhận hoàn tất</h3><label className="field"><span className="label">Kết quả xử lý *</span><textarea className="input" required rows="3" value={resolution} onChange={(event) => setResolution(event.target.value)} placeholder="Nguyên nhân, công việc đã làm, tình trạng sau sửa chữa…"/></label><div className="form-grid" style={{ marginTop: 10 }}><label className="field"><span className="label">Giờ công</span><input className="input num" type="number" min="0" step="0.25" value={laborHours} onChange={(event) => setLaborHours(event.target.value)}/></label><label className="field"><span className="label">Đơn giá giờ công</span><input className="input num" type="number" min="0" step="any" value={laborRate} onChange={(event) => setLaborRate(event.target.value)}/></label></div><div className="row" style={{ marginTop: 10 }}><span className="grow"/><button className="btn btn-primary" disabled={Boolean(busy)}>Hoàn tất lệnh</button></div></form>}
      {selected.resolution && <div className="alert success" style={{ marginTop: 12 }}><strong>Kết quả:</strong> {selected.resolution}{selected.labor_hours != null && <span> · {selected.labor_hours} giờ công · {fmtMoney((Number(selected.labor_hours) || 0) * (Number(selected.labor_rate) || 0))}</span>}</div>}
    </section>}
    <p className="small muted" style={{ marginTop: 12 }}>Kế hoạch đến hạn chỉ phát sinh một lệnh đang mở cho mỗi kỳ; nếu lệnh bị hủy, có thể tạo lại. Khi hoàn tất lệnh, hệ thống kiểm tra tồn kho, ghi xuất vật tư, lưu ngày bảo trì và tính kỳ kế tiếp từ ngày hoàn tất.</p>
  </div>;
}
