import React from 'react';

/** Controlled kanban view for open CRM opportunities. */
export default function CrmPipelineBoard({
  stages = [],
  deals = [],
  loading = false,
  canUpdate = false,
  fmtMoney,
  fmtNumber,
  statusLabel,
  t,
  onMoveDeal,
  renderOutcomeActions,
  role,
  id,
  labelledBy,
  tabIndex,
  className,
  ariaLabel,
}) {
  return <div role={role} id={id} aria-labelledby={labelledBy} tabIndex={tabIndex} className={className} aria-label={ariaLabel}>
    {stages.map((summary) => {
      const stageDeals = deals.filter((deal) => deal.pipelineStage === summary.stage);
      return <section className="crm-kanban-column" key={summary.stage} aria-labelledby={`crm-stage-${summary.stage}`}>
        <header className="crm-kanban-head"><h2 id={`crm-stage-${summary.stage}`}>{summary.name || t(statusLabel(summary.stage))}</h2><span>{stageDeals.length} · {fmtMoney(summary.amount || 0)}</span></header>
        {stageDeals.map((deal) => <article className="card crm-deal-card" key={deal.id}>
          <a href={`#/e/crm/deal/${encodeURIComponent(deal.id)}`}><strong>{deal.title}</strong></a>
          <span className="small muted">{deal.party || t('Chưa có khách hàng')}</span>
          <div className="crm-deal-metrics"><span>{fmtMoney(deal.amount)}</span><span>{fmtNumber(String(deal.probability || 0), { maximumFractionDigits: 1 })}%</span></div>
          <span className="small muted">{t('Dự báo:')} {fmtMoney(deal.weightedAmount)} · {deal.expectedClose || t('Chưa có ngày chốt')}</span>
          {canUpdate && <label className="field"><span className="label">{t('Chuyển giai đoạn')}</span><select className="select" value={deal.pipelineStage === 'unclassified' ? '' : deal.pipelineStage} disabled={loading} onChange={(event) => event.target.value && onMoveDeal(deal, event.target.value)}>
            {deal.pipelineStage === 'unclassified' && <option value="">{t('Chưa phân loại')}</option>}
            {stages.filter((item) => item.stage !== 'unclassified').map((item) => <option key={item.stage} value={item.stage}>{item.name || t(statusLabel(item.stage))}</option>)}
          </select></label>}
          {renderOutcomeActions(deal)}
        </article>)}
        {!stageDeals.length && <div className="crm-kanban-empty">{t('Chưa có cơ hội')}</div>}
      </section>;
    })}
  </div>;
}
