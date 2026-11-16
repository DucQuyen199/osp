import React from 'react';
import { fmtDateTime, fmtMoney, statusLabel } from '../../../lib/i18n.js';
import { recordHref } from '../../../lib/routes.js';

export default function WebOrderCard({
  order,
  storefrontName,
  partyName,
  products,
  currencyCode,
  sale,
  shipments,
  invoice,
  busy,
  permissions,
  onRefreshPrice,
  onTransition,
  t,
}) {
  return <article className="card ecommerce-order">
      <header className="card-head"><div><strong>{partyName}</strong><div className="small muted">{storefrontName || t('Gian hàng')} · {t((order.channel || 'web') === 'web' ? 'Website' : order.channel === 'app' ? 'Ứng dụng' : order.channel === 'marketplace' ? 'Sàn thương mại' : order.channel || '—')} · {fmtDateTime(order.created_at)}</div></div><span className={`badge ${order.status === 'placed' ? 'success' : order.status === 'cancelled' ? 'plain' : 'warning'}`}>{statusLabel(order.status)}</span></header>
    <ul className="ecommerce-order-lines">{(order.lines || []).map((line, index) => <li key={`${line.product}:${index}`}><span>{products.get(line.product)?.name || t('Sản phẩm')} × {line.qty}</span><strong className="num">{fmtMoney(line.line_total ?? (Number(line.price || 0) * Number(line.qty || 0)), currencyCode)}</strong></li>)}</ul>
    <div className="ecommerce-order-total"><span>{t('Tổng đơn')}{currencyCode ? ` (${currencyCode})` : ''}</span><strong className="num">{fmtMoney(order.total || 0, currencyCode)}</strong></div>
    {order.shipping_address && <div className="small muted ecommerce-address">{t('Giao đến:')} {order.shipping_address}</div>}
    <footer className="row wrap ecommerce-order-footer">
      {sale && permissions.salesRead && <a className="small" href={recordHref('sales.sales_order', sale.id)}>{t('Đơn bán')} {sale.number || String(sale.id).slice(0, 8)} · {statusLabel(sale.status)}</a>}
      {shipments.map((shipment) => permissions.logisticsRead && <a className="small" key={shipment.id} href={recordHref('logistics.shipment', shipment.id)}>{t('Vận đơn')} {shipment.tracking_number || String(shipment.id).slice(0, 8)} · {statusLabel(shipment.status)}</a>)}
      {invoice && permissions.invoiceRead && <a className="small" href={recordHref('accounting.invoice', invoice.id)}>{t('Hóa đơn')} · {statusLabel(invoice.status)}</a>}
      <span className="grow" />
      {order.status === 'cart' && permissions.update && <button className="btn btn-secondary btn-sm" type="button" disabled={Boolean(busy)} onClick={() => onRefreshPrice(order)}>{busy === `${order.id}:reprice` ? t('Đang cập nhật…') : t('Cập nhật giá')}</button>}
      {order.status === 'cart' && permissions.place && <button className="btn btn-primary btn-sm" type="button" disabled={Boolean(busy)} onClick={() => onTransition(order, 'placed')}>{busy === `${order.id}:placed` ? t('Đang đặt…') : t('Xác nhận đặt đơn')}</button>}
      {order.status === 'cart' && permissions.cancel && <button className="btn btn-secondary btn-sm" type="button" disabled={Boolean(busy)} onClick={() => onTransition(order, 'cancelled')}>{busy === `${order.id}:cancelled` ? t('Đang hủy…') : t('Hủy giỏ')}</button>}
      {order.status === 'placed' && sale?.status === 'confirmed' && permissions.cancel && <button className="btn btn-secondary btn-sm" type="button" disabled={Boolean(busy)} onClick={() => onTransition(order, 'cancelled')}>{busy === `${order.id}:cancelled` ? t('Đang hủy…') : t('Hủy đơn chưa giao')}</button>}
      {sale && !permissions.salesRead && <span className="small muted">{t('Đã chuyển thành đơn bán')}</span>}
    </footer>
  </article>;
}
