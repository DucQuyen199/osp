import React, { useEffect, useMemo, useState } from 'react';
import { useDocumentTitle } from '../../lib/useDocumentTitle.js';
import { api, tenantPath } from '../../lib/api.js';
import { fetchEvents } from '../../lib/events.js';
import { fmtNumber, uiText } from '../../lib/i18n.js';
import { app, can, entity, entityLabel, isAdmin } from '../../lib/state.js';
import { listHref } from '../../lib/routes.js';
import EventTimeline from '../../components/EventTimeline.jsx';
const PRIORITY = [
  'master-data.party', 'master-data.product', 'sales.sales_order', 'pos.pos_order', 'ecommerce.web_order', 'accounting.invoice', 'crm.deal', 'crm.lead',
  'clinic.encounter', 'school.student', 'hotel.reservation', 'restaurant.table_order', 'booking.booking', 'hrm.employee', 'helpdesk.ticket', 'project.project',
  'inventory.stock_level', 'purchasing.purchase_order', 'logistics.shipment',
];
const EXCLUDED = new Set(['master-data.currency', 'master-data.tax', 'master-data.uom', 'accounting.account']);
export default function HomePage({ summary }) {
  useDocumentTitle(uiText('Trang chủ · OSP Suite'));
  const [events, setEvents] = useState(null);
  const [failures, setFailures] = useState(0);
  const [dead, setDead] = useState(0);
  const picks = useMemo(() => {
    const candidates = [...(app.meta.summaryEntities || []), ...PRIORITY];
    return [...new Set(candidates)]
      .filter((qname) => app.entities.has(qname) && can(`${qname}.read`))
      .slice(0, 8);
  }, [app.meta.vertical]);
  const setupEntities = useMemo(() => [...new Set([
    ...(app.meta.setupEntities || []), 'master-data.party', 'master-data.product',
  ])].filter((qname) => {
    const definition = entity(qname);
    return definition && !definition.systemManaged && can(`${qname}.create`);
  }).slice(0, 2), [app.meta.vertical]);
  const total = Object.entries(summary || {}).filter(([qname]) => !EXCLUDED.has(qname)).reduce((sum, [, count]) => sum + Number(count || 0), 0);
  const firstName = (app.user?.name || '').split(' ').slice(-1)[0];
  useEffect(() => {
    let active = true;
    fetchEvents(60).then((items) => { if (active) setEvents(items); }).catch(() => { if (active) setEvents([]); });
    if (isAdmin()) api(tenantPath('/alerts')).then((result) => {
      if (active) { setFailures(Number(result?.failures || 0)); setDead(Number(result?.outboxDead || 0)); }
    }).catch(() => {});
    return () => { active = false; };
  }, []);
  const roots = useMemo(() => {
    const rootEvents = (events || []).filter((event) => event.depth === 0);
    const withEffects = rootEvents.filter((event) => event.handled.some((effect) => effect.outcome === 'ok'));
    return (withEffects.length >= 3 ? withEffects : rootEvents).slice(-6).reverse();
  }, [events]);
  return <div className="page">
    <div className="page-head"><div>
      <h1>{uiText('Xin chào')}{firstName ? `, ${firstName}` : ''}</h1>
      <p className="sub">{app.meta.name}{app.meta.verticalName ? ` · ${app.meta.verticalName}` : ''} · {app.meta.modules.length} {uiText('module đang bật')}</p>
    </div></div>
    {isAdmin() && (failures > 0 || dead > 0) && <div className="alert warning" role="status">
      <div><strong>{uiText('Tác vụ tích hợp cần xử lý')}</strong><p className="small">{uiText('Mở danh sách tương ứng để xem chi tiết và xử lý.')}</p></div>
      <div className="row wrap">
        {failures > 0 && <a className="btn btn-sm" href="#/settings/failures">{failures} {uiText('luồng lỗi cần xử lý')}</a>}
        {dead > 0 && <a className="btn btn-sm" href="#/settings/outbox">{dead} {uiText('giao nhận tích hợp lỗi')}</a>}
      </div>
    </div>}
    {total === 0
      ? <section className="card"><div className="empty">
        <h3>{uiText('Doanh nghiệp của bạn còn trống')}</h3><p>{app.meta.verticalName ? `${uiText('Bắt đầu quy trình')} ${app.meta.verticalName} ${uiText('bằng các hồ sơ nền tảng bên dưới.')}` : uiText('Tạo hồ sơ đầu tiên cho doanh nghiệp hoặc nhập dữ liệu CSV.')}</p>
        <div className="row wrap">
          {setupEntities.map((qname, index) => <a key={qname} className={`btn${index === 0 ? ' btn-primary' : ''}`} href={listHref(qname)}>{uiText('Thêm')} {uiText(entityLabel(qname)).toLowerCase()}</a>)}
          {isAdmin() && <a className="btn" href="#/settings/data">{uiText('Nhập từ CSV')}</a>}
        </div>
      </div></section>
      : <div className="stats">{picks.map((qname) => <a key={qname} className="card stat" href={listHref(qname)}>
        <span className="stat-label">{entityLabel(qname)}</span><span className="stat-value">{fmtNumber(summary?.[qname] ?? 0)}</span>
      </a>)}</div>}
    <div className="two-col">
      <section className="card" aria-labelledby="recent-title">
        <div className="card-head"><h2 id="recent-title">{uiText('Hoạt động gần đây')}</h2><a href="#/events">{uiText('Xem tất cả')}</a></div>
        <div className="card-pad">{events === null ? <div className="skeleton" data-h="row" /> : roots.length
          ? <EventTimeline events={roots} />
          : <div className="empty"><h3>{uiText('Chưa có hoạt động')}</h3><p>{uiText('Các bước tự động sẽ hiện ở đây khi phát sinh dữ liệu.')}</p></div>}
        </div>
      </section>
      <section className="card" aria-labelledby="mods-title">
        <div className="card-head"><h2 id="mods-title">{uiText('Module của bạn')}</h2></div>
        <div className="card-pad stack-sm">{app.meta.modules.filter((module) => module.id !== 'master-data').map((module) =>
          <a key={module.id} className="list-link" href={`#/m/${module.id}`}><span>{uiText(module.name)}</span><span aria-hidden="true">›</span></a>)}
          {app.meta.kpis.length > 0 && <div className="stack-sm"><hr /><div className="label">{uiText('Gợi ý KPI cho')} {uiText(app.meta.verticalName || 'doanh nghiệp')}</div><p className="small muted">{uiText('Đây là các chỉ tiêu tham khảo. Để xem số liệu thực tế, hãy cấu hình KPI từ báo cáo tổng hợp trong module BI.')}</p><ul className="muted small">{app.meta.kpis.map((kpi) => <li key={kpi}>{kpi}</li>)}</ul>{app.meta.modules.some((module) => module.id === 'bi') && (can('bi.report.read') || can('bi.kpi.read') || can('bi.dashboard.read')) && <a className="btn btn-sm" href="#/reports/bi">{uiText('Mở báo cáo & phân tích')}</a>}</div>}
        </div>
      </section>
    </div>
  </div>;
}
