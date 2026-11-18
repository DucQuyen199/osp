import React from 'react';
import { recordHref } from '../../../lib/routes.js';

export default function SelectedReservationPanel({
  reservation,
  guestLabel,
  roomTypeName,
  assignedRoomNumber,
  availableRooms,
  assignment,
  onAssignmentChange,
  onAssignRoom,
  canAssignRoom,
  showRoomAssignment,
  statusTone,
  statusLabel,
  t,
  fmtDate,
  fmtMoney,
  noShowReason,
  showNoShowTools,
  noShowHasCharges,
  canRecordNoShow,
  onNoShowReasonChange,
  onNoShow,
  busy,
  canCheckIn,
  canCheckOut,
  canCancel,
  onTransition,
  invoice,
  canOpenInvoice,
  selectedCharges,
  canAddCharge,
  chargeDescription,
  chargeAmount,
  onChargeDescriptionChange,
  onChargeAmountChange,
  onAddCharge,
  extensionPanel,
}) {
  return <>
    <article className="card hotel-detail-card">
      <header className="hotel-detail-head">
        <div>
          <h2>{guestLabel}</h2>
          <p className="small muted">{roomTypeName} · {reservation.guest_count || 1} {t('khách')} · {reservation.nights || '—'} {t('đêm')} · {fmtDate(reservation.check_in)} {t('đến')} {fmtDate(reservation.check_out)}</p>
        </div>
        <span className={`badge ${statusTone}`}>{statusLabel(reservation.status)}</span>
      </header>
      <div className="hotel-folio-total"><span>{t('Phòng')} {reservation.room ? assignedRoomNumber || '' : t('chưa phân')} · {fmtMoney(reservation.nightly_rate || 0)} / {t('đêm')}</span><strong>{fmtMoney(reservation.total || 0)}</strong></div>
      {reservation.status === 'no_show' && reservation.no_show_reason && <div className="alert warning" role="status">{t('Lý do khách vắng mặt:')} {reservation.no_show_reason}</div>}
      {showRoomAssignment && <div className="hotel-checkin-tools">
        <label className="field"><span className="label">{t('Phân phòng')}</span><select className="select" value={assignment} onChange={(event) => onAssignmentChange(event.target.value)}><option value="">{availableRooms.length ? t('Chọn phòng không trùng lịch') : t('Không còn phòng theo lịch ngày này')}</option>{availableRooms.map((room) => <option key={room.id} value={room.id}>{room.number}{room.floor ? ` · ${t('Tầng')} ${room.floor}` : ''}{room.status !== 'vacant' ? ` · ${statusLabel(room.status)} ${t('hiện tại')}` : ''}</option>)}</select></label>
        <button className="btn btn-secondary" type="button" disabled={Boolean(busy) || !assignment || assignment === reservation.room || !canAssignRoom} onClick={onAssignRoom}>{t('Lưu phòng')}</button>
      </div>}
      {showNoShowTools && <div className="hotel-no-show-tools">
        {noShowHasCharges && <div className="alert warning" role="status">{t('Đặt phòng còn phí folio; cần xử lý folio trước khi ghi nhận khách vắng mặt.')}</div>}
        <label className="field"><span className="label">{t('Lý do khách vắng mặt *')}</span><textarea className="textarea" rows="2" maxLength="500" required value={noShowReason} onChange={(event) => onNoShowReasonChange(event.target.value)} placeholder={t('Ví dụ: khách không đến, không liên lạc được')} /></label>
        {canRecordNoShow && <button className="btn btn-secondary" type="button" disabled={Boolean(busy) || !noShowReason.trim()} onClick={onNoShow}>{t('Ghi nhận khách vắng mặt')}</button>}
      </div>}
      <footer className="row wrap hotel-detail-actions">
        {canCheckIn && <button className="btn btn-primary" type="button" disabled={Boolean(busy) || !reservation.room} title={!reservation.room ? t('Phân phòng trước khi nhận khách') : ''} onClick={() => onTransition('checked_in')}>{t('Nhận phòng')}</button>}
        {canCheckOut && <button className="btn btn-primary" type="button" disabled={Boolean(busy)} onClick={() => onTransition('checked_out')}>{t('Trả phòng · chốt folio')}</button>}
        {canCancel && <button className="btn btn-secondary" type="button" disabled={Boolean(busy)} onClick={() => onTransition('cancelled')}>{t('Hủy đặt phòng')}</button>}
        {invoice && canOpenInvoice && <a className="btn btn-secondary" href={recordHref('accounting.invoice', invoice.id)}>{t('Mở hóa đơn ·')} {statusLabel(invoice.status)}</a>}
      </footer>
    </article>
    {extensionPanel}
    <article className="card hotel-detail-card">
      <header className="hotel-detail-head"><div><h3>{t('Folio và phí phát sinh')}</h3><p className="small muted">{t('Các khoản ghi vào folio sẽ cộng vào hóa đơn khi trả phòng.')}</p></div><strong>{fmtMoney(reservation.total || 0)}</strong></header>
      {selectedCharges.length ? <div className="hotel-charge-list">{selectedCharges.map((charge) => <div className="hotel-charge-row" key={charge.id}><span>{charge.description}</span><strong>{fmtMoney(charge.amount)}</strong></div>)}</div> : <div className="small muted">{t('Chưa có phí phát sinh.')}</div>}
      {canAddCharge && <form className="hotel-charge-form" onSubmit={onAddCharge}>
        <label className="field"><span className="label">{t('Mô tả khoản phí *')}</span><input className="input" required maxLength={500} value={chargeDescription} onChange={(event) => onChargeDescriptionChange(event.target.value)} placeholder={t('Ví dụ: minibar, giặt ủi')} /></label>
        <label className="field"><span className="label">{t('Số tiền *')}</span><input className="input num" required type="number" min="0" step="any" value={chargeAmount} onChange={(event) => onChargeAmountChange(event.target.value)} /></label>
        <button className="btn btn-secondary" type="submit" disabled={Boolean(busy)}>{busy === 'charge' ? t('Đang ghi…') : t('Ghi phí')}</button>
      </form>}
    </article>
  </>;
}
