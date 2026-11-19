import React, { useEffect, useMemo, useState } from 'react';
import { useDocumentTitle } from '../../lib/useDocumentTitle.js';
import { selectableTableRowProps } from '../../lib/accessibility.js';
import { fmtMoney, statusLabel, uiText, uiTextWith } from '../../lib/i18n.js';
import { app, can, recordLabel } from '../../lib/state.js';
import { api, tenantPath } from '../../lib/api.js';
import { recordHref } from '../../lib/routes.js';
import { absDecimal, addDecimals, compareDecimals, multiplyDecimals, subtractDecimals, minDecimal, roundDecimal } from '../../lib/decimal.js';
import { useSalesReturnsData } from './hooks/useSalesReturnsData.js';
import { useSalesReturnsWorkflow } from './hooks/useSalesReturnsWorkflow.js';
import SalesReturnRegisterPanel from './components/SalesReturnRegisterPanel.jsx';
import wholesaleEnglish from './wholesale.en.js';
const t = (text) => uiTextWith(text, wholesaleEnglish);
const sameDecimal = (left, right) => compareDecimals(left ?? 0, right ?? 0) === 0;
const samePrice = (left, right) => compareDecimals(absDecimal(subtractDecimals(left ?? 0, right ?? 0)), '0.005') <= 0;
const positiveDecimal = (value) => { try { return compareDecimals(value || 0, 0) > 0; } catch { return false; } };
export default function SalesReturnsWorkbenchPage() {
  useDocumentTitle(`${uiText('Trả hàng bán')} · OSP Suite`);
  const workflowApproval = app.meta?.modules?.some((module) => module.id === 'workflow-approval') || false;
  const logisticsEnabled = app.meta?.modules?.some((module) => module.id === 'logistics') || false;
  const inventoryEnabled = app.meta?.modules?.some((module) => module.id === 'inventory') || false;
  const { orders, returns, products, units, parties, warehouses, shipments, invoices, creditNotes, approvalRequests, loading, error, setError, load } = useSalesReturnsData(logisticsEnabled, workflowApproval);
  const workflow = useSalesReturnsWorkflow({ orders, returns, invoices, load, setError });
  const [returnLots, setReturnLots] = useState([]);
  const [lotsLoading, setLotsLoading] = useState(false);
  const [lotSelections, setLotSelections] = useState({});
  const {
    orderId, quantities, returnInvoiceId, setReturnInvoiceId,
    linkedInvoiceId, setLinkedInvoiceId, reason, setReason, selectedId, setSelectedId,
    busy, notice, formOrder, formInvoices, selected, selectedOrder, selectedReturnInvoices,
    changeOrder, changeQuantity, createReturn, transition, assignReturnInvoice,
  } = workflow;
  useEffect(() => {
    if (!orderId || !inventoryEnabled || !can('sales.sales_return.create')) {
      setReturnLots([]);
      setLotsLoading(false);
      return undefined;
    }
    let active = true;
    setLotsLoading(true);
    api(`${tenantPath('/reports/sales/return-lots')}?order=${encodeURIComponent(orderId)}`)
      .then((response) => { if (active) setReturnLots(Array.isArray(response?.items) ? response.items : []); })
      .catch((reason) => { if (active) { setReturnLots([]); setError(reason.message || t('Không tải được lô hàng đã xuất cho đơn bán.')); } })
      .finally(() => { if (active) setLotsLoading(false); });
    return () => { active = false; };
  }, [orderId, inventoryEnabled, setError]);
  const orderById = useMemo(() => new Map(orders.map((row) => [row.id, row])), [orders]);
  const returnableOrders = orders.filter((row) => ['confirmed','partially_delivered','delivered'].includes(row.status));
  const unitName = (line) => line.uom_name || units.get(line.uom)?.name || '';
  const stats = useMemo(() => ({ pending: returns.filter((row) => row.status === 'submitted').length, approved: returns.filter((row) => row.status === 'approved').length, received: returns.filter((row) => row.status === 'received').length, draft: returns.filter((row) => ['draft','rejected'].includes(row.status)).length }), [returns]);
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
      const current = groups.get(key) || { key, product: line.product, price, uom: line.uom, uom_name: line.uom_name, uom_ratio: line.uom_ratio || 1, discount_pct: discount, tax: line.tax ?? null, tax_rate: taxRate, ordered: '0', lotTracked: products.get(line.product)?.lot_tracked === true, name: products.get(line.product)?.name || uiText('Mặt hàng') };
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
  const lotsByProduct = useMemo(() => {
    const grouped = new Map();
    for (const lot of returnLots) grouped.set(lot.product, [...(grouped.get(lot.product) || []), lot]);
    return grouped;
  }, [returnLots]);
  function lotSelectionValid(line) {
    if (!line.lotTracked || !positiveDecimal(quantities[line.key])) return true;
    const allocations = lotSelections[line.key] || [];
    if (!allocations.length || allocations.some((item) => !item.lot || !positiveDecimal(item.qty))) return false;
    const availableLots = lotsByProduct.get(line.product) || [];
    const allocationTotal = addDecimals(allocations.map((item) => item.qty));
    const requiredBase = multiplyDecimals([quantities[line.key], line.uom_ratio || 1]);
    if (!sameDecimal(allocationTotal, requiredBase)) return false;
    return allocations.every((item) => {
      const lot = availableLots.find((candidate) => candidate.lot === item.lot);
      const selectedOnProduct = eligible.filter((other) => other.product === line.product)
        .flatMap((other) => lotSelections[other.key] || [])
        .filter((other) => other.lot === item.lot)
        .reduce((sum, other) => addDecimals([sum, other.qty || 0]), '0');
      return lot && compareDecimals(selectedOnProduct, lot.availableQty) <= 0;
    });
  }
  function changeLot(lineKey, index, field, value) {
    setLotSelections((current) => ({ ...current, [lineKey]: (current[lineKey] || []).map((item, position) => position === index ? { ...item, [field]: value } : item) }));
  }
  function addLot(lineKey) { setLotSelections((current) => ({ ...current, [lineKey]: [...(current[lineKey] || []), { lot: '', qty: '' }] })); }
  function removeLot(lineKey, index) { setLotSelections((current) => ({ ...current, [lineKey]: (current[lineKey] || []).filter((_, position) => position !== index) })); }
  function changeReturnOrder(value) { setLotSelections({}); changeOrder(value); }

  const selectedInvoice = formOrder ? invoiceFor(formOrder, returnInvoiceId) : null;
  const hasReturnQuantity = eligible.some((line) => positiveDecimal(quantities[line.key]));
  const returnSubmitDisabled = !hasReturnQuantity || !reason.trim() || !selectedInvoice || lotsLoading || eligible.some((line) => !lotSelectionValid(line));
  const linkedInvoice = selected ? invoiceFor(selectedOrder, selected.invoice || linkedInvoiceId) : null;
  const returnedTotal = selected ? addDecimals((selected.lines || []).map((line) => line.line_total ?? multiplyDecimals([line.price || 0, line.qty || 0]))) : '0';
  const selectedHasLotAllocations = (selected?.lines || []).some((line) => Array.isArray(line.lot_allocations) && line.lot_allocations.length > 0);
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
      lotSelections={lotSelections}
      lotsByProduct={lotsByProduct}
      lotsLoading={lotsLoading}
      reason={reason}
      busy={busy}
      submitDisabled={returnSubmitDisabled}
      partyLabel={(partyId) => parties.has(partyId) ? recordLabel('master-data.party', parties.get(partyId)) : ''}
      unitName={unitName}
      fmtMoney={fmtMoney}
      statusLabel={statusLabel}
      onOrderChange={changeReturnOrder}
      onInvoiceChange={setReturnInvoiceId}
      onQuantityChange={changeQuantity}
      onLotChange={changeLot}
      onLotQuantityChange={(lineKey, index, value) => changeLot(lineKey, index, 'qty', value)}
      onAddLot={addLot}
      onRemoveLot={removeLot}
      onReasonChange={setReason}
      onSubmit={(event) => createReturn(event, { formOrder, selectedInvoice, eligible, lotSelections })}
      t={t}
    />}
    <div className="layout-split u-mt-16" >
      <section className="card card-pad"><h2>{uiText('Phiếu trả hàng')}</h2>{loading ? <div className="skeleton" data-h="row"/> : !returns.length ? <div className="empty">{uiText('Chưa có phiếu trả hàng.')}</div> : <div className="table-wrap"><table className="table"><thead><tr><th>{uiText('Đơn / khách hàng')}</th><th>{uiText('Lý do')}</th><th>{uiText('Tổng giảm')}</th><th>{uiText('Trạng thái')}</th></tr></thead><tbody>{returns.map((row) => { const order = orderById.get(row.sales_order); return <tr {...selectableTableRowProps} key={row.id} aria-selected={row.id === selectedId} className={[row.id === selectedId ? 'selected' : '', 'u-pointer'].filter(Boolean).join(' ')} onClick={() => setSelectedId(row.id)} ><td><strong>{order ? recordLabel('master-data.party', parties.get(order.party)) : uiText('Khách hàng')}</strong><div className="small muted">{uiText('Đơn')} {String(row.sales_order || '').slice(0, 8)}</div></td><td>{row.reason || '—'}</td><td>{fmtMoney(row.total || 0)}</td><td>{statusLabel(row.status)}</td></tr>; })}</tbody></table></div>}</section>
      {selected && <section className="card card-pad"><div className="row wrap"><div><h2>{uiText('Phiếu trả')} {String(selected.id).slice(0, 8)}</h2><div className="small muted">{uiText('Đơn bán')} {selectedOrder?.number || String(selected.sales_order).slice(0, 8)} · {selected.reason}</div><div className="small muted">{uiText('Hóa đơn gốc')}: {linkedInvoice ? `${linkedInvoice.number || String(linkedInvoice.id).slice(0, 8)} · ${statusLabel(linkedInvoice.status)}` : uiText('chưa chọn')}</div></div><span className="grow"/><span className="badge warning">{statusLabel(selected.status)}</span></div>
        <div className="table-wrap u-mt-12" ><table className="table"><thead><tr><th>{uiText('Mặt hàng')}</th><th>{uiText('Số lượng')}</th>{selectedHasLotAllocations && <th>{t('Lô hàng nhập lại')}</th>}<th>{uiText('Đơn giá')}</th><th>{uiText('Giảm trừ')}</th></tr></thead><tbody>{(selected.lines || []).map((line, index) => <tr key={`${line.product}-${index}`}><td>{products.get(line.product)?.name || uiText('Mặt hàng')}</td><td>{line.qty} {unitName(line)}</td>{selectedHasLotAllocations && <td>{(line.lot_allocations || []).map((allocation) => `${String(allocation.lot).slice(0, 8)}: ${allocation.qty}`).join(' · ') || '—'}</td>}<td>{fmtMoney(line.price || 0)}</td><td>{fmtMoney(line.line_total ?? multiplyDecimals([line.qty || 0, line.price || 0]))}</td></tr>)}</tbody><tfoot><tr><th colSpan={selectedHasLotAllocations ? 4 : 3}>{uiText('Tổng credit note dự kiến')}</th><th>{fmtMoney(selected.total || returnedTotal)}</th></tr></tfoot></table></div>
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
