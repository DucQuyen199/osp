import React, { useCallback, useEffect, useState } from 'react';
import { api, dataPath, tenantPath } from './lib/api.js';
import { confirmDialog, textDialog, toast } from './lib/feedback.js';
import { fmtMoney, statusLabel } from './lib/i18n.js';
import { can } from './lib/state.js';

const STAGES = ['qualification', 'discovery', 'proposal', 'negotiation', 'unclassified'];

export default function CrmPipelinePage() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState('board');
  const [workingDeal, setWorkingDeal] = useState('');

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
      setError(reason.message || 'Không tải được pipeline bán hàng.');
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
      setError(reason.message || 'Không cập nhật được giai đoạn cơ hội.');
    }
  };

  const closeDeal = async (deal, outcome) => {
    let body;
    if (outcome === 'lost') {
      const lostReason = await textDialog({
        title: 'Ghi nhận cơ hội thua',
        message: 'Ghi lý do để nhóm bán hàng phân tích và cải thiện quy trình chốt đơn.',
        label: 'Lý do thua (5–1000 ký tự)',
        minLength: 5,
        maxLength: 1000,
        confirmLabel: 'Tiếp tục',
        danger: true,
      });
      if (!lostReason) return;
      body = { lost_reason: lostReason };
    }
    const won = outcome === 'won';
    const confirmed = await confirmDialog({
      title: won ? 'Xác nhận thắng cơ hội?' : 'Xác nhận thua cơ hội?',
      message: won
        ? 'Cơ hội sẽ được khóa lịch sử và hệ thống tự tạo đơn bán hàng theo khách hàng, giá trị cơ hội.'
        : 'Cơ hội sẽ được đóng và chuyển khỏi pipeline đang mở.',
      confirmLabel: won ? 'Thắng · tạo đơn bán' : 'Đóng cơ hội thua',
      danger: !won,
    });
    if (!confirmed) return;
    setWorkingDeal(`${deal.id}:${outcome}`); setError('');
    try {
      await api(dataPath('crm.deal', deal.id, outcome), { method: 'POST', ...(body ? { body } : {}) });
      toast(won ? 'Đã thắng cơ hội và tạo đơn bán hàng.' : 'Đã đóng cơ hội với lý do thua.', 'success');
      await load();
    } catch (reason) {
      setError(reason.message || 'Không thể đóng cơ hội.');
    } finally {
      setWorkingDeal('');
    }
  };

  const outcomeButtons = (deal) => <div className="row wrap">
    {can('crm.deal.won') && <button className="btn btn-primary btn-sm" type="button" disabled={loading || Boolean(workingDeal) || Number(deal.amount || 0) <= 0} title={Number(deal.amount || 0) <= 0 ? 'Nhập giá trị dương trước khi thắng cơ hội.' : ''} onClick={() => closeDeal(deal, 'won')}>Thắng · tạo đơn bán</button>}
    {can('crm.deal.update') && can('crm.deal.lost') && <button className="btn btn-ghost btn-sm" type="button" disabled={loading || Boolean(workingDeal)} onClick={() => closeDeal(deal, 'lost')}>Thua</button>}
  </div>;

  useEffect(() => { document.title = 'Pipeline bán hàng · OSP Suite'; load(); }, [load]);

  return <div className="page">
    <div className="page-head"><div><h1>Pipeline bán hàng</h1><p className="sub">Giá trị cơ hội mở và dự báo có trọng số theo xác suất; số liệu được tính ở Rust.</p></div>{can('crm.pipeline_stage.read') && <a className="btn btn-secondary" href="#/e/crm/pipeline_stage">Cấu hình pipeline</a>}</div>
    <section className="card"><form className="toolbar" onSubmit={(event) => { event.preventDefault(); load(); }}>
      <label className="field"><span className="label">Dự kiến chốt từ</span><input className="input" type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
      <label className="field"><span className="label">Đến</span><input className="input" type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
      <button className="btn btn-primary" type="submit" disabled={loading}>{loading ? 'Đang tải…' : 'Cập nhật'}</button>
    </form></section>
    {error && <div className="alert danger" role="alert">{error}</div>}
    {loading && !report ? <div className="card-pad"><div className="skeleton" data-h="row" /></div> : report && <div className="stack">
      <div className="stats">
        <div className="card stat"><span className="stat-label">Cơ hội đang mở</span><strong className="stat-value num">{Number(report.dealCount || 0).toLocaleString()}</strong></div>
        <div className="card stat"><span className="stat-label">Tổng giá trị pipeline</span><strong className="stat-value num">{fmtMoney(report.pipelineAmount)}</strong></div>
        <div className="card stat"><span className="stat-label">Dự báo có trọng số</span><strong className="stat-value num">{fmtMoney(report.weightedForecast)}</strong></div>
      </div>
      <div className="tabs" role="tablist" aria-label="Cách xem pipeline">
        <button className="tab" type="button" role="tab" aria-selected={view === 'board'} onClick={() => setView('board')}>Kanban</button>
        <button className="tab" type="button" role="tab" aria-selected={view === 'list'} onClick={() => setView('list')}>Danh sách</button>
      </div>
      {view === 'board' && <div className="crm-kanban" aria-label="Cơ hội theo giai đoạn bán hàng">
        {STAGES.map((stageName) => {
          const summary = report.stages.find((item) => item.stage === stageName);
          const deals = report.deals.filter((deal) => deal.pipelineStage === stageName);
          return <section className="crm-kanban-column" key={stageName} aria-labelledby={`crm-stage-${stageName}`}>
            <header className="crm-kanban-head"><h2 id={`crm-stage-${stageName}`}>{summary?.name || statusLabel(stageName)}</h2><span>{deals.length} · {fmtMoney(summary?.amount || 0)}</span></header>
            {deals.map((deal) => <article className="card crm-deal-card" key={deal.id}>
              <a href={`#/e/crm/deal/${encodeURIComponent(deal.id)}`}><strong>{deal.title}</strong></a>
              <span className="small muted">{deal.party || 'Chưa có khách hàng'}</span>
              <div className="crm-deal-metrics"><span>{fmtMoney(deal.amount)}</span><span>{Number(deal.probability || 0).toLocaleString(undefined, { maximumFractionDigits: 1 })}%</span></div>
              <span className="small muted">Dự báo: {fmtMoney(deal.weightedAmount)} · {deal.expectedClose || 'Chưa có ngày chốt'}</span>
              {can('crm.deal.update') && <label className="field"><span className="label">Chuyển giai đoạn</span><select className="select" value={deal.pipelineStage === 'unclassified' ? '' : deal.pipelineStage} disabled={loading} onChange={(event) => event.target.value && moveDeal(deal, event.target.value)}>
                {deal.pipelineStage === 'unclassified' && <option value="">Chưa phân loại</option>}
                {STAGES.filter((item) => item !== 'unclassified').map((item) => <option key={item} value={item}>{statusLabel(item)}</option>)}
              </select></label>}
              {outcomeButtons(deal)}
            </article>)}
            {!deals.length && <div className="crm-kanban-empty">Chưa có cơ hội</div>}
          </section>;
        })}
      </div>}
      <section className="card table-wrap"><table className="table">
        <thead><tr><th scope="col">Giai đoạn</th><th scope="col" className="right">Cơ hội</th><th scope="col" className="right">Giá trị</th><th scope="col" className="right">Dự báo có trọng số</th></tr></thead>
        <tbody>{report.stages.map((stage) => <tr key={stage.stage}>
          <td>{stage.name || statusLabel(stage.stage)}</td><td className="right">{Number(stage.count || 0).toLocaleString()}</td><td className="right money">{fmtMoney(stage.amount)}</td><td className="right money">{fmtMoney(stage.weightedAmount)}</td>
        </tr>)}</tbody>
      </table></section>
      {view === 'list' && (!report.deals?.length ? <div className="empty"><h3>Chưa có cơ hội đang mở</h3><p>Tạo cơ hội trong CRM để theo dõi giá trị và ngày dự kiến chốt.</p></div> : <section className="card table-wrap"><table className="table">
        <thead><tr><th scope="col">Cơ hội</th><th scope="col">Khách hàng</th><th scope="col">Giai đoạn</th><th scope="col" className="right">Xác suất</th><th scope="col" className="right">Giá trị</th><th scope="col" className="right">Dự báo</th><th scope="col">Ngày dự kiến chốt</th><th scope="col">Đóng cơ hội</th></tr></thead>
        <tbody>{report.deals.map((deal) => <tr key={deal.id}>
          <td><a href={`#/e/crm/deal/${encodeURIComponent(deal.id)}`}>{deal.title}</a></td><td>{deal.party}</td><td>{deal.pipelineStageName || statusLabel(deal.pipelineStage)}</td>
          <td className="right">{Number(deal.probability || 0).toLocaleString(undefined, { maximumFractionDigits: 1 })}%</td><td className="right money">{fmtMoney(deal.amount)}</td><td className="right money">{fmtMoney(deal.weightedAmount)}</td><td>{deal.expectedClose || '—'}</td><td>{outcomeButtons(deal)}</td>
        </tr>)}</tbody>
      </table></section>)}
    </div>}
  </div>;
}
