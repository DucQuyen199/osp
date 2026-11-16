import React from 'react';
import { statusLabel } from '../../../lib/i18n.js';
import { can } from '../../../lib/state.js';

export default function ProductionOrderCard({ order, productName, workCenterName, draft, busy, onOutputChange, onAction, formatQty, t }) {
  return <article className="manufacturing-order-card">
    <div className="manufacturing-order-summary">
      <strong>{productName || order.product}</strong>
      <span className="badge">{statusLabel(order.status)}</span>
      <span className="small muted">{t('Kế hoạch')} {formatQty(order.qty)} · {order.planned_start || t('Chưa xếp lịch')} · {workCenterName || t('Không gán trung tâm')}</span>
    </div>
    {order.status === 'in_progress' && <div className="manufacturing-output">
      <label className="field"><span>{t('Đạt')}</span><input className="input num" type="number" min="0" step="any" value={draft.good_qty ?? order.good_qty ?? order.qty} onChange={(event) => onOutputChange('good_qty', event.target.value)} /></label>
      <label className="field"><span>{t('Phế phẩm')}</span><input className="input num" type="number" min="0" step="any" value={draft.scrap_qty ?? order.scrap_qty ?? ''} onChange={(event) => onOutputChange('scrap_qty', event.target.value)} /></label>
      <label className="field"><span>{t('Lý do phế phẩm')}</span><input className="input" value={draft.scrap_reason ?? order.scrap_reason ?? ''} onChange={(event) => onOutputChange('scrap_reason', event.target.value)} /></label>
    </div>}
    {order.status === 'planned' && can('manufacturing.production_order.started') && <button className="btn btn-primary btn-sm" type="button" disabled={Boolean(busy)} onClick={() => onAction(order, 'started')}>{t('Bắt đầu, xuất vật tư')}</button>}
    {order.status === 'in_progress' && can('manufacturing.production_order.done') && <button className="btn btn-primary btn-sm" type="button" disabled={Boolean(busy)} onClick={() => onAction(order, 'done')}>{t('Hoàn tất, gửi QC')}</button>}
    {['planned', 'in_progress'].includes(order.status) && can('manufacturing.production_order.cancelled') && <button className="btn btn-ghost btn-sm" type="button" disabled={Boolean(busy)} onClick={() => onAction(order, 'cancelled')}>{t('Hủy lệnh')}</button>}
  </article>;
}
