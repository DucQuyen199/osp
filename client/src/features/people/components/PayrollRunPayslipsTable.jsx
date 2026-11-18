import React from 'react';

export default function PayrollRunPayslipsTable({ rows, employees, totalNet, recordLabel, fmtMoney, t }) {
  return <div className="table-wrap"><table className="table">
    <thead><tr><th>{t('Nhân viên')}</th><th>{t('Ngày công')}</th><th>{t('Lương gộp')}</th><th>{t('Khấu trừ')}</th><th>{t('Thực nhận')}</th></tr></thead>
    <tbody>{rows.map((slip) => <tr key={slip.id}>
      <td>{employees.get(slip.employee) ? recordLabel('hrm.employee', employees.get(slip.employee)) : t('Nhân viên')}</td>
      <td>{slip.paid_days} / {slip.working_days}</td>
      <td>{fmtMoney(slip.gross || 0)}</td>
      <td>{fmtMoney(slip.deductions || 0)}</td>
      <td><strong>{fmtMoney(slip.net || 0)}</strong></td>
    </tr>)}</tbody>
    <tfoot><tr><th colSpan="4">{t('Tổng thực nhận')}</th><th>{fmtMoney(totalNet)}</th></tr></tfoot>
  </table></div>;
}
