import React from 'react';

export default function PosCartContents({
  cart,
  units,
  unitsFor,
  priceFor,
  estimatedLines,
  partyOptions,
  partyId,
  rxRequired,
  loyaltyEnabled,
  voucherCode,
  pharmacyEnabled,
  prescriptionOptions,
  prescriptionId,
  onQuantityAdjust,
  onQuantityChange,
  onUnitChange,
  onPartyChange,
  onVoucherCodeChange,
  onPrescriptionChange,
  formatMoney,
  recordLabel,
  t,
}) {
  return <>
    <h2>{t('Đơn hàng')}</h2>
    {cart.length ? <div className="pos-cart-lines">{cart.map(({ product, uom, qty }, index) => <div className="pos-cart-line" key={product.id}>
      <div>
        <strong>{product.name}</strong>
        {unitsFor(product).length > 1 && <select className="select" aria-label={`${t('Đơn vị bán')} ${product.name}`} value={uom} onChange={(event) => onUnitChange(product.id, event.target.value)}>{unitsFor(product).map((unit) => <option key={unit.id} value={unit.id}>{unit.name}{unit.base_uom ? ` · ${unit.ratio} × ${t('đơn vị gốc')}` : ` · ${t('đơn vị gốc')}`}</option>)}</select>}
        <div className="small muted">{formatMoney(priceFor(product, uom))} / {units.get(uom)?.name || t('sp')}</div>
      </div>
      <div className="pos-qty"><button className="btn btn-ghost btn-sm" type="button" aria-label={`${t('Giảm')} ${product.name}`} onClick={() => onQuantityAdjust(product.id, -1)}>−</button><input className="input num" type="number" min="0" step="any" aria-label={`${t('Số lượng')} ${product.name}`} value={qty} onChange={(event) => onQuantityChange(product.id, event.target.value)} /><button className="btn btn-ghost btn-sm" type="button" aria-label={`${t('Tăng')} ${product.name}`} onClick={() => onQuantityAdjust(product.id, 1)}>+</button></div>
      <strong className="num">{formatMoney(estimatedLines[index].net)}</strong>
    </div>)}</div> : <div className="empty">{t('Chọn sản phẩm để thêm vào đơn.')}</div>}
    <label className="field"><span className="label">{t('Khách hàng')} {rxRequired ? '*' : t('(tùy chọn)')}</span><select className="select" required={rxRequired} value={partyId} onChange={(event) => onPartyChange(event.target.value)}><option value="">{t('Khách lẻ')}</option>{partyOptions.map((party) => <option key={party.id} value={party.id}>{recordLabel('master-data.party', party)}</option>)}</select></label>
    {loyaltyEnabled && <label className="field"><span className="label">{t('Mã voucher thành viên')}</span><input className="input" maxLength="80" autoCapitalize="characters" value={voucherCode} onChange={(event) => onVoucherCodeChange(event.target.value)}/><span className="small muted">{t('Cần chọn khách hàng đã đăng ký thành viên; mã chỉ được sử dụng một lần.')}</span></label>}
    {pharmacyEnabled && rxRequired && <label className="field"><span className="label">{t('Đơn thuốc *')}</span><select className="select" required={rxRequired} value={prescriptionId} onChange={(event) => onPrescriptionChange(event.target.value)}><option value="">{t('Chọn đơn còn thuốc được kê')}</option>{prescriptionOptions.map((prescription) => <option key={prescription.id} value={prescription.id}>{prescription.prescription_no} · {t(prescription.status === 'partially_dispensed' ? 'cấp một phần' : 'đã xác minh')} · {t('hết hạn')} {prescription.valid_until}</option>)}</select>{rxRequired && <small className="muted">{t('Thuốc kê đơn chỉ được bán theo đơn còn hạn, đúng khách hàng; số lượng bán cộng dồn không vượt số lượng kê.')}</small>}</label>}
  </>;
}
