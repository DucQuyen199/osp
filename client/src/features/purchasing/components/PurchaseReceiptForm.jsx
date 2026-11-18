import React from 'react';
import { uiText } from '../../../lib/i18n.js';

export default function PurchaseReceiptForm({ lines, products, note, busy, onClose, onLineChange, onNoteChange, onSubmit }) {
  return <form className="card card-pad u-mt-14"  onSubmit={onSubmit}>
    <div className="row wrap"><h3>{uiText('Phiếu nhận hàng')}</h3><span className="grow"/><button className="btn btn-ghost btn-sm" type="button" onClick={onClose}>{uiText('Đóng')}</button></div>
    <p className="small muted">{uiText('Nhập số lượng thực nhận. Kho được khóa theo đơn mua; số lượng không được vượt phần còn lại.')}</p>
    {lines.map((line, index) => <div className="row wrap" key={line.key}>
      <strong className="grow">{products.get(line.product)?.name || uiText('Hàng hóa')} · {uiText('còn')} {line.qty}</strong>
      <input className="input num u-max-w-150" aria-label={`${uiText('Số lượng thực nhận')} ${index + 1}`} type="number" min="0" max={line.qty} step="any" required value={line.received ?? line.qty} onChange={(event) => onLineChange(index, 'received', event.target.value)}  />
      {products.get(line.product)?.lot_tracked && <>
        <label className="field"><span className="label">{uiText('Mã lô nhà cung cấp')} *</span><input className="input" maxLength="160" required={Number(line.received ?? line.qty) > 0} value={line.lot_code || ''} onChange={(event) => onLineChange(index, 'lot_code', event.target.value)} /></label>
        <label className="field"><span className="label">{uiText('Hạn dùng')}</span><input className="input" type="date" required={Boolean(products.get(line.product)?.expiry_required) && Number(line.received ?? line.qty) > 0} value={line.expiry || ''} onChange={(event) => onLineChange(index, 'expiry', event.target.value)} /></label>
      </>}
    </div>)}
    <label className="field u-mt-10" ><span className="label">{uiText('Ghi chú nhận hàng')}</span><textarea className="input" rows="2" value={note} onChange={(event) => onNoteChange(event.target.value)} /></label>
    <div className="row"><span className="grow"/><button className="btn btn-primary" disabled={Boolean(busy)}>{uiText('Ghi nhận vào kho')}</button></div>
  </form>;
}
