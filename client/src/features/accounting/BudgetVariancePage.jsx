import React, { useCallback, useEffect, useState } from 'react';
import { localDate } from '../../lib/dates.js';
import { api, tenantPath } from '../../lib/api.js';
import { fmtMoney, fmtNumber, uiText } from '../../lib/i18n.js';

const year = () => localDate().slice(0, 4);
const amount = (value) => Number(value || 0);

function VarianceStats({ summary }) {
  return <div className="stats">
    <div className="card stat"><span className="stat-label">{uiText('Chi phí dự toán')}</span><strong className="stat-value num">{fmtMoney(summary.expensePlannedTotal)}</strong></div>
    <div className="card stat"><span className="stat-label">{uiText('Chi phí thực tế')}</span><strong className="stat-value num">{fmtMoney(summary.expenseActualTotal)}</strong></div>
    <div className="card stat"><span className="stat-label">{uiText('Còn lại chi phí')}</span><strong className="stat-value num">{fmtMoney(summary.expenseVarianceTotal)}</strong></div>
    <div className="card stat"><span className="stat-label">{uiText('Doanh thu kế hoạch')}</span><strong className="stat-value num">{fmtMoney(summary.revenuePlannedTotal)}</strong></div>
    <div className="card stat"><span className="stat-label">{uiText('Doanh thu thực tế')}</span><strong className="stat-value num">{fmtMoney(summary.revenueActualTotal)}</strong></div>
    <div className="card stat"><span className="stat-label">{uiText('Chênh lệch doanh thu')}</span><strong className="stat-value num">{fmtMoney(summary.revenueVarianceTotal)}</strong></div>
    <div className="card stat"><span className="stat-label">{uiText('Dòng bất lợi')}</span><strong className="stat-value num">{fmtNumber(Number(summary.unfavorableLines || summary.overBudgetLines || 0))}</strong></div>
  </div>;
}

export default function BudgetVariancePage() {
  const [period, setPeriod] = useState(year());
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (period.trim()) params.set('period', period.trim());
      setReport(await api(`${tenantPath('/reports/budget/variance')}?${params}`));
    } catch (reason) {
      setReport(null);
      setError(reason.message || uiText('Không tải được báo cáo thực hiện ngân sách.'));
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => { document.title = `${uiText('Thực hiện ngân sách')} · OSP Suite`; load(); }, [load]);

  return <div className="page">
    <div className="page-head"><div><h1>{uiText('Thực hiện ngân sách')}</h1><p className="sub">{uiText('Đối chiếu kế hoạch doanh thu và chi phí với số phát sinh theo số dư tự nhiên trên sổ kế toán.')}</p></div></div>
    <section className="card"><form className="toolbar" onSubmit={(event) => { event.preventDefault(); load(); }}>
      <label className="field"><span className="label">{uiText('Kỳ ngân sách')}</span><input className="input" value={period} onChange={(event) => setPeriod(event.target.value)} placeholder={uiText('YYYY hoặc YYYY-MM')} /></label>
      <button className="btn btn-primary" type="submit" disabled={loading}>{loading ? uiText('Đang tải…') : uiText('Xem báo cáo')}</button>
    </form></section>
    {error && <div className="alert danger" role="alert">{uiText(error)}</div>}
    {loading && !report ? <div className="card-pad"><div className="skeleton" data-h="row" /></div> : report && <div className="stack">
      {period.trim() ? <VarianceStats summary={report} /> : <section className="stack" aria-label={uiText('Tổng hợp theo kỳ ngân sách')}>
        {(report.periodSummaries || []).map((summary) => <section className="card" key={summary.period}>
          <div className="card-head"><h2>{summary.period}</h2></div>
          <VarianceStats summary={summary} />
        </section>)}
      </section>}
      {!report.lines?.length ? <div className="empty"><h2>{uiText('Chưa có ngân sách đã duyệt')}</h2><p>{uiText('Hãy thêm các dòng tài khoản chi phí hoặc doanh thu rồi duyệt ngân sách.')}</p></div> : <div className="card table-wrap"><table className="table">
        <thead><tr><th scope="col">{uiText('Kỳ')}</th><th scope="col">{uiText('Ngân sách')}</th><th scope="col">{uiText('Tài khoản')}</th><th scope="col">{uiText('Loại')}</th><th scope="col">{uiText('Trạng thái')}</th><th scope="col" className="right">{uiText('Dự toán')}</th><th scope="col" className="right">{uiText('Thực tế')}</th><th scope="col" className="right">{uiText('Chênh lệch thuận lợi')}</th><th scope="col" className="right">{uiText('Sử dụng')}</th></tr></thead>
        <tbody>{report.lines.map((line) => <tr key={line.lineId}>
          <td>{line.period}</td><td>{line.budget}</td><td>{line.accountCode} · {line.account}</td><td>{line.accountKind === 'revenue' ? uiText('Doanh thu') : uiText('Chi phí')}</td><td>{uiText(line.budgetStatus)}</td>
          <td className="right money">{fmtMoney(line.planned)}</td><td className="right money">{fmtMoney(line.actual)}</td>
          <td className="right money" data-over={amount(line.variance) < 0 || undefined}>{fmtMoney(line.variance)}</td><td className="right">{fmtNumber(amount(line.utilization), { maximumFractionDigits: 1 })}%</td>
        </tr>)}</tbody>
      </table></div>}
      <p className="faint">{uiText('Thực tế doanh thu/chi phí dùng số dư tự nhiên của tài khoản và cập nhật cùng transaction kế toán.')}</p>
    </div>}
  </div>;
}
