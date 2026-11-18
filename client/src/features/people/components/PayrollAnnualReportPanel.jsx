import React from 'react';
import { fmtMoney } from '../../../lib/i18n.js';
import { recordLabel } from '../../../lib/state.js';

const TOTAL_FIELDS = ['gross', 'taxable_income', 'income_tax', 'employee_contribution', 'net', 'medical_deduction', 'education_deduction'];

/** Renders the controlled annual payroll and withholding summary. */
export default function PayrollAnnualReportPanel({
  rows = [],
  totals = {},
  employees,
  reportYear,
  reportYears = [],
  loading = false,
  onYearChange,
  onExport,
  t,
}) {
  return <section className="card card-pad u-mt-16">
    <div className="row wrap">
      <div>
        <h2>{t('Tổng hợp lương và thuế theo năm')}</h2>
        <p className="small muted">{t('Cộng phiếu từ bảng lương có ngày chi trong năm. Các khoản y tế/giáo dục là hồ sơ đã duyệt, giới hạn theo chính sách thuế năm. Nếu dùng các khoản giảm trừ này để quyết toán, cá nhân phải tự quyết toán; báo cáo không tính nghĩa vụ thuế cuối cùng.')}</p>
      </div>
      <span className="grow" />
      <label className="field">
        <span className="label">{t('Năm')}</span>
        <select className="select" value={reportYear} onChange={(event) => onYearChange(event.target.value)}>
          {reportYears.map((year) => <option key={year} value={year}>{year}</option>)}
        </select>
      </label>
      <button className="btn btn-secondary" type="button" disabled={!rows.length} onClick={onExport}>{t('Tải CSV')}</button>
    </div>
    {loading ? <div className="skeleton" data-h="row" /> : rows.length ? <div className="table-wrap">
      <table className="table">
        <thead><tr><th>{t('Nhân viên')}</th><th>{t('Số bảng lương đã chi')}</th><th>{t('Lương gộp')}</th><th>{t('Thu nhập tính thuế')}</th><th>{t('Thuế đã khấu trừ')}</th><th>{t('Đóng góp nhân viên')}</th><th>{t('Thực nhận')}</th><th>{t('Giảm trừ y tế')}</th><th>{t('Giảm trừ giáo dục')}</th></tr></thead>
        <tbody>{rows.map((row) => <tr key={row.employee}>
          <td>{employees.get(row.employee) ? recordLabel('hrm.employee', employees.get(row.employee)) : t('Nhân viên')}</td>
          <td>{row.paidRuns}</td><td>{fmtMoney(row.gross)}</td><td>{fmtMoney(row.taxable_income)}</td>
          <td>{fmtMoney(row.income_tax)}</td><td>{fmtMoney(row.employee_contribution)}</td><td><strong>{fmtMoney(row.net)}</strong></td>
          <td>{row.medical_deduction === null ? '—' : fmtMoney(row.medical_deduction)}</td>
          <td>{row.education_deduction === null ? '—' : fmtMoney(row.education_deduction)}</td>
        </tr>)}</tbody>
        <tfoot><tr><th>{t('Tổng')}</th><th>—</th>{TOTAL_FIELDS.map((field) => <th key={field}>{totals[field] === null ? '—' : fmtMoney(totals[field] ?? 0)}</th>)}</tr></tfoot>
      </table>
    </div> : <div className="empty">{t('Chưa có payroll hoặc hồ sơ giảm trừ đã duyệt trong năm')} {reportYear}.</div>}
  </section>;
}
