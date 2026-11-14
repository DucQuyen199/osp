import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api, dataPath, tenantPath } from './lib/api.js';
import { fmtAgo, fmtDateTime, statusLabel } from './lib/i18n.js';
import { can } from './lib/state.js';
import { recordHref } from './lib/routes.js';

const LANES = [
  ['failed', 'Giao thất bại · cần xử lý'],
  ['created', 'Chờ xuất phát'],
  ['dispatched', 'Đang giao'],
];

export default function LogisticsDeliveryBoardPage() {
  const [items, setItems] = useState([]);
  const [counts, setCounts] = useState({ created: 0, dispatched: 0, failed: 0 });
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);
  const [deliveryProof, setDeliveryProof] = useState({});

  const load = useCallback(async (quiet = false) => {
    if (!quiet) { setLoading(true); setError(''); }
    try {
      const result = await api(tenantPath('/reports/logistics/delivery-board'));
      setItems(result.items || []);
      setCounts(result.counts || { created: 0, dispatched: 0, failed: 0 });
      setTruncated(Boolean(result.truncated));
      setLastUpdated(new Date().toISOString());
    } catch (reason) {
      setError(reason.message || 'Không tải được bảng điều phối giao hàng.');
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    document.title = 'Điều phối giao hàng · OSP Suite';
    load();
    const timer = window.setInterval(() => load(true), 15000);
    return () => window.clearInterval(timer);
  }, [load]);

  const grouped = useMemo(() => Object.fromEntries(
    LANES.map(([status]) => [status, items.filter((item) => item.status === status)]),
  ), [items]);

  const transition = async (shipment, action) => {
    const key = `${shipment.id}:${action}`;
    setBusy(key);
    setError('');
    try {
      await api(dataPath('logistics.shipment', shipment.id, action), { method: 'POST' });
      await load(true);
    } catch (reason) {
      setError(reason.message || 'Không cập nhật được vận đơn.');
      await load(true);
    } finally {
      setBusy('');
    }
  };

  const confirmDelivered = async (shipment) => {
    const proof = deliveryProof[shipment.id] || {};
    const receivedBy = proof.receivedBy?.trim() || '';
    const evidence = proof.evidence?.trim() || '';
    if (!receivedBy && !evidence) {
      setError('Nhập tên người nhận hoặc mã/bằng chứng giao hàng trước khi xác nhận.');
      return;
    }
    const key = `${shipment.id}:delivered`;
    setBusy(key);
    setError('');
    try {
      await api(dataPath('logistics.shipment', shipment.id, 'delivered'), {
        method: 'POST',
        body: {
          ...(receivedBy ? { received_by: receivedBy } : {}),
          ...(evidence ? { delivery_evidence: evidence } : {}),
        },
      });
      setDeliveryProof((current) => { const next = { ...current }; delete next[shipment.id]; return next; });
      await load(true);
    } catch (reason) {
      setError(reason.message || 'Không hoàn tất được giao hàng. Kiểm tra bằng chứng giao hàng và số lượng đã điều phối.');
      await load(true);
    } finally {
      setBusy('');
    }
  };

  const redeliver = async (shipment) => {
    setBusy(`${shipment.id}:redeliver`);
    setError('');
    try {
      const result = await api(tenantPath(`/reports/logistics/shipments/${encodeURIComponent(shipment.id)}/redeliver`), { method: 'POST' });
      location.hash = recordHref('logistics.shipment', result.id);
    } catch (reason) {
      setError(reason.message || 'Không tạo được vận đơn giao lại.');
      await load(true);
    } finally {
      setBusy('');
    }
  };

  const renderShipment = (shipment) => <article className="card delivery-card" key={shipment.id}>
    <header className="card-head">
      <div>
        {can('logistics.shipment.read') ? <a href={recordHref('logistics.shipment', shipment.id)}><strong>{shipment.carrier || 'Vận đơn'}{shipment.trackingNumber ? ` · ${shipment.trackingNumber}` : ''}</strong></a> : <strong>{shipment.carrier || 'Vận đơn'}{shipment.trackingNumber ? ` · ${shipment.trackingNumber}` : ''}</strong>}
        <div className="small muted">{shipment.party || 'Khách chưa xác định'} · {fmtAgo(shipment.createdAt)}</div>
      </div>
      <span className={`badge ${shipment.status === 'failed' ? 'danger' : shipment.status === 'dispatched' ? 'warning' : 'plain'}`}>{statusLabel(shipment.status)}</span>
    </header>
    <div className="delivery-route"><span>{shipment.origin || 'Kho'}</span><span aria-hidden="true">→</span><strong>{shipment.destination || 'Chưa khai báo điểm giao'}</strong></div>
    <div className="delivery-meta small muted">
      <span>{shipment.driver || 'Chưa phân công tài xế'}</span>
      <span>{shipment.vehicle || 'Chưa phân công xe'}</span>
      {shipment.weight != null && <span>{Number(shipment.weight).toLocaleString(undefined, { maximumFractionDigits: 3 })} kg</span>}
    </div>
    {shipment.failureReason && <div className="alert danger delivery-alert">{shipment.failureReason}</div>}
    {shipment.lastTrackingEvent && <div className="small delivery-tracking"><strong>{statusLabel(shipment.lastTrackingEvent)}</strong>{shipment.lastTrackingLocation && ` · ${shipment.lastTrackingLocation}`}{shipment.lastTrackingAt && ` · ${fmtDateTime(shipment.lastTrackingAt)}`}</div>}
    {shipment.status === 'dispatched' && can('logistics.shipment.delivered') && <div className="delivery-proof" role="group" aria-label="Bằng chứng giao hàng">
      <label className="field"><span>Người nhận hàng (nếu có)</span><input className="input" maxLength="160" value={deliveryProof[shipment.id]?.receivedBy || ''} onChange={(event) => setDeliveryProof((current) => ({ ...current, [shipment.id]: { ...current[shipment.id], receivedBy: event.target.value } }))}/></label>
      <label className="field"><span>Mã POD / bằng chứng giao hàng</span><input className="input" maxLength="1000" value={deliveryProof[shipment.id]?.evidence || ''} onChange={(event) => setDeliveryProof((current) => ({ ...current, [shipment.id]: { ...current[shipment.id], evidence: event.target.value } }))}/></label>
      <p className="small muted">Điền tên người nhận hoặc mã tham chiếu/bằng chứng từ đơn vị vận chuyển.</p>
    </div>}
    <footer className="row wrap delivery-footer">
      {shipment.source === 'sales_order' && shipment.sourceId && can('sales.sales_order.read') && <a className="small" href={recordHref('sales.sales_order', shipment.sourceId)}>Mở đơn bán</a>}
      <span className="grow" />
      {shipment.status === 'created' && can('logistics.shipment.dispatched') && <button className="btn btn-primary" type="button" disabled={Boolean(busy) || !shipment.vehicleId || !shipment.driverId} title={!shipment.vehicleId || !shipment.driverId ? 'Mở vận đơn để phân công xe và tài xế trước khi xuất phát' : ''} onClick={() => transition(shipment, 'dispatched')}>{busy === `${shipment.id}:dispatched` ? 'Đang cập nhật…' : 'Xác nhận xuất phát'}</button>}
      {shipment.status === 'dispatched' && can('logistics.shipment.delivered') && <button className="btn btn-primary" type="button" disabled={Boolean(busy) || !(deliveryProof[shipment.id]?.receivedBy?.trim() || deliveryProof[shipment.id]?.evidence?.trim())} onClick={() => confirmDelivered(shipment)}>{busy === `${shipment.id}:delivered` ? 'Đang cập nhật…' : 'Xác nhận đã giao'}</button>}
      {shipment.status === 'failed' && can('logistics.shipment.create') && <button className="btn btn-secondary" type="button" disabled={Boolean(busy)} onClick={() => redeliver(shipment)}>{busy === `${shipment.id}:redeliver` ? 'Đang tạo…' : 'Tạo vận đơn giao lại'}</button>}
      {shipment.status === 'failed' && can('logistics.shipment.read') && <a className="btn btn-secondary" href={recordHref('logistics.shipment', shipment.id)}>Xem lịch sử</a>}
    </footer>
  </article>;

  return <div className="page">
    <div className="page-head"><div><h1>Điều phối giao hàng</h1><p className="sub">Theo dõi vận đơn cần xử lý, chuyến đang giao và giao thất bại. Xác nhận giao thành công sẽ chạy luồng xuất kho và cập nhật tiến độ đơn bán.</p></div><button className="btn btn-secondary" type="button" disabled={loading} onClick={() => load()}>{loading ? 'Đang tải…' : 'Làm mới'}</button></div>
    <div className="row wrap delivery-summary"><span className="badge plain">Chờ xuất phát: {counts.created}</span><span className="badge warning">Đang giao: {counts.dispatched}</span><span className="badge danger">Cần xử lý: {counts.failed}</span>{lastUpdated && <span className="small muted">Cập nhật lúc {fmtDateTime(lastUpdated)}</span>}</div>
    {error && <div className="alert danger" role="alert">{error}</div>}
    {truncated && <div className="alert warning" role="status">Đang hiển thị tối đa 500 vận đơn đang mở. Xử lý vận đơn để xem các mục cũ hơn.</div>}
    {loading && !lastUpdated ? <div className="card-pad"><div className="skeleton" data-h="row" /></div> : <div className="delivery-board">
      {LANES.map(([status, title]) => <section className="delivery-lane" key={status} aria-labelledby={`delivery-${status}`}>
        <header className="delivery-lane-head"><h2 id={`delivery-${status}`}>{title}</h2><span className="badge plain">{grouped[status].length}</span></header>
        <div className="stack-sm">{grouped[status].map(renderShipment)}{!grouped[status].length && <div className="empty">Không có vận đơn</div>}</div>
      </section>)}
    </div>}
  </div>;
}
