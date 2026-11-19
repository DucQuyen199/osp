import React from 'react';

/** Controlled shipment and proof-of-delivery details presentation. */
export default function DeliveryShipmentDetails({
  title,
  shipmentHref,
  partyLabel,
  ageLabel,
  badgeClass,
  badgeLabel,
  originLabel,
  destinationLabel,
  routeLabel,
  routeStopLabel,
  isPartial,
  shortDeliveryReason,
  deliveredLines,
  remainingLines,
  driverLabel,
  vehicleLabel,
  weightLabel,
  failureReason,
  trackingStatus,
  trackingLocation,
  trackingAt,
  t,
}) {
  return <>
    <header className="card-head">
      <div>
        {shipmentHref ? <a href={shipmentHref}><strong>{title}</strong></a> : <strong>{title}</strong>}
        <div className="small muted">{partyLabel} · {ageLabel}</div>
      </div>
      <span className={`badge ${badgeClass}`}>{badgeLabel}</span>
    </header>
    <div className="delivery-route"><span>{originLabel}</span><span aria-hidden="true">→</span><strong>{destinationLabel}</strong></div>
    {(routeLabel || routeStopLabel) && <div className="small muted">{routeLabel}{routeLabel && routeStopLabel ? ' · ' : ''}{routeStopLabel}</div>}
    {isPartial && <div className="alert warning delivery-alert">
      <strong>{t('Lý do giao thiếu:')}</strong> {shortDeliveryReason || t('Chưa ghi lý do')}
      <div className="small u-mt-6"><strong>{t('Đã nhận thực tế:')}</strong>{deliveredLines.map((line, index) => <span key={line.key}> {line.label}{index < deliveredLines.length - 1 ? ' ·' : ''}</span>)}</div>
      <div className="small"><strong>{t('Còn giao bù:')}</strong>{remainingLines.map((line, index) => <span key={line.key}> {line.label}{index < remainingLines.length - 1 ? ' ·' : ''}</span>)}</div>
    </div>}
    <div className="delivery-meta small muted">
      <span>{driverLabel}</span>
      <span>{vehicleLabel}</span>
      {weightLabel && <span>{weightLabel}</span>}
    </div>
    {failureReason && <div className="alert danger delivery-alert">{failureReason}</div>}
    {trackingStatus && <div className="small delivery-tracking"><strong>{trackingStatus}</strong>{trackingLocation && ` · ${trackingLocation}`}{trackingAt && ` · ${trackingAt}`}</div>}
  </>;
}
