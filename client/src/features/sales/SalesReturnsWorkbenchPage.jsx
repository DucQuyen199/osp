import React, { useEffect, useMemo, useState } from 'react';
import { useDocumentTitle } from '../../lib/useDocumentTitle.js';
import { selectableTableRowProps } from '../../lib/accessibility.js';
import { api, dataPath } from '../../lib/api.js';
import { fmtMoney, statusLabel, uiText, uiTextWith } from '../../lib/i18n.js';
import { app, can, recordLabel } from '../../lib/state.js';
import { recordHref } from '../../lib/routes.js';
import { absDecimal, addDecimals, compareDecimals, multiplyDecimals, subtractDecimals, minDecimal, roundDecimal } from '../../lib/decimal.js';
import { useSalesReturnsData } from './hooks/useSalesReturnsData.js';
import SalesReturnRegisterPanel from './components/SalesReturnRegisterPanel.jsx';
import wholesaleEnglish from './wholesale.en.js';
const t = (text) => uiTextWith(text, wholesaleEnglish);
const action = (entity, row, verb) => api(dataPath(entity, row.id, verb), { method: 'POST' });
const sameDecimal = (left, right) => compareDecimals(left ?? 0, right ?? 0) === 0;
const samePrice = (left, right) => compareDecimals(absDecimal(subtractDecimals(left ?? 0, right ?? 0)), '0.005') <= 0;
const positiveDecimal = (value) => { try { return compareDecimals(value || 0, 0) > 0; } catch { return false; } };
export default function SalesReturnsWorkbenchPage() {
  useDocumentTitle(`${uiText('Trả hàng bán')} · OSP Suite`);
  const [orderId, setOrderId] = useState('');
  const [quantities, setQuantities] = useState({});
  const [returnInvoiceId, setReturnInvoiceId] = useState('');
  const [linkedInvoiceId, setLinkedInvoiceId] = useState('');
  const [reason, setReason] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const workflowApproval = app.meta?.modules?.some((module) => module.id === 'workflow-approval') || false;
  const logisticsEnabled = app.meta?.modules?.some((module) => module.id === 'logistics') || false;
  const { orders, returns, products, units, parties, warehouses, shipments, invoices, creditNotes, approvalRequests, loading, error, setError, load } = useSalesReturnsData(logisticsEnabled, workflowApproval);
  useEffect(() => {
    setOrderId((id) => orders.some((row) => row.id === id && ['confirmed','partially_delivered','delivered'].includes(row.status)) ? id : orders.find((row) => ['confirmed','partially_delivered','delivered'].includes(row.status))?.id || '');
    setSelectedId((id) => returns.some((row) => row.id === id) ? id : returns[0]?.id || '');
  }, [orders, returns]);
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
      const price = addDecimals([line.price || 0]);
      const uom = line.uom || '';
      const discount = addDecimals([line.effective_discount_pct ?? line.discount_pct ?? 0]);
      const tax = line.tax || '';
      const taxRate = addDecimals([line.tax_rate || 0]);
      const key = [line.product, roundDecimal(price, 2), uom, discount, tax, taxRate].join(':');
      const current = groups.get(key) || { key, product: line.product, price, uom: line.uom, uom_name: line.uom_name, uom_ratio: line.uom_ratio, discount_pct: discount, tax: line.tax ?? null, tax_rate: taxRate, ordered: '0', name: products.get(line.product)?.name || uiText('Mặt hàng') };
      current.ordered = addDecimals([current.ordered, line.qty || 0]);
      groups.set(key, current);
    }
    const requiresDelivery = logisticsEnabled && Boolean(order?.shipping_address?.trim());
    return [...groups.values()].map((line) => {
      const delivered = requiresDelivery
        ? shipmentsFor(order).filter((shipment) => shipment.status === 'delivered').flatMap((shipment) => shipment.delivered_lines || shipment.lines || []).filter((item) => item.product === line.product && (item.uom || '') === (line.uom || '') && samePrice(item.price, line.price) && sameDecimal(item.effective_discount_pct ?? item.discount_pct ?? 0, line.discount_pct) && (item.tax || '') === (line.tax || '') && sameDecimal(item.tax_rate || 0, line.tax_rate)).reduce((sum, item) => addDecimals([sum, item.qty || 0]), '0')
        : line.ordered;
      const reserved = returns.filter((row) => row.sales_order === order.id && ['submitted','approved','received'].includes(row.status)).flatMap((row) => row.lines || []).filter((item) => item.product === line.product && (item.uom || '') === (line.uom || '') && samePrice(item.price, line.price) && sameDecimal(item.discount_pct || 0, line.discount_pct) && (item.tax || '') === (line.tax || '') && sameDecimal(item.tax_rate || 0, line.tax_rate)).reduce((sum, item) => addDecimals([sum, item.qty || 0]), '0');
      const deliveredQuantity = minDecimal(line.ordered, delivered);
      const remainingQuantity = subtractDecimals(deliveredQuantity, reserved);
      return { ...line, delivered: deliveredQuantity, remaining: compareDecimals(remainingQuantity, 0) > 0 ? remainingQuantity : '0' };
    }).filter((line) => compareDecimals(line.remaining, '0.000001') > 0);
  }
  const eligible = formOrder ? eligibleLines(formOrder) : [];
  const formInvoices = formOrder ? invoicesFor(formOrder) : [];
  const selectedInvoice = formOrder ? invoiceFor(formOrder, returnInvoiceId) : null;
  const hasReturnQuantity = eligible.some((line) => positiveDecimal(quantities[line.key]));
  const returnSubmitDisabled = !hasReturnQuantity || !reason.trim() || !selectedInvoice;
  const linkedInvoice = selected ? invoiceFor(selectedOrder, selected.invoice || linkedInvoiceId) : null;
  const returnedTotal = selected ? addDecimals((selected.lines || []).map((line) => line.line_total ?? multiplyDecimals([line.price || 0, line.qty || 0]))) : '0';
  useEffect(() => {
    setReturnInvoiceId((current) => formInvoices.some((invoice) => invoice.id === current) ? current : formInvoices.length === 1 ? formInvoices[0].id : '');
  }, [orderId, invoices]);
  useEffect(() => {
    setLinkedInvoiceId(selected?.invoice || (selectedOrder && invoicesFor(selectedOrder).length === 1 ? invoicesFor(selectedOrder)[0].id : ''));
  }, [selectedId, selected?.invoice, invoices]);
  async function createReturn(event) {
    event.preventDefault(); if (!formOrder) return;
    if (!selectedInvoice) { setError(uiText('Chọn một hóa đơn đã ghi sổ của đơn bán trước khi gửi duyệt phiếu trả.')); return; }
    if (eligible.some((line) => positiveDecimal(quantities[line.key]) && compareDecimals(quantities[line.key], line.remaining) > 0)) { setError(uiText('Số lượng trả không được vượt số lượng còn đủ điều kiện trả.')); return; }
    const lines = eligible.map((line) => ({ product: line.product, uom: line.uom || undefined, price: String(line.price), qty: String(quantities[line.key] || '0'), discount_pct: String(line.discount_pct), tax: line.tax, tax_rate: String(line.tax_rate) })).filter((line) => positiveDecimal(line.qty));
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
    <div className="stats u-mb-16" ><div className="card stat"><span className="stat-label">{uiText('Nháp / bị từ chối')}</span><strong className="stat-value">{stats.draft}</strong></div><div className="card stat"><span className="stat-label">{uiText('Chờ duyệt')}</span><strong className="stat-value">{stats.pending}</strong></div><div className="card stat"><span className="stat-label">{uiText('Đã duyệt / chờ nhận')}</span><strong className="stat-value">{stats.approved}</strong></div><div className="card stat"><span className="stat-label">{uiText('Đã nhập và điều chỉnh')}</span><strong className="stat-value">{stats.received}</strong></div></div>
    {can('sales.sales_return.create') && <SalesReturnRegisterPanel
      returnableOrders={returnableOrders}
      orderId={orderId}
      formOrder={formOrder}
      warehouses={warehouses}
      selectedInvoice={selectedInvoice}
      returnInvoiceId={returnInvoiceId}
      formInvoices={formInvoices}
      showInvoiceSelector={formInvoices.length > 1}
      eligibleLines={eligible}
      quantities={quantities}
      reason={reason}
      busy={busy}
      submitDisabled={returnSubmitDisabled}
      partyLabel={(partyId) => parties.has(partyId) ? recordLabel('master-data.party', parties.get(partyId)) : ''}
      unitName={unitName}
      fmtMoney={fmtMoney}
      statusLabel={statusLabel}
      onOrderChange={(value) => { setOrderId(value); setQuantities({}); }}
      onInvoiceChange={setReturnInvoiceId}
      onQuantityChange={(key, value) => setQuantities((current) => ({ ...current, [key]: value }))}
      onReasonChange={setReason}
      onSubmit={createReturn}
      t={t}
    />}
    <div className="layout-split u-mt-16" >
      <section className="card card-pad"><h2>{uiText('Phiếu trả hàng')}</h2>{loading ? <div className="skeleton" data-h="row"/> : !returns.length ? <div className="empty">{uiText('Chưa có phiếu trả hàng.')}</div> : <div className="table-wrap"><table className="table"><thead><tr><th>{uiText('Đơn / khách hàng')}</th><th>{uiText('Lý do')}</th><th>{uiText('Tổng giảm')}</th><th>{uiText('Trạng thái')}</th></tr></thead><tbody>{returns.map((row) => { const order = orderById.get(row.sales_order); return <tr {...selectableTableRowProps} key={row.id} aria-selected={row.id === selectedId} className={[row.id === selectedId ? 'selected' : '', 'u-pointer'].filter(Boolean).join(' ')} onClick={() => setSelectedId(row.id)} ><td><strong>{order ? recordLabel('master-data.party', parties.get(order.party)) : uiText('Khách hàng')}</strong><div className="small muted">{uiText('Đơn')} {String(row.sales_order || '').slice(0, 8)}</div></td><td>{row.reason || '—'}</td><td>{fmtMoney(row.total || 0)}</td><td>{statusLabel(row.status)}</td></tr>; })}</tbody></table></div>}</section>
      {selected && <section className="card card-pad"><div className="row wrap"><div><h2>{uiText('Phiếu trả')} {String(selected.id).slice(0, 8)}</h2><div className="small muted">{uiText('Đơn bán')} {selectedOrder?.number || String(selected.sales_order).slice(0, 8)} · {selected.reason}</div><div className="small muted">{uiText('Hóa đơn gốc')}: {linkedInvoice ? `${linkedInvoice.number || String(linkedInvoice.id).slice(0, 8)} · ${statusLabel(linkedInvoice.status)}` : uiText('chưa chọn')}</div></div><span className="grow"/><span className="badge warning">{statusLabel(selected.status)}</span></div>
        <div className="table-wrap u-mt-12" ><table className="table"><thead><tr><th>{uiText('Mặt hàng')}</th><th>{uiText('Số lượng')}</th><th>{uiText('Đơn giá')}</th><th>{uiText('Giảm trừ')}</th></tr></thead><tbody>{(selected.lines || []).map((line, index) => <tr key={`${line.product}-${index}`}><td>{products.get(line.product)?.name || uiText('Mặt hàng')}</td><td>{line.qty} {unitName(line)}</td><td>{fmtMoney(line.price || 0)}</td><td>{fmtMoney(line.line_total ?? multiplyDecimals([line.qty || 0, line.price || 0]))}</td></tr>)}</tbody><tfoot><tr><th colSpan="3">{uiText('Tổng credit note dự kiến')}</th><th>{fmtMoney(selected.total || returnedTotal)}</th></tr></tfoot></table></div>
        {selected.status === 'submitted' && workflowApproval && approvalFor(selected) && <p className="small muted u-mt-10" >{uiText('Yêu cầu duyệt')}: <a href={recordHref('workflow-approval.approval_request', approvalFor(selected).id)}>{statusLabel(approvalFor(selected).status)} · {uiText('mở yêu cầu')}</a></p>}
        {['submitted', 'approved'].includes(selected.status) && !selected.invoice && selectedReturnInvoices.length > 1 && can('sales.sales_return.update') && <div className="row wrap u-mt-12" ><label className="field"><span className="label">{uiText('Hóa đơn gốc')} *</span><select className="select" value={linkedInvoiceId} onChange={(event) => setLinkedInvoiceId(event.target.value)}><option value="">{uiText('Chọn hóa đơn đã ghi sổ')}</option>{selectedReturnInvoices.map((invoice) => <option key={invoice.id} value={invoice.id}>{invoice.number || String(invoice.id).slice(0, 8)} · {statusLabel(invoice.status)} · {fmtMoney(invoice.total || 0)}</option>)}</select></label><button className="btn btn-secondary btn-sm" type="button" disabled={Boolean(busy) || !linkedInvoiceId} onClick={() => assignReturnInvoice(selected)}>{uiText('Gắn hóa đơn')}</button></div>}
        {selected.status === 'submitted' && !workflowApproval && can('sales.sales_return.approved') && <div className="row wrap u-mt-12" ><button className="btn btn-primary btn-sm" disabled={Boolean(busy)} onClick={() => transition(selected, 'approved')}>{uiText('Duyệt')}</button>{can('sales.sales_return.rejected') && <button className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => transition(selected, 'rejected')}>{uiText('Từ chối')}</button>}</div>}
        {selected.status === 'approved' && <div className="row wrap u-mt-12" >{can('sales.sales_return.received') && <button className="btn btn-primary btn-sm" disabled={Boolean(busy) || !linkedInvoice} onClick={() => transition(selected, 'received')}>{uiText('Nhận hàng và nhập kho')}</button>}{can('sales.sales_return.cancelled') && <button className="btn btn-ghost btn-sm" disabled={Boolean(busy)} onClick={() => transition(selected, 'cancelled')}>{uiText('Hủy phiếu')}</button>}{!linkedInvoice && <span className="small muted">{uiText('Cần chọn hóa đơn đã ghi sổ trước khi nhận trả.')}</span>}</div>}
        {['draft','rejected'].includes(selected.status) && <div className="row wrap u-mt-12" ><a className="small" href={recordHref('sales.sales_return', selected.id)}>{uiText('Mở phiếu')}</a>{can('sales.sales_return.submitted') && <button className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => transition(selected, 'submitted')}>{uiText('Gửi duyệt lại')}</button>}{can('sales.sales_return.cancelled') && <button className="btn btn-ghost btn-sm" disabled={Boolean(busy)} onClick={() => transition(selected, 'cancelled')}>{uiText('Hủy phiếu')}</button>}</div>}
        <div className="row wrap u-mt-12" >{creditFor(selected) && <a className="btn btn-secondary btn-sm" href={recordHref('accounting.credit_note', creditFor(selected).id)}>{uiText('Mở credit note')} · {statusLabel(creditFor(selected).status)}</a>}<a className="btn btn-ghost btn-sm" href={recordHref('sales.sales_order', selected.sales_order)}>{uiText('Mở đơn bán')}</a></div>
      </section>}
    </div>
    <p className="small muted u-mt-12" >{uiText('Khi nhận trả, hàng hóa đủ điều kiện được nhập lại kho và hệ thống tạo credit note gắn với hóa đơn gốc. Nếu khách đã thanh toán, credit note thể hiện số dư hoàn lại; thanh toán hoàn tiền được thực hiện qua quy trình payment kế toán.')}</p>
  </div>;
}
