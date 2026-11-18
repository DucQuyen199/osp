import React from 'react';
import { fmtDateTime, fmtMoney, statusLabel } from '../../../lib/i18n.js';
import { recordHref } from '../../../lib/routes.js';
import { compareDecimals } from '../../../lib/decimal.js';
import RestaurantOrderLineItems from './RestaurantOrderLineItems.jsx';

export default function RestaurantOrderDetailPanel({
  selected,
  tableName,
  products,
  selectedTickets,
  selectedPayment,
  selectedNeedsWarehouse,
  hasUnreadyTickets,
  busy,
  method,
  cancellationReason,
  canSend,
  canCancel,
  canServe,
  canCancelSent,
  canComplete,
  onTransition,
  onMethodChange,
  onCancellationReasonChange,
  methods,
  lineTotal,
  t,
}) {
  if (!selected) return <section className="restaurant-order-detail card"><div className="card-pad muted">{t('Chọn order để theo dõi và xử lý.')}</div></section>;

  const statusClass = selected.status === 'completed' ? 'success' : selected.status === 'cancelled' ? 'plain' : 'warning';

  return <section className="restaurant-order-detail card">
    <header className="restaurant-order-card-head"><div><h2>{tableName || t('Mang đi')}</h2><span className="small muted">{fmtDateTime(selected.created_at)}{selected.table ? ` · ${selected.guest_count || 1} ${t('khách')}` : ''}</span></div><span className={`badge ${statusClass}`}>{statusLabel(selected.status)}</span></header>
    {selected.cancellation_reason && <div className="small muted">{t('Lý do hủy:')} {selected.cancellation_reason}</div>}
    <RestaurantOrderLineItems lines={selected.lines || []} products={products} lineTotal={lineTotal} t={t} />
    {compareDecimals(selected.tax_total || 0, '0') > 0 && <div className="restaurant-tax-total"><span>{t('Thuế bán hàng')}</span><strong className="num">{fmtMoney(selected.tax_total)}</strong></div>}
    <div className="restaurant-cart-total"><span>{t('Tổng đã gồm thuế')}</span><strong className="num">{fmtMoney(selected.total || 0)}</strong></div>
    {selectedTickets.length > 0 && <div className="restaurant-ticket-status"><h3>{t('Tiến độ bếp')}</h3>{selectedTickets.map((ticket) => <div key={ticket.id}><span>{t(ticket.station === 'bar' ? 'Quầy pha chế' : 'Bếp')}</span><strong>{statusLabel(ticket.status)}</strong></div>)}</div>}
    {selected.status === 'open' && canSend && <div className="restaurant-actions"><button className="btn btn-primary" disabled={!!busy} onClick={() => onTransition(selected, 'sent')}>{t('Gửi bếp và quầy pha chế')}</button>{canCancel && <button className="btn" disabled={!!busy} onClick={() => onTransition(selected, 'cancelled')}>{t('Hủy order')}</button>}</div>}
    {selected.status === 'sent' && <div className="restaurant-actions">{canServe && <><button className="btn btn-primary" disabled={!!busy || hasUnreadyTickets} onClick={() => onTransition(selected, 'served')}>{t('Chuyển sang phục vụ')}</button>{hasUnreadyTickets && <span className="small muted">{t('Chờ tất cả phiếu bếp / quầy báo món xong.')}</span>}</>}{canCancelSent && <><label className="field"><span>{t('Lý do hủy (chỉ hủy được khi các trạm chưa bắt đầu)')}</span><input className="input" maxLength="500" value={cancellationReason} onChange={(event) => onCancellationReasonChange(event.target.value)} /></label><button className="btn" disabled={!!busy || !cancellationReason.trim()} onClick={() => onTransition(selected, 'cancelled')}>{t('Hủy order đã gửi')}</button></>}</div>}
    {selected.status === 'served' && canComplete && <div className="restaurant-payment"><label className="field"><span>{t('Phương thức thanh toán')}</span><select className="select" value={method} onChange={(event) => onMethodChange(event.target.value)}>{methods.map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</select></label><button className="btn btn-primary" disabled={!!busy || (selectedNeedsWarehouse && !selected.warehouse)} onClick={() => onTransition(selected, 'completed')}>{t('Thanh toán, xuất kho và đóng order')}</button>{selectedNeedsWarehouse && !selected.warehouse && <span className="small muted">{t('Order có nguyên liệu theo dõi tồn nhưng chưa gắn kho. Cập nhật order trước khi thanh toán.')}</span>}</div>}
    {selectedPayment && <a className="btn" href={recordHref('accounting.payment', selectedPayment.id)}>{t('Mở phiếu thanh toán')} {String(selectedPayment.id).slice(0, 8)}</a>}
  </section>;
}
