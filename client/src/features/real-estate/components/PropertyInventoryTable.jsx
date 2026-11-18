import React from 'react';
import { selectableTableRowProps } from '../../../lib/accessibility.js';

/** Controlled inventory table for the selected property. */
export default function PropertyInventoryTable({ properties = [], selectedId, onSelect, kindLabel, fmtMoney, statusLabel, t }) {
  return <section className="card card-pad">
    <h2>{t('Danh mục bất động sản')}</h2>
    <div className="table-wrap"><table className="table">
      <thead><tr><th>{t('Tài sản')}</th><th>{t('Diện tích')}</th><th>{t('Giá niêm yết')}</th><th>{t('Trạng thái')}</th></tr></thead>
      <tbody>{properties.map((row) => <tr {...selectableTableRowProps} key={row.id} aria-selected={selectedId === row.id}
        className={[selectedId === row.id ? 'selected' : '', 'u-pointer'].filter(Boolean).join(' ')} onClick={() => onSelect(row.id)}>
        <td><strong>{row.title}</strong><div className="small muted">{kindLabel(row.kind)} · {row.address || t('Chưa có địa chỉ')}</div></td>
        <td>{row.area ? `${row.area} m²` : '—'}</td>
        <td>{fmtMoney(row.sale_price || row.price || 0)}</td>
        <td>{statusLabel(row.status)}</td>
      </tr>)}</tbody>
    </table></div>
  </section>;
}
