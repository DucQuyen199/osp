import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useDocumentTitle } from '../../lib/useDocumentTitle.js';
import { api, dataPath, tenantPath } from '../../lib/api.js';
import { confirmDialog, textDialog, toast } from '../../lib/feedback.js';
import { fmtMoney, statusLabel, fmtNumber, uiTextWith } from '../../lib/i18n.js';
import { can } from '../../lib/state.js';
import crmEnglish from './crm.en.js';
const t = (text) => uiTextWith(text, crmEnglish);
export default function CrmPipelinePage() {
  useDocumentTitle(`${t('Pipeline bán hàng')} · OSP Suite`);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState('board');
  const [workingDeal, setWorkingDeal] = useState('');
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
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      setReport(await api(`${tenantPath('/reports/crm/pipeline')}?${params}`));
    } catch (reason) {
      setReport(null);
      setError(t(reason.message || 'Không tải được pipeline bán hàng.'));
    } finally {
      setLoading(false);
    }
  }, [from, to]);
  const moveDeal = async (deal, stage) => {
    setError('');
    try {
      await api(dataPath('crm.deal', deal.id), { method: 'PATCH', body: { pipeline_stage: stage } });
      await load();
    } catch (reason) {
      setError(t(reason.message || 'Không cập nhật được giai đoạn cơ hội.'));
    }
  };
  const closeDeal = async (deal, outcome) => {
    let body;
    if (outcome === 'lost') {
      const lostReason = await textDialog({
        title: t('Ghi nhận cơ hội thua'),
        message: t('Ghi lý do để nhóm bán hàng phân tích và cải thiện quy trình chốt đơn.'),
        label: t('Lý do thua (5–1000 ký tự)'),
        minLength: 5,
        maxLength: 1000,
        confirmLabel: t('Tiếp tục'),
        danger: true,
      });
      if (!lostReason) return;
      body = { lost_reason: lostReason };
    }
    const won = outcome === 'won';
    const confirmed = await confirmDialog({
      title: t(won ? 'Xác nhận thắng cơ hội?' : 'Xác nhận thua cơ hội?'),
      message: t(won
        ? 'Cơ hội sẽ được khóa lịch sử và hệ thống tạo đơn bán nháp theo khách hàng, dòng hàng, kho và giá trị để bạn rà soát trước khi xác nhận.'
        : 'Cơ hội sẽ được đóng và chuyển khỏi pipeline đang mở.'),
      confirmLabel: t(won ? 'Thắng · tạo đơn bán' : 'Đóng cơ hội thua'),
      danger: !won,
    });
    if (!confirmed) return;
    setWorkingDeal(`${deal.id}:${outcome}`); setError('');
    try {
      await api(dataPath('crm.deal', deal.id, outcome), { method: 'POST', ...(body ? { body } : {}) });
      toast(t(won ? 'Đã thắng cơ hội và tạo đơn bán hàng.' : 'Đã đóng cơ hội với lý do thua.'), 'success');
      await load();
    } catch (reason) {
      setError(t(reason.message || 'Không thể đóng cơ hội.'));
    } finally {
      setWorkingDeal('');
    }
  };
  const outcomeButtons = (deal) => <div className="row wrap">
    {can('crm.deal.won') && <button className="btn btn-primary btn-sm" type="button" disabled={loading || Boolean(workingDeal) || Number(deal.amount || 0) <= 0} title={Number(deal.amount || 0) <= 0 ? t('Nhập giá trị dương trước khi thắng cơ hội.') : ''} onClick={() => closeDeal(deal, 'won')}>{t('Thắng · tạo đơn bán')}</button>}
    {can('crm.deal.update') && can('crm.deal.lost') && <button className="btn btn-ghost btn-sm" type="button" disabled={loading || Boolean(workingDeal)} onClick={() => closeDeal(deal, 'lost')}>Thua</button>}
  </div>;
  useEffect(() => { load(); }, [load]);
  return <div className="page">
    <div className="page-head"><div><h1>{t('Pipeline bán hàng')}</h1><p className="sub">{t('Giá trị cơ hội mở và dự báo có trọng số theo xác suất; số liệu được tính ở Rust.')}</p></div>{can('crm.pipeline_stage.read') && <a className="btn btn-secondary" href="#/e/crm/pipeline_stage">{t('Cấu hình pipeline')}</a>}</div>
    <section className="card"><form className="toolbar" onSubmit={(event) => { event.preventDefault(); load(); }}>
      <label className="field"><span className="label">{t('Dự kiến chốt từ')}</span><input className="input" type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
      <label className="field"><span className="label">{t('Đến')}</span><input className="input" type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
      <button className="btn btn-primary" type="submit" disabled={loading}>{loading ? 'Đang tải…' : 'Cập nhật'}</button>
    </form></section>
    {error && <div className="alert danger" role="alert">{t(error)}</div>}
    {loading && !report ? <div className="card-pad"><div className="skeleton" data-h="row" /></div> : report && <div className="stack">
      <div className="stats">
        <div className="card stat"><span className="stat-label">{t('Cơ hội đang mở')}</span><strong className="stat-value num">{fmtNumber(Number(report.dealCount || 0))}</strong></div>
        <div className="card stat"><span className="stat-label">{t('Tổng giá trị pipeline')}</span><strong className="stat-value num">{fmtMoney(report.pipelineAmount)}</strong></div>
        <div className="card stat"><span className="stat-label">{t('Dự báo có trọng số')}</span><strong className="stat-value num">{fmtMoney(report.weightedForecast)}</strong></div>
      </div>
      <div className="tabs" role="tablist" aria-label={t("Cách xem pipeline")}>
        <button ref={boardTabRef} className="tab" id="crm-pipeline-board-tab" type="button" role="tab" aria-controls="crm-pipeline-board-panel" aria-selected={view === 'board'} tabIndex={view === 'board' ? 0 : -1} onKeyDown={handleTabKeyDown} onClick={() => setView('board')}>Kanban</button>
        <button ref={listTabRef} className="tab" id="crm-pipeline-list-tab" type="button" role="tab" aria-controls="crm-pipeline-list-panel" aria-selected={view === 'list'} tabIndex={view === 'list' ? 0 : -1} onKeyDown={handleTabKeyDown} onClick={() => setView('list')}>{t('Danh sách')}</button>
      </div>
      <div role="tabpanel" id="crm-pipeline-board-panel" aria-labelledby="crm-pipeline-board-tab" tabIndex={0} className={`crm-kanban${view === 'board' ? '' : ' is-hidden'}`} aria-label={t("Cơ hội theo giai đoạn bán hàng")}>
        {(report.stages || []).map((summary) => {
          const stageName = summary.stage;
          const deals = report.deals.filter((deal) => deal.pipelineStage === stageName);
          return <section className="crm-kanban-column" key={stageName} aria-labelledby={`crm-stage-${stageName}`}>
            <header className="crm-kanban-head"><h2 id={`crm-stage-${stageName}`}>{summary?.name || t(statusLabel(stageName))}</h2><span>{deals.length} · {fmtMoney(summary?.amount || 0)}</span></header>
            {deals.map((deal) => <article className="card crm-deal-card" key={deal.id}>
              <a href={`#/e/crm/deal/${encodeURIComponent(deal.id)}`}><strong>{deal.title}</strong></a>
              <span className="small muted">{deal.party || t('Chưa có khách hàng')}</span>
              <div className="crm-deal-metrics"><span>{fmtMoney(deal.amount)}</span><span>{fmtNumber(Number(deal.probability || 0), { maximumFractionDigits: 1 })}%</span></div>
              <span className="small muted">{t('Dự báo:')} {fmtMoney(deal.weightedAmount)} · {deal.expectedClose || t('Chưa có ngày chốt')}</span>
              {can('crm.deal.update') && <label className="field"><span className="label">{t('Chuyển giai đoạn')}</span><select className="select" value={deal.pipelineStage === 'unclassified' ? '' : deal.pipelineStage} disabled={loading} onChange={(event) => event.target.value && moveDeal(deal, event.target.value)}>
                {deal.pipelineStage === 'unclassified' && <option value="">{t('Chưa phân loại')}</option>}
                {report.stages.filter((item) => item.stage !== 'unclassified').map((item) => <option key={item.stage} value={item.stage}>{item.name || t(statusLabel(item.stage))}</option>)}
              </select></label>}
              {outcomeButtons(deal)}
            </article>)}
            {!deals.length && <div className="crm-kanban-empty">{t('Chưa có cơ hội')}</div>}
          </section>;
        })}
      </div>
      <section className="card table-wrap"><table className="table">
        <thead><tr><th scope="col">{t('Giai đoạn')}</th><th scope="col" className="right">{t('Cơ hội')}</th><th scope="col" className="right">{t('Giá trị')}</th><th scope="col" className="right">{t('Dự báo có trọng số')}</th></tr></thead>
        <tbody>{report.stages.map((stage) => <tr key={stage.stage}>
          <td>{stage.name || t(statusLabel(stage.stage))}</td><td className="right">{fmtNumber(Number(stage.count || 0))}</td><td className="right money">{fmtMoney(stage.amount)}</td><td className="right money">{fmtMoney(stage.weightedAmount)}</td>
        </tr>)}</tbody>
      </table></section>
      <div role="tabpanel" id="crm-pipeline-list-panel" aria-labelledby="crm-pipeline-list-tab" tabIndex={0} hidden={view !== 'list'}>{view === 'list' && (!report.deals?.length ? <div className="empty"><h3>{t('Chưa có cơ hội đang mở')}</h3><p>{t('Tạo cơ hội trong CRM để theo dõi giá trị và ngày dự kiến chốt.')}</p></div> : <section className="card table-wrap"><table className="table">
        <thead><tr><th scope="col">{t('Cơ hội')}</th><th scope="col">{t('Khách hàng')}</th><th scope="col">{t('Giai đoạn')}</th><th scope="col" className="right">{t('Xác suất')}</th><th scope="col" className="right">{t('Giá trị')}</th><th scope="col" className="right">{t('Dự báo')}</th><th scope="col">{t('Ngày dự kiến chốt')}</th><th scope="col">{t('Đóng cơ hội')}</th></tr></thead>
        <tbody>{report.deals.map((deal) => <tr key={deal.id}>
          <td><a href={`#/e/crm/deal/${encodeURIComponent(deal.id)}`}>{deal.title}</a></td><td>{deal.party}</td><td>{deal.pipelineStageName || t(statusLabel(deal.pipelineStage))}</td>
          <td className="right">{fmtNumber(Number(deal.probability || 0), { maximumFractionDigits: 1 })}%</td><td className="right money">{fmtMoney(deal.amount)}</td><td className="right money">{fmtMoney(deal.weightedAmount)}</td><td>{deal.expectedClose || '—'}</td><td>{outcomeButtons(deal)}</td>
        </tr>)}</tbody>
      </table></section>)}</div>
    </div>}
  </div>;
}
