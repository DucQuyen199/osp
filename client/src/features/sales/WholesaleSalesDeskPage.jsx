import React, { useEffect } from 'react';
import { useDocumentTitle } from '../../lib/useDocumentTitle.js';
import { localDate } from '../../lib/dates.js';
import { fmtDate, fmtMoney, statusLabel, uiTextWith } from '../../lib/i18n.js';
import { app, can, recordLabel } from '../../lib/state.js';
import { recordHref } from '../../lib/routes.js';
import { compareDecimals, multiplyDecimals } from '../../lib/decimal.js';
import QuotationComposer from './components/QuotationComposer.jsx';
import QuotationRegister from './components/QuotationRegister.jsx';
import { wholesalePrice } from './domain/wholesaleSelectors.js';
import wholesaleEnglish from './wholesale.en.js';
import { useWholesaleSalesData } from './hooks/useWholesaleSalesData.js';
import { useWholesaleSalesWorkflow } from './hooks/useWholesaleSalesWorkflow.js';
const today = localDate;
const t = (text) => uiTextWith(text, wholesaleEnglish);
export default function WholesaleSalesDeskPage() {
  useDocumentTitle(`${t('Bán hàng và báo giá')} · OSP Suite`);
  const emailQueueEnabled = app.meta?.modules?.some((module) => module.id === 'communication') || false;
  const logisticsEnabled = app.meta?.modules?.some((module) => module.id === 'logistics') || false;
  const accountingEnabled = app.meta?.modules?.some((module) => module.id === 'accounting') || false;
  const approvalEnabled = app.meta?.modules?.some((module) => module.id === 'workflow-approval') || false;
  const { parties, products, units, warehouses, priceLists, quotations, orders, shipments, invoices, returns, approvalRequests, creditNotes, loading, error, setError, load } = useWholesaleSalesData(logisticsEnabled, accountingEnabled, approvalEnabled);
  const workflow = useWholesaleSalesWorkflow({ load, emailQueueEnabled, logisticsEnabled, products, units, priceLists, orders, shipments, returns, setError, t });
  const {
    selectedUnits, setSelectedUnits, party, setParty, warehouse, setWarehouse, priceList, setPriceList,
    shippingAddress, setShippingAddress, validUntil, setValidUntil, note, setNote, quantities,
    returnQuantities, setReturnQuantities, returnReasons, setReturnReasons, shipmentQuantities, setShipmentQuantities,
    orderVoucherCodes, setOrderVoucherCodes, busy, notice, cart, selectedList, estimate, setQuantity,
    createQuote, transition, applyVoucher, eligibleReturnLines, remainingShipmentLines, createShipment,
    createReturn, decideApproval,
  } = workflow;
  useEffect(() => { const timer = window.setInterval(() => load(true), 20000); return () => window.clearInterval(timer); }, [load]);
  const activeProducts = [...products.values()].filter((product) => product.active !== false).sort((a, b) => String(a.name).localeCompare(String(b.name), 'vi'));
  const unitsFor = (product) => product?.uom ? [...units.values()].filter((unit) => unit.id === product.uom || unit.base_uom === product.uom) : [];
  const getPrice = (product, uomId) => wholesalePrice(product, uomId, selectedList, units);
  const orderForQuote = (quote) => orders.find((order) => order.source === 'quotation' && order.source_id === quote.id);
  const shipmentForOrder = (order) => shipments.filter((shipment) => shipment.source === 'sales_order' && shipment.source_id === order.id);
  const invoiceForOrder = (order) => invoices.find((invoice) => invoice.source === 'sales_order' && invoice.source_id === order.id);
  const expired = (quote) => quote.valid_until && quote.valid_until < today();
  const quotationCards = quotations.map((quote) => {
    const order = orderForQuote(quote);
    const isExpired = Boolean(expired(quote));
    return {
      id: quote.id,
      customerName: recordLabel('master-data.party', parties.get(quote.party)),
      meta: `${t('Báo giá')} ${String(quote.id).slice(0, 8)} · ${quote.valid_until ? `${t('hết hạn')} ${fmtDate(quote.valid_until)}` : t('không đặt ngày hết hạn')}`,
      badgeClass: isExpired ? 'danger' : quote.status === 'accepted' ? 'success' : 'warning',
      badgeText: isExpired && quote.status === 'sent' ? t('Quá hạn') : statusLabel(quote.status),
      expired: isExpired,
      lines: (quote.lines || []).map((line, index) => ({
        key: `${line.product}:${index}`,
        description: `${products.get(line.product)?.name || t('Mặt hàng')} × ${line.qty} ${line.uom_name || units.get(line.uom)?.name || ''}`,
        total: fmtMoney(line.line_total ?? multiplyDecimals([line.qty || 0, line.price || 0])),
      })),
      total: fmtMoney(quote.total || 0),
      href: recordHref('sales.quotation', quote.id),
      order: order ? { href: recordHref('sales.sales_order', order.id), idShort: String(order.id).slice(0, 8) } : null,
      actions: {
        busy: Boolean(busy),
        send: quote.status === 'draft' && can('sales.quotation.sent'),
        accept: quote.status === 'sent' && !isExpired && can('sales.quotation.accepted'),
        reject: quote.status === 'sent' && !isExpired && can('sales.quotation.rejected'),
        expire: quote.status === 'sent' && isExpired && can('sales.quotation.expired'),
        onSend: () => transition('sales.quotation', quote, 'sent'),
        onAccept: () => transition('sales.quotation', quote, 'accepted'),
        onReject: () => transition('sales.quotation', quote, 'rejected'),
        onExpire: () => transition('sales.quotation', quote, 'expired'),
      },
    };
  });
  return <div className="page wholesale-sales-page">
    <header className="page-head"><div><h1>{t('Bán hàng, báo giá và giao hàng')}</h1><p className="muted">{t('Lập báo giá theo khách hàng, chuyển báo giá được chấp nhận thành đơn, kiểm soát tín dụng và theo dõi giao hàng.')}</p></div><button className="btn" onClick={() => load()} disabled={loading}>{t('Làm mới')}</button></header>
    {error && <div className="alert error" role="alert">{t(error)}</div>}{notice && <div className="alert success" role="status">{t(notice)}</div>}
    {can('sales.quotation.create') && <QuotationComposer
      parties={parties} warehouses={warehouses} priceLists={priceLists} activeProducts={activeProducts}
      units={units} selectedUnits={selectedUnits} quantities={quantities} party={party}
      warehouse={warehouse} priceList={priceList} validUntil={validUntil}
      shippingAddress={shippingAddress} note={note} estimate={estimate} hasLines={cart.length > 0}
      saving={busy === 'create'} currentDate={today()}
      onPartyChange={setParty} onWarehouseChange={setWarehouse} onPriceListChange={setPriceList}
      onValidUntilChange={setValidUntil} onShippingAddressChange={setShippingAddress} onNoteChange={setNote}
      onUnitChange={(productId, unitId) => setSelectedUnits((current) => ({ ...current, [productId]: unitId }))}
      onQuantityChange={setQuantity} onSubmit={createQuote} getUnitsFor={unitsFor} getPrice={getPrice}
      recordLabel={recordLabel} formatMoney={fmtMoney} t={t}
    />}
    <QuotationRegister quotations={quotationCards} t={t} />
    <section className="wholesale-section"><header><h2>{t('Đơn bán và giao hàng')}</h2><a href="#/reports/logistics/delivery-board">{t('Mở bảng điều phối')}</a></header>
      <div className="wholesale-documents">{orders.map((order) => {
        const shipmentsForOrder = shipmentForOrder(order); const invoice = invoiceForOrder(order);
        return <article className="card wholesale-document" key={order.id}>
          <header><div><strong>{recordLabel('master-data.party', parties.get(order.party))}</strong><div className="small muted">{t('Đơn')} {String(order.id).slice(0, 8)} · {order.shipping_address || t('Bán trực tiếp')}</div></div><span className={`badge ${order.status === 'delivered' ? 'success' : order.status === 'cancelled' ? 'plain' : 'warning'}`}>{statusLabel(order.status)}</span></header>
          <ul>{(order.lines || []).map((line, index) => <li key={`${line.product}:${index}`}><span>{products.get(line.product)?.name || t('Mặt hàng')} × {line.qty} {line.uom_name || units.get(line.uom)?.name || ''}</span><strong className="num">{fmtMoney(line.line_total ?? multiplyDecimals([line.qty || 0, line.price || 0]))}</strong></li>)}</ul>
          <div className="wholesale-total"><span>{t('Tổng gồm thuế')}</span><strong className="num">{fmtMoney(order.total || 0)}</strong></div>
          {app.meta?.modules?.some((module) => module.id === 'loyalty') && order.status === 'draft' && can('sales.sales_order.update') && <div className="wholesale-related"><label className="field grow"><span className="label">{t('Voucher thành viên')}</span><input className="input" maxLength="80" autoCapitalize="characters" value={orderVoucherCodes[order.id] ?? order.voucher_code ?? ''} onChange={(event) => setOrderVoucherCodes((current) => ({ ...current, [order.id]: event.target.value.toUpperCase() }))}/></label><button className="btn" type="button" disabled={Boolean(busy)} onClick={() => applyVoucher(order)}>{t(order.voucher_code ? 'Cập nhật voucher' : 'Áp dụng voucher')}</button>{order.voucher_discount > 0 && <span className="small muted">{t('Giảm trước thuế')} {fmtMoney(order.voucher_discount)}</span>}</div>}
          {shipmentsForOrder.map((shipment) => <div className="wholesale-related" key={shipment.id}><span>{t('Chuyến giao')} · {statusLabel(shipment.status)}</span><a href={recordHref('logistics.shipment', shipment.id)}>{t('Mở')} {String(shipment.id).slice(0, 8)}</a></div>)}
          {app.meta?.modules?.some((module) => module.id === 'logistics') && can('logistics.shipment.read') && can('logistics.shipment.create') && order.shipping_address?.trim() && ['confirmed', 'partially_delivered'].includes(order.status) && <div className="wholesale-related wholesale-shipment-create">
            <div><strong>{t('Giao phần hàng còn lại')}</strong><div className="small muted">{t('Chỉ tính các vận đơn đang mở hoặc đã giao; vận đơn thất bại không giữ số lượng.')}</div></div>
            {remainingShipmentLines(order).length ? <div className="wholesale-shipment-lines">{remainingShipmentLines(order).map((line) => <label className="field" key={line.key}><span>{products.get(line.product)?.name || t('Mặt hàng')} · {t('còn')} {line.remaining} {line.uom_name || units.get(line.uom)?.name || ''}</span><input className="input num" aria-label={`${t('Số lượng giao')} ${products.get(line.product)?.name || line.product}`} type="number" min="0" max={line.remaining} step="any" value={shipmentQuantities[order.id]?.[line.key] || ''} onChange={(event) => setShipmentQuantities((current) => ({ ...current, [order.id]: { ...current[order.id], [line.key]: event.target.value } }))}/></label>)}<button className="btn btn-primary" type="button" disabled={Boolean(busy) || !remainingShipmentLines(order).some((line) => { try { return compareDecimals(shipmentQuantities[order.id]?.[line.key] || 0, 0) > 0; } catch { return false; } })} onClick={() => createShipment(order)}>{t('Tạo vận đơn đã chọn')}</button></div> : <span className="small muted">{t('Hàng đã được phân công hết. Muốn tách chuyến chưa xuất phát, mở vận đơn nháp và giảm số lượng trước khi điều phối.')}</span>}
          </div>}
          <footer>{order.status === 'draft' && can('sales.sales_order.confirmed') && <button className="btn btn-primary" disabled={!!busy} onClick={() => transition('sales.sales_order', order, 'confirmed')}>{t('Xác nhận đơn, giữ tồn và tạo hóa đơn')}</button>}
            {invoice && <a className="btn" href={recordHref('accounting.invoice', invoice.id)}>{t('Mở hóa đơn')}</a>}
            <a className="btn" href={recordHref('sales.sales_order', order.id)}>{t('Chi tiết đơn')}</a>
          </footer>
        </article>;
      })}{!orders.length && <div className="card-pad muted">{t('Chưa có đơn bán.')}</div>}</div>
    </section>
    {can('sales.sales_return.read') && <section className="wholesale-section"><header><h2>{t('Trả hàng và nhập lại kho')}</h2><span className="badge plain">{returns.length}</span></header>
      <div className="wholesale-documents">{orders.filter((order) => ['confirmed', 'partially_delivered', 'delivered'].includes(order.status)).map((order) => {
        const returnables = eligibleReturnLines(order);
        return <article className="card wholesale-document" key={`return-form:${order.id}`}>
          <header><div><strong>{recordLabel('master-data.party', parties.get(order.party))}</strong><div className="small muted">{t('Đơn')} {String(order.id).slice(0, 8)} · {order.shipping_address || t('Bán trực tiếp')}</div></div><a href={recordHref('sales.sales_order', order.id)}>{t('Chi tiết đơn')}</a></header>
          {returnables.length ? <>
            <div className="wholesale-return-lines">{returnables.map((line) => <label className="wholesale-return-line" key={line.key}><span>{line.name} · {t('đã giao')} {line.eligible} · {t('còn trả')} {line.remaining}</span><input className="input" type="number" min="0" max={line.remaining} step="any" aria-label={`${t('Số lượng trả')} ${line.name}`} value={returnQuantities[`${order.id}:${line.key}`] || ''} onChange={(event) => setReturnQuantities((current) => ({ ...current, [`${order.id}:${line.key}`]: event.target.value }))} /></label>)}</div>
            <label className="field"><span>{t('Lý do trả hàng')}</span><textarea className="input textarea" value={returnReasons[order.id] || ''} onChange={(event) => setReturnReasons((current) => ({ ...current, [order.id]: event.target.value }))} /></label>
            <button className="btn" disabled={!!busy || !returnables.some((line) => { try { return compareDecimals(returnQuantities[`${order.id}:${line.key}`] || 0, 0) > 0; } catch { return false; } }) || !returnReasons[order.id]?.trim()} onClick={() => createReturn(order)}>{t('Lập phiếu trả nháp')}</button>
          </> : <p className="small muted">{t('Chưa có số lượng đủ điều kiện trả. Đơn giao hàng chỉ nhận trả hàng đã giao thành công.')}</p>}
        </article>;
      })}{!orders.some((order) => ['confirmed', 'partially_delivered', 'delivered'].includes(order.status)) && <div className="card-pad muted">{t('Chưa có đơn đủ điều kiện trả hàng.')}</div>}</div>
    </section>}
    {can('sales.sales_return.read') && <section className="wholesale-section"><header><h2>{t('Phiếu trả và phê duyệt')}</h2><span className="badge plain">{returns.length}</span></header>
      <div className="wholesale-documents">{returns.map((record) => {
        const request = approvalRequests.find((item) => item.entity === 'sales.sales_return' && item.record_id === record.id && item.status === 'pending');
        const creditNote = creditNotes.find((item) => item.source === 'sales_return' && item.source_id === record.id);
        return <article className="card wholesale-document" key={record.id}>
          <header><div><strong>{t('Phiếu trả')} {String(record.id).slice(0, 8)}</strong><div className="small muted">{t('Đơn')} {String(record.sales_order).slice(0, 8)} · {record.reason || t('Không ghi lý do')}</div></div><span className={`badge ${record.status === 'received' ? 'success' : record.status === 'rejected' || record.status === 'cancelled' ? 'plain' : 'warning'}`}>{statusLabel(record.status)}</span></header>
          <ul>{(record.lines || []).map((line, index) => <li key={`${line.product}:${index}`}><span>{products.get(line.product)?.name || t('Mặt hàng')} × {line.qty}</span><strong className="num">{fmtMoney(line.line_total ?? multiplyDecimals([line.qty || 0, line.price || 0]))}</strong></li>)}</ul>
          <div className="wholesale-total"><span>{t('Giá trị giảm trừ')}</span><strong className="num">{fmtMoney(record.total || 0)}</strong></div>
          {request && <div className="wholesale-approval"><span>{t('Yêu cầu phê duyệt đang chờ')}</span>{can('workflow-approval.approval_request.approved') && <button className="btn btn-primary" disabled={!!busy} onClick={() => decideApproval(request, 'approved')}>{t('Duyệt')}</button>}{can('workflow-approval.approval_request.rejected') && <button className="btn" disabled={!!busy} onClick={() => decideApproval(request, 'rejected')}>{t('Từ chối')}</button>}</div>}
          <footer>{['draft', 'rejected'].includes(record.status) && can('sales.sales_return.submitted') && <button className="btn" disabled={!!busy} onClick={() => transition('sales.sales_return', record, 'submitted')}>{t('Gửi phê duyệt')}</button>}
            {record.status === 'approved' && can('sales.sales_return.received') && <button className="btn btn-primary" disabled={!!busy} onClick={() => transition('sales.sales_return', record, 'received')}>{t('Nhận hàng, nhập kho và lập credit note')}</button>}
            {creditNote && <a className="btn" href={recordHref('accounting.credit_note', creditNote.id)}>{t('Mở credit note')}</a>}
            <a className="btn" href={recordHref('sales.sales_return', record.id)}>{t('Chi tiết phiếu')}</a>
          </footer>
        </article>;
      })}{!returns.length && <div className="card-pad muted">{t('Chưa phát sinh phiếu trả hàng.')}</div>}</div>
    </section>}
  </div>;
}
