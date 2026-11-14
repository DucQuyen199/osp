import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api, dataPath } from './lib/api.js';
import { fmtDate, fmtMoney, statusLabel } from './lib/i18n.js';
import { app, can, loadRefs, recordLabel } from './lib/state.js';

const itemsOf = (response) => Array.isArray(response?.items) ? response.items : [];
const action = (entity, row, verb) => api(dataPath(entity, row.id, verb), { method: 'POST' });
const keyOf = (line) => `${line.product}|${Number(line.price || 0)}`;
const lineValue = (line, taxes) => {
  const net = (Number(line.qty) || 0) * (Number(line.price) || 0);
  return net * (1 + (Number(taxes.get(line.tax)?.rate) || 0) / 100);
};

export default function PurchasingWorkbenchPage() {
  const [orders, setOrders] = useState([]);
  const [requisitions, setRequisitions] = useState([]);
  const [receipts, setReceipts] = useState([]);
  const [supplierInvoices, setSupplierInvoices] = useState([]);
  const [suppliers, setSuppliers] = useState(new Map());
  const [products, setProducts] = useState(new Map());
  const [warehouses, setWarehouses] = useState(new Map());
  const [taxes, setTaxes] = useState([]);
  const [bills, setBills] = useState([]);
  const [approvalRequests, setApprovalRequests] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [editingId, setEditingId] = useState('');
  const [orderForm, setOrderForm] = useState({ supplier: '', warehouse: '', expected_date: '' });
  const [lines, setLines] = useState([{ product: '', qty: '1', price: '', tax: '' }]);
  const [requisitionForm, setRequisitionForm] = useState({ supplier: '', sourcing_method: 'direct', warehouse: '', requested_by: '', reason: '' });
  const [requisitionLines, setRequisitionLines] = useState([{ product: '', qty: '1' }]);
  const [editingRequisitionId, setEditingRequisitionId] = useState('');
  const [receiptOrderId, setReceiptOrderId] = useState('');
  const [receiptLines, setReceiptLines] = useState([]);
  const [receiptNote, setReceiptNote] = useState('');
  const [supplierInvoiceForm, setSupplierInvoiceForm] = useState({ invoice_number: '', issue_date: new Date().toISOString().slice(0, 10), due_date: '' });
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const workflowApproval = app.meta?.modules?.some((module) => module.id === 'workflow-approval') || false;
  const load = useCallback(async (quiet = false) => {
    if (!quiet) { setLoading(true); setError(''); }
    try {
      const [orderRes, receiptRes, requisitionRes, supplierInvoiceRes, supplierMap, productMap, warehouseMap, taxRes, billRes, approvalRes] = await Promise.all([
        can('purchasing.purchase_order.read') ? api(`${dataPath('purchasing.purchase_order')}?limit=1000`) : Promise.resolve({ items: [] }),
        can('purchasing.purchase_receipt.read') ? api(`${dataPath('purchasing.purchase_receipt')}?limit=1000`) : Promise.resolve({ items: [] }),
        can('purchasing.purchase_requisition.read') ? api(`${dataPath('purchasing.purchase_requisition')}?limit=1000`) : Promise.resolve({ items: [] }),
        can('purchasing.supplier_invoice.read') ? api(`${dataPath('purchasing.supplier_invoice')}?limit=1000`) : Promise.resolve({ items: [] }),
        can('master-data.party.read') ? loadRefs('master-data.party') : Promise.resolve(new Map()),
        can('master-data.product.read') ? loadRefs('master-data.product') : Promise.resolve(new Map()),
        can('inventory.warehouse.read') ? loadRefs('inventory.warehouse') : Promise.resolve(new Map()),
        can('master-data.tax.read') ? api(`${dataPath('master-data.tax')}?limit=1000`) : Promise.resolve({ items: [] }),
        can('accounting.bill.read') ? api(`${dataPath('accounting.bill')}?limit=1000`) : Promise.resolve({ items: [] }),
        workflowApproval && can('workflow-approval.approval_request.read') ? api(`${dataPath('workflow-approval.approval_request')}?limit=1000`) : Promise.resolve({ items: [] }),
      ]);
      const orderRows = itemsOf(orderRes).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
      const requisitionRows = itemsOf(requisitionRes).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
      const supplierRows = new Map([...supplierMap].filter(([, row]) => row.is_supplier !== false));
      setOrders(orderRows); setRequisitions(requisitionRows); setReceipts(itemsOf(receiptRes)); setSupplierInvoices(itemsOf(supplierInvoiceRes)); setSuppliers(supplierRows); setProducts(productMap); setWarehouses(warehouseMap);
      setTaxes(itemsOf(taxRes)); setBills(itemsOf(billRes)); setApprovalRequests(itemsOf(approvalRes));
      setSelectedId((current) => orderRows.some((row) => row.id === current) ? current : orderRows[0]?.id || '');
      setOrderForm((current) => ({ ...current, supplier: current.supplier || [...supplierRows.keys()][0] || '', warehouse: current.warehouse || [...warehouseMap.keys()][0] || '' }));
      setLines((current) => current.map((line) => ({ ...line, product: line.product || [...productMap.keys()][0] || '' })));
    } catch (reason) { setError(reason.message || 'Không tải được đơn mua và phiếu nhận hàng.'); }
    finally { if (!quiet) setLoading(false); }
  }, [workflowApproval]);

  useEffect(() => { document.title = 'Mua hàng và nhận hàng · OSP Suite'; load(); }, [load]);
  const taxById = useMemo(() => new Map(taxes.map((row) => [row.id, row])), [taxes]);
  const selected = orders.find((row) => row.id === selectedId);
  const selectedReceipts = useMemo(() => receipts.filter((row) => row.purchase_order === selectedId).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))), [receipts, selectedId]);
  const billByOrder = useMemo(() => new Map(bills.filter((row) => row.source === 'purchase_order').map((row) => [row.source_id, row])), [bills]);
  const supplierInvoiceByOrder = useMemo(() => new Map(supplierInvoices.map((row) => [row.purchase_order, row])), [supplierInvoices]);
  const approvalByOrder = useMemo(() => new Map(approvalRequests.filter((row) => row.entity === 'purchasing.purchase_order').map((row) => [row.record_id, row])), [approvalRequests]);
  const approvalByRequisition = useMemo(() => new Map(approvalRequests.filter((row) => row.entity === 'purchasing.purchase_requisition').map((row) => [row.record_id, row])), [approvalRequests]);
  const orderByRequisition = useMemo(() => new Map(orders.filter((row) => row.source === 'purchase_requisition').map((row) => [row.source_id, row])), [orders]);
  const totals = useMemo(() => ({
    draft: orders.filter((row) => ['draft','rejected'].includes(row.status)).length,
    awaitingApproval: orders.filter((row) => row.status === 'submitted').length,
    receiving: orders.filter((row) => ['approved','partially_received'].includes(row.status)).length,
    received: orders.filter((row) => row.status === 'received').length,
  }), [orders]);

  async function run(key, operation, success) {
    setBusy(key); setError(''); setNotice('');
    try { await operation(); setNotice(success); await load(true); }
    catch (reason) { setError(reason.message || 'Thao tác không thành công.'); await load(true); }
    finally { setBusy(''); }
  }

  async function saveOrder(event) {
    event.preventDefault();
    const payload = {
      supplier: orderForm.supplier, warehouse: orderForm.warehouse,
      expected_date: orderForm.expected_date || undefined,
      lines: lines.map((line) => ({ product: line.product, qty: Number(line.qty), price: Number(line.price), tax: line.tax || undefined })),
    };
    const existing = editingId;
    await run(existing ? `${existing}:save` : 'order:create', () => api(existing ? dataPath('purchasing.purchase_order', existing) : dataPath('purchasing.purchase_order'), { method: existing ? 'PATCH' : 'POST', body: payload }), existing ? 'Đã cập nhật đơn mua nháp.' : 'Đã tạo đơn mua nháp; tổng tiền và thuế được tính lại trên máy chủ.');
    setEditingId(''); setLines([{ product: [...products.keys()][0] || '', qty: '1', price: '', tax: '' }]);
    if (!existing) setOrderForm((current) => ({ ...current, expected_date: '' }));
  }

  async function saveRequisition(event) {
    event.preventDefault();
    const payload = {
      supplier: requisitionForm.sourcing_method === 'direct' ? requisitionForm.supplier || undefined : undefined,
      sourcing_method: requisitionForm.sourcing_method,
      warehouse: requisitionForm.warehouse,
      requested_by: requisitionForm.requested_by.trim() || undefined,
      reason: requisitionForm.reason.trim() || undefined,
      lines: requisitionLines.map((line) => ({ product: line.product, qty: Number(line.qty) })),
    };
    const existing = editingRequisitionId;
    await run(existing ? `${existing}:requisition-save` : 'requisition:create', () => api(existing ? dataPath('purchasing.purchase_requisition', existing) : dataPath('purchasing.purchase_requisition'), { method: existing ? 'PATCH' : 'POST', body: payload }), existing ? 'Đã cập nhật đề nghị mua nháp.' : 'Đã tạo đề nghị mua nháp.');
    setEditingRequisitionId(''); setRequisitionLines([{ product: [...products.keys()][0] || '', qty: '1' }]);
    setRequisitionForm((current) => ({ ...current, requested_by: '', reason: '' }));
  }

  function editRequisition(row) {
    setEditingRequisitionId(row.id);
    setRequisitionForm({ supplier: row.supplier || '', sourcing_method: row.sourcing_method || 'direct', warehouse: row.warehouse || '', requested_by: row.requested_by || '', reason: row.reason || '' });
    setRequisitionLines((row.lines || []).map((line) => ({ product: line.product || '', qty: String(line.qty || 1) })));
  }

  async function requisitionAction(row, verb) {
    const messages = { submitted: 'Đã gửi đề nghị mua đi duyệt.', approved: 'Đã duyệt đề nghị; hệ thống tạo đơn mua nháp để bổ sung báo giá và trình duyệt riêng.', rejected: 'Đề nghị mua đã bị từ chối.' };
    await run(`${row.id}:${verb}`, () => action('purchasing.purchase_requisition', row, verb), messages[verb]);
  }

  function editOrder(row) {
    setEditingId(row.id); setSelectedId(row.id);
    setOrderForm({ supplier: row.supplier || '', warehouse: row.warehouse || '', expected_date: row.expected_date || '' });
    setLines((row.lines || []).map((line) => ({ product: line.product || '', qty: String(line.qty || 1), price: String(line.price ?? ''), tax: line.tax || '' })));
  }

  async function submitOrder(row) {
    await run(`${row.id}:submitted`, () => action('purchasing.purchase_order', row, 'submitted'), 'Đã gửi đơn mua đi phê duyệt.');
  }

  async function approveOrder(row) {
    await run(`${row.id}:approved`, () => action('purchasing.purchase_order', row, 'approved'), 'Đã duyệt đơn mua; kho có thể nhận hàng.');
  }

  async function orderAction(row, verb) {
    const messages = { cancelled: 'Đã hủy đơn mua.', rejected: 'Đơn mua đã bị từ chối.' };
    await run(`${row.id}:${verb}`, () => action('purchasing.purchase_order', row, verb), messages[verb]);
  }

  function prepareReceipt(row) {
    const ordered = new Map();
    for (const line of row.lines || []) {
      const key = keyOf(line); const current = ordered.get(key) || { product: line.product, price: Number(line.price), qty: 0 };
      current.qty += Number(line.qty || 0); ordered.set(key, current);
    }
    const received = new Map();
    for (const receipt of receipts.filter((item) => item.purchase_order === row.id && item.status === 'received')) {
      for (const line of receipt.lines || []) received.set(keyOf(line), (received.get(keyOf(line)) || 0) + Number(line.qty || 0));
    }
    const remaining = [...ordered.entries()].map(([key, line]) => ({ ...line, qty: Math.max(0, line.qty - (received.get(key) || 0)), key })).filter((line) => line.qty > 0.000001);
    setReceiptOrderId(row.id); setReceiptLines(remaining.map((line) => ({ ...line, qty: String(line.qty) }))); setReceiptNote('');
  }

  async function receiveGoods(event) {
    event.preventDefault();
    const order = orders.find((row) => row.id === receiptOrderId);
    if (!order) return;
    const receiptItems = receiptLines.filter((line) => Number(line.received ?? line.qty) > 0).map((line) => ({ product: line.product, qty: Number(line.received ?? line.qty), price: Number(line.price) }));
    if (!receiptItems.length) { setError('Nhập số lượng nhận lớn hơn 0 cho ít nhất một dòng.'); return; }
    await run(`${order.id}:receipt`, async () => {
      const receipt = await api(dataPath('purchasing.purchase_receipt'), { method: 'POST', body: { purchase_order: order.id, warehouse: order.warehouse, lines: receiptItems, note: receiptNote.trim() || undefined } });
      await action('purchasing.purchase_receipt', receipt, 'received');
    }, 'Đã ghi nhận hàng vào kho. Số lượng đã được đối chiếu với đơn mua; đơn tự cập nhật tiến độ nhận.');
    setReceiptOrderId(''); setReceiptLines([]); setReceiptNote('');
  }

  async function createSupplierInvoice(event) {
    event.preventDefault();
    if (!selected) return;
    await run(`${selected.id}:supplier-invoice`, () => api(dataPath('purchasing.supplier_invoice'), { method: 'POST', body: {
      purchase_order: selected.id, supplier: selected.supplier, department: selected.department || undefined,
      invoice_number: supplierInvoiceForm.invoice_number.trim(),
      issue_date: supplierInvoiceForm.issue_date, due_date: supplierInvoiceForm.due_date || undefined,
      total: Number(selected.total), tax_total: Number(selected.tax_total || 0), lines: selected.lines || [],
    } }), 'Đã lưu nháp hóa đơn nhà cung cấp. Hãy đối chiếu số hóa đơn và duyệt để ghi nhận công nợ.');
    setSupplierInvoiceForm((current) => ({ ...current, invoice_number: '', due_date: '' }));
  }

  const addLine = () => setLines((current) => [...current, { product: [...products.keys()][0] || '', qty: '1', price: '', tax: '' }]);
  const updateLine = (index, field, value) => setLines((current) => current.map((line, i) => i === index ? { ...line, [field]: value } : line));
  const canReceive = (row) => ['approved','partially_received'].includes(row.status) && can('purchasing.purchase_receipt.create');
  const orderLinesTotal = lines.reduce((sum, line) => sum + lineValue(line, taxById), 0);

  return <div className="page">

    <div className="page-head"><div><h1>Mua hàng và nhận hàng</h1><p className="sub">Lập đơn mua, gửi duyệt, nhận đủ hoặc từng phần vào kho và theo dõi hóa đơn nhà cung cấp.</p></div><button className="btn btn-secondary" type="button" disabled={loading || Boolean(busy)} onClick={() => load()}>Làm mới</button></div>
    {can('purchasing.rfq.read') && <div className="row" style={{ justifyContent: 'flex-end', marginBottom: 10 }}><a className="btn btn-secondary btn-sm" href="#/sourcing">RFQ và so sánh báo giá</a></div>}
    {error && <div className="alert danger" role="alert">{error}</div>}{notice && <div className="alert success" role="status">{notice}</div>}
    <div className="stats" style={{ marginBottom: 16 }}><div className="card stat"><span className="stat-label">Nháp / bị trả</span><strong className="stat-value">{totals.draft}</strong></div><div className="card stat"><span className="stat-label">Chờ duyệt</span><strong className="stat-value">{totals.awaitingApproval}</strong></div><div className="card stat"><span className="stat-label">Đang nhận hàng</span><strong className="stat-value">{totals.receiving}</strong></div><div className="card stat"><span className="stat-label">Đã nhận đủ</span><strong className="stat-value">{totals.received}</strong></div></div>

    {can('purchasing.purchase_requisition.read') && <section className="card card-pad" style={{ marginBottom: 16 }}><div className="row wrap"><h2>{editingRequisitionId ? 'Sửa đề nghị mua nháp' : 'Đề nghị mua nội bộ'}</h2><span className="grow"/>{editingRequisitionId && <button className="btn btn-ghost btn-sm" type="button" onClick={() => { setEditingRequisitionId(''); setRequisitionLines([{ product: [...products.keys()][0] || '', qty: '1' }]); }}>Thoát chỉnh sửa</button>}</div><p className="small muted">Ghi nhu cầu hàng hóa và kho nhận. Sau khi phê duyệt, hệ thống sinh đơn mua nháp có liên kết nguồn; đơn mua vẫn cần giá và phê duyệt riêng trước khi đặt hàng.</p>
      {can('purchasing.purchase_requisition.create') && <><form onSubmit={saveRequisition}><div className="form-grid">
<label className="field"><span className="label">Phương thức mua *</span><select className="select" value={requisitionForm.sourcing_method} onChange={(event) => setRequisitionForm((current) => ({ ...current, sourcing_method: event.target.value, supplier: event.target.value === 'competitive' ? '' : current.supplier }))}><option value="direct">Mua trực tiếp</option><option value="competitive">So sánh báo giá nhà cung cấp</option></select></label>
                <label className="field"><span className="label">Nhà cung cấp *</span><select className="select" required={requisitionForm.sourcing_method === 'direct'} disabled={requisitionForm.sourcing_method === 'competitive'} value={requisitionForm.supplier} onChange={(event) => setRequisitionForm((current) => ({ ...current, supplier: event.target.value }))}><option value="">Chọn nhà cung cấp</option>{[...suppliers.values()].map((row) => <option key={row.id} value={row.id}>{recordLabel('master-data.party', row)}</option>)}</select></label>
        <label className="field"><span className="label">Kho nhận *</span><select className="select" required value={requisitionForm.warehouse} onChange={(event) => setRequisitionForm((current) => ({ ...current, warehouse: event.target.value }))}><option value="">Chọn kho</option>{[...warehouses.values()].filter((row) => row.active !== false).map((row) => <option key={row.id} value={row.id}>{recordLabel('inventory.warehouse', row)}</option>)}</select></label>
        <label className="field"><span className="label">Người yêu cầu</span><input className="input" maxLength="160" value={requisitionForm.requested_by} onChange={(event) => setRequisitionForm((current) => ({ ...current, requested_by: event.target.value }))}/></label>
        <label className="field"><span className="label">Lý do / mục đích</span><input className="input" maxLength="500" value={requisitionForm.reason} onChange={(event) => setRequisitionForm((current) => ({ ...current, reason: event.target.value }))}/></label>
      </div><div className="row wrap" style={{ marginTop: 12 }}><strong>Danh sách hàng cần mua</strong><span className="grow"/><button className="btn btn-secondary btn-sm" type="button" disabled={!products.size} onClick={() => setRequisitionLines((current) => [...current, { product: [...products.keys()][0] || '', qty: '1' }])}>Thêm dòng</button></div>
      {requisitionLines.map((line, index) => <div className="row wrap" key={index} style={{ marginTop: 8 }}><select className="select" required aria-label={`Sản phẩm đề nghị dòng ${index + 1}`} value={line.product} onChange={(event) => setRequisitionLines((current) => current.map((item, row) => row === index ? { ...item, product: event.target.value } : item))}><option value="">Chọn hàng hóa</option>{[...products.values()].filter((row) => row.active !== false).map((row) => <option key={row.id} value={row.id}>{row.name}{row.sku ? ` · ${row.sku}` : ''}</option>)}</select><input className="input num" aria-label="Số lượng cần mua" type="number" min="0.000001" step="any" required value={line.qty} onChange={(event) => setRequisitionLines((current) => current.map((item, row) => row === index ? { ...item, qty: event.target.value } : item))} style={{ maxWidth: 150 }}/><span className="grow"/>{requisitionLines.length > 1 && <button className="btn btn-ghost btn-sm" type="button" aria-label="Xóa dòng đề nghị" onClick={() => setRequisitionLines((current) => current.filter((_, row) => row !== index))}>Bỏ</button>}</div>)}
      <div className="row" style={{ marginTop: 12 }}><span className="grow"/><button className="btn btn-primary" disabled={Boolean(busy) || !products.size || !warehouses.size}>{editingRequisitionId ? 'Lưu đề nghị nháp' : 'Tạo đề nghị nháp'}</button></div></form>
      </>}<div className="table-wrap" style={{ marginTop: 16 }}><table className="table"><thead><tr><th>Đề nghị</th><th>Người yêu cầu / lý do</th><th>Hàng / số lượng</th><th>Trạng thái / thao tác</th></tr></thead><tbody>{requisitions.map((row) => { const request = approvalByRequisition.get(row.id); const order = orderByRequisition.get(row.id); return <tr key={row.id}><td><strong>{suppliers.get(row.supplier)?.name || 'Đề nghị mua'}</strong><div className="small muted">Kho: {warehouses.get(row.warehouse)?.name || '—'} · {String(row.id).slice(0, 8)}</div>{order && <div className="small"><a href={`#/e/purchasing/purchase_order/${order.id}`}>Đơn mua nháp đã sinh · {String(order.id).slice(0, 8)}</a></div>}</td><td>{row.requested_by || '—'}<div className="small muted">{row.reason || 'Không có lý do'}</div></td><td>{(row.lines || []).map((line, index) => <div key={`${line.product}-${index}`} className="small">{products.get(line.product)?.name || 'Hàng hóa'} · {line.qty}</div>)}</td><td><span className={`badge ${row.status === 'approved' ? 'success' : row.status === 'rejected' ? 'danger' : 'warning'}`}>{statusLabel(row.status)}</span>{row.status === 'submitted' && workflowApproval && request && <div className="small"><a href={`#/e/workflow-approval/approval_request/${request.id}`}>Mở yêu cầu duyệt · {statusLabel(request.status)}</a></div>}<div className="row wrap">{['draft','rejected'].includes(row.status) && can('purchasing.purchase_requisition.update') && <button className="btn btn-ghost btn-sm" disabled={Boolean(busy)} onClick={() => editRequisition(row)}>Sửa</button>}{['draft','rejected'].includes(row.status) && can('purchasing.purchase_requisition.submitted') && <button className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => requisitionAction(row, 'submitted')}>Gửi duyệt</button>}{row.status === 'submitted' && !workflowApproval && can('purchasing.purchase_requisition.approved') && <><button className="btn btn-primary btn-sm" disabled={Boolean(busy)} onClick={() => requisitionAction(row, 'approved')}>Duyệt</button>{can('purchasing.purchase_requisition.rejected') && <button className="btn btn-ghost btn-sm" disabled={Boolean(busy)} onClick={() => requisitionAction(row, 'rejected')}>Từ chối</button>}</>}</div></td></tr>; })}{!requisitions.length && <tr><td colSpan="4" className="muted">Chưa có đề nghị mua nội bộ. Bạn cũng có thể sinh đề nghị từ màn bổ sung tồn kho.</td></tr>}</tbody></table></div>
    </section>}

    {can('purchasing.purchase_order.create') && <section className="card card-pad"><div className="row wrap"><h2>{editingId ? 'Sửa đơn mua nháp' : 'Lập đơn mua trực tiếp'}</h2><span className="grow"/>{editingId && <button className="btn btn-ghost btn-sm" type="button" onClick={() => { setEditingId(''); setLines([{ product: [...products.keys()][0] || '', qty: '1', price: '', tax: '' }]); }}>Thoát chỉnh sửa</button>}</div>
      <form onSubmit={saveOrder}><div className="form-grid"><label className="field"><span className="label">Nhà cung cấp *</span><select className="select" required value={orderForm.supplier} onChange={(e) => setOrderForm({ ...orderForm, supplier: e.target.value })}><option value="">Chọn nhà cung cấp</option>{[...suppliers.values()].map((row) => <option key={row.id} value={row.id}>{recordLabel('master-data.party', row)}</option>)}</select></label><label className="field"><span className="label">Kho nhận *</span><select className="select" required value={orderForm.warehouse} onChange={(e) => setOrderForm({ ...orderForm, warehouse: e.target.value })}><option value="">Chọn kho</option>{[...warehouses.values()].filter((row) => row.active !== false).map((row) => <option key={row.id} value={row.id}>{recordLabel('inventory.warehouse', row)}</option>)}</select></label><label className="field"><span className="label">Ngày giao dự kiến</span><input className="input" type="date" value={orderForm.expected_date} onChange={(e) => setOrderForm({ ...orderForm, expected_date: e.target.value })}/></label></div>
        <div className="row wrap" style={{ marginTop: 14 }}><strong>Vật tư / hàng hóa</strong><span className="grow"/><button className="btn btn-secondary btn-sm" type="button" disabled={!products.size} onClick={addLine}>Thêm dòng</button></div>
        {lines.map((line, index) => <div className="row wrap" key={index} style={{ marginTop: 8 }}><select className="select" required value={line.product} onChange={(e) => updateLine(index, 'product', e.target.value)}><option value="">Chọn hàng</option>{[...products.values()].filter((row) => row.active !== false).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select><input className="input num" aria-label="Số lượng đặt" type="number" min="0.000001" step="any" required value={line.qty} onChange={(e) => updateLine(index, 'qty', e.target.value)} style={{ maxWidth: 120 }}/><input className="input num" aria-label="Đơn giá mua" type="number" min="0.000001" step="any" required value={line.price} onChange={(e) => updateLine(index, 'price', e.target.value)} style={{ maxWidth: 160 }}/><select className="select" aria-label="Thuế" value={line.tax} onChange={(e) => updateLine(index, 'tax', e.target.value)}><option value="">Không thuế</option>{taxes.map((tax) => <option key={tax.id} value={tax.id}>{tax.name} · {tax.rate}%</option>)}</select><strong>{fmtMoney(lineValue(line, taxById))}</strong>{lines.length > 1 && <button className="btn btn-ghost btn-sm" type="button" aria-label="Xóa dòng" onClick={() => setLines((current) => current.filter((_, i) => i !== index))}>Bỏ</button>}</div>)}
        <div className="row wrap" style={{ marginTop: 12 }}><span className="grow"/><strong>Tổng dự kiến có thuế: {fmtMoney(orderLinesTotal)}</strong><button className="btn btn-primary" disabled={Boolean(busy) || !products.size || !warehouses.size || orderLinesTotal <= 0}>{editingId ? 'Lưu đơn mua nháp' : 'Tạo đơn mua nháp'}</button></div>
      </form>
    </section>}

    {loading ? <div className="skeleton" data-h="row"/> : !orders.length ? <div className="card card-pad empty" style={{ marginTop: 16 }}>Chưa có đơn mua. Tạo đơn mua nháp, gửi duyệt rồi nhận hàng theo số lượng thực tế.</div> : <div className="layout-split" style={{ marginTop: 16 }}>
      <section className="card card-pad"><h2>Đơn mua hàng</h2><div className="table-wrap"><table className="table"><thead><tr><th>Nhà cung cấp</th><th>Giao dự kiến</th><th>Tổng</th><th>Trạng thái</th></tr></thead><tbody>{orders.map((row) => <tr key={row.id} className={selectedId === row.id ? 'selected' : ''} onClick={() => setSelectedId(row.id)} style={{ cursor: 'pointer' }}><td><strong>{suppliers.has(row.supplier) ? recordLabel('master-data.party', suppliers.get(row.supplier)) : 'Nhà cung cấp'}</strong><div className="small muted">{row.source ? `Nguồn: ${row.source}` : String(row.id).slice(0, 8)}</div></td><td>{fmtDate(row.expected_date)}</td><td>{fmtMoney(row.total || 0)}</td><td>{statusLabel(row.status)}</td></tr>)}</tbody></table></div></section>
      {selected && <section className="card card-pad"><div className="row wrap"><div><h2>{suppliers.has(selected.supplier) ? recordLabel('master-data.party', suppliers.get(selected.supplier)) : 'Đơn mua hàng'}</h2><div className="small muted">Kho nhận: {warehouses.get(selected.warehouse)?.name || '—'} · Giao dự kiến: {fmtDate(selected.expected_date)}</div></div><span className="grow"/><span className="badge warning">{statusLabel(selected.status)}</span></div>
        <div className="table-wrap" style={{ marginTop: 12 }}><table className="table"><thead><tr><th>Hàng</th><th>Đặt</th><th>Đã nhận</th><th>Đơn giá</th><th>Thành tiền</th></tr></thead><tbody>{(selected.lines || []).map((line, index) => { const receivedQty = selectedReceipts.filter((receipt) => receipt.status === 'received').flatMap((receipt) => receipt.lines || []).filter((receiptLine) => keyOf(receiptLine) === keyOf(line)).reduce((sum, receiptLine) => sum + Number(receiptLine.qty || 0), 0); return <tr key={`${line.product}-${index}`}><td>{products.get(line.product)?.name || 'Hàng hóa'}</td><td>{line.qty}</td><td>{receivedQty}</td><td>{fmtMoney(line.price)}</td><td>{fmtMoney(line.line_total || Number(line.qty || 0) * Number(line.price || 0))}</td></tr>; })}</tbody><tfoot><tr><th colSpan="4">Tổng có thuế</th><th>{fmtMoney(selected.total || 0)}</th></tr></tfoot></table></div>
        {selected.status === 'submitted' && workflowApproval && approvalByOrder.get(selected.id) && <p className="small muted" style={{ marginTop: 10 }}>Yêu cầu phê duyệt: <a href={`#/e/workflow-approval/approval_request/${approvalByOrder.get(selected.id).id}`}>{statusLabel(approvalByOrder.get(selected.id).status)} · mở yêu cầu</a></p>}
        <div className="row wrap" style={{ marginTop: 12 }}>{['draft','rejected'].includes(selected.status) && can('purchasing.purchase_order.update') && <button className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => editOrder(selected)}>Sửa nháp</button>}{['draft','rejected'].includes(selected.status) && can('purchasing.purchase_order.submitted') && <button className="btn btn-primary btn-sm" disabled={Boolean(busy) || !(selected.lines || []).length || Number(selected.total) <= 0} onClick={() => submitOrder(selected)}>Gửi duyệt</button>}{selected.status === 'submitted' && !workflowApproval && can('purchasing.purchase_order.approved') && <button className="btn btn-primary btn-sm" disabled={Boolean(busy)} onClick={() => approveOrder(selected)}>Duyệt đơn</button>}{['draft','submitted','approved','rejected'].includes(selected.status) && !(approvalByOrder.get(selected.id)?.status === 'pending') && can('purchasing.purchase_order.cancelled') && <button className="btn btn-ghost btn-sm" disabled={Boolean(busy)} onClick={() => orderAction(selected, 'cancelled')}>Hủy đơn</button>}{canReceive(selected) && <button className="btn btn-primary btn-sm" disabled={Boolean(busy)} onClick={() => prepareReceipt(selected)}>Nhận hàng</button>}{billByOrder.has(selected.id) && <a className="btn btn-secondary btn-sm" href={`#/e/accounting/bill/${billByOrder.get(selected.id).id}`}>Mở hóa đơn {statusLabel(billByOrder.get(selected.id).status)}</a>}</div>
        {selected.status === 'received' && !billByOrder.has(selected.id) && !supplierInvoiceByOrder.has(selected.id) && can('purchasing.supplier_invoice.create') && <form className="card card-pad" style={{ marginTop: 14 }} onSubmit={createSupplierInvoice}><h3>Ghi nhận hóa đơn nhà cung cấp</h3><p className="small muted">Chỉ lập sau khi nhận đủ hàng. Tổng tiền, thuế và dòng hàng được đối chiếu với đơn mua; duyệt sẽ ghi sổ công nợ phải trả.</p><div className="form-grid"><label className="field"><span className="label">Số hóa đơn nhà cung cấp *</span><input className="input" required value={supplierInvoiceForm.invoice_number} onChange={(e) => setSupplierInvoiceForm({ ...supplierInvoiceForm, invoice_number: e.target.value })}/></label><label className="field"><span className="label">Ngày hóa đơn *</span><input className="input" type="date" required value={supplierInvoiceForm.issue_date} onChange={(e) => setSupplierInvoiceForm({ ...supplierInvoiceForm, issue_date: e.target.value })}/></label><label className="field"><span className="label">Hạn thanh toán</span><input className="input" type="date" min={supplierInvoiceForm.issue_date} value={supplierInvoiceForm.due_date} onChange={(e) => setSupplierInvoiceForm({ ...supplierInvoiceForm, due_date: e.target.value })}/></label><div className="row"><span className="grow"/><button className="btn btn-secondary" disabled={Boolean(busy)}>Lưu hóa đơn nháp · {fmtMoney(selected.total || 0)}</button></div></div></form>}
        {supplierInvoiceByOrder.has(selected.id) && <div className="card card-pad" style={{ marginTop: 14 }}><h3>Hóa đơn nhà cung cấp · {supplierInvoiceByOrder.get(selected.id).invoice_number}</h3><p className="small muted">Ngày {fmtDate(supplierInvoiceByOrder.get(selected.id).issue_date)} · {fmtMoney(supplierInvoiceByOrder.get(selected.id).total)} · {statusLabel(supplierInvoiceByOrder.get(selected.id).status)}</p>{supplierInvoiceByOrder.get(selected.id).status === 'draft' && can('purchasing.supplier_invoice.approved') && <button className="btn btn-primary btn-sm" disabled={Boolean(busy)} onClick={() => run(`${selected.id}:invoice-approved`, () => action('purchasing.supplier_invoice', supplierInvoiceByOrder.get(selected.id), 'approved'), 'Đã duyệt hóa đơn nhà cung cấp và ghi sổ công nợ phải trả.')}>Duyệt và ghi sổ phải trả</button>}{billByOrder.has(selected.id) && <a className="btn btn-secondary btn-sm" style={{ marginLeft: 8 }} href={`#/e/accounting/bill/${billByOrder.get(selected.id).id}`}>Mở hóa đơn kế toán</a>}</div>}
        {receiptOrderId === selected.id && <form className="card card-pad" style={{ marginTop: 14 }} onSubmit={receiveGoods}><div className="row wrap"><h3>Phiếu nhận hàng</h3><span className="grow"/><button className="btn btn-ghost btn-sm" type="button" onClick={() => setReceiptOrderId('')}>Đóng</button></div><p className="small muted">Nhập số lượng thực nhận. Kho được khóa theo đơn mua; số lượng không được vượt phần còn lại.</p>{receiptLines.map((line, index) => <div className="row wrap" key={line.key}><strong className="grow">{products.get(line.product)?.name || 'Hàng hóa'} · còn {line.qty}</strong><input className="input num" aria-label="Số lượng thực nhận" type="number" min="0" max={line.qty} step="any" required value={line.received ?? line.qty} onChange={(e) => setReceiptLines((current) => current.map((item, i) => i === index ? { ...item, received: e.target.value } : item))} style={{ maxWidth: 150}}/></div>)}<label className="field" style={{ marginTop: 10 }}><span className="label">Ghi chú nhận hàng</span><textarea className="input" rows="2" value={receiptNote} onChange={(e) => setReceiptNote(e.target.value)}/></label><div className="row"><span className="grow"/><button className="btn btn-primary" disabled={Boolean(busy)}>Ghi nhận vào kho</button></div></form>}
        {selectedReceipts.length > 0 && <div className="table-wrap" style={{ marginTop: 14 }}><h3>Lịch sử nhận hàng</h3><table className="table"><thead><tr><th>Ngày</th><th>Tổng phiếu</th><th>Trạng thái</th></tr></thead><tbody>{selectedReceipts.map((row) => <tr key={row.id}><td>{fmtDate(row.created_at)}</td><td>{fmtMoney(row.total || 0)}</td><td>{statusLabel(row.status)}</td></tr>)}</tbody></table></div>}
        <p className="small muted" style={{ marginTop: 12 }}>Phiếu nhận cộng tồn kho theo số lượng thực nhận. Khi đơn đã nhận đủ, ghi số hóa đơn nhà cung cấp riêng; chỉ duyệt hóa đơn sau khi đối chiếu hồ sơ mua hàng.</p>
      </section>}
    </div>}
  </div>;
}
