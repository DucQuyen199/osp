export default function ReworkOrdersPanel({
  candidates,
  inspections,
  orders,
  inspectionId,
  quantity,
  reason,
  busy,
  canCreate,
  canStart,
  canComplete,
  canCancel,
  remainingQuantity,
  productName,
  baseUnitName,
  formatQuantity,
  statusLabel,
  onInspectionChange,
  onQuantityChange,
  onReasonChange,
  onSubmit,
  onAction,
  t,
}) {
  const selectedInspection = inspections.find((row) => row.id === inspectionId);
  const remaining = remainingQuantity(selectedInspection);

  return <div className="manufacturing-orders">
    <h3>{t('Sửa hàng không đạt')}</h3>
    {canCreate && <form className="manufacturing-form" onSubmit={onSubmit}>
      <label className="field">
        <span>{t('Phiếu QC trượt *')}</span>
        <select className="select" required value={inspectionId} onChange={(event) => onInspectionChange(event.target.value)}>
          <option value="">{t('Chọn phiếu QC')}</option>
          {candidates.map((inspection) => <option key={inspection.id} value={inspection.id}>
            {productName(inspection.product) || inspection.product} · {t('còn')} {formatQuantity(remainingQuantity(inspection))} {baseUnitName(inspection.product)} · {t('lệnh')} {String(inspection.source_id).slice(0, 8)}
          </option>)}
        </select>
      </label>
      {inspectionId && <>
        <label className="field">
          <span>{t('Số lượng sửa *')}</span>
          <input className="input num" type="number" min="0.000001" max={remaining} step="any" required value={quantity} onChange={(event) => onQuantityChange(event.target.value)} />
        </label>
        <p className="small muted">{t('Sau khi sửa, đúng số lượng này sẽ được kiểm tra lại riêng; phần còn lỗi vẫn được giữ trong phiếu QC ban đầu.')}</p>
      </>}
      <label className="field">
        <span>{t('Lý do sửa *')}</span>
        <input className="input" minLength={5} maxLength={500} required value={reason} onChange={(event) => onReasonChange(event.target.value)} />
      </label>
      <button className="btn btn-primary btn-sm" type="submit" disabled={busy === 'rework' || !inspectionId || !Number(quantity) || reason.trim().length < 5}>
        {busy === 'rework' ? t('Đang tạo…') : t('Tạo lệnh sửa')}
      </button>
    </form>}
    {orders.map((order) => {
      const inspection = inspections.find((row) => row.id === order.inspection);
      return <article className="manufacturing-order-card" key={order.id}>
        <div className="manufacturing-order-summary">
          <strong>{productName(inspection?.product) || t('Lô sửa hàng')}</strong>
          <span className="badge">{statusLabel(order.status)}</span>
          <span className="small muted">{t('Lệnh')} {String(order.production_order).slice(0, 8)} · {t('Số lượng')} {formatQuantity(order.qty)} · {order.reason}</span>
        </div>
        {order.status === 'planned' && canStart && <button className="btn btn-primary btn-sm" type="button" disabled={Boolean(busy)} onClick={() => onAction(order, 'started')}>{t('Bắt đầu, xuất vật tư')}</button>}
        {order.status === 'in_progress' && canComplete && <button className="btn btn-primary btn-sm" type="button" disabled={Boolean(busy)} onClick={() => onAction(order, 'done')}>{t('Hoàn tất, gửi QC kiểm tra lại')}</button>}
        {order.status === 'planned' && canCancel && <button className="btn btn-ghost btn-sm" type="button" disabled={Boolean(busy)} onClick={() => onAction(order, 'cancelled')}>{t('Hủy lệnh sửa')}</button>}
      </article>;
    })}
    {!orders.length && <p className="small muted">{t('Chưa có lệnh sửa hàng.')}</p>}
  </div>;
}
