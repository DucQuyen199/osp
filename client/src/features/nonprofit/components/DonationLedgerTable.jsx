import React from 'react';

/** Renders donation records and emits receipt requests to the charity workbench. */
export default function DonationLedgerTable({ rows = [], partyName, methods, fmtMoney, statusLabel, canReceive, busy, onReceive, t }) {
  return <div className="table-wrap u-mt-14"><table className="table">
    <thead><tr><th>{t('Nhà tài trợ')}</th><th>{t('Số tiền')}</th><th>{t('Phương thức')}</th><th>{t('Trạng thái / thao tác')}</th></tr></thead>
    <tbody>{rows.map((row) => <tr key={row.id}>
      <td>{partyName(row.donor)}<div className="small muted">{row.note}</div></td>
      <td>{fmtMoney(row.amount)}</td>
      <td>{t(methods.find(([value]) => value === row.method)?.[1] || row.method) || '—'}</td>
      <td><span className="badge warning">{statusLabel(row.status)}</span>{row.status === 'pledged' && canReceive && <button className="btn btn-primary btn-sm u-ml-8" disabled={Boolean(busy)} onClick={() => onReceive(row)}>{t('Xác nhận đã nhận')}</button>}</td>
    </tr>)}</tbody>
  </table></div>;
}
