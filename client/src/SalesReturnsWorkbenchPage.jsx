import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api, dataPath } from './lib/api.js';
import { fmtDate, fmtMoney, statusLabel } from './lib/i18n.js';
import { app, can, loadRefs, recordLabel, loadAllResponse } from './lib/state.js';
import { recordHref } from './lib/routes.js';

const itemsOf = (response) => Array.isArray(response?.items) ? response.items : [];
const action = (entity, row, verb) => api(dataPath(entity, row.id, verb), { method: 'POST' });

export default function SalesReturnsWorkbenchPage() {
  const [orders, setOrders] = useState([]);
  const [returns, setReturns] = useState([]);
  const [products, setProducts] = useState(new Map());
  const [units, setUnits] = useState(new Map());
  const [parties, setParties] = useState(new Map());
  const [warehouses, setWarehouses] = useState(new Map());
  const [shipments, setShipments] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [creditNotes, setCreditNotes] = useState([]);
  const [approvalRequests, setApprovalRequests] = useState([]);
  const [orderId, setOrderId] = useState('');
  const [quantities, setQuantities] = useState({});
  const [reason, setReason] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const workflowApproval = app.meta?.modules?.some((module) => module.id === 'workflow-approval') || false;
  const logisticsEnabled = app.meta?.modules?.some((module) => module.id === 'logistics') || false;

  const load = useCallback(async (quiet = false) => {
    if (!quiet) { setLoading(true); setError(''); }
    try {
      const [orderRes, returnRes, productMap, unitMap, partyMap, warehouseMap, shipmentRes, invoiceRes, creditRes, approvalRes] = await Promise.all([
        can('sales.sales_order.read') ? api(`${dataPath('sales.sales_order')}?limit=2000`) : Promise.resolve({ items: [] }),
        can('sales.sales_return.read') ? api(`${dataPath('sales.sales_return')}?limit=2000`) : Promise.resolve({ items: [] }),
        can('master-data.product.read') ? loadRefs('master-data.product') : Promise.resolve(new Map()),
        can('master-data.uom.read') ? loadRefs('master-data.uom') : Promise.resolve(new Map()),
        can('master-data.party.read') ? loadRefs('master-data.party') : Promise.resolve(new Map()),
        can('inventory.warehouse.read') ? loadRefs('inventory.warehouse') : Promise.resolve(new Map()),
        logisticsEnabled && can('logistics.shipment.read') ? api(`${dataPath('logistics.shipment')}?limit=3000`) : Promise.resolve({ items: [] }),
        can('accounting.invoice.read') ? api(`${dataPath('accounting.invoice')}?limit=2000`) : Promise.resolve({ items: [] }),
        can('accounting.credit_note.read') ? api(`${dataPath('accounting.credit_note')}?limit=2000`) : Promise.resolve({ items: [] }),
        workflowApproval && can('workflow-approval.approval_request.read') ? loadAllResponse('workflow-approval.approval_request') : Promise.resolve({ items: [] }),
      ]);
      const orderRows = itemsOf(orderRes).sort((a, b) => String(b.order_date || '').localeCompare(String(a.order_date || '')));
      const returnRows = itemsOf(returnRes).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
      setOrders(orderRows); setReturns(returnRows); setProducts(productMap); setUnits(unitMap); setParties(partyMap); setWarehouses(warehouseMap);
      setShipments(itemsOf(shipmentRes)); setInvoices(itemsOf(invoiceRes)); setCreditNotes(itemsOf(creditRes)); setApprovalRequests(itemsOf(approvalRes));
      setOrderId((id) => orderRows.some((row) => row.id === id && ['confirmed','partially_delivered','delivered'].includes(row.status)) ? id : orderRows.find((row) => ['confirmed','partially_delivered','delivered'].includes(row.status))?.id || '');
      setSelectedId((id) => returnRows.some((row) => row.id === id) ? id : returnRows[0]?.id || '');
    } catch (reason) { setError(reason.message || 'Không tải được đơn bán và phiếu trả hàng.'); }
    finally { if (!quiet) setLoading(false); }
  }, [logisticsEnabled, workflowApproval]);

  useEffect(() => { document.title = 'Trả hàng bán · OSP Suite'; load(); }, [load]);
  const orderById = useMemo(() => new Map(orders.map((row) => [row.id, row])), [orders]);
  const returnableOrders = orders.filter((row) => ['confirmed','partially_delivered','delivered'].includes(row.status));
  const formOrder = orderById.get(orderId);
  const selected = returns.find((row) => row.id === selectedId);
  const selectedOrder = orderById.get(selected?.sales_order);
  const unitName = (line) => line.uom_name || units.get(line.uom)?.name || '';
  const stats = useMemo(() => ({ pending: returns.filter((row) => row.status === 'submitted').length, approved: returns.filter((row) => row.status === 'approved').length, received: returns.filter((row) => row.status === 'received').length, draft: returns.filter((row) => ['draft','rejected'].includes(row.status)).length }), [returns]);

  async function run(key, operation, success) {
    setBusy(key); setError(''); setNotice('');
    try { await operation(); setNotice(success); await load(true); }
    catch (reason) { setError(reason.message || 'Thao tác không thành công.'); await load(true); }
    finally { setBusy(''); }
  }

  function shipmentsFor(order) { return shipments.filter((shipment) => shipment.source === 'sales_order' && shipment.source_id === order.id); }
  function invoiceFor(order) { return order ? invoices.find((invoice) => invoice.source === 'sales_order' && invoice.source_id === order.id) : null; }
  function creditFor(row) { return creditNotes.find((credit) => credit.source === 'sales_return' && credit.source_id === row.id); }
  function approvalFor(row) { return approvalRequests.find((request) => request.entity === 'sales.sales_return' && request.record_id === row.id); }

  function eligibleLines(order) {
    const groups = new Map();
    for (const line of order?.lines || []) {
      const price = Number(line.price || 0);
      const uom = line.uom || '';
      const key = line.product + ':' + price.toFixed(2) + ':' + uom;
      const current = groups.get(key) || { key, product: line.product, price, uom: line.uom, uom_name: line.uom_name, uom_ratio: line.uom_ratio, ordered: 0, name: products.get(line.product)?.name || 'Item' };
      current.ordered += Number(line.qty || 0);
      groups.set(key, current);
    }
    const requiresDelivery = logisticsEnabled && Boolean(order?.shipping_address?.trim());
    return [...groups.values()].map((line) => {
      const delivered = requiresDelivery
        ? shipmentsFor(order).filter((shipment) => shipment.status === 'delivered').flatMap((shipment) => shipment.delivered_lines || shipment.lines || []).filter((item) => item.product === line.product && (item.uom || '') === (line.uom || '') && Math.abs(Number(item.price || 0) - line.price) <= .005).reduce((sum, item) => sum + Number(item.qty || 0), 0)
        : line.ordered;
      const reserved = returns.filter((row) => row.sales_order === order.id && ['submitted','approved','received'].includes(row.status)).flatMap((row) => row.lines || []).filter((item) => item.product === line.product && (item.uom || '') === (line.uom || '') && Math.abs(Number(item.price || 0) - line.price) <= .005).reduce((sum, item) => sum + Number(item.qty || 0), 0);
      return { ...line, delivered: Math.min(line.ordered, delivered), remaining: Math.max(0, Math.min(line.ordered, delivered) - reserved) };
    }).filter((line) => line.remaining > .000001);
  }

  const eligible = formOrder ? eligibleLines(formOrder) : [];
  const selectedInvoice = formOrder ? invoiceFor(formOrder) : null;
  const returnedTotal = selected ? (selected.lines || []).reduce((sum, line) => sum + Number(line.line_total ?? Number(line.price || 0) * Number(line.qty || 0)), 0) : 0;

  async function createReturn(event) {
    event.preventDefault(); if (!formOrder) return;
    const lines = eligible.map((line) => ({ product: line.product, uom: line.uom || undefined, price: line.price, qty: Number(quantities[line.key]) || 0 })).filter((line) => line.qty > 0);
    if (!lines.length || !reason.trim()) { setError('Nhập số lượng trả và lý do cho ít nhất một mặt hàng.'); return; }
    await run('return:create', async () => {
      const row = await api(dataPath('sales.sales_return'), { method: 'POST', body: { sales_order: formOrder.id, warehouse: formOrder.warehouse || undefined, lines, reason: reason.trim() } });
      setSelectedId(row.id); setReason(''); setQuantities({});
      await action('sales.sales_return', row, 'submitted');
    }, 'Đã lập và gửi duyệt phiếu trả. Số lượng được đối chiếu với hàng đã giao và các phiếu đang xử lý.');
  }

  async function transition(row, verb) {
    const messages = { submitted: 'Đã gửi phiếu trả duyệt.', approved: 'Đã duyệt phiếu trả; kho có thể tiếp nhận hàng.', rejected: 'Đã từ chối phiếu trả.', received: 'Đã nhập lại hàng và tạo credit note để điều chỉnh công nợ khách hàng.', cancelled: 'Đã hủy phiếu trả nháp.' };
    await run(`${row.id}:${verb}`, () => action('sales.sales_return', row, verb), messages[verb]);
  }

  async function decideApproval(request, verb) {
    await run(`${request.id}:${verb}`, () => action('workflow-approval.approval_request', request, verb), verb === 'approved' ? 'Đã duyệt phiếu trả.' : 'Đã từ chối phiếu trả.');
  }

  return <div className="page">
    <div className="page-head"><div><h1>Trả hàng và điều chỉnh doanh thu</h1><p className="sub">Chỉ nhận trả trên số lượng đủ điều kiện, phê duyệt trước khi nhập kho và tạo credit note theo hóa đơn gốc.</p></div><button className="btn btn-secondary" type="button" disabled={loading || Boolean(busy)} onClick={() => load()}>Làm mới</button></div>
    {error && <div className="alert danger" role="alert">{error}</div>}{notice && <div className="alert success" role="status">{notice}</div>}
    <div className="stats" style={{ marginBottom: 16 }}><div className="card stat"><span className="stat-label">Nháp / bị từ chối</span><strong className="stat-value">{stats.draft}</strong></div><div className="card stat"><span className="stat-label">Chờ duyệt</span><strong className="stat-value">{stats.pending}</strong></div><div className="card stat"><span className="stat-label">Đã duyệt / chờ nhận</span><strong className="stat-value">{stats.approved}</strong></div><div className="card stat"><span className="stat-label">Đã nhập và điều chỉnh</span><strong className="stat-value">{stats.received}</strong></div></div>

    {can('sales.sales_return.create') && <section className="card card-pad"><h2>Lập phiếu trả hàng</h2><form onSubmit={createReturn}><label className="field"><span className="label">Đơn bán nguồn *</span><select className="select" required value={orderId} onChange={(event) => { setOrderId(event.target.value); setQuantities({}); }}><option value="">Chọn đơn đã xác nhận</option>{returnableOrders.map((order) => <option key={order.id} value={order.id}>{order.number || String(order.id).slice(0, 8)} · {parties.get(order.party) ? recordLabel('master-data.party', parties.get(order.party)) : 'Khách hàng'} · {statusLabel(order.status)}</option>)}</select></label>
      {formOrder && <><div className="small muted" style={{ marginTop: 8 }}>Kho nhận hàng trả: {warehouses.get(formOrder.warehouse)?.name || 'Kho của đơn bán'} · Hóa đơn gốc: {selectedInvoice ? `${selectedInvoice.number || String(selectedInvoice.id).slice(0, 8)} (${statusLabel(selectedInvoice.status)})` : 'chưa có'}</div>
        {eligible.length ? <div className="table-wrap" style={{ marginTop: 12 }}><table className="table"><thead><tr><th>Mặt hàng</th><th>Đã giao</th><th>Còn đủ điều kiện trả</th><th>Giá bán</th><th>Số lượng trả</th></tr></thead><tbody>{eligible.map((line) => <tr key={line.key}><td>{line.name}</td><td>{line.delivered} {unitName(line)}</td><td>{line.remaining} {unitName(line)}</td><td>{fmtMoney(line.price)}</td><td><input className="input num" aria-label={`Số lượng trả ${line.name}`} type="number" min="0" max={line.remaining} step="any" value={quantities[line.key] || ''} onChange={(event) => setQuantities((current) => ({ ...current, [line.key]: event.target.value }))} style={{ maxWidth: 150 }}/></td></tr>)}</tbody></table></div> : <p className="small muted" style={{ marginTop: 10 }}>Không còn số lượng đủ điều kiện trả. Đơn có giao vận chỉ tính những mặt hàng đã giao thành công.</p>}
        <label className="field" style={{ marginTop: 10 }}><span className="label">Lý do trả hàng *</span><textarea className="input" required rows="2" value={reason} onChange={(event) => setReason(event.target.value)}/></label>
      </>}
      <div className="row" style={{ marginTop: 10 }}><span className="grow"/><button className="btn btn-primary" disabled={Boolean(busy) || !eligible.some((line) => Number(quantities[line.key]) > 0) || !reason.trim() || !selectedInvoice}>Lập và gửi duyệt</button></div>
      {formOrder && !selectedInvoice && <p className="small muted">Cần có hóa đơn gốc cho đơn bán trước khi nhập trả hàng để kế toán lập credit note chính xác.</p>}
    </form></section>}

    <div className="layout-split" style={{ marginTop: 16 }}>
      <section className="card card-pad"><h2>Phiếu trả hàng</h2>{loading ? <div className="skeleton" data-h="row"/> : !returns.length ? <div className="empty">Chưa có phiếu trả hàng.</div> : <div className="table-wrap"><table className="table"><thead><tr><th>Đơn / khách hàng</th><th>Lý do</th><th>Tổng giảm</th><th>Trạng thái</th></tr></thead><tbody>{returns.map((row) => { const order = orderById.get(row.sales_order); return <tr key={row.id} className={row.id === selectedId ? 'selected' : ''} onClick={() => setSelectedId(row.id)} style={{ cursor: 'pointer' }}><td><strong>{order ? recordLabel('master-data.party', parties.get(order.party)) : 'Khách hàng'}</strong><div className="small muted">Đơn {String(row.sales_order || '').slice(0, 8)}</div></td><td>{row.reason || '—'}</td><td>{fmtMoney(row.total || 0)}</td><td>{statusLabel(row.status)}</td></tr>; })}</tbody></table></div>}</section>
      {selected && <section className="card card-pad"><div className="row wrap"><div><h2>Phiếu trả {String(selected.id).slice(0, 8)}</h2><div className="small muted">Đơn bán {selectedOrder?.number || String(selected.sales_order).slice(0, 8)} · {selected.reason}</div></div><span className="grow"/><span className="badge warning">{statusLabel(selected.status)}</span></div>
        <div className="table-wrap" style={{ marginTop: 12 }}><table className="table"><thead><tr><th>Mặt hàng</th><th>Số lượng</th><th>Đơn giá</th><th>Giảm trừ</th></tr></thead><tbody>{(selected.lines || []).map((line, index) => <tr key={`${line.product}-${index}`}><td>{products.get(line.product)?.name || 'Mặt hàng'}</td><td>{line.qty} {unitName(line)}</td><td>{fmtMoney(line.price || 0)}</td><td>{fmtMoney(line.line_total ?? Number(line.qty || 0) * Number(line.price || 0))}</td></tr>)}</tbody><tfoot><tr><th colSpan="3">Tổng credit note dự kiến</th><th>{fmtMoney(selected.total || returnedTotal)}</th></tr></tfoot></table></div>
        {selected.status === 'submitted' && workflowApproval && approvalFor(selected) && <p className="small muted" style={{ marginTop: 10 }}>Yêu cầu duyệt: <a href={recordHref('workflow-approval.approval_request', approvalFor(selected).id)}>{statusLabel(approvalFor(selected).status)} · mở yêu cầu</a></p>}
        <div className="row wrap" style={{ marginTop: 12 }}>{selected.status === 'submitted' && !workflowApproval && can('sales.sales_return.approved') && <><button className="btn btn-primary btn-sm" disabled={Boolean(busy)} onClick={() => transition(selected, 'approved')}>Duyệt</button>{can('sales.sales_return.rejected') && <button className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => transition(selected, 'rejected')}>Từ chối</button>}</>}{selected.status === 'approved' && can('sales.sales_return.received') && <button className="btn btn-primary btn-sm" disabled={Boolean(busy) || !invoiceFor(selectedOrder)} onClick={() => transition(selected, 'received')}>Nhận hàng và nhập kho</button>}{['draft','rejected'].includes(selected.status) && can('sales.sales_return.submitted') && <><a className="small" href={recordHref('sales.sales_return', selected.id)}>Mở phiếu</a><button className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => transition(selected, 'submitted')}>Gửi duyệt lại</button></>}{creditFor(selected) && <a className="btn btn-secondary btn-sm" href={recordHref('accounting.credit_note', creditFor(selected).id)}>Mở credit note · {statusLabel(creditFor(selected).status)}</a>}<a className="btn btn-ghost btn-sm" href={recordHref('sales.sales_order', selected.sales_order)}>Mở đơn bán</a></div>
        {selected.status === 'approved' && !invoiceFor(orderById.get(selected.sales_order)) && <p className="small muted" style={{ marginTop: 10 }}>Chưa có hóa đơn gốc; chưa thể nhận trả vì hệ thống cần lập credit note từ chứng từ bán đã ghi nhận.</p>}
      </section>}
    </div>
    <p className="small muted" style={{ marginTop: 12 }}>Khi nhận trả, hàng hóa đủ điều kiện được nhập lại kho và hệ thống tạo credit note gắn với hóa đơn gốc. Nếu khách đã thanh toán, credit note thể hiện số dư hoàn lại; thanh toán hoàn tiền được thực hiện qua quy trình payment kế toán.</p>
  </div>;
}
