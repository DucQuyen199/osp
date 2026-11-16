import React, { useCallback, useEffect, useState } from 'react';
import { localDate } from '../../lib/dates.js';
import { api, tenantPath } from '../../lib/api.js';
import { fmtMoney, fmtNumber } from '../../lib/i18n.js';
import { can } from '../../lib/state.js';
import AccountingChartTemplateDialog from './AccountingChartTemplateDialog.jsx';

const today = localDate;
const yearStart = () => `${today().slice(0, 4)}-01-01`;
const forecastEnd = (start) => {
  const date = new Date(`${start}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 90);
  return date.toISOString().slice(0, 10);
};
const num = (value) => Number(value) || 0;

function ReportTable({ headers, rows }) {
  if (!rows.length) return <div className="empty"><h3>Chưa có phát sinh</h3><p>Không có dữ liệu trong khoảng ngày đã chọn.</p></div>;
  return <div className="table-wrap"><table className="table">
    <thead><tr>{headers.map((header) => <th key={header} scope="col">{header}</th>)}</tr></thead>
    <tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, index) => <td key={index} className={typeof cell === 'number' ? 'right money' : ''}>{typeof cell === 'number' ? fmtMoney(cell) : cell}</td>)}</tr>)}</tbody>
  </table></div>;
}

function Stat({ label, value }) {
  return <div className="card stat"><span className="stat-label">{label}</span><strong className="stat-value num">{fmtMoney(value)}</strong></div>;
}

const TAX_DOCUMENT_KIND = {
  invoice: 'Hóa đơn bán',
  credit_note: 'Điều chỉnh giảm bán',
  bill: 'Hóa đơn mua',
  debit_note: 'Điều chỉnh giảm mua',
};

function TaxDocumentTable({ rows }) {
  if (!rows?.length) return <div className="empty"><h3>Chưa có chứng từ</h3><p>Không có chứng từ thuế trong khoảng ngày đã chọn.</p></div>;
  return <div className="table-wrap"><table className="table">
    <thead><tr><th scope="col">Ngày hạch toán</th><th scope="col">Loại</th><th scope="col">Đối tác</th><th scope="col">Mã số thuế</th><th scope="col">Dòng thuế</th><th scope="col" className="right">Tổng tiền</th><th scope="col" className="right">Tiền thuế</th></tr></thead>
    <tbody>{rows.map((document) => {
      const lines = Array.isArray(document.lines) ? document.lines : [];
      return <tr key={`${document.kind}:${document.id}`}>
        <td className="mono">{document.postingDate}</td>
        <td>{TAX_DOCUMENT_KIND[document.kind] || document.kind}</td>
        <td>{document.counterparty || '—'}</td>
        <td className="mono">{document.taxCode || '—'}</td>
        <td><details><summary>{lines.length} dòng</summary><div className="table-wrap"><table className="table"><thead><tr><th scope="col">Hàng hóa / dịch vụ</th><th scope="col">Thuế</th><th scope="col" className="right">Cơ sở tính thuế</th><th scope="col" className="right">Tiền thuế</th></tr></thead><tbody>{lines.map((line, index) => {
          const tax = Number(line.base_tax_amount) || 0;
          const base = Number(line.base_net_amount) || 0;
          const name = line.product_name || line.name || line.description || line.product || 'Dòng chứng từ';
          const rate = line.tax_rate == null ? (line.tax_name || 'Chưa phân loại') : `${line.tax_name || 'Thuế'} · ${line.tax_rate}%`;
          return <tr key={`${document.id}:line:${index}`}><td>{name}</td><td>{rate}</td><td className="right money">{fmtMoney(base)}</td><td className="right money">{fmtMoney(tax)}</td></tr>;
        })}</tbody></table></div></details></td>
        <td className="right money">{fmtMoney(document.total)}</td>
        <td className="right money">{fmtMoney(document.taxTotal)}</td>
      </tr>;
    })}</tbody>
  </table></div>;
}

export default function AccountingReportsPage() {
  const [mode, setMode] = useState('income');
  const [from, setFrom] = useState(yearStart());
  const [to, setTo] = useState(today());
  const [asOf, setAsOf] = useState(today());
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [fxMemo, setFxMemo] = useState('Đánh giá lại công nợ ngoại tệ');
  const [fxJournal, setFxJournal] = useState(null);
  const [postingFx, setPostingFx] = useState(false);
  const [showChartTemplates, setShowChartTemplates] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      let path;
      if (mode === 'balance') {
        if (asOf) params.set('asOf', asOf);
        path = '/reports/accounting/balance-sheet';
      } else if (mode === 'receivables' || mode === 'payables' || mode === 'fx') {
        if (asOf) params.set('asOf', asOf);
        path = mode === 'fx' ? '/reports/accounting/fx-revaluation-preview' : `/reports/accounting/${mode === 'receivables' ? 'receivables-aging' : 'payables-aging'}`;
      } else if (mode === 'cashflow') {
        if (from) params.set('from', from);
        if (to) params.set('to', to);
        path = '/reports/accounting/cash-flow-forecast';
      } else {
        if (from) params.set('from', from);
        if (to) params.set('to', to);
        path = mode === 'trial' ? '/reports/accounting/trial-balance' : mode === 'tax' ? '/reports/accounting/tax-register' : '/reports/accounting/income-statement';
      }
      setReport(await api(`${tenantPath(path)}?${params}`));
    } catch (reason) {
      setReport(null);
      setError(reason.message || 'Không tải được báo cáo.');
    } finally {
      setLoading(false);
    }
  }, [mode, from, to, asOf]);

  useEffect(() => { document.title = 'Báo cáo kế toán · OSP Suite'; load(); }, [load]);

  const createFxDraft = async () => {
    setPostingFx(true);
    setError('');
    setFxJournal(null);
    try {
      const result = await api(tenantPath('/reports/accounting/fx-revaluation-journals'), {
        method: 'POST', body: { asOf, memo: fxMemo },
      });
      const journal = result.journal || null;
      const id = journal?.id || result.journalId;
      setFxJournal({ id, status: journal?.status || result.status || 'draft', existing: result.existing });
      await load();
    } catch (reason) {
      setError(reason.message || 'Could not create the foreign-currency revaluation draft.');
    } finally {
      setPostingFx(false);
    }
  };

  const income = report?.revenue || [];
  const expense = report?.expense || [];
  const unclassified = report?.unclassified || [];

  return <div className="page">
    <div className="page-head"><div><h1>Báo cáo kế toán</h1><p className="sub">Số liệu lấy từ bút toán đã ghi sổ theo ngày hạch toán.</p></div>{can('accounting.account.read') && can('accounting.account.create') && <button className="btn btn-secondary" type="button" onClick={() => setShowChartTemplates(true)}>Mẫu hệ thống tài khoản</button>}</div>
    {showChartTemplates && <AccountingChartTemplateDialog onClose={() => setShowChartTemplates(false)} />}
    <section className="card">
      <form className="toolbar" onSubmit={(event) => { event.preventDefault(); load(); }}>
        <label className="field"><span className="label">Loại báo cáo</span><select className="select" value={mode} onChange={(event) => { const next = event.target.value; setMode(next); if (next === 'cashflow') { const start = today(); setFrom(start); setTo(forecastEnd(start)); } }}>
          <option value="income">Kết quả kinh doanh</option><option value="balance">Bảng cân đối kế toán</option><option value="trial">Bảng cân đối phát sinh</option><option value="receivables">Tuổi nợ phải thu</option><option value="payables">Tuổi nợ phải trả</option><option value="fx">FX revaluation preview</option><option value="cashflow">Dự báo dòng tiền</option><option value="tax">Sổ thuế đầu ra / đầu vào</option>
        </select></label>
        {['balance', 'receivables', 'payables', 'fx'].includes(mode) ? <label className="field"><span className="label">Tính đến ngày</span><input className="input" type="date" value={asOf} onChange={(event) => setAsOf(event.target.value)} /></label> : <>
          <label className="field"><span className="label">Từ ngày</span><input className="input" type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
          <label className="field"><span className="label">Đến ngày</span><input className="input" type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
        </>}
        <button className="btn btn-primary" type="submit" disabled={loading}>{loading ? 'Đang tải…' : 'Xem báo cáo'}</button>
      </form>
    </section>
    {error && <div className="alert danger" role="alert">{error}</div>}
    {loading && !report ? <div className="card-pad"><div className="skeleton" data-h="row" /></div> : report && <div className="stack">
      {mode === 'income' && <>
        <div className="stats"><Stat label="Doanh thu" value={report.totalRevenue} /><Stat label="Chi phí" value={report.totalExpense} /><Stat label="Lãi / lỗ thuần" value={report.netIncome} /></div>
        {!report.complete && <div className="alert warning" role="status">Có tài khoản chưa phân loại; báo cáo kết quả kinh doanh chưa đầy đủ.</div>}
        <section className="card report-section"><div className="card-head"><h2>Doanh thu</h2></div><div className="card-pad"><ReportTable headers={['Mã tài khoản', 'Tài khoản', 'Phát sinh thuần']} rows={income.map((row) => [row.code, row.name, num(row.balance)])} /></div></section>
        <section className="card report-section"><div className="card-head"><h2>Chi phí</h2></div><div className="card-pad"><ReportTable headers={['Mã tài khoản', 'Tài khoản', 'Phát sinh thuần']} rows={expense.map((row) => [row.code, row.name, num(row.balance)])} /></div></section>
        {!report.complete && <section className="card report-section"><div className="card-head"><h2>Tài khoản chưa phân loại</h2></div><div className="card-pad"><ReportTable headers={['Mã tài khoản', 'Tài khoản', 'Nợ trừ Có']} rows={unclassified.map((row) => [row.code, row.name, num(row.balance)])} /></div></section>}
      </>}
      {mode === 'balance' && <>
        <div className="stats"><Stat label="Tổng tài sản" value={report.totalAssets} /><Stat label="Nợ phải trả" value={report.totalLiabilities} /><Stat label="Vốn chủ sở hữu" value={report.totalEquity} /><Stat label="Lợi nhuận lũy kế" value={report.currentEarnings} /><Stat label="Nợ và vốn" value={report.liabilitiesAndEquity} /></div>
        {!report.complete && <div className="alert warning" role="status">Có tài khoản chưa phân loại; bảng cân đối chưa đầy đủ.</div>}
        {report.complete && !report.balanced && <div className="alert danger" role="alert">Bảng cân đối đang lệch {fmtMoney(num(report.difference))}. Hãy kiểm tra số dư đầu kỳ và các bút toán.</div>}
        {[
          ['Tài sản', report.assets, report.totalAssets], ['Nợ phải trả', report.liabilities, report.totalLiabilities], ['Vốn chủ sở hữu', report.equity, report.totalEquity],
        ].map(([title, rows, total]) => <section key={title} className="card report-section"><div className="card-head"><h2>{title}</h2><strong className="num">{fmtMoney(num(total))}</strong></div><div className="card-pad"><ReportTable headers={['Mã tài khoản', 'Tài khoản', 'Số dư']} rows={(rows || []).map((row) => [row.code, row.name, num(row.balance)])} /></div></section>)}
        {!report.complete && <section className="card report-section"><div className="card-head"><h2>Tài khoản chưa phân loại</h2></div><div className="card-pad"><ReportTable headers={['Mã tài khoản', 'Tài khoản', 'Nợ trừ Có']} rows={unclassified.map((row) => [row.code, row.name, num(row.balance)])} /></div></section>}
        <p className="muted small">Lợi nhuận/lỗ lũy kế đến {report.asOf || 'hôm nay'} được cộng vào phần vốn để đối chiếu.</p>
      </>}
      {mode === 'trial' && <section className="card report-section"><div className="card-pad"><ReportTable headers={['Mã TK', 'Tài khoản', 'Dư Nợ đầu', 'Dư Có đầu', 'Phát sinh Nợ', 'Phát sinh Có', 'Dư Nợ cuối', 'Dư Có cuối']} rows={(report.accounts || []).map((row) => [row.code, row.name, num(row.openingDebit), num(row.openingCredit), num(row.periodDebit), num(row.periodCredit), num(row.closingDebit), num(row.closingCredit)])} /></div></section>}
      {mode === 'tax' && <>
        <div className="stats"><Stat label="Thuế đầu ra thuần" value={report.outputTax} /><Stat label="Thuế đầu vào thuần" value={report.inputTax} /><Stat label="Chênh lệch đầu ra - đầu vào" value={report.netTaxPosition} /></div>
        <section className="card report-section"><div className="card-head"><h2>Tổng hợp theo thuế suất</h2><span className="muted small">{report.invoiceCount} hóa đơn · {report.creditNoteCount} credit note · {report.billCount} bill · {report.debitNoteCount} debit note</span></div><div className="card-pad"><ReportTable headers={['Thuế', 'Thuế đầu ra', 'Cơ sở bán thuần', 'Thuế đầu vào', 'Cơ sở mua thuần', 'Thuế đầu ra thuần - đầu vào thuần']} rows={(report.byRate || []).map((row) => [row.taxRate == null ? `${row.taxName} · chưa phân loại` : `${row.taxName} · ${row.taxRate}%`, num(row.outputTax), num(row.taxableBase), num(row.inputTax), num(row.taxablePurchaseBase), num(row.netTaxPosition)])} /></div></section>
        <section className="card report-section"><div className="card-head"><h2>Tax document details</h2><span className="muted small">Expand each document to compare taxable bases and tax amounts.</span></div><div className="card-pad"><TaxDocumentTable rows={report.documents || []} /></div></section>
        <p className="muted small">Sổ nội bộ tổng hợp theo ngày bút toán, gồm hóa đơn bán, credit note, bill mua và debit note đã ghi sổ. Đối chiếu thuế đầu vào với chứng từ và quy định trước khi kê khai.</p>
      </>}
      {(mode === 'receivables' || mode === 'payables') && <>
        <div className="stats"><Stat label={mode === 'receivables' ? 'Tổng phải thu còn lại' : 'Tổng phải trả còn lại'} value={report.totals?.total} /><Stat label="Quá hạn trên 90 ngày" value={report.totals?.over90Days} /></div>
        <section className="card report-section"><div className="card-head"><h2>{mode === 'receivables' ? 'Theo khách hàng' : 'Theo nhà cung cấp'}</h2><span className="muted small">Số dư tại {report.asOf}</span></div><div className="card-pad"><ReportTable headers={[mode === 'receivables' ? 'Khách hàng' : 'Nhà cung cấp', 'Chứng từ', 'Chưa đến hạn', 'Đến hạn hôm nay', '1–30 ngày', '31–60 ngày', '61–90 ngày', 'Trên 90 ngày', 'Còn lại']} rows={(report.parties || []).map((row) => [row.party, String(row.documents), num(row.notDue), num(row.dueToday), num(row.days1To30), num(row.days31To60), num(row.days61To90), num(row.over90Days), num(row.total)])} /></div></section>
      </>}
      {mode === 'fx' && <>
        <div className="alert info" role="status">Review closing rates and proposed adjustments. Creating a draft does not post it to the ledger; use the standard journal approval flow.</div>
        {report.missingRates > 0 && <div className="alert danger" role="alert">{report.missingRates} currency position(s) have no closing rate on or before {report.asOf}.</div>}
        <section className="card report-section"><div className="card-head"><h2>Foreign-currency positions</h2><span className="muted small">As of {report.asOf} · base currency {report.baseCurrency}</span></div><div className="card-pad">
          {(report.positions || []).length === 0 ? <div className="empty"><h3>No open foreign-currency balances</h3></div> : <div className="table-wrap"><table className="table">
            <thead><tr><th scope="col">Type</th><th scope="col">Currency</th><th scope="col" className="right">Open balance</th><th scope="col" className="right">Carrying amount</th><th scope="col" className="right">Closing rate</th><th scope="col" className="right">Target base amount</th><th scope="col" className="right">Proposed adjustment</th></tr></thead>
            <tbody>{report.positions.map((position) => <tr key={`${position.side}:${position.currencyId}`}>
              <td>{position.side === 'receivable' ? 'Receivable' : 'Payable'}</td><td>{position.currency} · {position.currencyName}</td>
              <td className="right">{fmtNumber(Number(position.foreignBalance || 0))} {position.currency}</td><td className="right money">{fmtMoney(num(position.carryingBase))}</td>
              <td className="right">{position.closingRate == null ? 'Missing' : fmtNumber(Number(position.closingRate), { maximumFractionDigits: 8 })}{position.rateDate ? ` · ${position.rateDate}` : ''}</td>
              <td className="right money">{position.targetBase == null ? '—' : fmtMoney(num(position.targetBase))}</td><td className="right money">{position.adjustment == null ? '—' : fmtMoney(num(position.adjustment))}</td>
            </tr>)}</tbody>
          </table></div>}
        </div></section>
        {can('accounting.journal_entry.create') && <section className="card card-pad">
          <div className="card-head"><h2>Create revaluation journal draft</h2><span className="faint">One idempotent journal per accounting date; review any existing entry before creating another.</span></div>
          <div className="toolbar">
            <label className="field"><span className="label">Memo</span><input className="input" maxLength={300} value={fxMemo} onChange={(event) => setFxMemo(event.target.value)} /></label>
            <button className="btn btn-primary" type="button" disabled={postingFx || loading || !report.draftCreationEnabled || !fxMemo.trim()} onClick={createFxDraft}>{postingFx ? 'Creating…' : 'Create journal draft'}</button>
          </div>
          {fxJournal && <div className="alert success" role="status">{fxJournal.existing ? 'A journal already exists for this date.' : 'Draft journal created.'} {fxJournal.id && <a href={`#/e/accounting/journal_entry/${encodeURIComponent(fxJournal.id)}`}>Open journal</a>} <span>Status: {fxJournal.status}</span></div>}
        </section>}
      </>}
      {mode === 'cashflow' && <>
        <div className="stats"><Stat label="Dự kiến thu" value={report.inflow} /><Stat label="Dự kiến chi" value={report.outflow} /><Stat label="Cam kết mua hàng" value={report.purchaseCommitments} /><Stat label="Lương chờ chi" value={report.payrollOutflow} /><Stat label="Hoàn ứng chờ chi" value={report.expenseReimbursements} /><Stat label="Dòng tiền ròng" value={report.net} /></div>
        <section className="card report-section"><div className="card-head"><h2>Lịch thu chi dự kiến</h2><span className="muted small">Số dư công nợ tại {report.asOf}</span></div><div className="card-pad"><ReportTable headers={['Ngày dự kiến', 'Loại', 'Đối tác', 'Mã chứng từ', 'Số tiền']} rows={(report.items || []).map((item) => [item.forecastDate, item.kind === 'receivable' ? 'Dự kiến thu' : item.kind === 'purchase_commitment' ? 'Cam kết mua hàng' : item.kind === 'payroll_payment' ? 'Thanh toán lương' : item.kind === 'expense_reimbursement' ? 'Hoàn ứng nhân viên' : 'Dự kiến chi', item.party, item.documentId, num(item.amount)])} /></div></section>
        <p className="muted small">Dự báo dựa trên hóa đơn đã ghi sổ còn mở, đơn mua đã duyệt chưa ghi bill, bảng lương đã duyệt và đề nghị chi đã duyệt có ngày thanh toán. Chưa gồm thuế hoặc doanh thu bán hàng chưa lập hóa đơn.</p>
      </>}
    </div>}
  </div>;
}
