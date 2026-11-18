import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api, dataPath } from '../../lib/api.js';
import { fmtDate, statusLabel, uiText } from '../../lib/i18n.js';
import { compareDecimals } from '../../lib/decimal.js';
import { app, can, loadAll, recordLabel } from '../../lib/state.js';
import { recordHref } from '../../lib/routes.js';
import StockCountLinesEditor from './components/StockCountLinesEditor.jsx';

async function listMap(qname) { return new Map((await loadAll(qname)).map((row) => [row.id, row])); }
const blankLine = () => ({ rowId: crypto.randomUUID(), product: '', lot: '', location: '', counted_qty: '' });
const cleanLines = (lines) => lines.map(({ product, lot, location, counted_qty }) => ({
  product,
  counted_qty: String(counted_qty),
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
  const [productSuggestionLimit, setProductSuggestionLimit] = useState(100);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const workflowApproval = app.meta?.modules?.some((module) => module.id === 'workflow-approval') || false;
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [countRows, warehouseMap, productMap, unitMap, lotMap, locationMap, requestRows] = await Promise.all([
        can('inventory.stock_count.read') ? loadAll('inventory.stock_count') : Promise.resolve([]),
        can('inventory.warehouse.read') ? listMap('inventory.warehouse') : Promise.resolve(new Map()),
        can('master-data.product.read') ? listMap('master-data.product') : Promise.resolve(new Map()),
        can('master-data.uom.read') ? listMap('master-data.uom') : Promise.resolve(new Map()),
        can('inventory.lot.read') ? listMap('inventory.lot') : Promise.resolve(new Map()),
        can('inventory.warehouse_location.read') ? listMap('inventory.warehouse_location') : Promise.resolve(new Map()),
        workflowApproval && can('workflow-approval.approval_request.read') ? loadAll('workflow-approval.approval_request') : Promise.resolve([]),
      ]);
      countRows.sort((a, b) => String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || '')));
      setCounts(countRows); setWarehouses(warehouseMap); setProducts(productMap); setUnits(unitMap); setLots(lotMap); setLocations(locationMap); setApprovalRequests(requestRows);
      setSelectedId((current) => countRows.some((row) => row.id === current) ? current : '');
    } catch (e) { setError(e.message || uiText('Không tải được danh sách kiểm kê.')); }
    finally { setLoading(false); }
  }, [workflowApproval]);
  useEffect(() => { load(); }, [load]);

  const selected = counts.find((row) => row.id === selectedId);
  const editable = !selected || ['draft', 'rejected'].includes(selected.status);
  const productRows = useMemo(() => [...products.values()].filter((row) => row.active !== false && row.kind !== 'service' && row.kind !== 'digital'), [products]);
  const unitForProduct = (productId) => {
    const product = products.get(productId);
    return units.get(product?.uom)?.name || (product?.uom ? uiText('đơn vị gốc') : uiText('chưa đặt đơn vị'));
  };
  const matchingProductRows = useMemo(() => productRows.filter((row) => {
    const search = productSearch.trim().toLocaleLowerCase();
    return !search || `${row.sku || ''} ${row.name || ''}`.toLocaleLowerCase().includes(search);
  }), [productRows, productSearch]);
  const matchingProducts = useMemo(() => matchingProductRows.slice(0, productSuggestionLimit), [matchingProductRows, productSuggestionLimit]);
  const approvalFor = (row) => approvalRequests.find((request) => request.entity === 'inventory.stock_count' && request.record_id === row.id);

  function startNew() {
    setSelectedId(''); setWarehouse(''); setReason('cycle_count'); setNote(''); setLines([blankLine()]); setProductSearch(''); setProductSuggestionLimit(100); setError(''); setNotice('');
  }
  function openCount(row) {
    setSelectedId(row.id); setWarehouse(row.warehouse || ''); setReason(row.reason || 'cycle_count'); setNote(row.note || '');
    setLines((row.adjustment_lines || []).map((line) => ({ rowId: crypto.randomUUID(), product: line.product || '', lot: line.lot || '', location: line.location || '', counted_qty: line.counted_qty == null ? '' : String(line.counted_qty), expected_qty: line.expected_qty, variance_qty: line.variance_qty })));
    setProductSearch(''); setProductSuggestionLimit(100); setError(''); setNotice('');
  }
  function updateLine(rowId, field, value) {
    setLines((current) => current.map((line) => line.rowId === rowId ? { ...line, [field]: value, ...(field === 'product' ? { lot: '' } : {}) } : line));
  }
  function addLine() { setLines((current) => [...current, blankLine()]); }
  function removeLine(rowId) { setLines((current) => current.filter((line) => line.rowId !== rowId)); }

  async function run(key, operation, success) {
    setBusy(key); setError(''); setNotice('');
    try { const result = await operation(); if (success) setNotice(success); await load(); return result; }
    catch (e) { setError(e.message || uiText('Thao tác kiểm kê không thành công.')); await load(); return null; }
    finally { setBusy(''); }
  }
  function validateForm() {
    if (!warehouse) return uiText('Chọn kho cần kiểm kê.');
    if (!lines.length) return uiText('Thêm ít nhất một dòng kiểm kê.');
    for (const [index, line] of lines.entries()) {
      if (!line.product) return `${uiText('Dòng')} ${index + 1}: ${uiText('chọn sản phẩm.')}`;
      let validCount = false;
      try { validCount = line.counted_qty !== '' && compareDecimals(line.counted_qty, 0) >= 0; } catch { validCount = false; }
      if (!validCount) return `${uiText('Dòng')} ${index + 1}: ${uiText('số lượng thực tế phải là số không âm.')}`;
      const product = products.get(line.product);
      if (product?.lot_tracked && !line.lot) return `${uiText('Dòng')} ${index + 1}: ${uiText('sản phẩm quản lý theo lô, cần chọn lô.')}`;
      const duplicate = lines.slice(0, index).some((other) => other.product === line.product && (other.lot || '') === (line.lot || '') && (other.location || '') === (line.location || ''));
      if (duplicate) return `${uiText('Dòng')} ${index + 1}: ${uiText('sản phẩm, lô và vị trí này đã được đếm.')}`;
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
      if (!saved) throw new Error(uiText('Không lưu được bản kiểm kê.'));
      setSelectedId(saved.id);
      await action(saved, 'submitted');
      return saved;
    }, uiText('Đã chốt số đếm và gửi duyệt. Số tồn sổ được chụp tại thời điểm gửi để tính chênh lệch.'));
  }
  async function saveOnly(event) {
    event.preventDefault();
    if (!can('inventory.stock_count.create') || (selected && !can('inventory.stock_count.update'))) return;
    await run('save', async () => {
      const saved = await saveDraft(); if (!saved) throw new Error(uiText('Không lưu được bản kiểm kê.'));
      setSelectedId(saved.id); return saved;
    }, uiText('Đã lưu bản kiểm kê nháp.'));
  }
  async function decide(row, verb) {
    const messages = { approved: uiText('Đã duyệt; chênh lệch đã được ghi thành biến động tồn kho.'), rejected: uiText('Đã từ chối; có thể mở lại bản kiểm kê để chỉnh số đếm.') };
    await run(`${row.id}:${verb}`, () => action(row, verb), messages[verb]);
  }
  async function cancel(row) { await run(`${row.id}:cancelled`, () => action(row, 'cancelled'), uiText('Đã hủy bản kiểm kê.')); }

  return <div className="page">
    <div className="page-head"><div><h1>{uiText('Kiểm kê kho')}</h1><p className="sub">{uiText('Ghi số lượng theo đơn vị gốc của sản phẩm, lô và vị trí. Số tồn sổ được chụp khi gửi duyệt; chỉ khi phê duyệt, phần chênh lệch mới tạo biến động kho.')}</p></div><div className="row"><button className="btn btn-secondary" disabled={loading || Boolean(busy)} onClick={load}>{uiText('Làm mới')}</button>{can('inventory.stock_count.create') && <button className="btn btn-primary" disabled={Boolean(busy)} onClick={startNew}>{uiText('Phiếu kiểm kê mới')}</button>}</div></div>
    {error && <div className="alert error" role="alert">{uiText(error)}</div>}{notice && <div className="alert success" role="status">{uiText(notice)}</div>}
    <div className="grid-2 u-legacy-41149aaf87" >
      <section className="card card-pad"><div className="row"><h2>{uiText('Phiếu kiểm kê')}</h2><span className="grow"/><span className="small muted">{counts.length} {uiText('phiếu')}</span></div>
        {loading ? <p className="muted">{uiText('Đang tải phiếu kiểm kê…')}</p> : !counts.length ? <div className="empty"><p>{uiText('Chưa có phiếu kiểm kê.')}</p></div> : <div className="stack-sm u-legacy-df928149c5" >{counts.map((row) => <button key={row.id} className={[`card-pad row wrap ${selectedId === row.id ? 'selected' : ''}`, 'u-legacy-4bbc9f7d70'].filter(Boolean).join(' ')}  onClick={() => openCount(row)}><span><strong>{warehouses.get(row.warehouse)?.name || uiText('Kho')}</strong><br/><span className="small muted">{statusLabel(row.reason || 'cycle_count')} · {fmtDate(row.updated_at || row.created_at)}</span></span><span className="grow"/><span className={`badge ${row.status === 'approved' ? 'success' : row.status === 'rejected' || row.status === 'cancelled' ? 'danger' : row.status === 'submitted' ? 'warning' : ''}`}>{statusLabel(row.status)}</span></button>)}</div>}
      </section>

      <section className="card card-pad"><div className="row wrap"><div><h2>{selected ? `${uiText('Kiểm kê')} ${warehouses.get(selected.warehouse)?.name || ''}` : uiText('Bắt đầu kiểm kê')}</h2><span className="small muted">{selected ? `${uiText('Mã')} ${String(selected.id).slice(0, 8)}` : uiText('Bản nháp chưa ảnh hưởng đến tồn kho.')}</span></div><span className="grow"/>{selected && <a className="small" href={recordHref('inventory.stock_count', selected.id)}>{uiText('Mở chứng từ')}</a>}</div>
        {(!selected || editable) && <form onSubmit={saveOnly}>
          <div className="form-grid u-legacy-0ee7f66ad9" >
            <label className="field"><span className="label">{uiText('Kho')} *</span><select className="select" required value={warehouse} onChange={(e) => { setWarehouse(e.target.value); setLines((current) => current.map((line) => ({ ...line, location: '' }))); }} disabled={Boolean(selected)}><option value="">{uiText('Chọn kho')}</option>{[...warehouses.values()].map((row) => <option key={row.id} value={row.id}>{recordLabel('inventory.warehouse', row)}</option>)}</select></label>
            <label className="field"><span className="label">{uiText('Loại kiểm kê')} *</span><select className="select" value={reason} onChange={(e) => setReason(e.target.value)}><option value="cycle_count">{uiText('Kiểm kê định kỳ')}</option><option value="correction">{uiText('Điều chỉnh sai lệch')}</option><option value="damage">{uiText('Hư hỏng / mất mát')}</option><option value="opening_balance">{uiText('Số dư đầu kỳ')}</option></select></label>
            <label className="field full"><span className="label">{uiText('Ghi chú')}</span><input className="input" maxLength="500" value={note} onChange={(e) => setNote(e.target.value)} placeholder={uiText('Phạm vi, khu vực hoặc lý do kiểm kê')}/></label>
          </div>
          <StockCountLinesEditor lines={lines} matchingProducts={matchingProducts} totalProductMatches={matchingProductRows.length} onShowMoreProducts={() => setProductSuggestionLimit((limit) => limit + 100)} products={products} units={units} lots={lots} locations={locations} warehouse={warehouse} productSearch={productSearch} onProductSearchChange={(value) => { setProductSearch(value); setProductSuggestionLimit(100); }} onAddLine={addLine} onUpdateLine={updateLine} onRemoveLine={removeLine} unitForProduct={unitForProduct} />
          <div className="row wrap u-legacy-0ee7f66ad9" ><span className="small muted">{uiText('Số tồn sổ được giữ kín trong lúc đếm để giảm sai lệch do thiên kiến. Backend sẽ chụp tồn kho và tính chênh lệch khi gửi duyệt.')}</span><span className="grow"/><button className="btn btn-secondary" type="submit" disabled={Boolean(busy) || !can('inventory.stock_count.create') || (selected && !can('inventory.stock_count.update'))}>{uiText('Lưu nháp')}</button><button className="btn btn-primary" type="button" disabled={Boolean(busy) || !can('inventory.stock_count.submitted') || (selected && !can('inventory.stock_count.update'))} onClick={saveAndSubmit}>{busy === 'submit' ? uiText('Đang chốt số đếm…') : uiText('Lưu và gửi duyệt')}</button></div>
        </form>}

        {selected && selected.status === 'submitted' && workflowApproval && approvalFor(selected) && <p className="small muted u-legacy-0ee7f66ad9" >{uiText('Yêu cầu duyệt')}: <a href={recordHref('workflow-approval.approval_request', approvalFor(selected).id)}>{statusLabel(approvalFor(selected).status)} · {uiText('mở yêu cầu')}</a></p>}
        {selected && selected.status === 'submitted' && !workflowApproval && <div className="row wrap u-legacy-0ee7f66ad9" >{can('inventory.stock_count.approved') && <button className="btn btn-primary" disabled={Boolean(busy)} onClick={() => decide(selected, 'approved')}>{uiText('Duyệt và điều chỉnh tồn')}</button>}{can('inventory.stock_count.rejected') && <button className="btn btn-secondary" disabled={Boolean(busy)} onClick={() => decide(selected, 'rejected')}>{uiText('Từ chối')}</button>}</div>}
        {selected && ['draft', 'rejected'].includes(selected.status) && can('inventory.stock_count.cancelled') && <button className="btn btn-ghost btn-sm u-legacy-df928149c5"  disabled={Boolean(busy)} onClick={() => cancel(selected)}>{uiText('Hủy phiếu')}</button>}
        {selected && ['submitted', 'approved'].includes(selected.status) && <div className="table-wrap u-legacy-92c18f6bda" ><h3>{uiText('Số đếm và chênh lệch')}</h3><table className="table"><thead><tr><th>{uiText('Sản phẩm')}</th><th>{uiText('Lô / vị trí')}</th><th className="right">{uiText('Thực tế (đơn vị gốc)')}</th><th className="right">{uiText('Theo sổ (đơn vị gốc)')}</th><th className="right">{uiText('Chênh lệch (đơn vị gốc)')}</th></tr></thead><tbody>{(selected.adjustment_lines || []).map((line, index) => <tr key={`${line.product}-${line.lot || ''}-${line.location || ''}-${index}`}><td>{products.get(line.product) ? recordLabel('master-data.product', products.get(line.product)) : String(line.product || '').slice(0, 8)}</td><td>{line.lot ? lots.get(line.lot)?.code || String(line.lot).slice(0, 8) : '—'}{line.location ? ` · ${locations.get(line.location)?.code || String(line.location).slice(0, 8)}` : ''}</td><td className="right">{line.counted_qty} {unitForProduct(line.product)}</td><td className="right">{line.expected_qty ?? '—'} {unitForProduct(line.product)}</td><td className="right"><strong>{line.variance_qty ?? '—'} {unitForProduct(line.product)}</strong></td></tr>)}</tbody></table></div>}
        {selected?.status === 'approved' && <p className="small muted u-legacy-df928149c5" >{uiText('Đã duyệt')} {fmtDate(selected.updated_at)}. {uiText('Chênh lệch đã chuyển thành biến động kho theo FIFO/lô và vị trí tương ứng.')}</p>}
      </section>
    </div>
  </div>;
}
