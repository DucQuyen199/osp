import React, { useCallback, useEffect, useState } from 'react';
import { localDate } from './lib/dates.js';
import { api, dataPath, tenantPath } from './lib/api.js';
import { fmtMoney, statusLabel } from './lib/i18n.js';
import { can, loadRefs, loadAllResponse } from './lib/state.js';

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
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [boms, setBoms] = useState([]);
  const [productionOrders, setProductionOrders] = useState([]);
  const [reworkOrders, setReworkOrders] = useState([]);
  const [productionDispositions, setProductionDispositions] = useState([]);
  const [conditionalAcceptances, setConditionalAcceptances] = useState([]);
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
  const [reworkInspection, setReworkInspection] = useState('');
  const [reworkQty, setReworkQty] = useState('');
  const [reworkReason, setReworkReason] = useState('');
  const [dispositionInspection, setDispositionInspection] = useState('');
  const [dispositionQty, setDispositionQty] = useState('');
  const [dispositionNote, setDispositionNote] = useState('');
  const [dispositionAccount, setDispositionAccount] = useState('');
  const [acceptanceInspection, setAcceptanceInspection] = useState('');
  const [acceptanceQty, setAcceptanceQty] = useState('');
  const [acceptanceCondition, setAcceptanceCondition] = useState('');
  const [acceptanceJustification, setAcceptanceJustification] = useState('');
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
      const [reportData, bomResponse, orderResponse, reworkResponse, inspectionResponse, dispositionResponse, acceptanceResponse, centerMap, productMap, warehouseMap, unitMap, accountMap] = await Promise.all([
        api(`${tenantPath('/reports/manufacturing/wip')}?${params}`),
        can('manufacturing.bom.read') ? loadAllResponse('manufacturing.bom') : Promise.resolve({ items: [] }),
        can('manufacturing.production_order.read') ? loadAllResponse('manufacturing.production_order') : Promise.resolve({ items: [] }),
        can('manufacturing.rework_order.read') ? loadAllResponse('manufacturing.rework_order') : Promise.resolve({ items: [] }),
        can('quality.inspection.read') ? loadAllResponse('quality.inspection') : Promise.resolve({ items: [] }),
        can('manufacturing.production_disposition.read') ? loadAllResponse('manufacturing.production_disposition') : Promise.resolve({ items: [] }),
        can('manufacturing.conditional_acceptance.read') ? loadAllResponse('manufacturing.conditional_acceptance') : Promise.resolve({ items: [] }),
        can('manufacturing.work_center.read') ? loadRefs('manufacturing.work_center') : Promise.resolve(new Map()),
        can('master-data.product.read') ? loadRefs('master-data.product') : Promise.resolve(new Map()),
        can('inventory.warehouse.read') ? loadRefs('inventory.warehouse') : Promise.resolve(new Map()),
        can('master-data.uom.read') ? loadRefs('master-data.uom') : Promise.resolve(new Map()),
        can('accounting.account.read') ? loadRefs('accounting.account') : Promise.resolve(new Map()),
      ]);
      setReport(reportData);
      setBoms(Array.isArray(bomResponse.items) ? bomResponse.items : []);
      setProductionOrders(Array.isArray(orderResponse.items) ? orderResponse.items : []);
      setReworkOrders(Array.isArray(reworkResponse.items) ? reworkResponse.items : []);
      setProductionDispositions(Array.isArray(dispositionResponse.items) ? dispositionResponse.items : []);
      setConditionalAcceptances(Array.isArray(acceptanceResponse.items) ? acceptanceResponse.items : []);
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
  const baseUnitName = (productId) => {
    const baseUnit = products.get(productId)?.uom;
    return units.get(baseUnit)?.name || (baseUnit ? 'đơn vị gốc' : 'chưa đặt đơn vị');
  };
  const alreadyAccountedReworkQty = (inspectionId) => (
    reworkOrders.filter((order) => order.inspection === inspectionId && order.status !== 'cancelled').reduce((total, order) => total + Number(order.qty || 0), 0)
    + productionDispositions.filter((row) => row.inspection === inspectionId && ['draft', 'posted'].includes(row.status)).reduce((total, row) => total + Number(row.qty || 0), 0)
    + conditionalAcceptances.filter((row) => row.inspection === inspectionId && ['draft', 'submitted', 'approved'].includes(row.status)).reduce((total, row) => total + Number(row.qty || 0), 0)
  );
  const remainingFailedQty = (inspection) => Math.max(0, Number(inspection?.qty || 0) - alreadyAccountedReworkQty(inspection?.id));
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

  const createReworkOrder = async (event) => {
    event.preventDefault();
    const inspection = inspections.find((row) => row.id === reworkInspection);
    if (!inspection) return;
    setBusy('rework'); setError('');
    try {
      await api(dataPath('manufacturing.rework_order'), { method: 'POST', body: {
        production_order: inspection.source_id, inspection: inspection.id,
        qty: Number(reworkQty), reason: reworkReason.trim(),
      } });
      setReworkInspection(''); setReworkQty(''); setReworkReason(''); await load();
    } catch (reason) { setError(reason.message || 'KhÃ´ng táº¡o Ä‘Æ°á»£c lá»‡nh sá»­a.'); }
    finally { setBusy(''); }
  };

  const operateRework = async (order, action) => {
    setBusy(`${order.id}:${action}`); setError('');
    try {
      await api(dataPath('manufacturing.rework_order', order.id, action), { method: 'POST' });
      await load();
    } catch (reason) { setError(reason.message || 'KhÃ´ng cáº­p nháº­t Ä‘Æ°á»£c lá»‡nh sá»­a.'); }
    finally { setBusy(''); }
  };

  const createProductionDisposition = async (event) => {
    event.preventDefault();
    if (!dispositionInspection) return;
    setBusy('production-disposition'); setError('');
    try {
      const created = await api(dataPath('manufacturing.production_disposition'), { method: 'POST', body: {
        inspection: dispositionInspection, qty: Number(dispositionQty), note: dispositionNote.trim(), expense_account: dispositionAccount,
      } });
      if (can('manufacturing.production_disposition.posted')) {
        await api(dataPath('manufacturing.production_disposition', created.id, 'posted'), { method: 'POST' });
        setNotice('Đã ghi sổ loại bỏ thành phẩm và hạch toán chi phí từ WIP.');
      } else {
        setNotice('Đã tạo phiếu loại bỏ; phiếu đang chờ người có quyền ghi sổ.');
      }
      setDispositionInspection(''); setDispositionQty(''); setDispositionNote(''); setDispositionAccount(''); await load();
    } catch (reason) { await load(); setError(reason.message || 'Không ghi nhận được lượng thành phẩm loại bỏ.'); }
    finally { setBusy(''); }
  };

  const submitConditionalAcceptance = async (event) => {
    event.preventDefault();
    const inspection = inspections.find((row) => row.id === acceptanceInspection);
    if (!inspection) return;
    setBusy('conditional-acceptance'); setError(''); setNotice('');
    try {
      const created = await api(dataPath('manufacturing.conditional_acceptance'), { method: 'POST', body: {
        inspection: inspection.id,
        qty: Number(acceptanceQty),
        condition: acceptanceCondition.trim(),
        justification: acceptanceJustification.trim(),
      } });
      await api(dataPath('manufacturing.conditional_acceptance', created.id, 'submitted'), { method: 'POST' });
      setAcceptanceInspection(''); setAcceptanceQty(''); setAcceptanceCondition(''); setAcceptanceJustification('');
      setNotice('Đã gửi đề nghị chấp nhận có điều kiện. Hàng vẫn bị giữ cho đến khi người có thẩm quyền phê duyệt.');
      await load();
    } catch (reason) { await load(); setError(reason.message || 'Không gửi được đề nghị chấp nhận có điều kiện.'); }
    finally { setBusy(''); }
  };

  const operateConditionalAcceptance = async (row, action) => {
    setBusy(`${row.id}:${action}`); setError(''); setNotice('');
    try {
      await api(dataPath('manufacturing.conditional_acceptance', row.id, action), { method: 'POST' });
      setNotice(action === 'submitted' ? 'Đã gửi lại đề nghị vào hàng chờ phê duyệt.' : 'Đã hủy đề nghị chấp nhận có điều kiện.');
      await load();
    } catch (reason) { setError(reason.message || 'Không cập nhật được đề nghị chấp nhận có điều kiện.'); }
    finally { setBusy(''); }
  };

  const operateProductionDisposition = async (row, action) => {
    setBusy(`${row.id}:${action}`); setError('');
    try {
      await api(dataPath('manufacturing.production_disposition', row.id, action), { method: 'POST' });
      await load();
    } catch (reason) { setError(reason.message || 'Không cập nhật được phiếu xử lý thành phẩm.'); }
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
    {notice && <div className="alert success" role="status">{notice}</div>}
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
      {can('quality.inspection.read') && <div className="manufacturing-orders"><h3>Kiểm tra thành phẩm</h3>{inspections.filter((inspection) => ['production_order', 'production_rework'].includes(inspection.source) && inspection.status === 'pending').map((inspection) => <article className="manufacturing-order-card" key={inspection.id}><div className="manufacturing-order-summary"><strong>{products.get(inspection.product)?.name || inspection.product}</strong><span className="small muted">Lệnh {String(inspection.source_id).slice(0, 8)} · Số lượng {qty(inspection.qty)} {baseUnitName(inspection.product)}{inspection.lot ? ` · Lô ${inspection.lot}` : ''}</span></div>{can('quality.inspection.failed') && can('quality.inspection.update') && <label className="field"><span>Mô tả lỗi nếu không đạt</span><input className="input" minLength="5" maxLength="500" value={qcNotes[inspection.id] || ''} onChange={(event) => setQcNotes((rows) => ({ ...rows, [inspection.id]: event.target.value }))} /></label>}{can('quality.inspection.passed') && <button className="btn btn-primary btn-sm" type="button" disabled={Boolean(busy)} onClick={() => decideInspection(inspection, 'passed')}>Đạt, nhập kho</button>}{can('quality.inspection.failed') && can('quality.inspection.update') && <button className="btn btn-ghost btn-sm" type="button" disabled={Boolean(busy) || (qcNotes[inspection.id] || '').trim().length < 5} onClick={() => decideInspection(inspection, 'failed')}>Không đạt, lập NCR</button>}</article>)}{!inspections.some((inspection) => ['production_order', 'production_rework'].includes(inspection.source) && inspection.status === 'pending') && <p className="small muted">Không có lô thành phẩm chờ kiểm tra.</p>}</div>}
    </section>
      {can('manufacturing.rework_order.read') && <div className="manufacturing-orders"><h3>Sửa hàng không đạt</h3>{can('manufacturing.rework_order.create') && <form className="manufacturing-form" onSubmit={createReworkOrder}><label className="field"><span>Phiếu QC trượt *</span><select className="select" required value={reworkInspection} onChange={(event) => { const nextId = event.target.value; const selected = inspections.find((row) => row.id === nextId); const alreadyAssigned = alreadyAccountedReworkQty(nextId); setReworkInspection(nextId); setReworkQty(selected ? String(Math.max(0, Number(selected.qty || 0) - alreadyAssigned)) : ''); }}><option value="">Chọn phiếu QC</option>{inspections.filter((inspection) => ['production_order', 'production_rework'].includes(inspection.source) && inspection.status === 'failed' && Number(inspection.qty || 0) - alreadyAccountedReworkQty(inspection.id) > 0.000001).map((inspection) => { const remaining = Math.max(0, Number(inspection.qty || 0) - alreadyAccountedReworkQty(inspection.id)); return <option key={inspection.id} value={inspection.id}>{products.get(inspection.product)?.name || inspection.product} · còn {qty(remaining)} {baseUnitName(inspection.product)} · lệnh {String(inspection.source_id).slice(0, 8)}</option>; })}</select></label>{reworkInspection && <><label className="field"><span>Số lượng sửa *</span><input className="input num" type="number" min="0.000001" max={remainingFailedQty(inspections.find((row) => row.id === reworkInspection))} step="any" required value={reworkQty} onChange={(event) => setReworkQty(event.target.value)} /></label><p className="small muted">Sau khi sửa, đúng số lượng này sẽ được kiểm tra lại riêng; phần còn lỗi vẫn được giữ trong phiếu QC ban đầu.</p></>}<label className="field"><span>Lý do sửa *</span><input className="input" minLength={5} maxLength={500} required value={reworkReason} onChange={(event) => setReworkReason(event.target.value)} /></label><button className="btn btn-primary btn-sm" type="submit" disabled={busy === 'rework' || !reworkInspection || !Number(reworkQty) || reworkReason.trim().length < 5}>{busy === 'rework' ? 'Đang tạo…' : 'Tạo lệnh sửa'}</button></form>}{reworkOrders.map((order) => { const inspection = inspections.find((row) => row.id === order.inspection); return <article className="manufacturing-order-card" key={order.id}><div className="manufacturing-order-summary"><strong>{products.get(inspection?.product)?.name || 'Lô sửa hàng'}</strong><span className="badge">{statusLabel(order.status)}</span><span className="small muted">Lệnh {String(order.production_order).slice(0, 8)} · Số lượng {qty(order.qty)} · {order.reason}</span></div>{order.status === 'planned' && can('manufacturing.rework_order.started') && <button className="btn btn-primary btn-sm" type="button" disabled={Boolean(busy)} onClick={() => operateRework(order, 'started')}>Bắt đầu, xuất vật tư</button>}{order.status === 'in_progress' && can('manufacturing.rework_order.done') && <button className="btn btn-primary btn-sm" type="button" disabled={Boolean(busy)} onClick={() => operateRework(order, 'done')}>Hoàn tất, gửi QC kiểm tra lại</button>}{order.status === 'planned' && can('manufacturing.rework_order.cancelled') && <button className="btn btn-ghost btn-sm" type="button" disabled={Boolean(busy)} onClick={() => operateRework(order, 'cancelled')}>Hủy lệnh sửa</button>}</article>; })}{!reworkOrders.length && <p className="small muted">Chưa có lệnh sửa hàng.</p>}</div>}
    {can('manufacturing.conditional_acceptance.read') && <section className="card card-pad">
      <h3>Chấp nhận có điều kiện</h3>
      <p className="small muted">Dùng khi có căn cứ cho phép dùng một phần sản phẩm chưa đạt chuẩn thông thường. Phải ghi điều kiện kiểm soát và lý do; chỉ người được giao quyền trong quy tắc phê duyệt mới có thể duyệt. Hàng vẫn bị giữ cho đến khi duyệt.</p>
      {can('manufacturing.conditional_acceptance.create') && can('manufacturing.conditional_acceptance.submitted') && <form className="manufacturing-form" onSubmit={submitConditionalAcceptance}>
        <label className="field"><span>Phiếu QC trượt *</span><select className="select" required value={acceptanceInspection} onChange={(event) => { const nextId = event.target.value; const selected = inspections.find((row) => row.id === nextId); setAcceptanceInspection(nextId); setAcceptanceQty(selected ? String(remainingFailedQty(selected)) : ''); }}><option value="">Chọn phiếu QC</option>{inspections.filter((inspection) => ['production_order', 'production_rework'].includes(inspection.source) && inspection.status === 'failed' && remainingFailedQty(inspection) > 0.000001).map((inspection) => <option key={inspection.id} value={inspection.id}>{products.get(inspection.product)?.name || inspection.product} · còn {qty(remainingFailedQty(inspection))} {baseUnitName(inspection.product)} · lệnh {String(inspection.source_id).slice(0, 8)}</option>)}</select></label>
        {acceptanceInspection && <label className="field"><span>Số lượng đề nghị *</span><input className="input num" type="number" min="0.000001" max={remainingFailedQty(inspections.find((row) => row.id === acceptanceInspection))} step="any" required value={acceptanceQty} onChange={(event) => setAcceptanceQty(event.target.value)} /></label>}
        <label className="field"><span>Điều kiện sử dụng / kiểm soát sau chấp nhận *</span><textarea className="input" rows="2" minLength="5" maxLength="2000" required value={acceptanceCondition} onChange={(event) => setAcceptanceCondition(event.target.value)} placeholder="Ví dụ: giới hạn sử dụng, kiểm tra bổ sung hoặc thông báo cho khách hàng" /></label>
        <label className="field"><span>Căn cứ đề nghị *</span><textarea className="input" rows="2" minLength="5" maxLength="2000" required value={acceptanceJustification} onChange={(event) => setAcceptanceJustification(event.target.value)} placeholder="Ghi kết quả đánh giá rủi ro và căn cứ kỹ thuật" /></label>
        <button className="btn btn-primary btn-sm" type="submit" disabled={Boolean(busy) || !acceptanceInspection || !(Number(acceptanceQty) > 0) || acceptanceCondition.trim().length < 5 || acceptanceJustification.trim().length < 5}>{busy === 'conditional-acceptance' ? 'Đang gửi…' : 'Gửi phê duyệt'}</button>
      </form>}
      <div className="stack-sm" style={{ marginTop: 16 }}>{conditionalAcceptances.map((row) => { const inspection = inspections.find((item) => item.id === row.inspection); return <article className="manufacturing-order-card" key={row.id}><div className="manufacturing-order-summary"><strong>{products.get(inspection?.product)?.name || 'Thành phẩm QC lỗi'}</strong><span className={`badge ${row.status === 'approved' ? 'success' : row.status === 'rejected' ? 'danger' : 'warning'}`}>{statusLabel(row.status)}</span><span className="small muted">Lệnh {String(inspection?.source_id || '').slice(0, 8)} · {qty(row.qty)} {baseUnitName(inspection?.product)} · {row.condition}</span><span className="small muted">Căn cứ: {row.justification}</span></div>{row.status === 'submitted' && <a className="btn btn-ghost btn-sm" href="#/approvals">Mở hàng chờ phê duyệt</a>}{row.status === 'rejected' && can('manufacturing.conditional_acceptance.submitted') && <button className="btn btn-secondary btn-sm" type="button" disabled={Boolean(busy)} onClick={() => operateConditionalAcceptance(row, 'submitted')}>Gửi duyệt lại</button>}{['draft', 'rejected'].includes(row.status) && can('manufacturing.conditional_acceptance.cancelled') && <button className="btn btn-ghost btn-sm" type="button" disabled={Boolean(busy)} onClick={() => operateConditionalAcceptance(row, 'cancelled')}>Hủy đề nghị</button>}</article>; })}{!conditionalAcceptances.length && <p className="small muted">Chưa có đề nghị chấp nhận có điều kiện.</p>}</div>
    </section>}
    {can('manufacturing.production_disposition.read') && <section className="card card-pad">
      <h3>Loại bỏ thành phẩm QC lỗi</h3>
      {can('manufacturing.production_disposition.create') && <form className="manufacturing-form" onSubmit={createProductionDisposition}>
        <label className="field"><span>Phiếu QC trượt *</span><select className="select" required value={dispositionInspection} onChange={(event) => { const nextId = event.target.value; const selected = inspections.find((row) => row.id === nextId); setDispositionInspection(nextId); setDispositionQty(selected ? String(remainingFailedQty(selected)) : ''); }}><option value="">Chọn phiếu QC</option>{inspections.filter((inspection) => ['production_order', 'production_rework'].includes(inspection.source) && inspection.status === 'failed' && remainingFailedQty(inspection) > 0.000001).map((inspection) => <option key={inspection.id} value={inspection.id}>{products.get(inspection.product)?.name || inspection.product} · còn {qty(remainingFailedQty(inspection))} {baseUnitName(inspection.product)} · lệnh {String(inspection.source_id).slice(0, 8)}</option>)}</select></label>
        {dispositionInspection && <label className="field"><span>Số lượng loại bỏ *</span><input className="input num" type="number" min="0.000001" max={remainingFailedQty(inspections.find((row) => row.id === dispositionInspection))} step="any" required value={dispositionQty} onChange={(event) => setDispositionQty(event.target.value)} /></label>}
        <label className="field"><span>Tài khoản chi phí *</span><select className="select" required value={dispositionAccount} onChange={(event) => setDispositionAccount(event.target.value)}><option value="">Chọn tài khoản chi phí</option>{[...accounts.values()].filter((account) => account.kind === 'expense' && account.active !== false).map((account) => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}</select></label>
        <label className="field"><span>Lý do loại bỏ *</span><input className="input" minLength="5" maxLength="500" required value={dispositionNote} onChange={(event) => setDispositionNote(event.target.value)} /></label>
        <button className="btn btn-primary btn-sm" type="submit" disabled={Boolean(busy) || !dispositionInspection || !Number(dispositionQty) || !dispositionAccount || dispositionNote.trim().length < 5}>{busy === 'production-disposition' ? 'Đang ghi nhận…' : 'Ghi sổ loại bỏ'}</button>
      </form>}
      {productionDispositions.map((row) => { const inspection = inspections.find((item) => item.id === row.inspection); return <article className="manufacturing-order-card" key={row.id}><div className="manufacturing-order-summary"><strong>{products.get(inspection?.product)?.name || 'Thành phẩm QC lỗi'}</strong><span className="badge">{statusLabel(row.status)}</span><span className="small muted">Số lượng {qty(row.qty)} · {row.note}</span></div>{row.status === 'draft' && can('manufacturing.production_disposition.posted') && <button className="btn btn-primary btn-sm" type="button" disabled={Boolean(busy)} onClick={() => operateProductionDisposition(row, 'posted')}>Ghi sổ</button>}{row.status === 'draft' && can('manufacturing.production_disposition.cancelled') && <button className="btn btn-ghost btn-sm" type="button" disabled={Boolean(busy)} onClick={() => operateProductionDisposition(row, 'cancelled')}>Hủy phiếu</button>}</article>; })}
      {!productionDispositions.length && <p className="small muted">Chưa có phiếu loại bỏ thành phẩm.</p>}
    </section>}
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
        <thead><tr><th scope="col">Lệnh sản xuất</th><th scope="col">Thành phẩm</th><th scope="col">Trạng thái</th><th scope="col">QC</th><th scope="col" className="right">Kế hoạch</th><th scope="col" className="right">Đạt</th><th scope="col" className="right">Phế phẩm</th><th scope="col" className="right">Giá trị NVL</th><th scope="col" className="right">Đã nhập</th><th scope="col" className="right">Loại bỏ QC</th><th scope="col" className="right">Còn WIP</th></tr></thead>
        <tbody>{report.orders.map((order) => <tr key={order.id}>
          <td>{order.id}</td><td>{order.product}</td><td>{statusLabel(order.status)}</td><td>{order.qualityStatus ? statusLabel(order.qualityStatus) : 'Chưa tạo QC'}</td>
          <td className="right">{qty(order.plannedQty)}</td><td className="right">{qty(order.goodQty)}</td><td className="right" title={order.scrapReason || undefined}>{qty(order.scrapQty)}</td>
          <td className="right money">{fmtMoney(order.materialCost)}</td><td className="right money">{fmtMoney(order.finishedCost)}</td><td className="right money">{fmtMoney(order.qcScrapCost)}</td><td className="right money"><strong>{fmtMoney(order.wipValue)}</strong></td>
        </tr>)}</tbody>
      </table></div>}
      <p className="faint">Giá trị tính theo phiếu kho phát sinh đến {report.asOf}. Trạng thái QC phản ánh trạng thái hiện tại; số dư âm theo lệnh vẫn được hiển thị để phục vụ đối chiếu.</p>
    </div>}
  </div>;
}
