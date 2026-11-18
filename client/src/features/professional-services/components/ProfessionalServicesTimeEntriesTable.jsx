import React from 'react';

/** Renders case time entries and requests billing through controlled callbacks. */
export default function ProfessionalServicesTimeEntriesTable({
  entries = [],
  invoiceByTime,
  busy,
  canBill,
  fmtDate,
  fmtMoney,
  statusLabel,
  onBill,
  t,
}) {
  return <div className="table-wrap u-mt-14">
    <table className="table">
      <thead><tr><th>{t('Ngày')}</th><th>{t('Chuyên viên')}</th><th>{t('Giờ')}</th><th>{t('Phí')}</th><th>{t('Trạng thái / hóa đơn')}</th></tr></thead>
      <tbody>{entries.map((entry) => {
        const invoice = invoiceByTime.get(entry.id);
        return <tr key={entry.id}>
          <td>{fmtDate(entry.date)}</td>
          <td>{entry.who}</td>
          <td>{entry.hours}</td>
          <td>{fmtMoney(entry.amount)}</td>
          <td>
            <span className="badge warning">{statusLabel(entry.status)}</span>
            {entry.status === 'recorded' && canBill && <button className="btn btn-primary btn-sm u-ml-8" type="button" disabled={Boolean(busy)} onClick={() => onBill(entry)}>{t('Lập hóa đơn')}</button>}
            {invoice && <a className="btn btn-ghost btn-sm u-ml-6" href={`#/e/accounting/invoice/${invoice.id}`}>{t('Mở hóa đơn')} {statusLabel(invoice.status)}</a>}
          </td>
        </tr>;
      })}</tbody>
    </table>
  </div>;
}
