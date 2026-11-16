import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { selectableTableRowProps } from '../../lib/accessibility.js';
import { api, dataPath } from '../../lib/api.js';
import { fmtMoney, statusLabel, uiText } from '../../lib/i18n.js';
import { app, can, loadRefs, recordLabel, loadAllResponse } from '../../lib/state.js';
import { recordHref } from '../../lib/routes.js';

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
  const [returnInvoiceId, setReturnInvoiceId] = useState('');
  const [linkedInvoiceId, setLinkedInvoiceId] = useState('');
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
    } catch (reason) { setError(reason.message || uiText('Không tải được đơn bán và phiếu trả hàng.')); }
    finally { if (!quiet) setLoading(false); }
  }, [logisticsEnabled, workflowApproval]);

  useEffect(() => { document.title = `${uiText('Trả hàng bán')} · OSP Suite`; load(); }, [load]);
  const orderById = useMemo(() => new Map(orders.map((row) => [row.id, row])), [orders]);
  const returnableOrders = orders.filter((row) => ['confirmed','partially_delivered','delivered'].includes(row.status));
  const formOrder = orderById.get(orderId);
  const selected = returns.find((row) => row.id === selectedId);
  const selectedOrder = orderById.get(selected?.sales_order);
  const selectedReturnInvoices = selectedOrder ? invoicesFor(selectedOrder) : [];
  const unitName = (line) => line.uom_name || units.get(line.uom)?.name || '';
  const stats = useMemo(() => ({ pending: returns.filter((row) => row.status === 'submitted').length, approved: returns.filter((row) => row.status === 'approved').length, received: returns.filter((row) => row.status === 'received').length, draft: returns.filter((row) => ['draft','rejected'].includes(row.status)).length }), [returns]);

  async function run(key, operation, success) {
    setBusy(key); setError(''); setNotice('');
    try { await operation(); setNotice(success); await load(true); }
    catch (reason) { setError(reason.message || uiText('Thao tác không thành công.')); await load(true); }
    finally { setBusy(''); }
  }

  function shipmentsFor(order) { return shipments.filter((shipment) => shipment.source === 'sales_order' && shipment.source_id === order.id); }
  function invoicesFor(order) { return order ? invoices.filter((invoice) => invoice.source === 'sales_order' && invoice.source_id === order.id && ['posted', 'partially_paid', 'partially_settled', 'paid', 'settled'].includes(invoice.status)) : []; }
  function invoiceFor(order, preferredId) {
    const candidates = invoicesFor(order);
    if (preferredId) return candidates.find((invoice) => invoice.id === preferredId) || null;
    return candidates.length === 1 ? candidates[0] : null;
  }
  function creditFor(row) { return creditNotes.find((credit) => credit.source === 'sales_return' && credit.source_id === row.id); }
  function approvalFor(row) { return approvalRequests.find((request) => request.entity === 'sales.sales_return' && request.record_id === row.id); }

  function eligibleLines(order) {
    const groups = new Map();
    for (const line of order?.lines || []) {
      const price = Number(line.price || 0);
      const uom = line.uom || '';
      const discount = Number(line.effective_discount_pct ?? line.discount_pct ?? 0);
      const tax = line.tax || '';
      const taxRate = Number(line.tax_rate || 0);
      const key = [line.product, price.toFixed(2), uom, discount.toFixed(6), tax, taxRate.toFixed(6)].join(':');
      const current = groups.get(key) || { key, product: line.product, price, uom: line.uom, uom_name: line.uom_name, uom_ratio: line.uom_ratio, discount_pct: discount, tax: line.tax ?? null, tax_rate: taxRate, ordered: 0, name: products.get(line.product)?.name || uiText('Mặt hàng') };
      current.ordered += Number(line.qty || 0);
      groups.set(key, current);
    }
    const requiresDelivery = logisticsEnabled && Boolean(order?.shipping_address?.trim());
    return [...groups.values()].map((line) => {
      const delivered = requiresDelivery
        ? shipmentsFor(order).filter((shipment) => shipment.status === 'delivered').flatMap((shipment) => shipment.delivered_lines || shipment.lines || []).filter((item) => item.product === line.product && (item.uom || '') === (line.uom || '') && Math.abs(Number(item.price || 0) - line.price) <= .005 && Number(item.effective_discount_pct ?? item.discount_pct ?? 0) === line.discount_pct && (item.tax || '') === (line.tax || '') && Number(item.tax_rate || 0) === line.tax_rate).reduce((sum, item) => sum + Number(item.qty || 0), 0)
        : line.ordered;
      const reserved = returns.filter((row) => row.sales_order === order.id && ['submitted','approved','received'].includes(row.status)).flatMap((row) => row.lines || []).filter((item) => item.product === line.product && (item.uom || '') === (line.uom || '') && Math.abs(Number(item.price || 0) - line.price) <= .005 && Number(item.discount_pct || 0) === line.discount_pct && (item.tax || '') === (line.tax || '') && Number(item.tax_rate || 0) === line.tax_rate).reduce((sum, item) => sum + Number(item.qty || 0), 0);
      return { ...line, delivered: Math.min(line.ordered, delivered), remaining: Math.max(0, Math.min(line.ordered, delivered) - reserved) };
    }).filter((line) => line.remaining > .000001);
  }

  const eligible = formOrder ? eligibleLines(formOrder) : [];
  const formInvoices = formOrder ? invoicesFor(formOrder) : [];
  const selectedInvoice = formOrder ? invoiceFor(formOrder, returnInvoiceId) : null;
  const linkedInvoice = selected ? invoiceFor(selectedOrder, selected.invoice || linkedInvoiceId) : null;
  const returnedTotal = selected ? (selected.lines || []).reduce((sum, line) => sum + Number(line.line_total ?? Number(line.price || 0) * Number(line.qty || 0)), 0) : 0;

  useEffect(() => {
    setReturnInvoiceId((current) => formInvoices.some((invoice) => invoice.id === current) ? current : formInvoices.length === 1 ? formInvoices[0].id : '');
  }, [orderId, invoices]);
  useEffect(() => {
    setLinkedInvoiceId(selected?.invoice || (selectedOrder && invoicesFor(selectedOrder).length === 1 ? invoicesFor(selectedOrder)[0].id : ''));
  }, [selectedId, selected?.invoice, invoices]);

  async function createReturn(event) {
    event.preventDefault(); if (!formOrder) return;
    if (!selectedInvoice) { setError(uiText('Chọn một hóa đơn đã ghi sổ của đơn bán trước khi gửi duyệt phiếu trả.')); return; }
    const lines = eligible.map((line) => ({ product: line.product, uom: line.uom || undefined, price: line.price, qty: Number(quantities[line.key]) || 0, discount_pct: line.discount_pct, tax: line.tax, tax_rate: line.tax_rate })).filter((line) => line.qty > 0);
    if (!lines.length || !reason.trim()) { setError(uiText('Nhập số lượng trả và lý do cho ít nhất một mặt hàng.')); return; }
    await run('return:create', async () => {
      const row = await api(dataPath('sales.sales_return'), { method: 'POST', body: { sales_order: formOrder.id, invoice: selectedInvoice.id, warehouse: formOrder.warehouse || undefined, lines, reason: reason.trim() } });
      setSelectedId(row.id); setReason(''); setQuantities({});
      await action('sales.sales_return', row, 'submitted');
    }, uiText('Đã lập và gửi duyệt phiếu trả. Số lượng được đối chiếu với hàng đã giao và các phiếu đang xử lý.'));
  }

  async function transition(row, verb) {
    const messages = { submitted: uiText('Đã gửi phiếu trả duyệt.'), approved: uiText('Đã duyệt phiếu trả; kho có thể tiếp nhận hàng.'), rejected: uiText('Đã từ chối phiếu trả.'), received: uiText('Đã nhập lại hàng và tạo credit note để điều chỉnh công nợ khách hàng.'), cancelled: uiText('Đã hủy phiếu trả.') };
    await run(`${row.id}:${verb}`, () => action('sales.sales_return', row, verb), messages[verb]);
  }

  async function assignReturnInvoice(row) {
    if (!linkedInvoiceId) return;
    await run(`${row.id}:invoice`, () => api(dataPath('sales.sales_return', row.id), { method: 'PATCH', body: { invoice: linkedInvoiceId } }), uiText('Đã gắn hóa đơn gốc vào phiếu trả.'));
  }

  async function decideApproval(request, verb) {
    await run(`${request.id}:${verb}`, () => action('workflow-approval.approval_request', request, verb), uiText(verb === 'approved' ? 'Đã duyệt phiếu trả.' : 'Đã từ chối phiếu trả.'));
  }

  return <div className="page">
    <div className="page-head"><div><h1>{uiText('Trả hàng và điều chỉnh doanh thu')}</h1><p className="sub">{uiText('Chỉ nhận trả trên số lượng đủ điều kiện, phê duyệt trước khi nhập kho và tạo credit note theo hóa đơn gốc.')}</p></div><button className="btn btn-secondary" type="button" disabled={loading || Boolean(busy)} onClick={() => load()}>{uiText('Làm mới')}</button></div>
    {error && <div className="alert danger" role="alert">{uiText(error)}</div>}{notice && <div className="alert success" role="status">{uiText(notice)}</div>}
    <div className="stats u-legacy-bf4a218e05" ><div className="card stat"><span className="stat-label">{uiText('Nháp / bị từ chối')}</span><strong className="stat-value">{stats.draft}</strong></div><div className="card stat"><span className="stat-label">{uiText('Chờ duyệt')}</span><strong className="stat-value">{stats.pending}</strong></div><div className="card stat"><span className="stat-label">{uiText('Đã duyệt / chờ nhận')}</span><strong className="stat-value">{stats.approved}</strong></div><div className="card stat"><span className="stat-label">{uiText('Đã nhập và điều chỉnh')}</span><strong className="stat-value">{stats.received}</strong></div></div>

    {can('sales.sales_return.create') && <section className="card card-pad"><h2>{uiText('Lập phiếu trả hàng')}</h2><form onSubmit={createReturn}><label className="field"><span className="label">{uiText('Đơn bán nguồn')} *</span><select className="select" required value={orderId} onChange={(event) => { setOrderId(event.target.value); setQuantities({}); }}><option value="">{uiText('Chọn đơn đã xác nhận')}</option>{returnableOrders.map((order) => <option key={order.id} value={order.id}>{order.number || String(order.id).slice(0, 8)} · {parties.get(order.party) ? recordLabel('master-data.party', parties.get(order.party)) : uiText('Khách hàng')} · {statusLabel(order.status)}</option>)}</select></label>
      {formOrder && <><div className="small muted u-legacy-43a97fe494" >{uiText('Kho nhận hàng trả')}: {warehouses.get(formOrder.warehouse)?.name || uiText('Kho của đơn bán')} · {uiText('Hóa đơn gốc')}: {selectedInvoice ? `${selectedInvoice.number || String(selectedInvoice.id).slice(0, 8)} (${statusLabel(selectedInvoice.status)})` : uiText('chưa chọn')}</div>
        {formInvoices.length > 1 && <label className="field u-legacy-df928149c5" ><span className="label">{uiText('Hóa đơn gốc cho credit note')} *</span><select className="select" required value={returnInvoiceId} onChange={(event) => setReturnInvoiceId(event.target.value)}><option value="">{uiText('Chọn hóa đơn đã ghi sổ')}</option>{formInvoices.map((invoice) => <option key={invoice.id} value={invoice.id}>{invoice.number || String(invoice.id).slice(0, 8)} · {statusLabel(invoice.status)} · {fmtMoney(invoice.total || 0)}</option>)}</select></label>}
        {eligible.length ? <div className="table-wrap u-legacy-0ee7f66ad9" ><table className="table"><thead><tr><th>{uiText('Mặt hàng')}</th><th>{uiText('Đã giao')}</th><th>{uiText('Còn đủ điều kiện trả')}</th><th>{uiText('Giá bán')}</th><th>{uiText('Số lượng trả')}</th></tr></thead><tbody>{eligible.map((line) => <tr key={line.key}><td>{line.name}</td><td>{line.delivered} {unitName(line)}</td><td>{line.remaining} {unitName(line)}</td><td>{fmtMoney(line.price)}</td><td><input className="input num u-legacy-5e96948257" aria-label={`${uiText('Số lượng trả')} ${line.name}`} type="number" min="0" max={line.remaining} step="any" value={quantities[line.key] || ''} onChange={(event) => setQuantities((current) => ({ ...current, [line.key]: event.target.value }))} /></td></tr>)}</tbody></table></div> : <p className="small muted u-legacy-df928149c5" >{uiText('Không còn số lượng đủ điều kiện trả. Đơn có giao vận chỉ tính những mặt hàng đã giao thành công.')}</p>}
        <label className="field u-legacy-df928149c5" ><span className="label">{uiText('Lý do trả hàng')} *</span><textarea className="input" required rows="2" value={reason} onChange={(event) => setReason(event.target.value)}/></label>
      </>}
      <div className="row u-legacy-df928149c5" ><span className="grow"/><button className="btn btn-primary" disabled={Boolean(busy) || !eligible.some((line) => Number(quantities[line.key]) > 0) || !reason.trim() || !selectedInvoice}>{uiText('Lập và gửi duyệt')}</button></div>
      {formOrder && !selectedInvoice && <p className="small muted">{uiText('Cần chọn hóa đơn đã ghi sổ của đơn bán trước khi gửi duyệt để credit note gắn đúng chứng từ.')}</p>}
    </form></section>}

    <div className="layout-split u-legacy-92c18f6bda" >
      <section className="card card-pad"><h2>{uiText('Phiếu trả hàng')}</h2>{loading ? <div className="skeleton" data-h="row"/> : !returns.length ? <div className="empty">{uiText('Chưa có phiếu trả hàng.')}</div> : <div className="table-wrap"><table className="table"><thead><tr><th>{uiText('Đơn / khách hàng')}</th><th>{uiText('Lý do')}</th><th>{uiText('Tổng giảm')}</th><th>{uiText('Trạng thái')}</th></tr></thead><tbody>{returns.map((row) => { const order = orderById.get(row.sales_order); return <tr {...selectableTableRowProps} key={row.id} aria-selected={row.id === selectedId} className={[row.id === selectedId ? 'selected' : '', 'u-legacy-9463ff4798'].filter(Boolean).join(' ')} onClick={() => setSelectedId(row.id)} ><td><strong>{order ? recordLabel('master-data.party', parties.get(order.party)) : uiText('Khách hàng')}</strong><div className="small muted">{uiText('Đơn')} {String(row.sales_order || '').slice(0, 8)}</div></td><td>{row.reason || '—'}</td><td>{fmtMoney(row.total || 0)}</td><td>{statusLabel(row.status)}</td></tr>; })}</tbody></table></div>}</section>
      {selected && <section className="card card-pad"><div className="row wrap"><div><h2>{uiText('Phiếu trả')} {String(selected.id).slice(0, 8)}</h2><div className="small muted">{uiText('Đơn bán')} {selectedOrder?.number || String(selected.sales_order).slice(0, 8)} · {selected.reason}</div><div className="small muted">{uiText('Hóa đơn gốc')}: {linkedInvoice ? `${linkedInvoice.number || String(linkedInvoice.id).slice(0, 8)} · ${statusLabel(linkedInvoice.status)}` : uiText('chưa chọn')}</div></div><span className="grow"/><span className="badge warning">{statusLabel(selected.status)}</span></div>
        <div className="table-wrap u-legacy-0ee7f66ad9" ><table className="table"><thead><tr><th>{uiText('Mặt hàng')}</th><th>{uiText('Số lượng')}</th><th>{uiText('Đơn giá')}</th><th>{uiText('Giảm trừ')}</th></tr></thead><tbody>{(selected.lines || []).map((line, index) => <tr key={`${line.product}-${index}`}><td>{products.get(line.product)?.name || uiText('Mặt hàng')}</td><td>{line.qty} {unitName(line)}</td><td>{fmtMoney(line.price || 0)}</td><td>{fmtMoney(line.line_total ?? Number(line.qty || 0) * Number(line.price || 0))}</td></tr>)}</tbody><tfoot><tr><th colSpan="3">{uiText('Tổng credit note dự kiến')}</th><th>{fmtMoney(selected.total || returnedTotal)}</th></tr></tfoot></table></div>
        {selected.status === 'submitted' && workflowApproval && approvalFor(selected) && <p className="small muted u-legacy-df928149c5" >{uiText('Yêu cầu duyệt')}: <a href={recordHref('workflow-approval.approval_request', approvalFor(selected).id)}>{statusLabel(approvalFor(selected).status)} · {uiText('mở yêu cầu')}</a></p>}
        {['submitted', 'approved'].includes(selected.status) && !selected.invoice && selectedReturnInvoices.length > 1 && can('sales.sales_return.update') && <div className="row wrap u-legacy-0ee7f66ad9" ><label className="field"><span className="label">{uiText('Hóa đơn gốc')} *</span><select className="select" value={linkedInvoiceId} onChange={(event) => setLinkedInvoiceId(event.target.value)}><option value="">{uiText('Chọn hóa đơn đã ghi sổ')}</option>{selectedReturnInvoices.map((invoice) => <option key={invoice.id} value={invoice.id}>{invoice.number || String(invoice.id).slice(0, 8)} · {statusLabel(invoice.status)} · {fmtMoney(invoice.total || 0)}</option>)}</select></label><button className="btn btn-secondary btn-sm" type="button" disabled={Boolean(busy) || !linkedInvoiceId} onClick={() => assignReturnInvoice(selected)}>{uiText('Gắn hóa đơn')}</button></div>}
        {selected.status === 'submitted' && !workflowApproval && can('sales.sales_return.approved') && <div className="row wrap u-legacy-0ee7f66ad9" ><button className="btn btn-primary btn-sm" disabled={Boolean(busy)} onClick={() => transition(selected, 'approved')}>{uiText('Duyệt')}</button>{can('sales.sales_return.rejected') && <button className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => transition(selected, 'rejected')}>{uiText('Từ chối')}</button>}</div>}
        {selected.status === 'approved' && <div className="row wrap u-legacy-0ee7f66ad9" >{can('sales.sales_return.received') && <button className="btn btn-primary btn-sm" disabled={Boolean(busy) || !linkedInvoice} onClick={() => transition(selected, 'received')}>{uiText('Nhận hàng và nhập kho')}</button>}{can('sales.sales_return.cancelled') && <button className="btn btn-ghost btn-sm" disabled={Boolean(busy)} onClick={() => transition(selected, 'cancelled')}>{uiText('Hủy phiếu')}</button>}{!linkedInvoice && <span className="small muted">{uiText('Cần chọn hóa đơn đã ghi sổ trước khi nhận trả.')}</span>}</div>}
        {['draft','rejected'].includes(selected.status) && <div className="row wrap u-legacy-0ee7f66ad9" ><a className="small" href={recordHref('sales.sales_return', selected.id)}>{uiText('Mở phiếu')}</a>{can('sales.sales_return.submitted') && <button className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => transition(selected, 'submitted')}>{uiText('Gửi duyệt lại')}</button>}{can('sales.sales_return.cancelled') && <button className="btn btn-ghost btn-sm" disabled={Boolean(busy)} onClick={() => transition(selected, 'cancelled')}>{uiText('Hủy phiếu')}</button>}</div>}
        <div className="row wrap u-legacy-0ee7f66ad9" >{creditFor(selected) && <a className="btn btn-secondary btn-sm" href={recordHref('accounting.credit_note', creditFor(selected).id)}>{uiText('Mở credit note')} · {statusLabel(creditFor(selected).status)}</a>}<a className="btn btn-ghost btn-sm" href={recordHref('sales.sales_order', selected.sales_order)}>{uiText('Mở đơn bán')}</a></div>
      </section>}
    </div>
    <p className="small muted u-legacy-0ee7f66ad9" >{uiText('Khi nhận trả, hàng hóa đủ điều kiện được nhập lại kho và hệ thống tạo credit note gắn với hóa đơn gốc. Nếu khách đã thanh toán, credit note thể hiện số dư hoàn lại; thanh toán hoàn tiền được thực hiện qua quy trình payment kế toán.')}</p>
  </div>;
}
