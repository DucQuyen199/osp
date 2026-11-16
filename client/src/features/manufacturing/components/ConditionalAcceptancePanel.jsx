import React from 'react';

export default function ConditionalAcceptancePanel({
  inspections,
  candidates,
  acceptances,
  products,
  busy,
  inspectionId,
  quantity,
  condition,
  justification,
  canCreate,
  canResubmit,
  canCancel,
  remainingQuantity,
  baseUnitName,
  formatQuantity,
  statusLabel,
  onSubmit,
  onInspectionChange,
  onQuantityChange,
  onConditionChange,
  onJustificationChange,
  onAction,
  t,
}) {
  return <section className="card card-pad">
    <h3>{t('Chấp nhận có điều kiện')}</h3>
    <p className="small muted">{t('Dùng khi có căn cứ cho phép dùng một phần sản phẩm chưa đạt chuẩn thông thường. Phải ghi điều kiện kiểm soát và lý do; chỉ người được giao quyền trong quy tắc phê duyệt mới có thể duyệt. Hàng vẫn bị giữ cho đến khi duyệt.')}</p>
    {canCreate && <form className="manufacturing-form" onSubmit={onSubmit}>
      <label className="field"><span>{t('Phiếu QC trượt *')}</span><select className="select" required value={inspectionId} onChange={(event) => onInspectionChange(event.target.value)}><option value="">{t('Chọn phiếu QC')}</option>{candidates.map((inspection) => <option key={inspection.id} value={inspection.id}>{products.get(inspection.product)?.name || inspection.product} · {t('còn')} {formatQuantity(remainingQuantity(inspection))} {baseUnitName(inspection.product)} · {t('lệnh')} {String(inspection.source_id).slice(0, 8)}</option>)}</select></label>
      {inspectionId && <label className="field"><span>{t('Số lượng đề nghị *')}</span><input className="input num" type="number" min="0.000001" max={remainingQuantity(inspections.find((row) => row.id === inspectionId))} step="any" required value={quantity} onChange={(event) => onQuantityChange(event.target.value)} /></label>}
      <label className="field"><span>{t('Điều kiện sử dụng / kiểm soát sau chấp nhận *')}</span><textarea className="input" rows="2" minLength="5" maxLength="2000" required value={condition} onChange={(event) => onConditionChange(event.target.value)} placeholder={t('Ví dụ: giới hạn sử dụng, kiểm tra bổ sung hoặc thông báo cho khách hàng')} /></label>
      <label className="field"><span>{t('Căn cứ đề nghị *')}</span><textarea className="input" rows="2" minLength="5" maxLength="2000" required value={justification} onChange={(event) => onJustificationChange(event.target.value)} placeholder={t('Ghi kết quả đánh giá rủi ro và căn cứ kỹ thuật')} /></label>
      <button className="btn btn-primary btn-sm" type="submit" disabled={Boolean(busy) || !inspectionId || !(Number(quantity) > 0) || condition.trim().length < 5 || justification.trim().length < 5}>{busy === 'conditional-acceptance' ? t('Đang gửi…') : t('Gửi phê duyệt')}</button>
    </form>}
    <div className="stack-sm u-legacy-92c18f6bda">{acceptances.map((row) => {
      const inspection = inspections.find((item) => item.id === row.inspection);
      return <article className="manufacturing-order-card" key={row.id}>
        <div className="manufacturing-order-summary"><strong>{products.get(inspection?.product)?.name || t('Thành phẩm QC lỗi')}</strong><span className={`badge ${row.status === 'approved' ? 'success' : row.status === 'rejected' ? 'danger' : 'warning'}`}>{statusLabel(row.status)}</span><span className="small muted">{t('Lệnh')} {String(inspection?.source_id || '').slice(0, 8)} · {formatQuantity(row.qty)} {baseUnitName(inspection?.product)} · {row.condition}</span><span className="small muted">{t('Căn cứ')}: {row.justification}</span></div>
        {row.status === 'submitted' && <a className="btn btn-ghost btn-sm" href="#/approvals">{t('Mở hàng chờ phê duyệt')}</a>}
        {row.status === 'rejected' && canResubmit && <button className="btn btn-secondary btn-sm" type="button" disabled={Boolean(busy)} onClick={() => onAction(row, 'submitted')}>{t('Gửi duyệt lại')}</button>}
        {['draft', 'rejected'].includes(row.status) && canCancel && <button className="btn btn-ghost btn-sm" type="button" disabled={Boolean(busy)} onClick={() => onAction(row, 'cancelled')}>{t('Hủy đề nghị')}</button>}
      </article>;
    })}{!acceptances.length && <p className="small muted">{t('Chưa có đề nghị chấp nhận có điều kiện.')}</p>}</div>
  </section>;
}
