import React from 'react';

/** Controlled POD quantity, recipient, and evidence fields for a dispatched shipment. */
export default function DeliveryProofFields({ shipment, proof = {}, hasShortDelivery, t, onQuantityChange, onShortReasonChange, onReceivedByChange, onEvidenceChange }) {
  return <div className="delivery-proof" role="group" aria-label={t('Bằng chứng giao hàng')}>
    <div className="delivery-proof-lines">
      <strong>{t('Số lượng thực nhận theo vận đơn')}</strong>
      {(shipment.lines || []).map((line, index) => <label className="field" key={`${line.product || 'line'}-${index}`}>
        <span>{line.productName || line.name || line.product || `${t('Mặt hàng')} ${index + 1}`} · {t('đã điều phối')} {line.qty} {line.uom_name || ''}</span>
        <input className="input num" aria-label={`${t('Số lượng thực nhận dòng')} ${index + 1}`} type="number" min="0" max={line.qty} step="any" value={proof.deliveredQuantities?.[index] ?? line.qty} onChange={(event) => onQuantityChange(index, event.target.value)}/>
      </label>)}
    </div>
    {hasShortDelivery && <label className="field"><span>{t('Lý do giao thiếu (bắt buộc, 5–500 ký tự)')}</span><textarea className="input" rows="2" maxLength="500" value={proof.shortDeliveryReason || ''} onChange={(event) => onShortReasonChange(event.target.value)}/></label>}
    <label className="field"><span>{t('Người nhận hàng (nếu có)')}</span><input className="input" maxLength="160" value={proof.receivedBy || ''} onChange={(event) => onReceivedByChange(event.target.value)}/></label>
    <label className="field"><span>{t('Mã POD / bằng chứng giao hàng')}</span><input className="input" maxLength="1000" value={proof.evidence || ''} onChange={(event) => onEvidenceChange(event.target.value)}/></label>
    <p className="small muted">{t('Điền tên người nhận hoặc mã tham chiếu/bằng chứng từ đơn vị vận chuyển.')}</p>
  </div>;
}
