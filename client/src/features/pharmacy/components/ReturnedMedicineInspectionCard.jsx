import React from 'react';

/** Controlled presentation for a quarantined returned-medicine inspection. */
export default function ReturnedMedicineInspectionCard({
  productLabel,
  remaining,
  canDispose,
  remainingLabel,
  statusLabel,
  sourceId,
  lot,
  note,
  draft,
  busy,
  showFailAction,
  showDispositionForm,
  fullyDisposed,
  t,
  onFail,
  onSubmit,
  onQuantityChange,
  onNoteChange,
}) {
  return <article className="card card-pad stack-sm">
    <div className="row wrap">
      <div className="grow">
        <strong>{productLabel}</strong>
        <div className="small muted">{t('Số lượng cách ly')}: {remainingLabel} · {t('Trạng thái')}: {statusLabel} · {t('Mã truy xuất')}: {sourceId}</div>
        {lot && <div className="small muted">{t('Lô')}: {lot}</div>}
        {note && <div className="small muted">{note}</div>}
      </div>
      {showFailAction && <button className="btn btn-danger btn-sm" type="button" disabled={busy} onClick={onFail}>{t('Xác nhận không đạt')}</button>}
    </div>
    {showDispositionForm && <form className="row wrap" onSubmit={onSubmit}>
      <label className="field"><span className="label">{t('Số lượng hủy')}</span><input className="input num" type="number" min="0.000001" max={remaining} step="any" required value={draft.qty || ''} onChange={(event) => onQuantityChange(event.target.value)} /></label>
      <label className="field grow"><span className="label">{t('Lý do / chứng từ hủy')}</span><input className="input" required minLength="5" maxLength="500" value={draft.note || ''} onChange={(event) => onNoteChange(event.target.value)} /></label>
      <button className="btn btn-danger" type="submit" disabled={busy || !canDispose}>{t('Ghi sổ hủy')}</button>
    </form>}
    {fullyDisposed && <div className="small muted">{t('Đã hủy hết số lượng cách ly.')}</div>}
  </article>;
}
