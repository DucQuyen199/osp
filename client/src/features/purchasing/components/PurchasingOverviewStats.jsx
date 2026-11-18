import React from 'react';
import { uiText } from '../../../lib/i18n.js';

export default function PurchasingOverviewStats({ totals }) {
  return <div className="stats u-mb-16">
    <div className="card stat"><span className="stat-label">{uiText('Nháp / bị trả')}</span><strong className="stat-value">{totals.draft}</strong></div>
    <div className="card stat"><span className="stat-label">{uiText('Chờ duyệt')}</span><strong className="stat-value">{totals.awaitingApproval}</strong></div>
    <div className="card stat"><span className="stat-label">{uiText('Đang nhận hàng')}</span><strong className="stat-value">{totals.receiving}</strong></div>
    <div className="card stat"><span className="stat-label">{uiText('Đã nhận đủ')}</span><strong className="stat-value">{totals.received}</strong></div>
  </div>;
}
