import React, { useCallback, useEffect, useState } from 'react';
import { useDocumentTitle } from '../../lib/useDocumentTitle.js';
import { localDate } from '../../lib/dates.js';
import { api, tenantPath } from '../../lib/api.js';
import { uiText } from '../../lib/i18n.js';
import AccountingReportResults from './AccountingReportResults.jsx';
import { can } from '../../lib/state.js';
import AccountingChartTemplateDialog from './AccountingChartTemplateDialog.jsx';
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
