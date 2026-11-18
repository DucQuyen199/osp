import React from 'react';
import { selectableTableRowProps } from '../../../lib/accessibility.js';
import { fmtDate, fmtMoney, statusLabel, uiText } from '../../../lib/i18n.js';
import { recordLabel } from '../../../lib/state.js';

export default function PurchaseOrdersList({ orders, suppliers, selectedId, onSelect }) {
  return <section className="card card-pad"><h2>{uiText('Đơn mua hàng')}</h2><div className="table-wrap"><table className="table"><thead><tr><th>{uiText('Nhà cung cấp')}</th><th>{uiText('Giao dự kiến')}</th><th>{uiText('Tổng')}</th><th>{uiText('Trạng thái')}</th></tr></thead><tbody>{orders.map((order) => <tr {...selectableTableRowProps} key={order.id} aria-selected={selectedId === order.id} className={[selectedId === order.id ? 'selected' : '', 'u-pointer'].filter(Boolean).join(' ')} onClick={() => onSelect(order.id)} ><td><strong>{suppliers.has(order.supplier) ? recordLabel('master-data.party', suppliers.get(order.supplier)) : uiText('Nhà cung cấp')}</strong><div className="small muted">{order.source ? `${uiText('Nguồn')}: ${order.source}` : String(order.id).slice(0, 8)}</div></td><td>{fmtDate(order.expected_date)}</td><td>{fmtMoney(order.total || 0)}</td><td>{statusLabel(order.status)}</td></tr>)}</tbody></table></div></section>;
}
