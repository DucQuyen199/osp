import React from 'react';
import { selectableTableRowProps } from '../../../lib/accessibility.js';

/** Controlled presentation for selecting a field-service work order. */
export default function FieldServiceWorkOrderQueue({ orders, selectedId, onSelect, t }) {
  return <section className="card card-pad">
    <div className="table-wrap"><table className="table">
      <thead><tr><th>{t('Công việc')}</th><th>{t('Lịch')}</th><th>{t('Kỹ thuật viên')}</th><th>{t('Trạng thái')}</th></tr></thead>
      <tbody>{orders.map((order) => <tr
        {...selectableTableRowProps}
        key={order.id}
        aria-selected={selectedId === order.id}
        className={[selectedId === order.id ? 'selected' : '', 'u-pointer'].filter(Boolean).join(' ')}
        onClick={() => onSelect(order.id)}
      >
        <td><strong>{order.title}</strong><div className="small muted">{order.customerLabel}{order.address ? ` · ${order.address}` : ''}</div></td>
        <td>{order.scheduleLabel}</td>
        <td>{order.technicianLabel}</td>
        <td>{order.statusLabel}</td>
      </tr>)}</tbody>
    </table></div>
  </section>;
}
