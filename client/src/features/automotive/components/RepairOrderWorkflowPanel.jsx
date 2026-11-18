import React from 'react';
import RepairQuoteEditor from './RepairQuoteEditor.jsx';

export default function RepairOrderWorkflowPanel({
  order,
  quoteDraft,
  products,
  productChoices,
  warehouses,
  unitsFor,
  unitRatio,
  fmtMoney,
  fmtDateTime,
  fmtNumber,
  statusLabel,
  estimateLines,
  totalLabel,
  invoiceHref,
  invoiceCode,
  vehicleOrders,
  declineReason,
  canSubmitDecline,
  actions,
  busy,
  t,
  onStartQuoteEdit,
  onDraftChange,
  onLineChange,
  onAddLine,
  onRemoveLine,
  onSaveQuoteEdit,
  onCancelQuoteEdit,
  onTransition,
  onDeclineReasonChange,
}) {
  return <>
    {actions.showEditQuote && <button type="button" className="btn" disabled={Boolean(busy)} onClick={onStartQuoteEdit}>{t('Điều chỉnh báo giá')}</button>}
    {actions.editQuote && <RepairQuoteEditor draft={quoteDraft} products={products} productChoices={productChoices} warehouses={warehouses} unitsFor={unitsFor} unitRatio={unitRatio} fmtMoney={fmtMoney} t={t} busy={busy === `${order.id}:quote`} onDraftChange={onDraftChange} onLineChange={onLineChange} onAddLine={onAddLine} onRemoveLine={onRemoveLine} onSubmit={onSaveQuoteEdit} onCancel={onCancelQuoteEdit} />}
    <h3>{t('Báo giá')}</h3>
    <ul className="workshop-estimate">{estimateLines.map((line) => <li key={line.key}><span>{line.productName || t('Sản phẩm')} × {line.qty} {line.unitName}</span><strong className="num">{line.total}</strong></li>)}</ul>
    <div className="workshop-total"><span>{t('Tổng cộng')}</span><strong className="num">{totalLabel}</strong></div>
    {invoiceHref && <a className="btn" href={invoiceHref}>{t('Mở hóa đơn')} {invoiceCode}</a>}
    <div className="workshop-actions">
      {actions.approve && <button className="btn btn-primary" onClick={() => onTransition('approved')} disabled={!!busy}>{t('Khách duyệt báo giá')}</button>}
      {actions.decline && <div className="workshop-decline"><label className="field"><span>{t('Lý do khách từ chối báo giá *')}</span><textarea className="input textarea" rows="2" minLength="5" maxLength="500" value={declineReason} onChange={(event) => onDeclineReasonChange(event.target.value)} placeholder={t('Ví dụ: khách chưa đồng ý chi phí sửa chữa')} /></label><button className="btn" type="button" disabled={!!busy || !canSubmitDecline} onClick={() => onTransition('quote_declined')}>{t('Ghi nhận khách từ chối')}</button></div>}
      {actions.start && <button className="btn btn-primary" onClick={() => onTransition('started')} disabled={!!busy}>{t('Bắt đầu sửa chữa')}</button>}
      {actions.complete && <button className="btn btn-primary" onClick={() => onTransition('completed')} disabled={!!busy}>{t('Hoàn tất, xuất phụ tùng và lập hóa đơn')}</button>}
      {actions.deliver && <button className="btn btn-primary" onClick={() => onTransition('delivered')} disabled={!!busy}>{t('Bàn giao xe')}</button>}
    </div>
    <details className="workshop-history"><summary>{t('Lịch sử xe')} ({vehicleOrders.length} {t('lệnh')})</summary>{vehicleOrders.map((historyOrder) => <div className="workshop-history-row" key={historyOrder.id}><span>{fmtDateTime(historyOrder.created_at)} · {historyOrder.odometer_reading == null ? t('Chưa ghi số km') : `${fmtNumber(historyOrder.odometer_reading)} km`} · {historyOrder.complaint || t('Bảo dưỡng')}</span><strong>{statusLabel(historyOrder.status)} · {fmtMoney(historyOrder.total || 0)}</strong></div>)}</details>
  </>;
}
