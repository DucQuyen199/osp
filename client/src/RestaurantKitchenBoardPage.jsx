import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api, dataPath, tenantPath } from './lib/api.js';
import { fmtAgo, fmtDateTime, statusLabel } from './lib/i18n.js';
import { can, loadRefs, recordLabel } from './lib/state.js';
import { recordHref } from './lib/routes.js';

const STATIONS = [
  ['all', 'Tất cả trạm'],
  ['kitchen', 'Bếp'],
  ['bar', 'Quầy pha chế'],
];

export default function RestaurantKitchenBoardPage() {
  const [station, setStation] = useState('all');
  const [items, setItems] = useState([]);
  const [products, setProducts] = useState(new Map());
  const [error, setError] = useState('');
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) { setError(''); setLoading(true); }
    try {
      const params = new URLSearchParams({ station });
      const [result, refs] = await Promise.all([
        api(tenantPath(`/reports/restaurant/kitchen-board?${params}`)),
        products.size ? Promise.resolve(products) : loadRefs('master-data.product'),
      ]);
      setItems(result.items || []);
      setTruncated(Boolean(result.truncated));
      setProducts(refs);
      setLastUpdated(new Date().toISOString());
    } catch (reason) {
      setError(reason.message || 'Không tải được phiếu bếp.');
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [station, products]);

  useEffect(() => {
    document.title = 'Màn hình bếp · OSP Suite';
    load();
    const timer = window.setInterval(() => load(true), 15000);
    return () => window.clearInterval(timer);
  }, [load]);

  const grouped = useMemo(() => ({
    queued: items.filter((item) => item.status === 'queued'),
    preparing: items.filter((item) => item.status === 'preparing'),
    ready: items.filter((item) => item.status === 'ready'),
  }), [items]);

  const transition = async (ticket, action) => {
    const key = `${ticket.id}:${action}`;
    setBusy(key);
    setError('');
    try {
      await api(dataPath('restaurant.kitchen_ticket', ticket.id, action), { method: 'POST' });
      await load(true);
    } catch (reason) {
      setError(reason.message || 'Không cập nhật được trạng thái phiếu bếp.');
      await load(true);
    } finally {
      setBusy('');
    }
  };

  const renderTicket = (ticket) => <article className="card kitchen-ticket" key={ticket.id}>
    <header className="card-head">
      <div>{can('restaurant.table_order.read') ? <a href={recordHref('restaurant.table_order', ticket.orderId)}><strong>{ticket.table || 'Mang đi'}</strong></a> : <strong>{ticket.table || 'Mang đi'}</strong>}<div className="small muted">{fmtAgo(ticket.createdAt)} · {ticket.station === 'bar' ? 'Quầy pha chế' : 'Bếp'}</div></div>
      <span className={`badge ${ticket.status === 'ready' ? 'success' : ticket.status === 'preparing' ? 'warning' : 'plain'}`}>{statusLabel(ticket.status)}</span>
    </header>
    <ul className="kitchen-lines">{(ticket.lines || []).map((line, index) => {
      const productId = line.product;
      const product = products.get(productId);
      return <li key={`${productId || 'line'}:${index}`}>
        <strong>{line.qty ? `${Number(line.qty).toLocaleString(undefined, { maximumFractionDigits: 3 })} × ` : ''}{product ? recordLabel('master-data.product', product) : 'Món'}</strong>
        {line.note && <span className="small muted">{line.note}</span>}
      </li>;
    })}</ul>
    <footer className="row wrap kitchen-ticket-footer"><span className="small muted">{fmtDateTime(ticket.createdAt)}</span><span className="grow" />
      {ticket.status === 'queued' && can('restaurant.kitchen_ticket.preparing') && <button className="btn btn-primary" type="button" disabled={Boolean(busy)} onClick={() => transition(ticket, 'preparing')}>{busy === `${ticket.id}:preparing` ? 'Đang cập nhật…' : 'Bắt đầu chế biến'}</button>}
      {ticket.status === 'preparing' && can('restaurant.kitchen_ticket.ready') && <button className="btn btn-primary" type="button" disabled={Boolean(busy)} onClick={() => transition(ticket, 'ready')}>{busy === `${ticket.id}:ready` ? 'Đang cập nhật…' : 'Báo món đã xong'}</button>}
    </footer>
  </article>;

  return <div className="page">
    <div className="page-head"><div><h1>Màn hình bếp</h1><p className="sub">Phiếu theo thứ tự nhận món. Bảng tự làm mới mỗi 15 giây; trạng thái món được dùng để cho phép phục vụ order.</p></div><div className="row wrap">
      <label className="field"><span className="label">Trạm</span><select className="select" value={station} onChange={(event) => setStation(event.target.value)}>{STATIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <button className="btn btn-secondary" type="button" disabled={loading} onClick={() => load()} aria-label="Làm mới màn hình bếp">{loading ? 'Đang tải…' : 'Làm mới'}</button>
    </div></div>
    {lastUpdated && <p className="small muted">Cập nhật lúc {fmtDateTime(lastUpdated)}</p>}
    {error && <div className="alert danger" role="alert">{error}</div>}
    {truncated && <div className="alert warning" role="status">Đang hiển thị tối đa 500 phiếu đang mở. Hãy lọc theo trạm để xem ít phiếu hơn.</div>}
    {loading && !lastUpdated ? <div className="card-pad"><div className="skeleton" data-h="row" /></div> : <div className="kitchen-board">
      {[
        ['queued', 'Chờ chế biến'],
        ['preparing', 'Đang chế biến'],
        ['ready', 'Đã xong · chờ phục vụ'],
      ].map(([status, title]) => <section className="kitchen-lane" key={status} aria-labelledby={`kitchen-${status}`}>
        <header className="kitchen-lane-head"><h2 id={`kitchen-${status}`}>{title}</h2><span className="badge plain">{grouped[status].length}</span></header>
        <div className="stack-sm">{grouped[status].map(renderTicket)}{!grouped[status].length && <div className="empty kitchen-empty">Không có phiếu</div>}</div>
      </section>)}
    </div>}
    {items.length > 0 && <p className="small muted">Order chỉ được chuyển sang phục vụ khi tất cả phiếu bếp và quầy pha chế đã sẵn sàng.</p>}
  </div>;
}
