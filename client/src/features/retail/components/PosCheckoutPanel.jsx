import React from 'react';
import { compareDecimals } from '../../../lib/decimal.js';

export default function PosCheckoutPanel({ method, onMethodChange, cashReceived, onCashReceived, subtotal, estimatedTax, total, hasItems, busy, canCreate, onCheckout, formatMoney, t }) {
  let cashCoversTotal = false;
  try { cashCoversTotal = Boolean(cashReceived) && compareDecimals(cashReceived, total) >= 0; } catch { /* Invalid number input stays blocked. */ }
  const cashInvalid = method === 'cash' && !cashCoversTotal;
  return <>
    <label className="field"><span className="label">{t('Thanh toán')}</span><select className="select" value={method} onChange={(event) => onMethodChange(event.target.value)}><option value="cash">{t('Tiền mặt')}</option><option value="card">{t('Thẻ')}</option><option value="transfer">{t('Chuyển khoản')}</option><option value="ewallet">{t('Ví điện tử')}</option></select></label>
    {method === 'cash' && <label className="field"><span className="label">{t('Khách đưa')}</span><input className="input num" required type="number" min={total} step="0.01" value={cashReceived} onChange={(event) => onCashReceived(event.target.value)} placeholder={t('Nhập số tiền nhận')} /></label>}
    <div className="pos-total"><span>{t('Tạm tính')}</span><span>{t('Tiền hàng')} <strong className="num">{formatMoney(subtotal)}</strong></span><span>{t('Thuế ước tính')} <strong className="num">{formatMoney(estimatedTax)}</strong></span><strong className="num">{formatMoney(total)}</strong><small>{t('Thuế và số tiền chính thức do máy chủ tính theo danh mục khi tạo đơn.')}</small></div>
    <button className="btn btn-primary pos-checkout" type="button" disabled={busy || !hasItems || !canCreate || cashInvalid} onClick={onCheckout}>{busy ? t('Đang xử lý…') : `${t('Tạo đơn & thanh toán ·')} ${formatMoney(total)}`}</button>
  </>;
}
