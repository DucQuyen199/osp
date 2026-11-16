import React from 'react';

export default function ProductionInspectionQueue({
  inspections,
  products,
  qcNotes,
  busy,
  canPass,
  canRecordFailure,
  formatQty,
  baseUnitName,
  t,
  onNoteChange,
  onDecide,
}) {
  const pending = inspections.filter((inspection) => ['production_order', 'production_rework'].includes(inspection.source) && inspection.status === 'pending');
  return <div className="manufacturing-orders">
    <h3>{t('Kiểm tra thành phẩm')}</h3>
    {pending.map((inspection) => <article className="manufacturing-order-card" key={inspection.id}>
      <div className="manufacturing-order-summary">
        <strong>{products.get(inspection.product)?.name || inspection.product}</strong>
        <span className="small muted">{t('Lệnh')} {String(inspection.source_id).slice(0, 8)} · {t('Số lượng')} {formatQty(inspection.qty)} {baseUnitName(inspection.product)}{inspection.lot ? ` · ${t('Lô')} ${inspection.lot}` : ''}</span>
      </div>
      {canRecordFailure && <label className="field"><span>{t('Mô tả lỗi nếu không đạt')}</span><input className="input" minLength="5" maxLength="500" value={qcNotes[inspection.id] || ''} onChange={(event) => onNoteChange(inspection.id, event.target.value)} /></label>}
      {canPass && <button className="btn btn-primary btn-sm" type="button" disabled={Boolean(busy)} onClick={() => onDecide(inspection, 'passed')}>{t('Đạt, nhập kho')}</button>}
      {canRecordFailure && <button className="btn btn-ghost btn-sm" type="button" disabled={Boolean(busy) || (qcNotes[inspection.id] || '').trim().length < 5} onClick={() => onDecide(inspection, 'failed')}>{t('Không đạt, lập NCR')}</button>}
    </article>)}
    {!pending.length && <p className="small muted">{t('Không có lô thành phẩm chờ kiểm tra.')}</p>}
  </div>;
}
