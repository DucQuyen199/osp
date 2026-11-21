import React, { useMemo } from 'react';
import { useDocumentTitle } from '../../lib/useDocumentTitle.js';
import { fmtAgo, fmtDateTime, statusLabel, fmtNumber, uiTextWith } from '../../lib/i18n.js';
import { can } from '../../lib/state.js';
import { recordHref } from '../../lib/routes.js';
import { isDeliveredShort, sameDeliveryLine } from './domain/deliveryQuantities.js';
import logisticsEnglish from './logistics.en.js';
import DeliveryProofFields from './components/DeliveryProofFields.jsx';
import DeliveryShipmentDetails from './components/DeliveryShipmentDetails.jsx';
import { useLogisticsDeliveryData } from './hooks/useLogisticsDeliveryData.js';
import { useLogisticsDeliveryWorkflow } from './hooks/useLogisticsDeliveryWorkflow.js';
const t = (text) => uiTextWith(text, logisticsEnglish);
const LANES = [
  ['failed', 'Giao thất bại · cần xử lý'],
  ['partial', 'Giao thiếu · cần giao bù'],
  ['created', 'Chờ xuất phát'],
  ['dispatched', 'Đang giao'],
];
export default function LogisticsDeliveryBoardPage() {
  useDocumentTitle(`${t('Điều phối giao hàng')} · OSP Suite`);
  const {
    items, counts, total, offset, setOffset, hasMore, error, setError,
    loading, lastUpdated, load,
  } = useLogisticsDeliveryData();
  const {
    busy, deliveryProof, transition, confirmDelivered, redeliver, changeDeliveredQuantity,
    changeShortDeliveryReason, changeReceivedBy, changeEvidence,
  } = useLogisticsDeliveryWorkflow({ load, setError, t });
  const grouped = useMemo(() => Object.fromEntries(
    LANES.map(([status]) => [status, items.filter((item) => item.status === status)]),
  ), [items]);
  const renderShipment = (shipment) => {
    const shipmentTitle = `${shipment.carrier || t('Vận đơn')}${shipment.trackingNumber ? ` · ${shipment.trackingNumber}` : ''}`;
    const deliveredLines = (shipment.deliveredLines || []).map((line, index) => {
      const sourceLine = (shipment.lines || []).find((item) => sameDeliveryLine(item, line));
      return {
        key: `${line.product}-${index}`,
        label: `${sourceLine?.productName || line.name || line.product} ${fmtNumber(line.qty || 0, { maximumFractionDigits: 6 })} ${line.uom_name || ''}`,
      };
    });
    const remainingLines = (shipment.remainingLines || []).map((line, index) => ({
      key: `${line.product}-${index}`,
      label: `${(shipment.lines || []).find((item) => sameDeliveryLine(item, line))?.productName || line.name || line.product} ${fmtNumber(line.qty || 0, { maximumFractionDigits: 6 })} ${line.uom_name || ''}`,
    }));
    const routeStop = shipment.routeStop;
    const stopName = typeof routeStop === 'string'
      ? routeStop
      : routeStop && typeof routeStop === 'object'
        ? routeStop.name || routeStop.address || routeStop.label || routeStop.location || JSON.stringify(routeStop)
        : '';
    return <article className="card delivery-card" key={shipment.id}>
      <DeliveryShipmentDetails
        title={shipmentTitle}
        shipmentHref={can('logistics.shipment.read') ? recordHref('logistics.shipment', shipment.id) : ''}
        partyLabel={shipment.party || t('Khách chưa xác định')}
        ageLabel={fmtAgo(shipment.createdAt)}
        badgeClass={shipment.status === 'failed' ? 'danger' : shipment.status === 'dispatched' || shipment.status === 'partial' ? 'warning' : 'plain'}
        badgeLabel={shipment.status === 'partial' ? t('Giao thiếu · cần giao bù') : statusLabel(shipment.status)}
        originLabel={shipment.origin || t('Kho')}
        destinationLabel={shipment.destination || t('Chưa khai báo điểm giao')}
        routeLabel={shipment.route ? `${t('Tuyến')}: ${shipment.route}` : ''}
        routeStopLabel={stopName ? `${t('Điểm dừng')} ${shipment.routeStopNumber}: ${stopName}` : ''}
        isPartial={shipment.status === 'partial'}
        shortDeliveryReason={shipment.shortDeliveryReason}
        deliveredLines={deliveredLines}
        remainingLines={remainingLines}
        driverLabel={shipment.driver || t('Chưa phân công tài xế')}
        vehicleLabel={shipment.vehicle || t('Chưa phân công xe')}
        weightLabel={shipment.weight != null ? `${fmtNumber(String(shipment.weight), { maximumFractionDigits: 3 })} kg` : ''}
        failureReason={shipment.failureReason}
        trackingStatus={shipment.lastTrackingEvent ? statusLabel(shipment.lastTrackingEvent) : ''}
        trackingLocation={shipment.lastTrackingLocation}
        trackingAt={shipment.lastTrackingAt ? fmtDateTime(shipment.lastTrackingAt) : ''}
        t={t}
      />
      {shipment.status === 'dispatched' && can('logistics.shipment.delivered') && <DeliveryProofFields
      shipment={shipment} proof={deliveryProof[shipment.id] || {}}
      hasShortDelivery={(shipment.lines || []).some((line, index) => isDeliveredShort(deliveryProof[shipment.id]?.deliveredQuantities?.[index] ?? line.qty ?? 0, line.qty || 0))}
      t={t}
      onQuantityChange={(index, value) => changeDeliveredQuantity(shipment.id, index, value)}
      onShortReasonChange={(value) => changeShortDeliveryReason(shipment.id, value)}
      onReceivedByChange={(value) => changeReceivedBy(shipment.id, value)}
      onEvidenceChange={(value) => changeEvidence(shipment.id, value)}
    />}
    <footer className="row wrap delivery-footer">
      {shipment.source === 'sales_order' && shipment.sourceId && can('sales.sales_order.read') && <a className="small" href={recordHref('sales.sales_order', shipment.sourceId)}>{t('Mở đơn bán')}</a>}
      <span className="grow" />
      {shipment.status === 'created' && can('logistics.shipment.dispatched') && <button className="btn btn-primary" type="button" disabled={Boolean(busy) || !shipment.vehicleId || !shipment.driverId} title={!shipment.vehicleId || !shipment.driverId ? t('Mở vận đơn để phân công xe và tài xế trước khi xuất phát') : ''} onClick={() => transition(shipment, 'dispatched')}>{busy === `${shipment.id}:dispatched` ? t('Đang cập nhật…') : t('Xác nhận xuất phát')}</button>}
      {shipment.status === 'dispatched' && can('logistics.shipment.delivered') && <button className="btn btn-primary" type="button" disabled={Boolean(busy) || !(deliveryProof[shipment.id]?.receivedBy?.trim() || deliveryProof[shipment.id]?.evidence?.trim())} onClick={() => confirmDelivered(shipment)}>{busy === `${shipment.id}:delivered` ? t('Đang cập nhật…') : t('Xác nhận đã giao')}</button>}
      {(shipment.status === 'failed' || shipment.status === 'partial') && can('logistics.shipment.create') && <button className="btn btn-secondary" type="button" disabled={Boolean(busy)} onClick={() => redeliver(shipment)}>{busy === `${shipment.id}:redeliver` ? t('Đang tạo…') : t(shipment.status === 'partial' ? 'Tạo vận đơn giao bù' : 'Tạo vận đơn giao lại')}</button>}
      {shipment.status === 'failed' && can('logistics.shipment.read') && <a className="btn btn-secondary" href={recordHref('logistics.shipment', shipment.id)}>{t('Xem lịch sử')}</a>}
    </footer>
    </article>;
  };
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
