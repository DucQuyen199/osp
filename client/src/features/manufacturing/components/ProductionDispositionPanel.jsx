import React from 'react';
import { isPositiveQuantity } from '../domain/inspectionQuantities.js';

export default function ProductionDispositionPanel({
  inspections,
  candidates,
  dispositions,
  products,
  accounts,
  busy,
  inspectionId,
  quantity,
  accountId,
  note,
  canCreate,
  canPost,
  canCancel,
  remainingQuantity,
  baseUnitName,
  formatQuantity,
  statusLabel,
  onSubmit,
  onInspectionChange,
  onQuantityChange,
  onAccountChange,
  onNoteChange,
  onAction,
  t,
}) {
  return <section className="card card-pad">
    <h3>{t('Loại bỏ thành phẩm QC lỗi')}</h3>
    {canCreate && <form className="manufacturing-form" onSubmit={onSubmit}>
      <label className="field"><span>{t('Phiếu QC trượt *')}</span><select className="select" required value={inspectionId} onChange={(event) => onInspectionChange(event.target.value)}><option value="">{t('Chọn phiếu QC')}</option>{candidates.map((inspection) => <option key={inspection.id} value={inspection.id}>{products.get(inspection.product)?.name || inspection.product} · {t('còn')} {formatQuantity(remainingQuantity(inspection))} {baseUnitName(inspection.product)} · {t('lệnh')} {String(inspection.source_id).slice(0, 8)}</option>)}</select></label>
      {inspectionId && <label className="field"><span>{t('Số lượng loại bỏ *')}</span><input className="input num" type="number" min="0.000001" max={remainingQuantity(inspections.find((row) => row.id === inspectionId))} step="any" required value={quantity} onChange={(event) => onQuantityChange(event.target.value)} /></label>}
      <label className="field"><span>{t('Tài khoản chi phí *')}</span><select className="select" required value={accountId} onChange={(event) => onAccountChange(event.target.value)}><option value="">{t('Chọn tài khoản chi phí')}</option>{[...accounts.values()].filter((account) => account.kind === 'expense' && account.active !== false).map((account) => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}</select></label>
      <label className="field"><span>{t('Lý do loại bỏ *')}</span><input className="input" minLength="5" maxLength="500" required value={note} onChange={(event) => onNoteChange(event.target.value)} /></label>
      <button className="btn btn-primary btn-sm" type="submit" disabled={Boolean(busy) || !inspectionId || !isPositiveQuantity(quantity) || !accountId || note.trim().length < 5}>{busy === 'production-disposition' ? t('Đang ghi nhận…') : t('Ghi sổ loại bỏ')}</button>
    </form>}
    {dispositions.map((row) => {
      const inspection = inspections.find((item) => item.id === row.inspection);
      return <article className="manufacturing-order-card" key={row.id}>
        <div className="manufacturing-order-summary"><strong>{products.get(inspection?.product)?.name || t('Thành phẩm QC lỗi')}</strong><span className="badge">{statusLabel(row.status)}</span><span className="small muted">{t('Số lượng')} {formatQuantity(row.qty)} · {row.note}</span></div>
        {row.status === 'draft' && canPost && <button className="btn btn-primary btn-sm" type="button" disabled={Boolean(busy)} onClick={() => onAction(row, 'posted')}>{t('Ghi sổ')}</button>}
        {row.status === 'draft' && canCancel && <button className="btn btn-ghost btn-sm" type="button" disabled={Boolean(busy)} onClick={() => onAction(row, 'cancelled')}>{t('Hủy phiếu')}</button>}
      </article>;
    })}
    {!dispositions.length && <p className="small muted">{t('Chưa có phiếu loại bỏ thành phẩm.')}</p>}
  </section>;
}
