import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useDocumentTitle } from '../../lib/useDocumentTitle.js';
import { localDate } from '../../lib/dates.js';
import { api, dataPath } from '../../lib/api.js';
import { fmtDate, fmtMoney, statusLabel, uiTextWith } from '../../lib/i18n.js';
import { app, can, loadRefs, recordLabel, loadAllResponse } from '../../lib/state.js';
import { recordHref } from '../../lib/routes.js';
import QuotationComposer from './components/QuotationComposer.jsx';
import wholesaleEnglish from './wholesale.en.js';
const itemsOf = (response) => Array.isArray(response?.items) ? response.items : [];
const today = localDate;
const t = (text) => uiTextWith(text, wholesaleEnglish);
export default function WholesaleSalesDeskPage() {
  useDocumentTitle(`${t('Bán hàng và báo giá')} · OSP Suite`);
  const emailQueueEnabled = app.meta?.modules?.some((module) => module.id === 'communication') || false;
  const [parties, setParties] = useState(new Map());
  const [products, setProducts] = useState(new Map());
  const [units, setUnits] = useState(new Map());
  const [selectedUnits, setSelectedUnits] = useState({});
  const [warehouses, setWarehouses] = useState(new Map());
  const [priceLists, setPriceLists] = useState([]);
  const [quotations, setQuotations] = useState([]);
  const [orders, setOrders] = useState([]);
  const [shipments, setShipments] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [returns, setReturns] = useState([]);
  const [approvalRequests, setApprovalRequests] = useState([]);
  const [creditNotes, setCreditNotes] = useState([]);
  const [party, setParty] = useState('');
  const [warehouse, setWarehouse] = useState('');
  const [priceList, setPriceList] = useState('');
  const [shippingAddress, setShippingAddress] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [note, setNote] = useState('');
  const [quantities, setQuantities] = useState({});
  const [returnQuantities, setReturnQuantities] = useState({});
  const [returnReasons, setReturnReasons] = useState({});
  const [shipmentQuantities, setShipmentQuantities] = useState({});
  const [orderVoucherCodes, setOrderVoucherCodes] = useState({});
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const load = useCallback(async (quiet = false) => {
    if (!quiet) { setLoading(true); setError(''); }
    try {
      const logisticsEnabled = app.meta?.modules?.some((module) => module.id === 'logistics') && can('logistics.shipment.read');
      const accountingEnabled = app.meta?.modules?.some((module) => module.id === 'accounting') && can('accounting.invoice.read');
      const approvalEnabled = app.meta?.modules?.some((module) => module.id === 'workflow-approval') && can('workflow-approval.approval_request.read');
      const [partyMap, productMap, unitMap, warehouseMap, listResponse, quoteResponse, orderResponse, shipmentResponse, invoiceResponse, returnResponse, approvalResponse, creditResponse] = await Promise.all([
        loadRefs('master-data.party'), loadRefs('master-data.product'), loadRefs('master-data.uom'), loadRefs('inventory.warehouse'),
        loadAllResponse('sales.price_list'), loadAllResponse('sales.quotation'), loadAllResponse('sales.sales_order'),
        logisticsEnabled ? loadAllResponse('logistics.shipment') : Promise.resolve({ items: [] }),
        accountingEnabled ? loadAllResponse('accounting.invoice') : Promise.resolve({ items: [] }),
        loadAllResponse('sales.sales_return'),
        approvalEnabled ? loadAllResponse('workflow-approval.approval_request') : Promise.resolve({ items: [] }),
        can('accounting.credit_note.read') ? loadAllResponse('accounting.credit_note') : Promise.resolve({ items: [] }),
      ]);
      setParties(partyMap); setProducts(productMap); setUnits(unitMap); setWarehouses(warehouseMap);
      setPriceLists(itemsOf(listResponse));
      setQuotations(itemsOf(quoteResponse).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))));
      setOrders(itemsOf(orderResponse).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))));
      setShipments(itemsOf(shipmentResponse)); setInvoices(itemsOf(invoiceResponse));
      setReturns(itemsOf(returnResponse).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))));
      setApprovalRequests(itemsOf(approvalResponse)); setCreditNotes(itemsOf(creditResponse));
    } catch (reason) { setError(reason.message || t('Không tải được báo giá và đơn bán hàng.')); }
    finally { if (!quiet) setLoading(false); }
  }, []);
  useEffect(() => { load(); const timer = window.setInterval(() => load(true), 20000); return () => window.clearInterval(timer); }, [load]);
  const activeProducts = [...products.values()].filter((product) => product.active !== false).sort((a, b) => String(a.name).localeCompare(String(b.name), 'vi'));
  const selectedList = priceLists.find((item) => item.id === priceList);
  const unitsFor = (product) => product?.uom ? [...units.values()].filter((unit) => unit.id === product.uom || unit.base_uom === product.uom) : [];
  const cart = Object.entries(quantities).map(([id, qty]) => ({ product: products.get(id), qty: Number(qty), uom: selectedUnits[id] || products.get(id)?.uom })).filter((line) => line.product && line.qty > 0);
  const getPrice = (product, uomId) => {
    const basePrice = Number(selectedList?.items?.find((item) => item.product === product.id)?.price ?? product.price ?? 0) || 0;
    const unit = units.get(uomId);
    return basePrice * (unit?.base_uom ? Number(unit.ratio || 0) : 1);
  };
  const estimate = cart.reduce((total, line) => total + getPrice(line.product, line.uom) * line.qty, 0);
  const setQuantity = (id, value) => setQuantities((current) => { const next = { ...current }; const qty = Math.max(0, Number(value) || 0); if (qty) next[id] = qty; else delete next[id]; return next; });
  const createQuote = async (event) => {
    event.preventDefault(); if (!party || !warehouse || !cart.length) return;
    setBusy('create'); setError(''); setNotice('');
    try {
      const created = await api(dataPath('sales.quotation'), { method: 'POST', body: {
        party, warehouse, price_list: priceList || undefined, shipping_address: shippingAddress.trim() || undefined,
        valid_until: validUntil || undefined, note: note.trim() || undefined,
        lines: cart.map(({ product, qty, uom }) => ({ product: product.id, qty, uom })),
      } });
      setQuantities({}); setSelectedUnits({}); setNote(''); await load(true);
      setNotice(`${t('Đã tạo báo giá')} ${String(created.id).slice(0, 8)}. ${t('Máy chủ áp dụng bảng giá hoặc giá danh mục và tính thuế.')}`);
    } catch (reason) { setError(reason.message || t('Không tạo được báo giá. Kiểm tra khách hàng, giá và ngày hiệu lực.')); }
    finally { setBusy(''); }
  };
  const transition = async (entity, record, action) => {
    setBusy(`${record.id}:${action}`); setError(''); setNotice('');
    try {
      await api(dataPath(entity, record.id, action), { method: 'POST' });
      await load(true);
      const message = t(action === 'confirmed'
        ? 'Đơn đã xác nhận. Hạn mức tín dụng và tồn khả dụng đã được kiểm tra; hệ thống tạo hóa đơn và chuyến giao nếu có địa chỉ.'
        : action === 'accepted' ? 'Báo giá đã duyệt; hệ thống tạo đơn bán nháp.'
          : action === 'sent' ? (emailQueueEnabled
            ? 'Báo giá đã gửi và email chi tiết đã xếp vào hàng đợi gửi.'
            : 'Đã ghi nhận báo giá đã gửi cho khách hàng.')
            : action === 'expired' ? 'Đã đánh dấu báo giá hết hạn.' : 'Đã cập nhật trạng thái chứng từ.');
      setNotice(message);
    } catch (reason) { setError(reason.message || t('Không cập nhật được chứng từ. Kiểm tra giá, tín dụng và tồn kho.')); await load(true); }
    finally { setBusy(''); }
  };
  const applyVoucher = async (order) => {
    const code = (orderVoucherCodes[order.id] ?? order.voucher_code ?? '').trim().toUpperCase();
    setBusy(`${order.id}:voucher`); setError(''); setNotice('');
    try {
      await api(dataPath('sales.sales_order', order.id), { method: 'PATCH', body: { voucher_code: code } });
      await load(true);
      setNotice(t(code ? 'Đã áp dụng voucher; số tiền và thuế đã được máy chủ tính lại.' : 'Đã gỡ voucher khỏi đơn nháp.'));
    } catch (reason) { setError(reason.message || t('Không áp dụng được voucher. Kiểm tra ngày hiệu lực, thành viên và mã.')); }
    finally { setBusy(''); }
  };
  const orderForQuote = (quote) => orders.find((order) => order.source === 'quotation' && order.source_id === quote.id);
  const shipmentForOrder = (order) => shipments.filter((shipment) => shipment.source === 'sales_order' && shipment.source_id === order.id);
  const invoiceForOrder = (order) => invoices.find((invoice) => invoice.source === 'sales_order' && invoice.source_id === order.id);
  const expired = (quote) => quote.valid_until && quote.valid_until < today();
  const eligibleReturnLines = (order) => {
    const groups = new Map();
    for (const line of order.lines || []) {
      const product = line.product;
      const price = Number(line.price || 0);
      const uom = line.uom || products.get(product)?.uom || '';
      const key = `${product}:${price.toFixed(2)}:${uom}`;
      const current = groups.get(key) || { key, product, price, uom: uom || undefined, uom_name: line.uom_name, ordered: 0, name: products.get(product)?.name || 'Mặt hàng' };
      current.ordered += Number(line.qty || 0);
      groups.set(key, current);
    }
    const requiresDelivery = app.meta?.modules?.some((module) => module.id === 'logistics') && Boolean(order.shipping_address?.trim());
    return [...groups.values()].map((line) => {
      const eligible = requiresDelivery
        ? shipmentForOrder(order).filter((shipment) => shipment.status === 'delivered').flatMap((shipment) => shipment.delivered_lines || shipment.lines || []).filter((item) => item.product === line.product && (item.uom || '') === (line.uom || '') && Math.abs(Number(item.price || 0) - line.price) <= .005).reduce((sum, item) => sum + Number(item.qty || 0), 0)
        : line.ordered;
      const alreadyReturned = returns.filter((record) => record.sales_order === order.id && ['submitted', 'approved', 'received'].includes(record.status)).flatMap((record) => record.lines || []).filter((item) => item.product === line.product && (item.uom || '') === (line.uom || '') && Math.abs(Number(item.price || 0) - line.price) <= .005).reduce((sum, item) => sum + Number(item.qty || 0), 0);
      return { ...line, eligible, remaining: Math.max(0, eligible - alreadyReturned) };
    }).filter((line) => line.remaining > 0);
  };
  const remainingShipmentLines = (order) => {
    const groups = new Map();
    for (const line of order.lines || []) {
      if (['service', 'digital'].includes(line.kind)) continue;
      const product = line.product;
      const price = Number(line.price || 0);
      const uom = line.uom || products.get(product)?.uom || '';
      const key = `${product}:${price.toFixed(2)}:${uom}`;
      const current = groups.get(key) || { key, product, price, uom: uom || undefined, uom_name: line.uom_name, ordered: 0 };
      current.ordered += Number(line.qty || 0);
      groups.set(key, current);
    }
    const reserved = new Map();
    for (const shipment of shipmentForOrder(order).filter((row) => ['created', 'dispatched', 'delivered'].includes(row.status))) {
      const reservedLines = shipment.status === 'delivered' ? (shipment.delivered_lines || shipment.lines || []) : (shipment.lines || []);
      for (const line of reservedLines) {
        const key = `${line.product}:${Number(line.price || 0).toFixed(2)}:${line.uom || products.get(line.product)?.uom || ''}`;
        reserved.set(key, (reserved.get(key) || 0) + Number(line.qty || 0));
      }
    }
    return [...groups.values()].map((line) => ({
      ...line,
      remaining: Math.max(0, line.ordered - (reserved.get(line.key) || 0)),
    })).filter((line) => line.remaining > 0.000001);
  };
  const createShipment = async (order) => {
    const openLines = remainingShipmentLines(order);
    const lines = openLines.map((line) => ({
      product: line.product,
      price: line.price,
      uom: line.uom,
      qty: Number(shipmentQuantities[order.id]?.[line.key]) || 0,
      remaining: line.remaining,
    })).filter((line) => line.qty > 0);
    if (!lines.length || lines.some((line) => line.qty > line.remaining + 0.000001)) return;
    setBusy(`${order.id}:shipment`); setError(''); setNotice('');
    try {
      const created = await api(dataPath('logistics.shipment'), { method: 'POST', body: {
        source: 'sales_order', source_id: order.id, party: order.party,
        warehouse: order.warehouse, destination: order.shipping_address,
        lines: lines.map(({ product, price, qty, uom }) => ({ product, price, qty, uom })),
      } });
      setShipmentQuantities((current) => { const next = { ...current }; delete next[order.id]; return next; });
      await load(true);
      setNotice(`${t('Đã tạo vận đơn')} ${String(created.id).slice(0, 8)} ${t('cho số lượng được chọn.')}`);
    } catch (reason) {
      setError(reason.message || t('Không tạo được vận đơn. Hệ thống kiểm tra lại lượng còn giao trên đơn.'));
      await load(true);
    } finally { setBusy(''); }
  };
  const createReturn = async (order) => {
    const lines = eligibleReturnLines(order).map((line) => ({ ...line, qty: Number(returnQuantities[`${order.id}:${line.key}`]) || 0 })).filter((line) => line.qty > 0).map(({ product, price, qty, uom }) => ({ product, price, qty, uom }));
    if (!lines.length || !returnReasons[order.id]?.trim()) return;
    setBusy(`${order.id}:return`); setError(''); setNotice('');
    try {
      const created = await api(dataPath('sales.sales_return'), { method: 'POST', body: {
        sales_order: order.id, warehouse: order.warehouse, lines, reason: returnReasons[order.id].trim(),
      } });
      setReturnReasons((current) => ({ ...current, [order.id]: '' }));
      setReturnQuantities((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith(`${order.id}:`))));
      await load(true); setNotice(`${t('Đã lập phiếu trả')} ${String(created.id).slice(0, 8)}. ${t('Gửi duyệt để nhận hàng và lập chứng từ giảm công nợ.')}`);
    } catch (reason) { setError(reason.message || t('Không lập được phiếu trả. Kiểm tra số lượng đã giao và các phiếu trả trước.')); }
    finally { setBusy(''); }
  };
  const decideApproval = async (request, action) => {
    setBusy(`${request.id}:${action}`); setError(''); setNotice('');
    try {
      await api(dataPath('workflow-approval.approval_request', request.id, action), { method: 'POST' });
      await load(true); setNotice(t(action === 'approved' ? 'Đã duyệt phiếu trả; hàng có thể được nhận về kho.' : 'Đã từ chối yêu cầu trả hàng.'));
    } catch (reason) { setError(reason.message || t('Không cập nhật được quyết định phê duyệt.')); await load(true); }
    finally { setBusy(''); }
  };
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
    <section className="wholesale-section"><header><h2>{t('Báo giá')}</h2><span className="badge plain">{quotations.length}</span></header>
      <div className="wholesale-documents">{quotations.map((quote) => {
        const customer = parties.get(quote.party); const order = orderForQuote(quote);
        return <article className="card wholesale-document" key={quote.id}>
          <header><div><strong>{recordLabel('master-data.party', customer)}</strong><div className="small muted">{t('Báo giá')} {String(quote.id).slice(0, 8)} · {quote.valid_until ? `${t('hết hạn')} ${fmtDate(quote.valid_until)}` : t('không đặt ngày hết hạn')}</div></div><span className={`badge ${expired(quote) ? 'danger' : quote.status === 'accepted' ? 'success' : 'warning'}`}>{expired(quote) && quote.status === 'sent' ? t('Quá hạn') : statusLabel(quote.status)}</span></header>
          <ul>{(quote.lines || []).map((line, index) => <li key={`${line.product}:${index}`}><span>{products.get(line.product)?.name || t('Mặt hàng')} × {line.qty} {line.uom_name || units.get(line.uom)?.name || ''}</span><strong className="num">{fmtMoney(line.line_total ?? Number(line.qty || 0) * Number(line.price || 0))}</strong></li>)}</ul>
          <div className="wholesale-total"><span>{t('Tổng gồm thuế')}</span><strong className="num">{fmtMoney(quote.total || 0)}</strong></div>
          <footer>{quote.status === 'draft' && can('sales.quotation.sent') && <button className="btn" disabled={!!busy || expired(quote)} onClick={() => transition('sales.quotation', quote, 'sent')}>{t('Gửi báo giá')}</button>}
            {quote.status === 'sent' && !expired(quote) && can('sales.quotation.accepted') && <button className="btn btn-primary" disabled={!!busy} onClick={() => transition('sales.quotation', quote, 'accepted')}>{t('Khách duyệt')}</button>}
            {quote.status === 'sent' && !expired(quote) && can('sales.quotation.rejected') && <button className="btn" disabled={!!busy} onClick={() => transition('sales.quotation', quote, 'rejected')}>{t('Khách từ chối')}</button>}
            {quote.status === 'sent' && expired(quote) && can('sales.quotation.expired') && <button className="btn" disabled={!!busy} onClick={() => transition('sales.quotation', quote, 'expired')}>{t('Đóng báo giá quá hạn')}</button>}
            <a className="btn" href={recordHref('sales.quotation', quote.id)}>{t('Chi tiết báo giá')}</a>
            {order && <a className="btn" href={recordHref('sales.sales_order', order.id)}>{t('Mở đơn bán')} {String(order.id).slice(0, 8)}</a>}
          </footer>
        </article>;
      })}{!quotations.length && <div className="card-pad muted">{t('Chưa có báo giá.')}</div>}</div>
    </section>
    <section className="wholesale-section"><header><h2>{t('Đơn bán và giao hàng')}</h2><a href="#/reports/logistics/delivery-board">{t('Mở bảng điều phối')}</a></header>
      <div className="wholesale-documents">{orders.map((order) => {
        const shipmentsForOrder = shipmentForOrder(order); const invoice = invoiceForOrder(order);
        return <article className="card wholesale-document" key={order.id}>
          <header><div><strong>{recordLabel('master-data.party', parties.get(order.party))}</strong><div className="small muted">{t('Đơn')} {String(order.id).slice(0, 8)} · {order.shipping_address || t('Bán trực tiếp')}</div></div><span className={`badge ${order.status === 'delivered' ? 'success' : order.status === 'cancelled' ? 'plain' : 'warning'}`}>{statusLabel(order.status)}</span></header>
          <ul>{(order.lines || []).map((line, index) => <li key={`${line.product}:${index}`}><span>{products.get(line.product)?.name || t('Mặt hàng')} × {line.qty} {line.uom_name || units.get(line.uom)?.name || ''}</span><strong className="num">{fmtMoney(line.line_total ?? Number(line.qty || 0) * Number(line.price || 0))}</strong></li>)}</ul>
          <div className="wholesale-total"><span>{t('Tổng gồm thuế')}</span><strong className="num">{fmtMoney(order.total || 0)}</strong></div>
          {app.meta?.modules?.some((module) => module.id === 'loyalty') && order.status === 'draft' && can('sales.sales_order.update') && <div className="wholesale-related"><label className="field grow"><span className="label">{t('Voucher thành viên')}</span><input className="input" maxLength="80" autoCapitalize="characters" value={orderVoucherCodes[order.id] ?? order.voucher_code ?? ''} onChange={(event) => setOrderVoucherCodes((current) => ({ ...current, [order.id]: event.target.value.toUpperCase() }))}/></label><button className="btn" type="button" disabled={Boolean(busy)} onClick={() => applyVoucher(order)}>{t(order.voucher_code ? 'Cập nhật voucher' : 'Áp dụng voucher')}</button>{order.voucher_discount > 0 && <span className="small muted">{t('Giảm trước thuế')} {fmtMoney(order.voucher_discount)}</span>}</div>}
          {shipmentsForOrder.map((shipment) => <div className="wholesale-related" key={shipment.id}><span>{t('Chuyến giao')} · {statusLabel(shipment.status)}</span><a href={recordHref('logistics.shipment', shipment.id)}>{t('Mở')} {String(shipment.id).slice(0, 8)}</a></div>)}
          {app.meta?.modules?.some((module) => module.id === 'logistics') && can('logistics.shipment.read') && can('logistics.shipment.create') && order.shipping_address?.trim() && ['confirmed', 'partially_delivered'].includes(order.status) && <div className="wholesale-related wholesale-shipment-create">
            <div><strong>{t('Giao phần hàng còn lại')}</strong><div className="small muted">{t('Chỉ tính các vận đơn đang mở hoặc đã giao; vận đơn thất bại không giữ số lượng.')}</div></div>
            {remainingShipmentLines(order).length ? <div className="wholesale-shipment-lines">{remainingShipmentLines(order).map((line) => <label className="field" key={line.key}><span>{products.get(line.product)?.name || t('Mặt hàng')} · {t('còn')} {line.remaining} {line.uom_name || units.get(line.uom)?.name || ''}</span><input className="input num" aria-label={`${t('Số lượng giao')} ${products.get(line.product)?.name || line.product}`} type="number" min="0" max={line.remaining} step="any" value={shipmentQuantities[order.id]?.[line.key] || ''} onChange={(event) => setShipmentQuantities((current) => ({ ...current, [order.id]: { ...current[order.id], [line.key]: event.target.value } }))}/></label>)}<button className="btn btn-primary" type="button" disabled={Boolean(busy) || !remainingShipmentLines(order).some((line) => Number(shipmentQuantities[order.id]?.[line.key]) > 0)} onClick={() => createShipment(order)}>{t('Tạo vận đơn đã chọn')}</button></div> : <span className="small muted">{t('Hàng đã được phân công hết. Muốn tách chuyến chưa xuất phát, mở vận đơn nháp và giảm số lượng trước khi điều phối.')}</span>}
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
            <button className="btn" disabled={!!busy || !returnables.some((line) => Number(returnQuantities[`${order.id}:${line.key}`]) > 0) || !returnReasons[order.id]?.trim()} onClick={() => createReturn(order)}>{t('Lập phiếu trả nháp')}</button>
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
          <ul>{(record.lines || []).map((line, index) => <li key={`${line.product}:${index}`}><span>{products.get(line.product)?.name || t('Mặt hàng')} × {line.qty}</span><strong className="num">{fmtMoney(line.line_total ?? Number(line.qty || 0) * Number(line.price || 0))}</strong></li>)}</ul>
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
