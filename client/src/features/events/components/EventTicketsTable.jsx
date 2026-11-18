import React from 'react';

/** Controlled ticket register; the workbench owns ticket rules and actions. */
export default function EventTicketsTable({
  tickets = [],
  partyName,
  paymentMethods,
  ticketMethods,
  refundReasons,
  busy,
  permissions,
  fmtDateTime,
  statusLabel,
  price,
  t,
  onMethodChange,
  onRefundReasonChange,
  onAction,
}) {
  return <div className="table-wrap"><table className="table">
    <thead><tr><th>{t('Mã vé')}</th><th>{t('Người tham dự')}</th><th>{t('Giá vé')}</th><th>{t('Trạng thái')}</th><th>{t('Hạn giữ chỗ')}</th><th>{t('Thao tác')}</th></tr></thead>
    <tbody>{tickets.map((ticket) => <tr key={ticket.id}>
      <td className="mono small">{ticket.ticket_code || '—'}</td>
      <td>{partyName(ticket.party) || t('Khách tham dự')}</td>
      <td>{price(ticket.price)}</td>
      <td>{statusLabel(ticket.status)}{ticket.method && <div className="small muted">{statusLabel(ticket.method)}</div>}</td>
      <td>{ticket.reservation_expires_at ? fmtDateTime(ticket.reservation_expires_at) : '—'}{ticket.status === 'reserved' && ticket.expired && <div className="small muted">{t('Đã hết hạn; tác vụ nền sẽ giải phóng chỗ.')}</div>}</td>
      <td className="row wrap">
        {ticket.status === 'reserved' && permissions.sell && permissions.update && <>
          <select className="select" aria-label={t('Phương thức thanh toán vé')} value={ticketMethods[ticket.id] || ticket.method || ''} onChange={(event) => onMethodChange(ticket, event.target.value)}>
            <option value="">{t('Phương thức')}</option>
            {paymentMethods.map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
          </select>
          <button className="btn btn-primary btn-sm" disabled={busy || ticket.expired || !(ticketMethods[ticket.id] || ticket.method)} onClick={() => onAction(ticket, 'sold')}>{t('Bán vé')}</button>
          {permissions.cancel && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => onAction(ticket, 'cancelled')}>{t('Hủy giữ chỗ')}</button>}
        </>}
        {ticket.status === 'sold' && permissions.checkIn && <button className="btn btn-primary btn-sm" disabled={busy || !ticket.checkInWindow} title={!ticket.checkInWindow ? t('Check-in mở từ 2 giờ trước đến 24 giờ sau giờ bắt đầu') : undefined} onClick={() => onAction(ticket, 'checked_in')}>{t('Check-in')}</button>}
        {ticket.status === 'sold' && permissions.refund && permissions.update && <>
          <input className="input" aria-label={t('Lý do hoàn vé')} placeholder={t('Lý do hoàn vé')} maxLength="500" value={refundReasons[ticket.id] || ''} onChange={(event) => onRefundReasonChange(ticket, event.target.value)} />
          <button className="btn btn-ghost btn-sm" disabled={busy || !refundReasons[ticket.id]?.trim() || !ticket.refundWindow} onClick={() => onAction(ticket, 'refunded')}>{t('Hoàn vé')}</button>
        </>}
      </td>
    </tr>)}</tbody>
  </table></div>;
}
