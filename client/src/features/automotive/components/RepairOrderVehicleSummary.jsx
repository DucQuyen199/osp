import React from 'react';
import { fmtDateTime, fmtNumber, statusLabel } from '../../../lib/i18n.js';

export default function RepairOrderVehicleSummary({
  selected,
  vehicle,
  partyName,
  warehouseName,
  latestOdometer,
  currentOdometer,
  odometerReading,
  canUpdateOdometer,
  odometerBusy,
  onOdometerChange,
  onOdometerSubmit,
  t,
}) {
  const statusClass = ['completed', 'delivered'].includes(selected.status)
    ? 'success'
    : selected.status === 'quote_declined' ? 'plain' : 'warning';

  return <>
    <header className="workshop-section-head"><div><h2>{vehicle?.plate || t('Lệnh sửa chữa')}</h2><div className="muted">{partyName} · {warehouseName || t('Chưa chọn kho')}</div></div><span className={`badge ${statusClass}`}>{statusLabel(selected.status)}</span></header>
    <dl className="workshop-summary">
      <div><dt>{t('Xe')}</dt><dd>{[vehicle?.make, vehicle?.model].filter(Boolean).join(' ') || t('Chưa khai báo')}</dd></div>
      <div><dt>{t('Km lúc tiếp nhận')}</dt><dd>{selected.odometer_reading == null ? t('Chưa ghi') : `${fmtNumber(selected.odometer_reading)} km`}</dd></div>
      <div><dt>{t('Km ghi nhận gần nhất')}</dt><dd>{vehicle && latestOdometer != null ? `${fmtNumber(latestOdometer)} km` : '—'}</dd></div>
      <div><dt>{t('VIN')}</dt><dd>{vehicle?.vin || '—'}</dd></div>
      <div><dt>{t('Ngày nhận')}</dt><dd>{fmtDateTime(selected.created_at)}</dd></div>
    </dl>
    {vehicle && canUpdateOdometer && <form className="workshop-form u-margin-12-0" onSubmit={onOdometerSubmit}>
      <label className="field"><span>{t('Số công-tơ-mét hiện tại (km)')}</span><input className="input" type="number" min={currentOdometer ?? 0} step="1" required value={odometerReading} onChange={(event) => onOdometerChange(event.target.value)} /></label>
      <button className="btn" disabled={odometerBusy || odometerReading === '' || Number(odometerReading) === Number(currentOdometer || 0)}>{t('Cập nhật số km')}</button>
      <span className="small muted">{t('Số km không được thấp hơn lần ghi nhận trước hoặc lịch sử xưởng.')}</span>
    </form>}
    {selected.complaint && <p className="workshop-complaint"><strong>{t('Yêu cầu:')}</strong> {selected.complaint}</p>}
    {selected.status === 'quote_declined' && selected.declined_reason && <div className="alert">{t('Khách từ chối báo giá:')} {selected.declined_reason}</div>}
  </>;
}
