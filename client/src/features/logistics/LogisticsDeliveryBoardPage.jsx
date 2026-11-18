import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useDocumentTitle } from '../../lib/useDocumentTitle.js';
import { useLatestRequest } from '../../lib/useLatestRequest.js';
import { api, dataPath, tenantPath } from '../../lib/api.js';
import { fmtAgo, fmtDateTime, statusLabel, fmtNumber, uiTextWith } from '../../lib/i18n.js';
import { can } from '../../lib/state.js';
import { recordHref } from '../../lib/routes.js';
import { compareDecimals } from '../../lib/decimal.js';
import { isDeliveredShort, isDeliveredWithinLimit, sameDeliveryLine } from './domain/deliveryQuantities.js';
import logisticsEnglish from './logistics.en.js';
const t = (text) => uiTextWith(text, logisticsEnglish);
const PAGE_SIZE = 100;
const LANES = [
  ['failed', 'Giao thất bại · cần xử lý'],
  ['partial', 'Giao thiếu · cần giao bù'],
  ['created', 'Chờ xuất phát'],
  ['dispatched', 'Đang giao'],
];
export default function LogisticsDeliveryBoardPage() {
  useDocumentTitle(`${t('Điều phối giao hàng')} · OSP Suite`);
  const [items, setItems] = useState([]);
  const [counts, setCounts] = useState({ created: 0, dispatched: 0, failed: 0, partial: 0 });
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);
  const [deliveryProof, setDeliveryProof] = useState({});
  const latestRequest = useLatestRequest();
  const load = useCallback(async (quiet = false) => {
    const isLatest = latestRequest();
    if (!quiet) { setLoading(true); setError(''); }
    try {
      const result = await api(tenantPath(`/reports/logistics/delivery-board?limit=${PAGE_SIZE}&offset=${offset}`));
      if (isLatest()) {
        setItems(result.items || []);
        setCounts(result.counts || { created: 0, dispatched: 0, failed: 0, partial: 0 });
        setTotal(Number(result.itemCount || 0));
        setHasMore(Boolean(result.hasMore));
        setLastUpdated(new Date().toISOString());
      }
    } catch (reason) {
      if (isLatest()) setError(reason.message || t('Không tải được bảng điều phối giao hàng.'));
    } finally {
      if (isLatest()) setLoading(false);
    }
  }, [offset, latestRequest]);
  useEffect(() => { load();
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
      setError(reason.message || t('Không cập nhật được vận đơn.'));
      await load(true);
    } finally {
      setBusy('');
    }
  };
  const confirmDelivered = async (shipment) => {
    const proof = deliveryProof[shipment.id] || {};
    const receivedBy = proof.receivedBy?.trim() || '';
    const evidence = proof.evidence?.trim() || '';
    const lines = shipment.lines || [];
    const deliveredLines = lines.map((line, index) => {
      const receivedQty = String(proof.deliveredQuantities?.[index] ?? line.qty ?? '0');
      const shipmentLine = { ...line };
      delete shipmentLine.productName;
      return {
        ...shipmentLine,
        qty: receivedQty,
      };
    }).filter((line) => { try { return compareDecimals(line.qty, '0') > 0; } catch { return false; } });
    const invalidQuantity = lines.some((line, index) => {
      const receivedValue = proof.deliveredQuantities?.[index] ?? line.qty ?? 0;
      try { return compareDecimals(receivedValue, '0') < 0 || !isDeliveredWithinLimit(receivedValue, line.qty || 0); } catch { return true; }
    });
    const hasShortDelivery = lines.some((line, index) => isDeliveredShort(
      proof.deliveredQuantities?.[index] ?? line.qty ?? 0,
      line.qty || 0,
    ));
    const shortReason = proof.shortDeliveryReason?.trim() || '';
    if (!receivedBy && !evidence) {
      setError(t('Nhập tên người nhận hoặc mã/bằng chứng giao hàng trước khi xác nhận.'));
      return;
    }
    if (!deliveredLines.length || invalidQuantity) {
      setError(t('Số lượng giao thực tế phải hợp lệ và không vượt số lượng trên vận đơn.'));
      return;
    }
    if (hasShortDelivery && (shortReason.length < 5 || shortReason.length > 500)) {
      setError(t('Giao thiếu cần lý do từ 5 đến 500 ký tự.'));
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
          delivered_lines: deliveredLines,
          ...(hasShortDelivery ? { short_delivery_reason: shortReason } : {}),
        },
      });
      setDeliveryProof((current) => { const next = { ...current }; delete next[shipment.id]; return next; });
      await load(true);
    } catch (reason) {
      setError(reason.message || t('Không hoàn tất được giao hàng. Kiểm tra bằng chứng giao hàng và số lượng đã điều phối.'));
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
      setError(reason.message || t('Không tạo được vận đơn giao lại.'));
      await load(true);
    } finally {
      setBusy('');
    }
  };
  const renderShipment = (shipment) => <article className="card delivery-card" key={shipment.id}>
    <header className="card-head">
      <div>
        {can('logistics.shipment.read') ? <a href={recordHref('logistics.shipment', shipment.id)}><strong>{shipment.carrier || t('Vận đơn')}{shipment.trackingNumber ? ` · ${shipment.trackingNumber}` : ''}</strong></a> : <strong>{shipment.carrier || t('Vận đơn')}{shipment.trackingNumber ? ` · ${shipment.trackingNumber}` : ''}</strong>}
        <div className="small muted">{shipment.party || t('Khách chưa xác định')} · {fmtAgo(shipment.createdAt)}</div>
      </div>
      <span className={`badge ${shipment.status === 'failed' ? 'danger' : shipment.status === 'dispatched' || shipment.status === 'partial' ? 'warning' : 'plain'}`}>{shipment.status === 'partial' ? t('Giao thiếu · cần giao bù') : statusLabel(shipment.status)}</span>
    </header>
    <div className="delivery-route"><span>{shipment.origin || t('Kho')}</span><span aria-hidden="true">→</span><strong>{shipment.destination || t('Chưa khai báo điểm giao')}</strong></div>
    {shipment.status === 'partial' && <div className="alert warning delivery-alert">
      <strong>{t('Lý do giao thiếu:')}</strong> {shipment.shortDeliveryReason || t('Chưa ghi lý do')}
      <div className="small u-legacy-301647f506" ><strong>{t('Đã nhận thực tế:')}</strong> {(shipment.deliveredLines || []).map((line, index) => {
        const sourceLine = (shipment.lines || []).find((item) => sameDeliveryLine(item, line));
        return <span key={`${line.product}-${index}`}> {sourceLine?.productName || line.name || line.product} {fmtNumber(line.qty || 0, { maximumFractionDigits: 6 })} {line.uom_name || ''}{index < shipment.deliveredLines.length - 1 ? ' ·' : ''}</span>;
      })}</div>
      <div className="small"><strong>{t('Còn giao bù:')}</strong> {(shipment.remainingLines || []).map((line, index) => <span key={`${line.product}-${index}`}> {(shipment.lines || []).find((item) => sameDeliveryLine(item, line))?.productName || line.name || line.product} {fmtNumber(line.qty || 0, { maximumFractionDigits: 6 })} {line.uom_name || ''}{index < shipment.remainingLines.length - 1 ? ' ·' : ''}</span>)}</div>
    </div>}
    <div className="delivery-meta small muted">
      <span>{shipment.driver || t('Chưa phân công tài xế')}</span>
      <span>{shipment.vehicle || t('Chưa phân công xe')}</span>
      {shipment.weight != null && <span>{fmtNumber(Number(shipment.weight), { maximumFractionDigits: 3 })} kg</span>}
    </div>
    {shipment.failureReason && <div className="alert danger delivery-alert">{shipment.failureReason}</div>}
    {shipment.lastTrackingEvent && <div className="small delivery-tracking"><strong>{statusLabel(shipment.lastTrackingEvent)}</strong>{shipment.lastTrackingLocation && ` · ${shipment.lastTrackingLocation}`}{shipment.lastTrackingAt && ` · ${fmtDateTime(shipment.lastTrackingAt)}`}</div>}
    {shipment.status === 'dispatched' && can('logistics.shipment.delivered') && <div className="delivery-proof" role="group" aria-label={t('Bằng chứng giao hàng')}>
      <div className="delivery-proof-lines">
        <strong>{t('Số lượng thực nhận theo vận đơn')}</strong>
        {(shipment.lines || []).map((line, index) => <label className="field" key={`${line.product || 'line'}-${index}`}>
          <span>{line.productName || line.name || line.product || `${t('Mặt hàng')} ${index + 1}`} · {t('đã điều phối')} {line.qty} {line.uom_name || ''}</span>
          <input className="input num" aria-label={`${t('Số lượng thực nhận dòng')} ${index + 1}`} type="number" min="0" max={line.qty} step="any" value={deliveryProof[shipment.id]?.deliveredQuantities?.[index] ?? line.qty} onChange={(event) => setDeliveryProof((current) => ({ ...current, [shipment.id]: { ...current[shipment.id], deliveredQuantities: { ...current[shipment.id]?.deliveredQuantities, [index]: event.target.value } } }))}/>
        </label>)}
      </div>
      {(shipment.lines || []).some((line, index) => isDeliveredShort(deliveryProof[shipment.id]?.deliveredQuantities?.[index] ?? line.qty ?? 0, line.qty || 0)) && <label className="field"><span>{t('Lý do giao thiếu (bắt buộc, 5–500 ký tự)')}</span><textarea className="input" rows="2" maxLength="500" value={deliveryProof[shipment.id]?.shortDeliveryReason || ''} onChange={(event) => setDeliveryProof((current) => ({ ...current, [shipment.id]: { ...current[shipment.id], shortDeliveryReason: event.target.value } }))}/></label>}
      <label className="field"><span>{t('Người nhận hàng (nếu có)')}</span><input className="input" maxLength="160" value={deliveryProof[shipment.id]?.receivedBy || ''} onChange={(event) => setDeliveryProof((current) => ({ ...current, [shipment.id]: { ...current[shipment.id], receivedBy: event.target.value } }))}/></label>
      <label className="field"><span>{t('Mã POD / bằng chứng giao hàng')}</span><input className="input" maxLength="1000" value={deliveryProof[shipment.id]?.evidence || ''} onChange={(event) => setDeliveryProof((current) => ({ ...current, [shipment.id]: { ...current[shipment.id], evidence: event.target.value } }))}/></label>
      <p className="small muted">{t('Điền tên người nhận hoặc mã tham chiếu/bằng chứng từ đơn vị vận chuyển.')}</p>
    </div>}
    <footer className="row wrap delivery-footer">
      {shipment.source === 'sales_order' && shipment.sourceId && can('sales.sales_order.read') && <a className="small" href={recordHref('sales.sales_order', shipment.sourceId)}>{t('Mở đơn bán')}</a>}
      <span className="grow" />
      {shipment.status === 'created' && can('logistics.shipment.dispatched') && <button className="btn btn-primary" type="button" disabled={Boolean(busy) || !shipment.vehicleId || !shipment.driverId} title={!shipment.vehicleId || !shipment.driverId ? t('Mở vận đơn để phân công xe và tài xế trước khi xuất phát') : ''} onClick={() => transition(shipment, 'dispatched')}>{busy === `${shipment.id}:dispatched` ? t('Đang cập nhật…') : t('Xác nhận xuất phát')}</button>}
      {shipment.status === 'dispatched' && can('logistics.shipment.delivered') && <button className="btn btn-primary" type="button" disabled={Boolean(busy) || !(deliveryProof[shipment.id]?.receivedBy?.trim() || deliveryProof[shipment.id]?.evidence?.trim())} onClick={() => confirmDelivered(shipment)}>{busy === `${shipment.id}:delivered` ? t('Đang cập nhật…') : t('Xác nhận đã giao')}</button>}
      {(shipment.status === 'failed' || shipment.status === 'partial') && can('logistics.shipment.create') && <button className="btn btn-secondary" type="button" disabled={Boolean(busy)} onClick={() => redeliver(shipment)}>{busy === `${shipment.id}:redeliver` ? t('Đang tạo…') : t(shipment.status === 'partial' ? 'Tạo vận đơn giao bù' : 'Tạo vận đơn giao lại')}</button>}
      {shipment.status === 'failed' && can('logistics.shipment.read') && <a className="btn btn-secondary" href={recordHref('logistics.shipment', shipment.id)}>{t('Xem lịch sử')}</a>}
    </footer>
  </article>;
  return <div className="page">
    <div className="page-head"><div><h1>{t('Điều phối giao hàng')}</h1><p className="sub">{t('Theo dõi vận đơn cần xử lý, chuyến đang giao và giao thất bại. Xác nhận giao thành công sẽ chạy luồng xuất kho và cập nhật tiến độ đơn bán.')}</p></div><button className="btn btn-secondary" type="button" disabled={loading} onClick={() => load()}>{loading ? t('Đang tải…') : t('Làm mới')}</button></div>
    <div className="row wrap delivery-summary"><span className="badge plain">{t('Chờ xuất phát')}: {counts.created}</span><span className="badge warning">{t('Đang giao')}: {counts.dispatched}</span><span className="badge danger">{t('Giao thất bại')}: {counts.failed}</span><span className="badge warning">{t('Giao thiếu')}: {counts.partial}</span>{lastUpdated && <span className="small muted">{t('Cập nhật lúc')} {fmtDateTime(lastUpdated)}</span>}</div>
    {error && <div className="alert danger" role="alert">{t(error)}</div>}
    {loading && !lastUpdated ? <div className="card-pad"><div className="skeleton" data-h="row" /></div> : <div className="delivery-board">
      {LANES.map(([status, title]) => <section className="delivery-lane" key={status} aria-labelledby={`delivery-${status}`}>
        <header className="delivery-lane-head"><h2 id={`delivery-${status}`}>{t(title)}</h2><span className="badge plain">{counts[status]}</span></header>
        <div className="stack-sm">{grouped[status].map(renderShipment)}{!grouped[status].length && <div className="empty">{counts[status] > 0 ? t('Vận đơn ở trang khác') : t('Không có vận đơn')}</div>}</div>
      </section>)}
    </div>}
    <nav className="row wrap" aria-label={t('Phân trang điều phối giao hàng')}>
      <span className="small muted" aria-live="polite">{t('Đang hiển thị {from}–{to} trên {total} vận đơn').replace('{from}', String(total ? offset + 1 : 0)).replace('{to}', String(Math.min(offset + items.length, total))).replace('{total}', String(total))}{loading ? ` · ${t('Đang tải…')}` : ''}</span>
      <span className="grow" />
      <button className="btn btn-secondary btn-sm" type="button" disabled={loading || offset === 0} onClick={() => setOffset((current) => Math.max(0, current - PAGE_SIZE))}>{t('Trang trước')}</button>
      <button className="btn btn-secondary btn-sm" type="button" disabled={loading || !hasMore} onClick={() => setOffset((current) => current + PAGE_SIZE)}>{t('Trang sau')}</button>
    </nav>
  </div>;
}
