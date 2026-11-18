import React from 'react';
import EventTicketsTable from './EventTicketsTable.jsx';

/** Presents the selected event summary and ticket register; operations stay in the page. */
export default function EventTicketRegister({
  eventName,
  venueLabel,
  startsAtLabel,
  ticketPriceLabel,
  remaining,
  capacity,
  showPublish,
  showClose,
  busy,
  tickets,
  partyName,
  paymentMethods,
  ticketMethods,
  refundReasons,
  permissions,
  fmtDateTime,
  statusLabel,
  price,
  t,
  onPublish,
  onClose,
  onMethodChange,
  onRefundReasonChange,
  onTicketAction,
  children,
}) {
  return <>
    <div className="row wrap u-margin-12-0">
      <div>
        <strong>{eventName}</strong>
        <div className="small muted">{venueLabel} · {startsAtLabel} · {t('Vé')} {ticketPriceLabel} · {t('Còn')} {remaining}/{capacity}</div>
      </div>
      <span className="grow" />
      {showPublish && <button className="btn btn-primary btn-sm" disabled={busy} onClick={onPublish}>{t('Công bố')}</button>}
      {showClose && <button className="btn btn-secondary btn-sm" disabled={busy} onClick={onClose}>{t('Đóng bán vé')}</button>}
    </div>
    {children}
    {!tickets.length ? <div className="empty">{t('Chưa có vé cho sự kiện này.')}</div> : <EventTicketsTable
      tickets={tickets}
      partyName={partyName}
      paymentMethods={paymentMethods}
      ticketMethods={ticketMethods}
      refundReasons={refundReasons}
      busy={busy}
      permissions={permissions}
      fmtDateTime={fmtDateTime}
      statusLabel={statusLabel}
      price={price}
      t={t}
      onMethodChange={onMethodChange}
      onRefundReasonChange={onRefundReasonChange}
      onAction={onTicketAction}
    />}
    <p className="small muted">{t('Bán vé ghi nhận thanh toán và thuế. Check-in chỉ mở từ 2 giờ trước đến 24 giờ sau giờ bắt đầu; vé đã check-in không thể hoàn.')}</p>
  </>;
}
