import React from 'react';

/** Controlled editor for progressive utility tariff tiers. */
export default function TariffTiersEditor({
  tiers,
  maxTiers,
  label,
  showExplanation = false,
  onTierChange,
  onTierRemove,
  onTierAdd,
  t,
}) {
  return <div className="field full">
    <span className="label">{t(label)}</span>
    {tiers.map((tier, index) => <div className="row wrap" key={tier.rowId}>
      <label className="field">
        <span className="small">{t('Ngưỡng tiêu thụ lũy kế (để trống bậc cuối nếu không giới hạn)')}</span>
        <input className="input num" type="number" min="0.000001" step="any" required={index < tiers.length - 1} value={tier.up_to} onChange={(event) => onTierChange(index, 'up_to', event.target.value)} />
      </label>
      <label className="field">
        <span className="small">{t('Đơn giá mỗi bậc *')}</span>
        <input className="input num" type="number" min="0" step="any" required value={tier.rate} onChange={(event) => onTierChange(index, 'rate', event.target.value)} />
      </label>
      <button className="btn btn-ghost" type="button" aria-label={`${t('Xóa bậc')} ${index + 1}`} onClick={() => onTierRemove(index)}>{t('Xóa bậc')}</button>
    </div>)}
    <button className="btn btn-secondary btn-sm" type="button" disabled={tiers.length >= maxTiers} onClick={onTierAdd}>{t('Thêm bậc giá')}</button>
    {showExplanation && <p className="small muted">{t('Mỗi bậc chỉ tính giá cho phần tiêu thụ nằm trong ngưỡng lũy kế.')}</p>}
  </div>;
}
