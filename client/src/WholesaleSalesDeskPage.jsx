import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api, dataPath } from './lib/api.js';
import { fmtDate, fmtDateTime, fmtMoney, statusLabel } from './lib/i18n.js';
import { app, can, loadRefs, recordLabel } from './lib/state.js';
import { recordHref } from './lib/routes.js';

const itemsOf = (response) => Array.isArray(response?.items) ? response.items : [];
const today = () => new Date().toISOString().slice(0, 10);

export default function WholesaleSalesDeskPage() {
  const [parties, setParties] = useState(new Map());
  const [products, setProducts] = useState(new Map());
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
      const [partyMap, productMap, warehouseMap, listResponse, quoteResponse, orderResponse, shipmentResponse, invoiceResponse, returnResponse, approvalResponse, creditResponse] = await Promise.all([
        loadRefs('master-data.party'), loadRefs('master-data.product'), loadRefs('inventory.warehouse'),
        api(`${dataPath('sales.price_list')}?limit=1000`), api(`${dataPath('sales.quotation')}?limit=1000`), api(`${dataPath('sales.sales_order')}?limit=1000`),
        logisticsEnabled ? api(`${dataPath('logistics.shipment')}?limit=1000`) : Promise.resolve({ items: [] }),
        accountingEnabled ? api(`${dataPath('accounting.invoice')}?limit=1000`) : Promise.resolve({ items: [] }),
        api(`${dataPath('sales.sales_return')}?limit=1000`),
        approvalEnabled ? api(`${dataPath('workflow-approval.approval_request')}?limit=1000`) : Promise.resolve({ items: [] }),
        can('accounting.credit_note.read') ? api(`${dataPath('accounting.credit_note')}?limit=1000`) : Promise.resolve({ items: [] }),
      ]);
      setParties(partyMap); setProducts(productMap); setWarehouses(warehouseMap);
      setPriceLists(itemsOf(listResponse));
      setQuotations(itemsOf(quoteResponse).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))));
      setOrders(itemsOf(orderResponse).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))));
      setShipments(itemsOf(shipmentResponse)); setInvoices(itemsOf(invoiceResponse));
      setReturns(itemsOf(returnResponse).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))));
      setApprovalRequests(itemsOf(approvalResponse)); setCreditNotes(itemsOf(creditResponse));
    } catch (reason) { setError(reason.message || 'Không tải được báo giá và đơn bán hàng.'); }
    finally { if (!quiet) setLoading(false); }
  }, []);

  useEffect(() => { document.title = 'Bán buôn · OSP Suite'; load(); const timer = window.setInterval(() => load(true), 20000); return () => window.clearInterval(timer); }, [load]);

  const activeProducts = [...products.values()].filter((product) => product.active !== false).sort((a, b) => String(a.name).localeCompare(String(b.name), 'vi'));
  const selectedList = priceLists.find((item) => item.id === priceList);
  const cart = Object.entries(quantities).map(([id, qty]) => ({ product: products.get(id), qty: Number(qty) })).filter((line) => line.product && line.qty > 0);
  const getPrice = (product) => selectedList?.items?.find((item) => item.product === product.id)?.price ?? product.price ?? 0;
  const estimate = cart.reduce((total, line) => total + (Number(getPrice(line.product)) || 0) * line.qty, 0);
  const setQuantity = (id, value) => setQuantities((current) => { const next = { ...current }; const qty = Math.max(0, Number(value) || 0); if (qty) next[id] = qty; else delete next[id]; return next; });

  const createQuote = async (event) => {
    event.preventDefault(); if (!party || !warehouse || !cart.length) return;
    setBusy('create'); setError(''); setNotice('');
    try {
      const created = await api(dataPath('sales.quotation'), { method: 'POST', body: {
        party, warehouse, price_list: priceList || undefined, shipping_address: shippingAddress.trim() || undefined,
        valid_until: validUntil || undefined, note: note.trim() || undefined,
        lines: cart.map(({ product, qty }) => ({ product: product.id, qty })),
      } });
      setQuantities({}); setNote(''); await load(true);
      setNotice(`Đã tạo báo giá ${String(created.id).slice(0, 8)}. Server áp dụng giá bảng hoặc giá danh mục và tính thuế.`);
    } catch (reason) { setError(reason.message || 'Không tạo được báo giá. Kiểm tra khách hàng, giá và ngày hiệu lực.'); }
    finally { setBusy(''); }
  };

  const transition = async (entity, record, action) => {
    setBusy(`${record.id}:${action}`); setError(''); setNotice('');
    try {
      await api(dataPath(entity, record.id, action), { method: 'POST' });
      await load(true);
      const message = action === 'confirmed'
        ? 'Đơn đã xác nhận. Hạn mức tín dụng và tồn khả dụng đã được kiểm tra; hệ thống tạo hóa đơn và chuyến giao nếu có địa chỉ.'
        : action === 'accepted' ? 'Báo giá đã duyệt; hệ thống tạo đơn bán nháp.'
          : action === 'sent' ? 'Đã gửi báo giá cho khách hàng.'
            : action === 'expired' ? 'Đã đánh dấu báo giá hết hạn.' : 'Đã cập nhật trạng thái chứng từ.';
      setNotice(message);
    } catch (reason) { setError(reason.message || 'Không cập nhật được chứng từ. Kiểm tra giá, tín dụng và tồn kho.'); await load(true); }
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
      const key = `${product}:${price.toFixed(2)}`;
      const current = groups.get(key) || { key, product, price, ordered: 0, name: products.get(product)?.name || 'Mặt hàng' };
      current.ordered += Number(line.qty || 0);
      groups.set(key, current);
    }
    const requiresDelivery = app.meta?.modules?.some((module) => module.id === 'logistics') && Boolean(order.shipping_address?.trim());
    return [...groups.values()].map((line) => {
      const eligible = requiresDelivery
        ? shipmentForOrder(order).filter((shipment) => shipment.status === 'delivered').flatMap((shipment) => shipment.lines || []).filter((item) => item.product === line.product && Math.abs(Number(item.price || 0) - line.price) <= .005).reduce((sum, item) => sum + Number(item.qty || 0), 0)
        : line.ordered;
      const alreadyReturned = returns.filter((record) => record.sales_order === order.id && ['submitted', 'approved', 'received'].includes(record.status)).flatMap((record) => record.lines || []).filter((item) => item.product === line.product && Math.abs(Number(item.price || 0) - line.price) <= .005).reduce((sum, item) => sum + Number(item.qty || 0), 0);
      return { ...line, eligible, remaining: Math.max(0, eligible - alreadyReturned) };
    }).filter((line) => line.remaining > 0);
  };

  const createReturn = async (order) => {
    const lines = eligibleReturnLines(order).map((line) => ({ ...line, qty: Number(returnQuantities[`${order.id}:${line.key}`]) || 0 })).filter((line) => line.qty > 0).map(({ product, price, qty }) => ({ product, price, qty }));
    if (!lines.length || !returnReasons[order.id]?.trim()) return;
    setBusy(`${order.id}:return`); setError(''); setNotice('');
    try {
      const created = await api(dataPath('sales.sales_return'), { method: 'POST', body: {
        sales_order: order.id, warehouse: order.warehouse, lines, reason: returnReasons[order.id].trim(),
      } });
      setReturnReasons((current) => ({ ...current, [order.id]: '' }));
      setReturnQuantities((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith(`${order.id}:`))));
      await load(true); setNotice(`Đã lập phiếu trả ${String(created.id).slice(0, 8)}. Gửi duyệt để nhận hàng và lập chứng từ giảm công nợ.`);
    } catch (reason) { setError(reason.message || 'Không lập được phiếu trả. Kiểm tra số lượng đã giao và các phiếu trả trước.'); }
    finally { setBusy(''); }
  };

  const decideApproval = async (request, action) => {
    setBusy(`${request.id}:${action}`); setError(''); setNotice('');
    try {
      await api(dataPath('workflow-approval.approval_request', request.id, action), { method: 'POST' });
      await load(true); setNotice(action === 'approved' ? 'Đã duyệt phiếu trả; hàng có thể được nhận về kho.' : 'Đã từ chối yêu cầu trả hàng.');
    } catch (reason) { setError(reason.message || 'Không cập nhật được quyết định phê duyệt.'); await load(true); }
    finally { setBusy(''); }
  };

  return <div className="page-content wholesale-sales-page">
    <header className="page-header"><div><h1>Bán buôn và phân phối</h1><p className="muted">Báo giá theo khách hàng, duyệt thành đơn, kiểm soát tín dụng và giao hàng.</p></div><button className="button" onClick={() => load()} disabled={loading}>Làm mới</button></header>
    {error && <div className="alert error" role="alert">{error}</div>}{notice && <div className="alert success" role="status">{notice}</div>}
    {can('sales.quotation.create') && <section className="wholesale-create card"><h2>Lập báo giá</h2><form onSubmit={createQuote}>
      <div className="wholesale-form">
        <label className="field"><span>Khách hàng / đại lý</span><select className="select" required value={party} onChange={(event) => setParty(event.target.value)}><option value="">Chọn khách hàng</option>{[...parties.values()].map((item) => <option key={item.id} value={item.id}>{recordLabel('master-data.party', item)}</option>)}</select></label>
        <label className="field"><span>Kho xuất</span><select className="select" required value={warehouse} onChange={(event) => setWarehouse(event.target.value)}><option value="">Chọn kho</option>{[...warehouses.values()].map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="field"><span>Bảng giá</span><select className="select" value={priceList} onChange={(event) => setPriceList(event.target.value)}><option value="">Giá bán mặc định</option>{priceLists.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="field"><span>Ngày hết hạn</span><input className="input" type="date" min={today()} value={validUntil} onChange={(event) => setValidUntil(event.target.value)} /></label>
        <label className="field wholesale-address"><span>Địa chỉ giao hàng</span><input className="input" value={shippingAddress} onChange={(event) => setShippingAddress(event.target.value)} placeholder="Nhập để tạo chuyến giao khi xác nhận đơn" /></label>
        <label className="field wholesale-address"><span>Ghi chú</span><input className="input" value={note} onChange={(event) => setNote(event.target.value)} /></label>
      </div>
      <div className="wholesale-product-grid">{activeProducts.map((product) => <article className="wholesale-product card" key={product.id}>
        <strong>{recordLabel('master-data.product', product)}</strong><span className="num">{fmtMoney(getPrice(product))}</span>
        <label className="field"><span>Số lượng</span><input className="input" type="number" min="0" step="any" value={quantities[product.id] || ''} onChange={(event) => setQuantity(product.id, event.target.value)} /></label>
      </article>)}</div>
      <div className="wholesale-estimate"><span>Tạm tính theo bảng giá, chưa gồm thuế</span><strong className="num">{fmtMoney(estimate)}</strong></div>
      <button className="button primary" disabled={busy === 'create' || !party || !warehouse || !cart.length}>{busy === 'create' ? 'Đang tạo…' : 'Lưu báo giá nháp'}</button>
    </form></section>}

    <section className="wholesale-section"><header><h2>Báo giá</h2><span className="badge plain">{quotations.length}</span></header>
      <div className="wholesale-documents">{quotations.map((quote) => {
        const customer = parties.get(quote.party); const order = orderForQuote(quote);
        return <article className="card wholesale-document" key={quote.id}>
          <header><div><strong>{recordLabel('master-data.party', customer)}</strong><div className="small muted">Báo giá {String(quote.id).slice(0, 8)} · {quote.valid_until ? `hết hạn ${fmtDate(quote.valid_until)}` : 'không đặt ngày hết hạn'}</div></div><span className={`badge ${expired(quote) ? 'danger' : quote.status === 'accepted' ? 'success' : 'warning'}`}>{expired(quote) && quote.status === 'sent' ? 'Quá hạn' : statusLabel(quote.status)}</span></header>
          <ul>{(quote.lines || []).map((line, index) => <li key={`${line.product}:${index}`}><span>{products.get(line.product)?.name || 'Mặt hàng'} × {line.qty}</span><strong className="num">{fmtMoney(line.line_total ?? Number(line.qty || 0) * Number(line.price || 0))}</strong></li>)}</ul>
          <div className="wholesale-total"><span>Tổng gồm thuế</span><strong className="num">{fmtMoney(quote.total || 0)}</strong></div>
          <footer>{quote.status === 'draft' && can('sales.quotation.sent') && <button className="button" disabled={!!busy || expired(quote)} onClick={() => transition('sales.quotation', quote, 'sent')}>Gửi báo giá</button>}
            {quote.status === 'sent' && !expired(quote) && can('sales.quotation.accepted') && <button className="button primary" disabled={!!busy} onClick={() => transition('sales.quotation', quote, 'accepted')}>Khách duyệt</button>}
            {quote.status === 'sent' && !expired(quote) && can('sales.quotation.rejected') && <button className="button" disabled={!!busy} onClick={() => transition('sales.quotation', quote, 'rejected')}>Khách từ chối</button>}
            {quote.status === 'sent' && expired(quote) && can('sales.quotation.expired') && <button className="button" disabled={!!busy} onClick={() => transition('sales.quotation', quote, 'expired')}>Đóng báo giá quá hạn</button>}
            <a className="button" href={recordHref('sales.quotation', quote.id)}>Chi tiết báo giá</a>
            {order && <a className="button" href={recordHref('sales.sales_order', order.id)}>Mở đơn bán {String(order.id).slice(0, 8)}</a>}
          </footer>
        </article>;
      })}{!quotations.length && <div className="card-pad muted">Chưa có báo giá.</div>}</div>
    </section>

    <section className="wholesale-section"><header><h2>Đơn bán và giao hàng</h2><a href="#/reports/logistics/delivery-board">Mở bảng điều phối</a></header>
      <div className="wholesale-documents">{orders.map((order) => {
        const shipmentsForOrder = shipmentForOrder(order); const invoice = invoiceForOrder(order);
        return <article className="card wholesale-document" key={order.id}>
          <header><div><strong>{recordLabel('master-data.party', parties.get(order.party))}</strong><div className="small muted">Đơn {String(order.id).slice(0, 8)} · {order.shipping_address || 'Bán trực tiếp'}</div></div><span className={`badge ${order.status === 'delivered' ? 'success' : order.status === 'cancelled' ? 'plain' : 'warning'}`}>{statusLabel(order.status)}</span></header>
          <ul>{(order.lines || []).map((line, index) => <li key={`${line.product}:${index}`}><span>{products.get(line.product)?.name || 'Mặt hàng'} × {line.qty}</span><strong className="num">{fmtMoney(line.line_total ?? Number(line.qty || 0) * Number(line.price || 0))}</strong></li>)}</ul>
          <div className="wholesale-total"><span>Tổng gồm thuế</span><strong className="num">{fmtMoney(order.total || 0)}</strong></div>
          {shipmentsForOrder.map((shipment) => <div className="wholesale-related" key={shipment.id}><span>Chuyến giao · {statusLabel(shipment.status)}</span><a href={recordHref('logistics.shipment', shipment.id)}>Mở {String(shipment.id).slice(0, 8)}</a></div>)}
          <footer>{order.status === 'draft' && can('sales.sales_order.confirmed') && <button className="button primary" disabled={!!busy} onClick={() => transition('sales.sales_order', order, 'confirmed')}>Xác nhận đơn, giữ tồn và tạo hóa đơn</button>}
            {invoice && <a className="button" href={recordHref('accounting.invoice', invoice.id)}>Mở hóa đơn</a>}
            <a className="button" href={recordHref('sales.sales_order', order.id)}>Chi tiết đơn</a>
          </footer>
        </article>;
      })}{!orders.length && <div className="card-pad muted">Chưa có đơn bán.</div>}</div>
    </section>
    {can('sales.sales_return.read') && <section className="wholesale-section"><header><h2>Trả hàng và nhập lại kho</h2><span className="badge plain">{returns.length}</span></header>
      <div className="wholesale-documents">{orders.filter((order) => ['confirmed', 'partially_delivered', 'delivered'].includes(order.status)).map((order) => {
        const returnables = eligibleReturnLines(order);
        return <article className="card wholesale-document" key={`return-form:${order.id}`}>
          <header><div><strong>{recordLabel('master-data.party', parties.get(order.party))}</strong><div className="small muted">Order {String(order.id).slice(0, 8)} · {order.shipping_address || 'Bán trực tiếp'}</div></div><a href={recordHref('sales.sales_order', order.id)}>Chi tiết đơn</a></header>
          {returnables.length ? <>
            <div className="wholesale-return-lines">{returnables.map((line) => <label className="wholesale-return-line" key={line.key}><span>{line.name} · đã giao {line.eligible} · còn trả {line.remaining}</span><input className="input" type="number" min="0" max={line.remaining} step="any" aria-label={`Số lượng trả ${line.name}`} value={returnQuantities[`${order.id}:${line.key}`] || ''} onChange={(event) => setReturnQuantities((current) => ({ ...current, [`${order.id}:${line.key}`]: event.target.value }))} /></label>)}</div>
            <label className="field"><span>Lý do trả hàng</span><textarea className="input textarea" value={returnReasons[order.id] || ''} onChange={(event) => setReturnReasons((current) => ({ ...current, [order.id]: event.target.value }))} /></label>
            <button className="button" disabled={!!busy || !returnables.some((line) => Number(returnQuantities[`${order.id}:${line.key}`]) > 0) || !returnReasons[order.id]?.trim()} onClick={() => createReturn(order)}>Lập phiếu trả nháp</button>
          </> : <p className="small muted">Chưa có số lượng đủ điều kiện trả. Đơn giao hàng chỉ nhận trả hàng đã giao thành công.</p>}
        </article>;
      })}{!orders.some((order) => ['confirmed', 'partially_delivered', 'delivered'].includes(order.status)) && <div className="card-pad muted">Chưa có đơn đủ điều kiện trả hàng.</div>}</div>
    </section>}

    {can('sales.sales_return.read') && <section className="wholesale-section"><header><h2>Phiếu trả và phê duyệt</h2><span className="badge plain">{returns.length}</span></header>
      <div className="wholesale-documents">{returns.map((record) => {
        const request = approvalRequests.find((item) => item.entity === 'sales.sales_return' && item.record_id === record.id && item.status === 'pending');
        const creditNote = creditNotes.find((item) => item.source === 'sales_return' && item.source_id === record.id);
        return <article className="card wholesale-document" key={record.id}>
          <header><div><strong>Phiếu trả {String(record.id).slice(0, 8)}</strong><div className="small muted">Order {String(record.sales_order).slice(0, 8)} · {record.reason || 'Không ghi lý do'}</div></div><span className={`badge ${record.status === 'received' ? 'success' : record.status === 'rejected' || record.status === 'cancelled' ? 'plain' : 'warning'}`}>{statusLabel(record.status)}</span></header>
          <ul>{(record.lines || []).map((line, index) => <li key={`${line.product}:${index}`}><span>{products.get(line.product)?.name || 'Mặt hàng'} × {line.qty}</span><strong className="num">{fmtMoney(line.line_total ?? Number(line.qty || 0) * Number(line.price || 0))}</strong></li>)}</ul>
          <div className="wholesale-total"><span>Giá trị giảm trừ</span><strong className="num">{fmtMoney(record.total || 0)}</strong></div>
          {request && <div className="wholesale-approval"><span>Yêu cầu phê duyệt đang chờ</span>{can('workflow-approval.approval_request.approved') && <button className="button primary" disabled={!!busy} onClick={() => decideApproval(request, 'approved')}>Duyệt</button>}{can('workflow-approval.approval_request.rejected') && <button className="button" disabled={!!busy} onClick={() => decideApproval(request, 'rejected')}>Từ chối</button>}</div>}
          <footer>{['draft', 'rejected'].includes(record.status) && can('sales.sales_return.submitted') && <button className="button" disabled={!!busy} onClick={() => transition('sales.sales_return', record, 'submitted')}>Gửi phê duyệt</button>}
            {record.status === 'approved' && can('sales.sales_return.received') && <button className="button primary" disabled={!!busy} onClick={() => transition('sales.sales_return', record, 'received')}>Nhận hàng, nhập kho và lập credit note</button>}
            {creditNote && <a className="button" href={recordHref('accounting.credit_note', creditNote.id)}>Mở credit note</a>}
            <a className="button" href={recordHref('sales.sales_return', record.id)}>Chi tiết phiếu</a>
          </footer>
        </article>;
      })}{!returns.length && <div className="card-pad muted">Chưa phát sinh phiếu trả hàng.</div>}</div>
    </section>}
  </div>;
}
