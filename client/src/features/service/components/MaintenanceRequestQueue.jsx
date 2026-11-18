import React from 'react';
import { selectableTableRowProps } from '../../../lib/accessibility.js';

/** Controlled presentation for the maintenance request queue. */
export default function MaintenanceRequestQueue({ loading, requests, selectedId, onSelect, t }) {
  return <section className="card card-pad">
    <h2>{t('Hàng đợi lệnh bảo trì')}</h2>
    {loading ? <div className="skeleton" data-h="row" /> : !requests.length ? <div className="empty">{t('Chưa có lệnh bảo trì.')}</div> : <div className="table-wrap"><table className="table">
      <thead><tr><th>{t('Tài sản / mô tả')}</th><th>{t('Kỹ thuật viên')}</th><th>{t('Ưu tiên')}</th><th>{t('Ngày')}</th><th>{t('Trạng thái')}</th></tr></thead>
      <tbody>{requests.map((request) => <tr
        {...selectableTableRowProps}
        key={request.id}
        aria-selected={selectedId === request.id}
        className={[selectedId === request.id ? 'selected' : '', 'u-pointer'].filter(Boolean).join(' ')}
        onClick={() => onSelect(request.id)}
      >
        <td><strong>{request.assetName}</strong><div className="small muted">{request.description}</div></td>
        <td>{request.technicianName}</td>
        <td>{request.priorityLabel}</td>
        <td>{request.dateLabel}</td>
        <td>{request.statusLabel}</td>
      </tr>)}</tbody>
    </table></div>}
  </section>;
}
