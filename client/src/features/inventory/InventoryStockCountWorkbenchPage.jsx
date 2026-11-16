import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api, dataPath } from '../../lib/api.js';
import { fmtDate, fmtMoney, statusLabel } from '../../lib/i18n.js';
import { app, can, recordLabel } from '../../lib/state.js';
import { recordHref } from '../../lib/routes.js';

const itemsOf = (response) => Array.isArray(response?.items) ? response.items : [];
async function listAll(qname) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const response = await api(`${dataPath(qname)}?${new URLSearchParams({ limit: '1000', offset: String(offset) })}`);
    const items = itemsOf(response);
    rows.push(...items);
    if (items.length < 1000 || rows.length >= Number(response?.total ?? 0)) break;
  }
  return rows;
}
async function listMap(qname) { return new Map((await listAll(qname)).map((row) => [row.id, row])); }
const blankLine = () => ({ rowId: crypto.randomUUID(), product: '', lot: '', location: '', counted_qty: '' });
const cleanLines = (lines) => lines.map(({ product, lot, location, counted_qty }) => ({
  product,
  counted_qty: Number(counted_qty),
  ...(lot ? { lot } : {}),
  ...(location ? { location } : {}),
}));
const action = (row, verb) => api(dataPath('inventory.stock_count', row.id, verb), { method: 'POST' });

export default function InventoryStockCountWorkbenchPage() {
  const [counts, setCounts] = useState([]);
  const [warehouses, setWarehouses] = useState(new Map());
  const [products, setProducts] = useState(new Map());
  const [units, setUnits] = useState(new Map());
  const [lots, setLots] = useState(new Map());
  const [locations, setLocations] = useState(new Map());
  const [approvalRequests, setApprovalRequests] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [warehouse, setWarehouse] = useState('');
  const [reason, setReason] = useState('cycle_count');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState([blankLine()]);
  const [productSearch, setProductSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const workflowApproval = app.meta?.modules?.some((module) => module.id === 'workflow-approval') || false;
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [countRows, warehouseMap, productMap, unitMap, lotMap, locationMap, requestRows] = await Promise.all([
        can('inventory.stock_count.read') ? listAll('inventory.stock_count') : Promise.resolve([]),
        can('inventory.warehouse.read') ? listMap('inventory.warehouse') : Promise.resolve(new Map()),
        can('master-data.product.read') ? listMap('master-data.product') : Promise.resolve(new Map()),
        can('master-data.uom.read') ? listMap('master-data.uom') : Promise.resolve(new Map()),
        can('inventory.lot.read') ? listMap('inventory.lot') : Promise.resolve(new Map()),
        can('inventory.warehouse_location.read') ? listMap('inventory.warehouse_location') : Promise.resolve(new Map()),
        workflowApproval && can('workflow-approval.approval_request.read') ? listAll('workflow-approval.approval_request') : Promise.resolve([]),
      ]);
      countRows.sort((a, b) => String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || '')));
      setCounts(countRows); setWarehouses(warehouseMap); setProducts(productMap); setUnits(unitMap); setLots(lotMap); setLocations(locationMap); setApprovalRequests(requestRows);
      setSelectedId((current) => countRows.some((row) => row.id === current) ? current : '');
    } catch (e) { setError(e.message || 'Không tải được danh sách kiểm kê.'); }
    finally { setLoading(false); }
  }, [workflowApproval]);
  useEffect(() => { load(); }, [load]);

  const selected = counts.find((row) => row.id === selectedId);
  const editable = !selected || ['draft', 'rejected'].includes(selected.status);
  const productRows = useMemo(() => [...products.values()].filter((row) => row.active !== false && row.kind !== 'service' && row.kind !== 'digital'), [products]);
  const unitForProduct = (productId) => {
    const product = products.get(productId);
    return units.get(product?.uom)?.name || (product?.uom ? 'đơn vị gốc' : 'chưa đặt đơn vị');
  };
  const matchingProducts = useMemo(() => productRows.filter((row) => {
    const search = productSearch.trim().toLocaleLowerCase();
    return !search || `${row.sku || ''} ${row.name || ''}`.toLocaleLowerCase().includes(search);
  }).slice(0, 100), [productRows, productSearch]);
  const activeLocations = (warehouseId) => [...locations.values()].filter((row) => row.warehouse === warehouseId && row.active !== false);
  const lotsFor = (productId) => [...lots.values()].filter((row) => row.product === productId);
  const approvalFor = (row) => approvalRequests.find((request) => request.entity === 'inventory.stock_count' && request.record_id === row.id);

  function startNew() {
    setSelectedId(''); setWarehouse(''); setReason('cycle_count'); setNote(''); setLines([blankLine()]); setProductSearch(''); setError(''); setNotice('');
  }
  function openCount(row) {
    setSelectedId(row.id); setWarehouse(row.warehouse || ''); setReason(row.reason || 'cycle_count'); setNote(row.note || '');
    setLines((row.adjustment_lines || []).map((line) => ({ rowId: crypto.randomUUID(), product: line.product || '', lot: line.lot || '', location: line.location || '', counted_qty: line.counted_qty == null ? '' : String(line.counted_qty), expected_qty: line.expected_qty, variance_qty: line.variance_qty })));
    setProductSearch(''); setError(''); setNotice('');
  }
  function updateLine(rowId, field, value) {
    setLines((current) => current.map((line) => line.rowId === rowId ? { ...line, [field]: value, ...(field === 'product' ? { lot: '' } : {}) } : line));
  }
  function addLine() { setLines((current) => [...current, blankLine()]); }
  function removeLine(rowId) { setLines((current) => current.filter((line) => line.rowId !== rowId)); }

  async function run(key, operation, success) {
    setBusy(key); setError(''); setNotice('');
    try { const result = await operation(); if (success) setNotice(success); await load(); return result; }
    catch (e) { setError(e.message || 'Thao tác kiểm kê không thành công.'); await load(); return null; }
    finally { setBusy(''); }
  }
  function validateForm() {
    if (!warehouse) return 'Chọn kho cần kiểm kê.';
    if (!lines.length) return 'Thêm ít nhất một dòng kiểm kê.';
    for (const [index, line] of lines.entries()) {
      if (!line.product) return `Dòng ${index + 1}: chọn sản phẩm.`;
      if (line.counted_qty === '' || !Number.isFinite(Number(line.counted_qty)) || Number(line.counted_qty) < 0) return `Dòng ${index + 1}: số lượng thực tế phải là số không âm.`;
      const product = products.get(line.product);
      if (product?.lot_tracked && !line.lot) return `Dòng ${index + 1}: sản phẩm quản lý theo lô, cần chọn lô.`;
      const duplicate = lines.slice(0, index).some((other) => other.product === line.product && (other.lot || '') === (line.lot || '') && (other.location || '') === (line.location || ''));
      if (duplicate) return `Dòng ${index + 1}: sản phẩm, lô và vị trí này đã được đếm.`;
    }
    return '';
  }
  async function saveDraft() {
    const validation = validateForm(); if (validation) { setError(validation); return null; }
    const body = { warehouse, reason, note: note.trim() || undefined, adjustment_lines: cleanLines(lines) };
    if (selected) return api(dataPath('inventory.stock_count', selected.id), { method: 'PATCH', body });
    return api(dataPath('inventory.stock_count'), { method: 'POST', body });
  }
  async function saveAndSubmit() {
    if (!can('inventory.stock_count.create') || (selected && !can('inventory.stock_count.update'))) return;
    await run('submit', async () => {
      const saved = await saveDraft();
      if (!saved) throw new Error('Không lưu được bản kiểm kê.');
      setSelectedId(saved.id);
      await action(saved, 'submitted');
      return saved;
    }, 'Đã chốt số đếm và gửi duyệt. Số tồn sổ được chụp tại thời điểm gửi để tính chênh lệch.');
  }
  async function saveOnly(event) {
    event.preventDefault();
    if (!can('inventory.stock_count.create') || (selected && !can('inventory.stock_count.update'))) return;
    await run('save', async () => {
      const saved = await saveDraft(); if (!saved) throw new Error('Không lưu được bản kiểm kê.');
      setSelectedId(saved.id); return saved;
    }, 'Đã lưu bản kiểm kê nháp.');
  }
  async function decide(row, verb) {
    const messages = { approved: 'Đã duyệt; chênh lệch đã được ghi thành biến động tồn kho.', rejected: 'Đã từ chối; có thể mở lại bản kiểm kê để chỉnh số đếm.' };
    await run(`${row.id}:${verb}`, () => action(row, verb), messages[verb]);
  }
  async function cancel(row) { await run(`${row.id}:cancelled`, () => action(row, 'cancelled'), 'Đã hủy bản kiểm kê.'); }

  return <div className="page">
    <div className="page-head"><div><h1>Kiểm kê kho</h1><p className="sub">Ghi số lượng theo đơn vị gốc của sản phẩm, lô và vị trí. Số tồn sổ được chụp khi gửi duyệt; chỉ khi phê duyệt, phần chênh lệch mới tạo biến động kho.</p></div><div className="row"><button className="btn btn-secondary" disabled={loading || Boolean(busy)} onClick={load}>Làm mới</button>{can('inventory.stock_count.create') && <button className="btn btn-primary" disabled={Boolean(busy)} onClick={startNew}>Phiếu kiểm kê mới</button>}</div></div>
    {error && <div className="alert error" role="alert">{error}</div>}{notice && <div className="alert success" role="status">{notice}</div>}
    <div className="grid-2" style={{ alignItems: 'start' }}>
      <section className="card card-pad"><div className="row"><h2>Phiếu kiểm kê</h2><span className="grow"/><span className="small muted">{counts.length} phiếu</span></div>
        {loading ? <p className="muted">Đang tải phiếu kiểm kê…</p> : !counts.length ? <div className="empty"><p>Chưa có phiếu kiểm kê.</p></div> : <div className="stack-sm" style={{ marginTop: 10 }}>{counts.map((row) => <button key={row.id} className={`card-pad row wrap ${selectedId === row.id ? 'selected' : ''}`} style={{ textAlign: 'left', width: '100%' }} onClick={() => openCount(row)}><span><strong>{warehouses.get(row.warehouse)?.name || 'Kho'}</strong><br/><span className="small muted">{statusLabel(row.reason || 'cycle_count')} · {fmtDate(row.updated_at || row.created_at)}</span></span><span className="grow"/><span className={`badge ${row.status === 'approved' ? 'success' : row.status === 'rejected' || row.status === 'cancelled' ? 'danger' : row.status === 'submitted' ? 'warning' : ''}`}>{statusLabel(row.status)}</span></button>)}</div>}
      </section>

      <section className="card card-pad"><div className="row wrap"><div><h2>{selected ? `Kiểm kê ${warehouses.get(selected.warehouse)?.name || ''}` : 'Bắt đầu kiểm kê'}</h2><span className="small muted">{selected ? `Mã ${String(selected.id).slice(0, 8)}` : 'Bản nháp chưa ảnh hưởng đến tồn kho.'}</span></div><span className="grow"/>{selected && <a className="small" href={recordHref('inventory.stock_count', selected.id)}>Mở chứng từ</a>}</div>
        {(!selected || editable) && <form onSubmit={saveOnly}>
          <div className="form-grid" style={{ marginTop: 12 }}>
            <label className="field"><span className="label">Kho *</span><select className="select" required value={warehouse} onChange={(e) => { setWarehouse(e.target.value); setLines((current) => current.map((line) => ({ ...line, location: '' }))); }} disabled={Boolean(selected)}><option value="">Chọn kho</option>{[...warehouses.values()].map((row) => <option key={row.id} value={row.id}>{recordLabel('inventory.warehouse', row)}</option>)}</select></label>
            <label className="field"><span className="label">Loại kiểm kê *</span><select className="select" value={reason} onChange={(e) => setReason(e.target.value)}><option value="cycle_count">Kiểm kê định kỳ</option><option value="correction">Điều chỉnh sai lệch</option><option value="damage">Hư hỏng / mất mát</option><option value="opening_balance">Số dư đầu kỳ</option></select></label>
            <label className="field full"><span className="label">Ghi chú</span><input className="input" maxLength="500" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Phạm vi, khu vực hoặc lý do kiểm kê"/></label>
          </div>
          <div className="row wrap" style={{ margin: '16px 0 8px' }}><h3>Dòng đếm thực tế</h3><span className="grow"/><input className="input" style={{ maxWidth: 260 }} type="search" value={productSearch} onChange={(e) => setProductSearch(e.target.value)} placeholder="Tìm SKU hoặc sản phẩm" aria-label="Tìm sản phẩm"/><button className="btn btn-secondary btn-sm" type="button" onClick={addLine}>Thêm dòng</button></div>
          <div className="table-wrap"><table className="table"><thead><tr><th>Sản phẩm</th><th>Lô</th><th>Vị trí</th><th>Số lượng thực tế (đơn vị gốc)</th><th scope="col">Thao tác</th></tr></thead><tbody>{lines.map((line, index) => { const product = products.get(line.product); const productLots = lotsFor(line.product); const productOptions = product && !matchingProducts.some((row) => row.id === product.id) ? [product, ...matchingProducts] : matchingProducts; return <tr key={line.rowId}>
            <td><select className="select" aria-label={`Sản phẩm dòng ${index + 1}`} required value={line.product} onChange={(e) => updateLine(line.rowId, 'product', e.target.value)}><option value="">Chọn sản phẩm…</option>{productOptions.map((row) => <option key={row.id} value={row.id}>{row.sku} · {row.name} · {units.get(row.uom)?.name || (row.uom ? 'đơn vị gốc' : 'chưa đặt đơn vị')}{row.lot_tracked ? ' · theo lô' : ''}</option>)}</select></td>
            <td><select className="select" aria-label={`Lô dòng ${index + 1}`} value={line.lot} required={Boolean(product?.lot_tracked)} disabled={!product?.lot_tracked} onChange={(e) => updateLine(line.rowId, 'lot', e.target.value)}><option value="">{product?.lot_tracked ? 'Chọn lô…' : 'Không áp dụng'}</option>{productLots.map((row) => <option key={row.id} value={row.id}>{row.code}{row.expiry ? ` · HSD ${row.expiry}` : ''}</option>)}</select></td>
            <td><select className="select" aria-label={`Vị trí dòng ${index + 1}`} value={line.location} disabled={!warehouse} onChange={(e) => updateLine(line.rowId, 'location', e.target.value)}><option value="">Không gán vị trí</option>{activeLocations(warehouse).map((row) => <option key={row.id} value={row.id}>{row.code} · {row.name}</option>)}</select></td>
            <td><div><input className="input num" aria-label={`Số lượng thực tế dòng ${index + 1} (${unitForProduct(line.product)})`} type="number" min="0" step="0.000001" required value={line.counted_qty} onChange={(e) => updateLine(line.rowId, 'counted_qty', e.target.value)} placeholder="0"/><span className="small muted">{unitForProduct(line.product)}</span></div></td>
            <td><button className="btn btn-ghost btn-sm" type="button" disabled={lines.length <= 1} onClick={() => removeLine(line.rowId)} aria-label={`Xóa dòng ${index + 1}`}>Xóa</button></td>
          </tr>; })}</tbody></table></div>
          <div className="row wrap" style={{ marginTop: 12 }}><span className="small muted">Số tồn sổ được giữ kín trong lúc đếm để giảm sai lệch do thiên kiến. Backend sẽ chụp tồn kho và tính chênh lệch khi gửi duyệt.</span><span className="grow"/><button className="btn btn-secondary" type="submit" disabled={Boolean(busy) || !can('inventory.stock_count.create') || (selected && !can('inventory.stock_count.update'))}>Lưu nháp</button><button className="btn btn-primary" type="button" disabled={Boolean(busy) || !can('inventory.stock_count.submitted') || (selected && !can('inventory.stock_count.update'))} onClick={saveAndSubmit}>{busy === 'submit' ? 'Đang chốt số đếm…' : 'Lưu và gửi duyệt'}</button></div>
        </form>}

        {selected && selected.status === 'submitted' && workflowApproval && approvalFor(selected) && <p className="small muted" style={{ marginTop: 12 }}>Yêu cầu duyệt: <a href={recordHref('workflow-approval.approval_request', approvalFor(selected).id)}>{statusLabel(approvalFor(selected).status)} · mở yêu cầu</a></p>}
        {selected && selected.status === 'submitted' && !workflowApproval && <div className="row wrap" style={{ marginTop: 12 }}>{can('inventory.stock_count.approved') && <button className="btn btn-primary" disabled={Boolean(busy)} onClick={() => decide(selected, 'approved')}>Duyệt và điều chỉnh tồn</button>}{can('inventory.stock_count.rejected') && <button className="btn btn-secondary" disabled={Boolean(busy)} onClick={() => decide(selected, 'rejected')}>Từ chối</button>}</div>}
        {selected && ['draft', 'rejected'].includes(selected.status) && can('inventory.stock_count.cancelled') && <button className="btn btn-ghost btn-sm" style={{ marginTop: 10 }} disabled={Boolean(busy)} onClick={() => cancel(selected)}>Hủy phiếu</button>}
        {selected && ['submitted', 'approved'].includes(selected.status) && <div className="table-wrap" style={{ marginTop: 16 }}><h3>Số đếm và chênh lệch</h3><table className="table"><thead><tr><th>Sản phẩm</th><th>Lô / vị trí</th><th className="right">Thực tế (đơn vị gốc)</th><th className="right">Theo sổ (đơn vị gốc)</th><th className="right">Chênh lệch (đơn vị gốc)</th></tr></thead><tbody>{(selected.adjustment_lines || []).map((line, index) => <tr key={`${line.product}-${line.lot || ''}-${line.location || ''}-${index}`}><td>{products.get(line.product) ? recordLabel('master-data.product', products.get(line.product)) : String(line.product || '').slice(0, 8)}</td><td>{line.lot ? lots.get(line.lot)?.code || String(line.lot).slice(0, 8) : '—'}{line.location ? ` · ${locations.get(line.location)?.code || String(line.location).slice(0, 8)}` : ''}</td><td className="right">{line.counted_qty} {unitForProduct(line.product)}</td><td className="right">{line.expected_qty ?? '—'} {unitForProduct(line.product)}</td><td className="right"><strong>{line.variance_qty ?? '—'} {unitForProduct(line.product)}</strong></td></tr>)}</tbody></table></div>}
        {selected?.status === 'approved' && <p className="small muted" style={{ marginTop: 10 }}>Đã duyệt {fmtDate(selected.updated_at)}. Chênh lệch đã chuyển thành biến động kho theo FIFO/lô và vị trí tương ứng.</p>}
      </section>
    </div>
  </div>;
}
