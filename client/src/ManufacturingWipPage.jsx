import React, { useCallback, useEffect, useState } from 'react';
import { localDate } from './lib/dates.js';
import { api, dataPath, tenantPath } from './lib/api.js';
import { fmtMoney, statusLabel } from './lib/i18n.js';
import { can, loadRefs } from './lib/state.js';

const today = localDate;
const qty = (value) => Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 3 });

export default function ManufacturingWipPage() {
  const [asOf, setAsOf] = useState(today());
  const [report, setReport] = useState(null);
  const [accounts, setAccounts] = useState(new Map());
  const [offsetAccountId, setOffsetAccountId] = useState('');
  const [memo, setMemo] = useState('Điều chỉnh đối chiếu WIP');
  const [adjustment, setAdjustment] = useState(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [boms, setBoms] = useState([]);
  const [productionOrders, setProductionOrders] = useState([]);
  const [inspections, setInspections] = useState([]);
  const [workCenters, setWorkCenters] = useState(new Map());
  const [products, setProducts] = useState(new Map());
  const [warehouses, setWarehouses] = useState(new Map());
  const [units, setUnits] = useState(new Map());
  const [editingBom, setEditingBom] = useState('');
  const [bomProduct, setBomProduct] = useState('');
  const [bomOutputQty, setBomOutputQty] = useState('1');
  const [components, setComponents] = useState([{ product: '', qty: '1', uom: '' }]);
  const [orderBom, setOrderBom] = useState('');
  const [orderQty, setOrderQty] = useState('1');
  const [orderWarehouse, setOrderWarehouse] = useState('');
  const [orderCenter, setOrderCenter] = useState('');
  const [orderDate, setOrderDate] = useState(today());
  const [outputLot, setOutputLot] = useState('');
  const [outputExpiry, setOutputExpiry] = useState('');
  const [scrapMethod, setScrapMethod] = useState('absorb');
  const [scrapAccount, setScrapAccount] = useState('');
  const [outputs, setOutputs] = useState({});
  const [busy, setBusy] = useState('');
  const [qcNotes, setQcNotes] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (asOf) params.set('asOf', asOf);
      const [reportData, bomResponse, orderResponse, inspectionResponse, centerMap, productMap, warehouseMap, unitMap, accountMap] = await Promise.all([
        api(`${tenantPath('/reports/manufacturing/wip')}?${params}`),
        can('manufacturing.bom.read') ? api(`${dataPath('manufacturing.bom')}?limit=1000`) : Promise.resolve({ items: [] }),
        can('manufacturing.production_order.read') ? api(`${dataPath('manufacturing.production_order')}?limit=1000`) : Promise.resolve({ items: [] }),
        can('quality.inspection.read') ? api(`${dataPath('quality.inspection')}?limit=1000`) : Promise.resolve({ items: [] }),
        can('manufacturing.work_center.read') ? loadRefs('manufacturing.work_center') : Promise.resolve(new Map()),
        can('master-data.product.read') ? loadRefs('master-data.product') : Promise.resolve(new Map()),
        can('inventory.warehouse.read') ? loadRefs('inventory.warehouse') : Promise.resolve(new Map()),
        can('master-data.uom.read') ? loadRefs('master-data.uom') : Promise.resolve(new Map()),
        can('accounting.account.read') ? loadRefs('accounting.account') : Promise.resolve(new Map()),
      ]);
      setReport(reportData);
      setBoms(Array.isArray(bomResponse.items) ? bomResponse.items : []);
      setProductionOrders(Array.isArray(orderResponse.items) ? orderResponse.items : []);
      setInspections(Array.isArray(inspectionResponse.items) ? inspectionResponse.items : []);
      setWorkCenters(centerMap); setProducts(productMap); setWarehouses(warehouseMap); setUnits(unitMap); setAccounts(accountMap);
    } catch (reason) {
      setReport(null);
      setError(reason.message || 'Không tải được báo cáo WIP.');
    } finally {
      setLoading(false);
    }
  }, [asOf]);

  const unitsFor = (productId) => {
    const baseUnit = products.get(productId)?.uom;
    return baseUnit ? [...units.values()].filter((unit) => unit.id === baseUnit || unit.base_uom === baseUnit) : [];
  };
  const resetBom = () => { setEditingBom(''); setBomProduct(''); setBomOutputQty('1'); setComponents([{ product: '', qty: '1', uom: '' }]); };
  const editBom = (bom) => {
    setEditingBom(bom.id); setBomProduct(bom.product); setBomOutputQty(String(bom.output_qty || 1));
    setComponents(Array.isArray(bom.components) && bom.components.length ? bom.components.map((row) => ({ product: row.product || '', qty: String(row.qty || ''), uom: row.uom || '' })) : [{ product: '', qty: '1', uom: '' }]);
  };
  const saveBom = async (event) => {
    event.preventDefault(); setBusy('bom'); setError('');
    try {
      const body = { product: bomProduct, output_qty: Number(bomOutputQty), components: components.map((row) => ({ product: row.product, qty: Number(row.qty), ...(row.uom ? { uom: row.uom } : {}) })) };
      await api(editingBom ? dataPath('manufacturing.bom', editingBom) : dataPath('manufacturing.bom'), { method: editingBom ? 'PATCH' : 'POST', body });
      resetBom(); await load();
    } catch (reason) { setError(reason.message || 'Không lưu được BOM.'); }
    finally { setBusy(''); }
  };
  const selectedBom = boms.find((bom) => bom.id === orderBom);
  const createProductionOrder = async (event) => {
    event.preventDefault(); if (!selectedBom) return;
    setBusy('order'); setError('');
    try {
      await api(dataPath('manufacturing.production_order'), { method: 'POST', body: {
        product: selectedBom.product, bom: selectedBom.id, qty: Number(orderQty), warehouse: orderWarehouse,
        ...(orderCenter ? { work_center: orderCenter, planned_start: orderDate } : {}),
        ...(outputLot ? { output_lot_code: outputLot } : {}), ...(outputExpiry ? { output_expiry: outputExpiry } : {}),
        scrap_cost_method: scrapMethod, ...(scrapMethod === 'expense' && scrapAccount ? { scrap_expense_account: scrapAccount } : {}),
      } });
      setOrderQty('1'); setOutputLot(''); setOutputExpiry(''); await load();
    } catch (reason) { setError(reason.message || 'Không tạo được lệnh sản xuất.'); }
    finally { setBusy(''); }
  };
  const operateOrder = async (order, action) => {
    setBusy(`${order.id}:${action}`); setError('');
    try {
      if (action === 'done') {
        const draft = outputs[order.id] || {};
        const goodQty = Number(draft.good_qty ?? order.qty);
        const scrapInput = draft.scrap_qty;
        const scrapQty = scrapInput != null && String(scrapInput).trim() !== '' ? Number(scrapInput) : Math.max(0, Number(order.qty) - goodQty);
        await api(dataPath('manufacturing.production_order', order.id), { method: 'PATCH', body: {
          good_qty: goodQty, scrap_qty: scrapQty, ...(draft.scrap_reason ? { scrap_reason: draft.scrap_reason } : {}),
        } });
      }
      await api(dataPath('manufacturing.production_order', order.id, action), { method: 'POST' });
      await load();
    } catch (reason) { setError(reason.message || `Không thực hiện được ${action} cho lệnh.`); }
    finally { setBusy(''); }
  };
  const decideInspection = async (inspection, action) => {
    setBusy(`${inspection.id}:${action}`); setError('');
    try {
      if (action === 'failed') {
        const note = qcNotes[inspection.id]?.trim() || '';
        if (note.length < 5) throw new Error('Nhập mô tả lỗi QC từ 5 ký tự trở lên.');
        await api(dataPath('quality.inspection', inspection.id), { method: 'PATCH', body: { note } });
      }
      await api(dataPath('quality.inspection', inspection.id, action), { method: 'POST' });
      await load();
    } catch (reason) { setError(reason.message || 'Không lưu được kết quả QC.'); }
    finally { setBusy(''); }
  };

  useEffect(() => { document.title = 'WIP sản xuất · OSP Suite'; load(); }, [load]);

  const createDraft = async () => {
    setCreating(true);
    setError('');
    setAdjustment(null);
    try {
      const result = await api(tenantPath('/reports/manufacturing/wip/reconciliation-journals'), {
        method: 'POST', body: { asOf, offsetAccountId, memo },
      });
      const journal = result.journal || null;
      const id = journal?.id || result.journalId;
      setAdjustment({ id, status: journal?.status || result.status || 'draft', existing: result.existing });
      await load();
    } catch (reason) {
      setError(reason.message || 'Không tạo được bút toán nháp đối chiếu WIP.');
    } finally {
      setCreating(false);
    }
  };

  return <div className="page">
    <div className="page-head"><div><h1>WIP sản xuất</h1><p className="sub">Đối chiếu giá trị vật tư theo lệnh sản xuất với số dư tài khoản 154 trên sổ cái.</p></div></div>
    {error && <div className="alert danger" role="alert">{error}</div>}
    <section className="card card-pad manufacturing-workbench">
      <header className="card-head"><div><h2>BOM và lệnh sản xuất</h2><p className="small muted">Lập định mức, giữ lịch sử BOM đã dùng, xuất vật tư khi bắt đầu và chuyển thành phẩm sang QC khi hoàn tất.</p></div></header>
      {can('manufacturing.bom.read') && <div className="manufacturing-bom-area">
        {(can('manufacturing.bom.create') || can('manufacturing.bom.update')) && <form className="manufacturing-form" onSubmit={saveBom}>
          <h3>{editingBom ? 'Sửa BOM' : 'Tạo BOM'}</h3>
          <label className="field"><span>Thành phẩm *</span><select className="select" required value={bomProduct} disabled={Boolean(editingBom)} onChange={(event) => setBomProduct(event.target.value)}><option value="">Chọn thành phẩm</option>{[...products.values()].filter((product) => product.active !== false && product.kind !== 'service').map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select></label>
          <label className="field"><span>Sản lượng định mức *</span><input className="input num" type="number" min="0.000001" step="any" required value={bomOutputQty} onChange={(event) => setBomOutputQty(event.target.value)} /></label>
          <div className="manufacturing-lines"><h4>Nguyên vật liệu</h4>{components.map((component, index) => { const options = unitsFor(component.product); return <div className="manufacturing-line" key={index}><select className="select" required aria-label={`Vật tư BOM ${index + 1}`} value={component.product} onChange={(event) => setComponents((rows) => rows.map((row, i) => i === index ? { ...row, product: event.target.value, uom: '' } : row))}><option value="">Chọn vật tư</option>{[...products.values()].filter((product) => product.active !== false && product.kind !== 'service').map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select><input className="input num" type="number" min="0.000001" step="any" aria-label={`Số lượng vật tư ${index + 1}`} required value={component.qty} onChange={(event) => setComponents((rows) => rows.map((row, i) => i === index ? { ...row, qty: event.target.value } : row))} />{options.length > 1 && <select className="select" aria-label={`Đơn vị vật tư ${index + 1}`} value={component.uom || products.get(component.product)?.uom || ''} onChange={(event) => setComponents((rows) => rows.map((row, i) => i === index ? { ...row, uom: event.target.value } : row))}>{options.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}{unit.base_uom ? ` · ${unit.ratio} × đơn vị gốc` : ' · đơn vị gốc'}</option>)}</select>}{components.length > 1 && <button className="btn btn-ghost btn-sm" type="button" onClick={() => setComponents((rows) => rows.filter((_, i) => i !== index))}>Bỏ</button>}</div>; })}<button className="btn btn-secondary btn-sm" type="button" onClick={() => setComponents((rows) => [...rows, { product: '', qty: '1', uom: '' }])}>Thêm vật tư</button></div>
          <div className="row wrap"><button className="btn btn-primary" type="submit" disabled={busy === 'bom' || !can(editingBom ? 'manufacturing.bom.update' : 'manufacturing.bom.create')}>{busy === 'bom' ? 'Đang lưu…' : editingBom ? 'Lưu BOM' : 'Tạo BOM'}</button>{editingBom && <button className="btn btn-ghost" type="button" onClick={resetBom}>Hủy sửa</button>}</div>
        </form>}
        <div className="manufacturing-bom-list">{boms.map((bom) => <article className="manufacturing-bom-card" key={bom.id}><div><strong>{products.get(bom.product)?.name || bom.product}</strong><span className="small muted"> · {bom.output_qty || 1} thành phẩm / định mức</span><div className="small muted">{(bom.components || []).map((item) => `${products.get(item.product)?.name || 'Vật tư'} ${item.qty} ${units.get(item.uom)?.name || ''}`).join(' · ')}</div></div>{can('manufacturing.bom.update') && <button className="btn btn-ghost btn-sm" type="button" onClick={() => editBom(bom)}>Sửa</button>}</article>)}{!boms.length && <div className="empty">Chưa có BOM. Tạo định mức trước khi lập lệnh sản xuất.</div>}</div>
      </div>}
      {can('manufacturing.production_order.create') && <form className="manufacturing-form manufacturing-order-form" onSubmit={createProductionOrder}>
        <h3>Lập lệnh sản xuất</h3>
        <label className="field"><span>BOM *</span><select className="select" required value={orderBom} onChange={(event) => setOrderBom(event.target.value)}><option value="">Chọn BOM</option>{boms.map((bom) => <option key={bom.id} value={bom.id}>{products.get(bom.product)?.name || bom.product}</option>)}</select></label>
        <label className="field"><span>Số lượng *</span><input className="input num" type="number" min="0.000001" step="any" required value={orderQty} onChange={(event) => setOrderQty(event.target.value)} /></label>
        <label className="field"><span>Kho xuất / nhập *</span><select className="select" required value={orderWarehouse} onChange={(event) => setOrderWarehouse(event.target.value)}><option value="">Chọn kho</option>{[...warehouses.values()].filter((warehouse) => warehouse.active !== false).map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select></label>
        <label className="field"><span>Trung tâm sản xuất</span><select className="select" value={orderCenter} onChange={(event) => setOrderCenter(event.target.value)}><option value="">Không lập lịch trung tâm</option>{[...workCenters.values()].map((center) => <option key={center.id} value={center.id}>{center.name}{center.capacity_per_day ? ` · ${center.capacity_per_day}/ngày` : ''}</option>)}</select></label>
        {orderCenter && <label className="field"><span>Ngày dự kiến bắt đầu *</span><input className="input" type="date" required value={orderDate} onChange={(event) => setOrderDate(event.target.value)} /></label>}
        {products.get(selectedBom?.product)?.lot_tracked && <label className="field"><span>Mã lô thành phẩm *</span><input className="input" required maxLength="120" value={outputLot} onChange={(event) => setOutputLot(event.target.value)} /></label>}
        {products.get(selectedBom?.product)?.lot_tracked && <label className="field"><span>Hạn dùng thành phẩm</span><input className="input" type="date" value={outputExpiry} onChange={(event) => setOutputExpiry(event.target.value)} /></label>}
        <label className="field"><span>Hạch toán phế phẩm</span><select className="select" value={scrapMethod} onChange={(event) => setScrapMethod(event.target.value)}><option value="absorb">Phân bổ vào giá thành phẩm đạt</option><option value="expense">Ghi nhận chi phí bất thường</option></select></label>
        {scrapMethod === 'expense' && <label className="field"><span>Tài khoản chi phí phế phẩm *</span><select className="select" required value={scrapAccount} onChange={(event) => setScrapAccount(event.target.value)}><option value="">Chọn tài khoản chi phí</option>{[...accounts.values()].filter((account) => account.kind === 'expense').map((account) => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}</select></label>}
        <button className="btn btn-primary" type="submit" disabled={busy === 'order' || !orderBom || !orderWarehouse}>{busy === 'order' ? 'Đang lập lệnh…' : 'Tạo lệnh'}</button>
      </form>}
      <div className="manufacturing-orders"><h3>Lệnh sản xuất</h3>{productionOrders.map((order) => { const draft = outputs[order.id] || {}; return <article className="manufacturing-order-card" key={order.id}><div className="manufacturing-order-summary"><strong>{products.get(order.product)?.name || order.product}</strong><span className="badge">{statusLabel(order.status)}</span><span className="small muted">Kế hoạch {qty(order.qty)} · {order.planned_start || 'Chưa xếp lịch'} · {workCenters.get(order.work_center)?.name || 'Không gán trung tâm'}</span></div>{order.status === 'in_progress' && <div className="manufacturing-output"><label className="field"><span>Đạt</span><input className="input num" type="number" min="0" step="any" value={draft.good_qty ?? order.good_qty ?? order.qty} onChange={(event) => setOutputs((rows) => ({ ...rows, [order.id]: { ...rows[order.id], good_qty: event.target.value } }))} /></label><label className="field"><span>Phế phẩm</span><input className="input num" type="number" min="0" step="any" value={draft.scrap_qty ?? order.scrap_qty ?? ''} onChange={(event) => setOutputs((rows) => ({ ...rows, [order.id]: { ...rows[order.id], scrap_qty: event.target.value } }))} /></label><label className="field"><span>Lý do phế phẩm</span><input className="input" value={draft.scrap_reason ?? order.scrap_reason ?? ''} onChange={(event) => setOutputs((rows) => ({ ...rows, [order.id]: { ...rows[order.id], scrap_reason: event.target.value } }))} /></label></div>}{order.status === 'planned' && can('manufacturing.production_order.started') && <button className="btn btn-primary btn-sm" type="button" disabled={Boolean(busy)} onClick={() => operateOrder(order, 'started')}>Bắt đầu, xuất vật tư</button>}{order.status === 'in_progress' && can('manufacturing.production_order.done') && <button className="btn btn-primary btn-sm" type="button" disabled={Boolean(busy)} onClick={() => operateOrder(order, 'done')}>Hoàn tất, gửi QC</button>}{['planned', 'in_progress'].includes(order.status) && can('manufacturing.production_order.cancelled') && <button className="btn btn-ghost btn-sm" type="button" disabled={Boolean(busy)} onClick={() => operateOrder(order, 'cancelled')}>Hủy lệnh</button>}</article>; })}{!productionOrders.length && <p className="small muted">Chưa có lệnh sản xuất.</p>}</div>
      {can('quality.inspection.read') && <div className="manufacturing-orders"><h3>Kiểm tra thành phẩm</h3>{inspections.filter((inspection) => inspection.source === 'production_order' && inspection.status === 'pending').map((inspection) => <article className="manufacturing-order-card" key={inspection.id}><div className="manufacturing-order-summary"><strong>{products.get(inspection.product)?.name || inspection.product}</strong><span className="small muted">Lệnh {String(inspection.source_id).slice(0, 8)} · Số lượng {qty(inspection.qty)}{inspection.lot ? ` · Lô ${inspection.lot}` : ''}</span></div>{can('quality.inspection.failed') && can('quality.inspection.update') && <label className="field"><span>Mô tả lỗi nếu không đạt</span><input className="input" minLength="5" maxLength="500" value={qcNotes[inspection.id] || ''} onChange={(event) => setQcNotes((rows) => ({ ...rows, [inspection.id]: event.target.value }))} /></label>}{can('quality.inspection.passed') && <button className="btn btn-primary btn-sm" type="button" disabled={Boolean(busy)} onClick={() => decideInspection(inspection, 'passed')}>Đạt, nhập kho</button>}{can('quality.inspection.failed') && can('quality.inspection.update') && <button className="btn btn-ghost btn-sm" type="button" disabled={Boolean(busy) || (qcNotes[inspection.id] || '').trim().length < 5} onClick={() => decideInspection(inspection, 'failed')}>Không đạt, lập NCR</button>}</article>)}{!inspections.some((inspection) => inspection.source === 'production_order' && inspection.status === 'pending') && <p className="small muted">Không có lô thành phẩm chờ kiểm tra.</p>}</div>}
    </section>
    <section className="card">
      <form className="toolbar" onSubmit={(event) => { event.preventDefault(); load(); }}>
        <label className="field"><span className="label">Chốt phát sinh đến ngày</span><input className="input" type="date" value={asOf} onChange={(event) => setAsOf(event.target.value)} /></label>
        <button className="btn btn-primary" type="submit" disabled={loading}>{loading ? 'Đang tải…' : 'Xem báo cáo'}</button>
      </form>
    </section>
    {report && <div className="stack">
      <div className="stats">
        <div className="card stat"><span className="stat-label">Lệnh có số dư WIP</span><strong className="stat-value num">{Number(report.orderCount || 0).toLocaleString()}</strong></div>
        <div className="card stat"><span className="stat-label">Tổng giá trị WIP</span><strong className="stat-value num">{fmtMoney(report.totalWipValue)}</strong></div>
        {report.ledgerComparisonAvailable && <div className="card stat"><span className="stat-label">Số dư TK 154 trên sổ cái</span><strong className="stat-value num">{fmtMoney(report.ledgerWipBalance)}</strong></div>}
        {report.ledgerComparisonAvailable && <div className="card stat"><span className="stat-label">Chênh lệch WIP - TK 154</span><strong className="stat-value num">{fmtMoney(report.wipVariance)}</strong><span className={`badge ${report.reconciled ? 'success' : 'danger'}`}>{report.reconciled ? 'Khớp' : 'Cần đối chiếu'}</span></div>}
      </div>
      {!report.ledgerComparisonAvailable && <div className="alert info" role="status">Bật kế toán và quyền đọc sổ cái để đối chiếu chi tiết với tài khoản 154.</div>}
      {report.ledgerComparisonAvailable && !report.reconciled && can('accounting.journal_entry.create') && can('accounting.account.read') && <section className="card card-pad">
        <div className="card-head"><h2>Tạo bút toán điều chỉnh nháp</h2><span className="faint">Kế toán chọn tài khoản đối ứng và duyệt trước khi ghi sổ</span></div>
        <div className="toolbar">
          <label className="field"><span className="label">Tài khoản đối ứng</span><select className="select" value={offsetAccountId} onChange={(event) => setOffsetAccountId(event.target.value)}>
            <option value="">Chọn tài khoản</option>
            {[...accounts.values()].filter((account) => account.code !== '154').map((account) => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}
          </select></label>
          <label className="field"><span className="label">Diễn giải</span><input className="input" maxLength={300} value={memo} onChange={(event) => setMemo(event.target.value)} /></label>
          <button className="btn btn-primary" type="button" disabled={creating || !offsetAccountId || !memo.trim()} onClick={createDraft}>{creating ? 'Đang tạo…' : 'Tạo bút toán nháp'}</button>
        </div>
      </section>}
      {adjustment && <div className="alert success" role="status">{adjustment.existing ? 'Đã có bút toán đối chiếu cho chênh lệch này.' : 'Đã tạo bút toán nháp.'} {adjustment.id && <a href={`#/e/accounting/journal_entry/${encodeURIComponent(adjustment.id)}`}>Mở bút toán</a>} <span>Trạng thái: {adjustment.status}</span></div>}
      {!report.orders?.length ? <div className="empty"><h3>Không có số dư WIP theo lệnh</h3><p>Chưa có vật tư được xuất cho lệnh đang chạy, hoặc thành phẩm đạt QC đã được nhập kho.</p></div> : <div className="card table-wrap"><table className="table">
        <thead><tr><th scope="col">Lệnh sản xuất</th><th scope="col">Thành phẩm</th><th scope="col">Trạng thái</th><th scope="col">QC</th><th scope="col" className="right">Kế hoạch</th><th scope="col" className="right">Đạt</th><th scope="col" className="right">Phế phẩm</th><th scope="col" className="right">Giá trị NVL</th><th scope="col" className="right">Đã nhập</th><th scope="col" className="right">Còn WIP</th></tr></thead>
        <tbody>{report.orders.map((order) => <tr key={order.id}>
          <td>{order.id}</td><td>{order.product}</td><td>{statusLabel(order.status)}</td><td>{order.qualityStatus ? statusLabel(order.qualityStatus) : 'Chưa tạo QC'}</td>
          <td className="right">{qty(order.plannedQty)}</td><td className="right">{qty(order.goodQty)}</td><td className="right" title={order.scrapReason || undefined}>{qty(order.scrapQty)}</td>
          <td className="right money">{fmtMoney(order.materialCost)}</td><td className="right money">{fmtMoney(order.finishedCost)}</td><td className="right money"><strong>{fmtMoney(order.wipValue)}</strong></td>
        </tr>)}</tbody>
      </table></div>}
      <p className="faint">Giá trị tính theo phiếu kho phát sinh đến {report.asOf}. Trạng thái QC phản ánh trạng thái hiện tại; số dư âm theo lệnh vẫn được hiển thị để phục vụ đối chiếu.</p>
    </div>}
  </div>;
}
