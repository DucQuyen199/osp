import React, { useState } from 'react';
import { useDocumentTitle } from '../../lib/useDocumentTitle.js';
import { localDate } from '../../lib/dates.js';
import { uiText } from '../../lib/i18n.js';
import AccountingReportResults from './AccountingReportResults.jsx';
import { can } from '../../lib/state.js';
import AccountingChartTemplateDialog from './AccountingChartTemplateDialog.jsx';
import { useAccountingReportsData } from './hooks/useAccountingReportsData.js';
import { useAccountingReportsWorkflow } from './hooks/useAccountingReportsWorkflow.js';
const today = localDate;
const yearStart = () => `${today().slice(0, 4)}-01-01`;
const forecastEnd = (start) => {
  const date = new Date(`${start}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 90);
  return date.toISOString().slice(0, 10);
};
export default function AccountingReportsPage() {
  useDocumentTitle(`${uiText('Báo cáo kế toán')} · OSP Suite`);
  const [mode, setMode] = useState('income');
  const [from, setFrom] = useState(yearStart());
  const [to, setTo] = useState(today());
  const [asOf, setAsOf] = useState(today());
  const [showChartTemplates, setShowChartTemplates] = useState(false);
  const data = useAccountingReportsData({ mode, from, to, asOf });
  const workflow = useAccountingReportsWorkflow({ asOf, load: data.load });
  const { report, error: dataError, loading, load } = data;
  const { fxMemo, setFxMemo, fxJournal, postingFx, error: workflowError, createFxDraft } = workflow;
  const error = dataError || workflowError;
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
      <AccountingReportResults mode={mode} report={report} income={report.revenue || []} expense={report.expense || []} unclassified={report.unclassified || []} fxMemo={fxMemo} onFxMemoChange={setFxMemo} canCreateJournal={can('accounting.journal_entry.create')} postingFx={postingFx} loading={loading} createFxDraft={createFxDraft} fxJournal={fxJournal} />
    </div>}
  </div>;
}
