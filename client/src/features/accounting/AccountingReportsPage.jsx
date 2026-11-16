import React, { useCallback, useEffect, useState } from 'react';
import { useDocumentTitle } from '../../lib/useDocumentTitle.js';
import { localDate } from '../../lib/dates.js';
import { api, tenantPath } from '../../lib/api.js';
import { fmtMoney, fmtNumber, uiText } from '../../lib/i18n.js';
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
  if (!rows.length) return <div className="empty"><h3>{uiText("Chưa có phát sinh")}</h3><p>{uiText("Không có dữ liệu trong khoảng ngày đã chọn.")}</p></div>;
  return <div className="table-wrap"><table className="table">
    <thead><tr>{headers.map((header) => <th key={header} scope="col">{uiText(header)}</th>)}</tr></thead>
    <tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, index) => <td key={index} className={typeof cell === 'number' ? 'right money' : ''}>{typeof cell === 'number' ? fmtMoney(cell) : uiText(cell)}</td>)}</tr>)}</tbody>
  </table></div>;
}
function Stat({ label, value }) {
  return <div className="card stat"><span className="stat-label">{uiText(label)}</span><strong className="stat-value num">{fmtMoney(value)}</strong></div>;
}
const TAX_DOCUMENT_KIND = {
  invoice: 'Hóa đơn bán',
  credit_note: 'Điều chỉnh giảm bán',
  bill: 'Hóa đơn mua',
  debit_note: 'Điều chỉnh giảm mua',
};
function TaxDocumentTable({ rows }) {
  if (!rows?.length) return <div className="empty"><h3>{uiText("Chưa có chứng từ")}</h3><p>{uiText("Không có chứng từ thuế trong khoảng ngày đã chọn.")}</p></div>;
  return <div className="table-wrap"><table className="table">
    <thead><tr><th scope="col">{uiText("Ngày hạch toán")}</th><th scope="col">{uiText("Loại")}</th><th scope="col">{uiText("Đối tác")}</th><th scope="col">{uiText("Mã số thuế")}</th><th scope="col">{uiText("Dòng thuế")}</th><th scope="col" className="right">{uiText("Tổng tiền")}</th><th scope="col" className="right">{uiText("Tiền thuế")}</th></tr></thead>
    <tbody>{rows.map((document) => {
      const lines = Array.isArray(document.lines) ? document.lines : [];
      return <tr key={`${document.kind}:${document.id}`}>
        <td className="mono">{document.postingDate}</td>
        <td>{uiText(TAX_DOCUMENT_KIND[document.kind] || document.kind)}</td>
        <td>{document.counterparty || '—'}</td>
        <td className="mono">{document.taxCode || '—'}</td>
        <td><details><summary>{lines.length} dòng</summary><div className="table-wrap"><table className="table"><thead><tr><th scope="col">{uiText("Hàng hóa / dịch vụ")}</th><th scope="col">{uiText("Thuế")}</th><th scope="col" className="right">{uiText("Cơ sở tính thuế")}</th><th scope="col" className="right">{uiText("Tiền thuế")}</th></tr></thead><tbody>{lines.map((line, index) => {
          const tax = Number(line.base_tax_amount) || 0;
          const base = Number(line.base_net_amount) || 0;
          const name = line.product_name || line.name || line.description || line.product || uiText('Dòng chứng từ');
          const rate = line.tax_rate == null ? uiText(line.tax_name || 'Chưa phân loại') : `${uiText(line.tax_name || 'Thuế')} · ${line.tax_rate}%`;
          return <tr key={`${document.id}:line:${index}`}><td>{name}</td><td>{rate}</td><td className="right money">{fmtMoney(base)}</td><td className="right money">{fmtMoney(tax)}</td></tr>;
        })}</tbody></table></div></details></td>
        <td className="right money">{fmtMoney(document.total)}</td>
        <td className="right money">{fmtMoney(document.taxTotal)}</td>
      </tr>;
    })}</tbody>
  </table></div>;
}
export default function AccountingReportsPage() {
  useDocumentTitle(`${uiText('Báo cáo kế toán')} · OSP Suite`);
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
      setError(reason.message || uiText('Không tải được báo cáo.'));
    } finally {
      setLoading(false);
    }
  }, [mode, from, to, asOf]);
  useEffect(() => { load(); }, [load]);
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
      setError(reason.message || uiText('Không tạo được bút toán đánh giá lại ngoại tệ nháp.'));
    } finally {
      setPostingFx(false);
    }
  };
  const income = report?.revenue || [];
  const expense = report?.expense || [];
  const unclassified = report?.unclassified || [];
  return <div className="page">
    <div className="page-head"><div><h1>{uiText("Báo cáo kế toán")}</h1><p className="sub">{uiText("Số liệu lấy từ bút toán đã ghi sổ theo ngày hạch toán.")}</p></div>{can('accounting.account.read') && can('accounting.account.create') && <button className="btn btn-secondary" type="button" onClick={() => setShowChartTemplates(true)}>{uiText("Mẫu hệ thống tài khoản")}</button>}</div>
    {showChartTemplates && <AccountingChartTemplateDialog onClose={() => setShowChartTemplates(false)} />}
    <section className="card">
      <form className="toolbar" onSubmit={(event) => { event.preventDefault(); load(); }}>
        <label className="field"><span className="label">{uiText("Loại báo cáo")}</span><select className="select" value={mode} onChange={(event) => { const next = event.target.value; setMode(next); if (next === 'cashflow') { const start = today(); setFrom(start); setTo(forecastEnd(start)); } }}>
          <option value="income">{uiText("Kết quả kinh doanh")}</option><option value="balance">{uiText("Bảng cân đối kế toán")}</option><option value="trial">{uiText("Bảng cân đối phát sinh")}</option><option value="receivables">{uiText("Tuổi nợ phải thu")}</option><option value="payables">{uiText("Tuổi nợ phải trả")}</option><option value="fx">{uiText("Đánh giá lại ngoại tệ")}</option><option value="cashflow">{uiText("Dự báo dòng tiền")}</option><option value="tax">{uiText("Sổ thuế đầu ra / đầu vào")}</option>
        </select></label>
        {['balance', 'receivables', 'payables', 'fx'].includes(mode) ? <label className="field"><span className="label">{uiText("Tính đến ngày")}</span><input className="input" type="date" value={asOf} onChange={(event) => setAsOf(event.target.value)} /></label> : <>
          <label className="field"><span className="label">{uiText("Từ ngày")}</span><input className="input" type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
          <label className="field"><span className="label">{uiText("Đến ngày")}</span><input className="input" type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
        </>}
        <button className="btn btn-primary" type="submit" disabled={loading}>{loading ? uiText('Đang tải…') : uiText('Xem báo cáo')}</button>
      </form>
    </section>
    {error && <div className="alert danger" role="alert">{uiText(error)}</div>}
    {loading && !report ? <div className="card-pad"><div className="skeleton" data-h="row" /></div> : report && <div className="stack">
      {mode === 'income' && <>
        <div className="stats"><Stat label="Doanh thu" value={report.totalRevenue} /><Stat label="Chi phí" value={report.totalExpense} /><Stat label="Lãi / lỗ thuần" value={report.netIncome} /></div>
        {!report.complete && <div className="alert warning" role="status">{uiText("Có tài khoản chưa phân loại; báo cáo kết quả kinh doanh chưa đầy đủ.")}</div>}
        <section className="card report-section"><div className="card-head"><h2>{uiText("Doanh thu")}</h2></div><div className="card-pad"><ReportTable headers={['Mã tài khoản', 'Tài khoản', 'Phát sinh thuần']} rows={income.map((row) => [row.code, row.name, num(row.balance)])} /></div></section>
        <section className="card report-section"><div className="card-head"><h2>{uiText("Chi phí")}</h2></div><div className="card-pad"><ReportTable headers={['Mã tài khoản', 'Tài khoản', 'Phát sinh thuần']} rows={expense.map((row) => [row.code, row.name, num(row.balance)])} /></div></section>
        {!report.complete && <section className="card report-section"><div className="card-head"><h2>{uiText("Tài khoản chưa phân loại")}</h2></div><div className="card-pad"><ReportTable headers={['Mã tài khoản', 'Tài khoản', 'Nợ trừ Có']} rows={unclassified.map((row) => [row.code, row.name, num(row.balance)])} /></div></section>}
      </>}
      {mode === 'balance' && <>
        <div className="stats"><Stat label="Tổng tài sản" value={report.totalAssets} /><Stat label="Nợ phải trả" value={report.totalLiabilities} /><Stat label="Vốn chủ sở hữu" value={report.totalEquity} /><Stat label="Lợi nhuận lũy kế" value={report.currentEarnings} /><Stat label="Nợ và vốn" value={report.liabilitiesAndEquity} /></div>
        {!report.complete && <div className="alert warning" role="status">{uiText("Có tài khoản chưa phân loại; bảng cân đối chưa đầy đủ.")}</div>}
        {report.complete && !report.balanced && <div className="alert danger" role="alert">{uiText('Bảng cân đối đang lệch {difference}. Hãy kiểm tra số dư đầu kỳ và các bút toán.').replace('{difference}', fmtMoney(num(report.difference)))}</div>}
        {[
          ['Tài sản', report.assets, report.totalAssets], ['Nợ phải trả', report.liabilities, report.totalLiabilities], ['Vốn chủ sở hữu', report.equity, report.totalEquity],
        ].map(([title, rows, total]) => <section key={title} className="card report-section"><div className="card-head"><h2>{uiText(title)}</h2><strong className="num">{fmtMoney(num(total))}</strong></div><div className="card-pad"><ReportTable headers={['Mã tài khoản', 'Tài khoản', 'Số dư']} rows={(rows || []).map((row) => [row.code, row.name, num(row.balance)])} /></div></section>)}
        {!report.complete && <section className="card report-section"><div className="card-head"><h2>{uiText("Tài khoản chưa phân loại")}</h2></div><div className="card-pad"><ReportTable headers={['Mã tài khoản', 'Tài khoản', 'Nợ trừ Có']} rows={unclassified.map((row) => [row.code, row.name, num(row.balance)])} /></div></section>}
        <p className="muted small">{uiText('Lợi nhuận/lỗ lũy kế đến {date} được cộng vào phần vốn để đối chiếu.').replace('{date}', report.asOf || uiText('hôm nay'))}</p>
      </>}
      {mode === 'trial' && <section className="card report-section"><div className="card-pad"><ReportTable headers={['Mã TK', 'Tài khoản', 'Dư Nợ đầu', 'Dư Có đầu', 'Phát sinh Nợ', 'Phát sinh Có', 'Dư Nợ cuối', 'Dư Có cuối']} rows={(report.accounts || []).map((row) => [row.code, row.name, num(row.openingDebit), num(row.openingCredit), num(row.periodDebit), num(row.periodCredit), num(row.closingDebit), num(row.closingCredit)])} /></div></section>}
      {mode === 'tax' && <>
        <div className="stats"><Stat label="Thuế đầu ra thuần" value={report.outputTax} /><Stat label="Thuế đầu vào thuần" value={report.inputTax} /><Stat label="Chênh lệch đầu ra - đầu vào" value={report.netTaxPosition} /></div>
        <section className="card report-section"><div className="card-head"><h2>{uiText("Tổng hợp theo thuế suất")}</h2><span className="muted small">{uiText('{invoices} invoices · {credits} credit notes · {bills} bills · {debits} debit notes').replace('{invoices}', report.invoiceCount).replace('{credits}', report.creditNoteCount).replace('{bills}', report.billCount).replace('{debits}', report.debitNoteCount)}</span></div><div className="card-pad"><ReportTable headers={['Thuế', 'Thuế đầu ra', 'Cơ sở bán thuần', 'Thuế đầu vào', 'Cơ sở mua thuần', 'Thuế đầu ra thuần - đầu vào thuần']} rows={(report.byRate || []).map((row) => [row.taxRate == null ? `${uiText(row.taxName)} · ${uiText('chưa phân loại')}` : `${uiText(row.taxName)} · ${row.taxRate}%`, num(row.outputTax), num(row.taxableBase), num(row.inputTax), num(row.taxablePurchaseBase), num(row.netTaxPosition)])} /></div></section>
        <section className="card report-section"><div className="card-head"><h2>{uiText("Chi tiết chứng từ thuế")}</h2><span className="muted small">{uiText("Mở rộng từng chứng từ để so sánh cơ sở tính thuế và tiền thuế.")}</span></div><div className="card-pad"><TaxDocumentTable rows={report.documents || []} /></div></section>
        <p className="muted small">{uiText("Sổ nội bộ tổng hợp theo ngày bút toán, gồm hóa đơn bán, credit note, bill mua và debit note đã ghi sổ. Đối chiếu thuế đầu vào với chứng từ và quy định trước khi kê khai.")}</p>
      </>}
      {(mode === 'receivables' || mode === 'payables') && <>
        <div className="stats"><Stat label={uiText(mode === 'receivables' ? 'Tổng phải thu còn lại' : 'Tổng phải trả còn lại')} value={report.totals?.total} /><Stat label={uiText('Quá hạn trên 90 ngày')} value={report.totals?.over90Days} /></div>
        <section className="card report-section"><div className="card-head"><h2>{uiText(mode === 'receivables' ? 'Theo khách hàng' : 'Theo nhà cung cấp')}</h2><span className="muted small">{uiText('Số dư tại {date}').replace('{date}', report.asOf)}</span></div><div className="card-pad"><ReportTable headers={[mode === 'receivables' ? uiText('Khách hàng') : uiText('Nhà cung cấp'), 'Chứng từ', 'Chưa đến hạn', 'Đến hạn hôm nay', '1–30 ngày', '31–60 ngày', '61–90 ngày', 'Trên 90 ngày', 'Còn lại']} rows={(report.parties || []).map((row) => [row.party, String(row.documents), num(row.notDue), num(row.dueToday), num(row.days1To30), num(row.days31To60), num(row.days61To90), num(row.over90Days), num(row.total)])} /></div></section>
      </>}
      {mode === 'fx' && <>
        <div className="alert info" role="status">{uiText("Rà soát tỷ giá cuối kỳ và khoản điều chỉnh đề xuất. Tạo bản nháp không ghi sổ; hãy dùng luồng duyệt bút toán chuẩn.")}</div>
        {report.missingRates > 0 && <div className="alert danger" role="alert">{uiText('{count} currency position(s) have no closing rate on or before {date}.').replace('{count}', report.missingRates).replace('{date}', report.asOf)}</div>}
        <section className="card report-section"><div className="card-head"><h2>{uiText("Số dư ngoại tệ")}</h2><span className="muted small">{uiText('Tính đến {date} · đồng tiền cơ sở {currency}').replace('{date}', report.asOf).replace('{currency}', report.baseCurrency)}</span></div><div className="card-pad">
          {(report.positions || []).length === 0 ? <div className="empty"><h3>{uiText("Không có số dư ngoại tệ còn mở")}</h3></div> : <div className="table-wrap"><table className="table">
            <thead><tr><th scope="col">{uiText("Loại")}</th><th scope="col">{uiText("Đồng tiền")}</th><th scope="col" className="right">{uiText("Số dư ngoại tệ")}</th><th scope="col" className="right">{uiText("Giá trị ghi sổ")}</th><th scope="col" className="right">{uiText("Tỷ giá cuối kỳ")}</th><th scope="col" className="right">{uiText("Số tiền quy đổi mục tiêu")}</th><th scope="col" className="right">{uiText("Điều chỉnh đề xuất")}</th></tr></thead>
            <tbody>{report.positions.map((position) => <tr key={`${position.side}:${position.currencyId}`}>
              <td>{uiText(position.side === 'receivable' ? 'Khoản phải thu' : 'Khoản phải trả')}</td><td>{position.currency} · {position.currencyName}</td>
              <td className="right">{fmtNumber(Number(position.foreignBalance || 0))} {position.currency}</td><td className="right money">{fmtMoney(num(position.carryingBase))}</td>
              <td className="right">{position.closingRate == null ? uiText('Missing') : fmtNumber(Number(position.closingRate), { maximumFractionDigits: 8 })}{position.rateDate ? ` · ${position.rateDate}` : ''}</td>
              <td className="right money">{position.targetBase == null ? '—' : fmtMoney(num(position.targetBase))}</td><td className="right money">{position.adjustment == null ? '—' : fmtMoney(num(position.adjustment))}</td>
            </tr>)}</tbody>
          </table></div>}
        </div></section>
        {can('accounting.journal_entry.create') && <section className="card card-pad">
          <div className="card-head"><h2>{uiText("Tạo bút toán đánh giá lại nháp")}</h2><span className="faint">{uiText("Mỗi ngày hạch toán chỉ có một bút toán; kiểm tra bút toán hiện có trước khi tạo.")}</span></div>
          <div className="toolbar">
            <label className="field"><span className="label">{uiText("Diễn giải")}</span><input className="input" maxLength={300} value={fxMemo} onChange={(event) => setFxMemo(event.target.value)} /></label>
            <button className="btn btn-primary" type="button" disabled={postingFx || loading || !report.draftCreationEnabled || !fxMemo.trim()} onClick={createFxDraft}>{postingFx ? uiText('Đang tạo…') : uiText('Tạo bút toán nháp')}</button>
          </div>
          {fxJournal && <div className="alert success" role="status">{uiText(fxJournal.existing ? 'Đã có bút toán cho ngày này.' : 'Đã tạo bút toán nháp.')} {fxJournal.id && <a href={`#/e/accounting/journal_entry/${encodeURIComponent(fxJournal.id)}`}>{uiText("Mở bút toán")}</a>} <span>{uiText('Trạng thái: {status}').replace('{status}', uiText(fxJournal.status))}</span></div>}
        </section>}
      </>}
      {mode === 'cashflow' && <>
        <div className="stats"><Stat label={uiText('Dự kiến thu')} value={report.inflow} /><Stat label={uiText('Dự kiến chi')} value={report.outflow} /><Stat label={uiText('Cam kết mua hàng')} value={report.purchaseCommitments} /><Stat label={uiText('Lương chờ chi')} value={report.payrollOutflow} /><Stat label={uiText('Hoàn ứng chờ chi')} value={report.expenseReimbursements} /><Stat label={uiText('Dòng tiền ròng')} value={report.net} /></div>
        <section className="card report-section"><div className="card-head"><h2>{uiText("Lịch thu chi dự kiến")}</h2><span className="muted small">{uiText('Số dư công nợ tại {date}').replace('{date}', report.asOf)}</span></div><div className="card-pad"><ReportTable headers={['Ngày dự kiến', 'Loại', 'Đối tác', 'Mã chứng từ', 'Số tiền'].map(uiText)} rows={(report.items || []).map((item) => [item.forecastDate, uiText(item.kind === 'receivable' ? 'Dự kiến thu' : item.kind === 'purchase_commitment' ? 'Cam kết mua hàng' : item.kind === 'payroll_payment' ? 'Thanh toán lương' : item.kind === 'expense_reimbursement' ? 'Hoàn ứng nhân viên' : 'Dự kiến chi'), item.party, item.documentId, num(item.amount)])} /></div></section>
        <p className="muted small">{uiText("Dự báo dựa trên hóa đơn đã ghi sổ còn mở, đơn mua đã duyệt chưa ghi bill, bảng lương đã duyệt và đề nghị chi đã duyệt có ngày thanh toán. Chưa gồm thuế hoặc doanh thu bán hàng chưa lập hóa đơn.")}</p>
      </>}
    </div>}
  </div>;
}
