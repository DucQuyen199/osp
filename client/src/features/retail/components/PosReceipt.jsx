import React from 'react';
import { fmtDateTime, fmtMoney } from '../../../lib/i18n.js';

export default function PosReceipt({ order, storeName, partyName, products, t }) {
  if (!order) return null;

  return <article className="pos-receipt is-printing" aria-hidden="true">
    <header><strong>{storeName || t('Cửa hàng')}</strong><div>{t('BIÊN NHẬN BÁN HÀNG')}</div></header>
    <hr />
    <div>{t('Mã đơn:')} {String(order.id).slice(0, 8)}</div>
    <div>{t('Thời gian:')} {fmtDateTime(order.created_at)}</div>
    <div>{t('Khách hàng:')} {partyName || t('Khách lẻ')}</div>
    {order.status === 'refunded' && <strong>{t('ĐÃ HOÀN TIỀN')}</strong>}
    <hr />
    {(order.lines || []).map((line, index) => {
      const qty = Number(line.qty) || 0;
      const unitPrice = Number(line.price ?? line.unit_price) || 0;
      return <div className="pos-receipt-line" key={`${line.product || 'line'}-${index}`}>
        <strong>{line.product_name || products.get(line.product)?.name || t('Mặt hàng')}</strong>
        <div>{qty}{line.uom_name ? ` ${line.uom_name}` : ''} × {fmtMoney(unitPrice)} <span>{fmtMoney(qty * unitPrice)}</span></div>
      </div>;
    })}
    <hr />
    {Number(order.voucher_discount) > 0 && <div className="pos-receipt-total"><span>{t('Chiết khấu')}</span><span>−{fmtMoney(order.voucher_discount)}</span></div>}
    <div className="pos-receipt-total"><span>{t('Thuế')}</span><span>{fmtMoney(order.tax_total || 0)}</span></div>
    <div className="pos-receipt-total pos-receipt-grand"><strong>{t('Tổng cộng')}</strong><strong>{fmtMoney(order.total || 0)}</strong></div>
    <div>{t('Thanh toán:')} {t(order.method === 'cash' ? 'Tiền mặt' : order.method === 'card' ? 'Thẻ' : order.method === 'transfer' ? 'Chuyển khoản' : order.method === 'ewallet' ? 'Ví điện tử' : '—')}</div>
    {order.method === 'cash' && <><div>{t('Khách đưa:')} {fmtMoney(order.cash_received || 0)}</div><div>{t('Tiền thối:')} {fmtMoney(order.change_due || 0)}</div></>}
    {order.refund_reason && <div>{t('Lý do hoàn:')} {order.refund_reason}</div>}
    <footer>{t('Cảm ơn quý khách!')}</footer>
  </article>;
}
