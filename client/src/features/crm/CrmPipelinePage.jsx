import React, { useEffect, useRef, useState } from 'react';
import { useDocumentTitle } from '../../lib/useDocumentTitle.js';
import { fmtMoney, statusLabel, fmtNumber, uiTextWith } from '../../lib/i18n.js';
import { can } from '../../lib/state.js';
import { compareDecimals } from '../../lib/decimal.js';
import crmEnglish from './crm.en.js';
import CrmPipelineBoard from './components/CrmPipelineBoard.jsx';
import { useCrmPipelineWorkflow } from './hooks/useCrmPipelineWorkflow.js';
const t = (text) => uiTextWith(text, crmEnglish);
const hasPositiveAmount = (deal) => compareDecimals(deal.amount || 0, 0) > 0;
export default function CrmPipelinePage() {
  useDocumentTitle(`${t('Pipeline bán hàng')} · OSP Suite`);
  const workflow = useCrmPipelineWorkflow({ t });
  const { from, setFrom, to, setTo, report, error, loading, workingDeal, load, moveDeal, closeDeal } = workflow;
  const [view, setView] = useState('board');
  const boardTabRef = useRef(null);
  const listTabRef = useRef(null);
  const handleTabKeyDown = (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const nextView = event.key === 'Home' ? 'board'
      : event.key === 'End' ? 'list'
        : event.key === 'ArrowRight' ? (view === 'board' ? 'list' : 'board')
          : (view === 'board' ? 'list' : 'board');
    setView(nextView);
    (nextView === 'board' ? boardTabRef : listTabRef).current?.focus();
  };
  const outcomeButtons = (deal) => <div className="row wrap">
    {can('crm.deal.won') && <button className="btn btn-primary btn-sm" type="button" disabled={loading || Boolean(workingDeal) || !hasPositiveAmount(deal)} title={!hasPositiveAmount(deal) ? t('Nhập giá trị dương trước khi thắng cơ hội.') : ''} onClick={() => closeDeal(deal, 'won')}>{t('Thắng · tạo đơn bán')}</button>}
    {can('crm.deal.update') && can('crm.deal.lost') && <button className="btn btn-ghost btn-sm" type="button" disabled={loading || Boolean(workingDeal)} onClick={() => closeDeal(deal, 'lost')}>Thua</button>}
  </div>;
  useEffect(() => { load(); }, [load]);
  return <div className="page">
    <div className="page-head"><div><h1>{t('Pipeline bán hàng')}</h1><p className="sub">{t('Giá trị cơ hội mở và dự báo có trọng số theo xác suất; số liệu được tính ở Rust.')}</p></div>{can('crm.pipeline_stage.read') && <a className="btn btn-secondary" href="#/e/crm/pipeline_stage">{t('Cấu hình pipeline')}</a>}</div>
    <section className="card"><form className="toolbar" onSubmit={(event) => { event.preventDefault(); load(); }}>
      <label className="field"><span className="label">{t('Dự kiến chốt từ')}</span><input className="input" type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
      <label className="field"><span className="label">{t('Đến')}</span><input className="input" type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
      <button className="btn btn-primary" type="submit" disabled={loading}>{loading ? t('Đang tải…') : t('Cập nhật')}</button>
    </form></section>
    {error && <div className="alert danger" role="alert">{t(error)}</div>}
    {loading && !report ? <div className="card-pad"><div className="skeleton" data-h="row" /></div> : report && <div className="stack">
      <div className="stats">
        <div className="card stat"><span className="stat-label">{t('Cơ hội đang mở')}</span><strong className="stat-value num">{fmtNumber(String(report.dealCount || 0))}</strong></div>
        <div className="card stat"><span className="stat-label">{t('Tổng giá trị pipeline')}</span><strong className="stat-value num">{fmtMoney(report.pipelineAmount)}</strong></div>
        <div className="card stat"><span className="stat-label">{t('Dự báo có trọng số')}</span><strong className="stat-value num">{fmtMoney(report.weightedForecast)}</strong></div>
      </div>
      <div className="tabs" role="tablist" aria-label={t("Cách xem pipeline")}>
        <button ref={boardTabRef} className="tab" id="crm-pipeline-board-tab" type="button" role="tab" aria-controls="crm-pipeline-board-panel" aria-selected={view === 'board'} tabIndex={view === 'board' ? 0 : -1} onKeyDown={handleTabKeyDown} onClick={() => setView('board')}>Kanban</button>
        <button ref={listTabRef} className="tab" id="crm-pipeline-list-tab" type="button" role="tab" aria-controls="crm-pipeline-list-panel" aria-selected={view === 'list'} tabIndex={view === 'list' ? 0 : -1} onKeyDown={handleTabKeyDown} onClick={() => setView('list')}>{t('Danh sách')}</button>
      </div>
      <CrmPipelineBoard role="tabpanel" id="crm-pipeline-board-panel" labelledBy="crm-pipeline-board-tab" tabIndex={0} className={`crm-kanban${view === 'board' ? '' : ' is-hidden'}`} ariaLabel={t("Cơ hội theo giai đoạn bán hàng")} stages={report.stages || []} deals={report.deals || []} loading={loading} canUpdate={can('crm.deal.update')} fmtMoney={fmtMoney} fmtNumber={fmtNumber} statusLabel={statusLabel} t={t} onMoveDeal={moveDeal} renderOutcomeActions={outcomeButtons} />
      <section className="card table-wrap"><table className="table">
        <thead><tr><th scope="col">{t('Giai đoạn')}</th><th scope="col" className="right">{t('Cơ hội')}</th><th scope="col" className="right">{t('Giá trị')}</th><th scope="col" className="right">{t('Dự báo có trọng số')}</th></tr></thead>
        <tbody>{report.stages.map((stage) => <tr key={stage.stage}>
          <td>{stage.name || t(statusLabel(stage.stage))}</td><td className="right">{fmtNumber(String(stage.count || 0))}</td><td className="right money">{fmtMoney(stage.amount)}</td><td className="right money">{fmtMoney(stage.weightedAmount)}</td>
        </tr>)}</tbody>
      </table></section>
      <div role="tabpanel" id="crm-pipeline-list-panel" aria-labelledby="crm-pipeline-list-tab" tabIndex={0} hidden={view !== 'list'}>{view === 'list' && (!report.deals?.length ? <div className="empty"><h3>{t('Chưa có cơ hội đang mở')}</h3><p>{t('Tạo cơ hội trong CRM để theo dõi giá trị và ngày dự kiến chốt.')}</p></div> : <section className="card table-wrap"><table className="table">
        <thead><tr><th scope="col">{t('Cơ hội')}</th><th scope="col">{t('Khách hàng')}</th><th scope="col">{t('Giai đoạn')}</th><th scope="col" className="right">{t('Xác suất')}</th><th scope="col" className="right">{t('Giá trị')}</th><th scope="col" className="right">{t('Dự báo')}</th><th scope="col">{t('Ngày dự kiến chốt')}</th><th scope="col">{t('Đóng cơ hội')}</th></tr></thead>
        <tbody>{report.deals.map((deal) => <tr key={deal.id}>
          <td><a href={`#/e/crm/deal/${encodeURIComponent(deal.id)}`}>{deal.title}</a></td><td>{deal.party}</td><td>{deal.pipelineStageName || t(statusLabel(deal.pipelineStage))}</td>
          <td className="right">{fmtNumber(String(deal.probability || 0), { maximumFractionDigits: 1 })}%</td><td className="right money">{fmtMoney(deal.amount)}</td><td className="right money">{fmtMoney(deal.weightedAmount)}</td><td>{deal.expectedClose || '—'}</td><td>{outcomeButtons(deal)}</td>
        </tr>)}</tbody>
      </table></section>)}</div>
    </div>}
  </div>;
}
