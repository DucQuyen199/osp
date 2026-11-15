import React, { useEffect, useMemo, useState } from 'react';
import { api, tenantPath } from './lib/api.js';
import { fetchEvents } from './lib/events.js';
import { fmtNumber } from './lib/i18n.js';
import { app, can, entityLabel, isAdmin } from './lib/state.js';
import { listHref } from './lib/routes.js';
import { EventTimeline } from './EntityDetailPage.jsx';

const PRIORITY = [
  'master-data.party', 'master-data.product', 'sales.sales_order', 'pos.pos_order', 'ecommerce.web_order', 'accounting.invoice', 'crm.deal', 'crm.lead',
  'clinic.encounter', 'school.student', 'hotel.reservation', 'restaurant.table_order', 'booking.booking', 'hrm.employee', 'helpdesk.ticket', 'project.project',
  'inventory.stock_level', 'purchasing.purchase_order', 'logistics.shipment',
];
const EXCLUDED = new Set(['master-data.currency', 'master-data.tax', 'master-data.uom', 'accounting.account']);

export default function HomePage({ summary }) {
  const [events, setEvents] = useState(null);
  const [failures, setFailures] = useState(0);
  const [dead, setDead] = useState(0);
  const picks = useMemo(() => PRIORITY.filter((qname) => app.entities.has(qname) && can(`${qname}.read`)).slice(0, 8), []);
  const total = Object.entries(summary || {}).filter(([qname]) => !EXCLUDED.has(qname)).reduce((sum, [, count]) => sum + Number(count || 0), 0);
  const firstName = (app.user?.name || '').split(' ').slice(-1)[0];

  useEffect(() => {
    document.title = 'Trang chủ · OSP Suite';
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
      <h1>Xin chào{firstName ? `, ${firstName}` : ''}</h1>
      <p className="sub">{app.meta.name}{app.meta.verticalName ? ` · ${app.meta.verticalName}` : ''} · {app.meta.modules.length} module đang bật</p>
    </div></div>
    {isAdmin() && (failures > 0 || dead > 0) && <div className="alert warning" role="status">
      <div><strong>Tác vụ tích hợp cần xử lý</strong><p className="small">Mở danh sách tương ứng để xem chi tiết và xử lý.</p></div>
      <div className="row wrap">
        {failures > 0 && <a className="btn btn-sm" href="#/settings/failures">{failures} luồng lỗi cần xử lý</a>}
        {dead > 0 && <a className="btn btn-sm" href="#/settings/outbox">{dead} giao nhận tích hợp lỗi</a>}
      </div>
    </div>}
    {total === 0
      ? <section className="card"><div className="empty">
        <h3>Doanh nghiệp của bạn còn trống</h3><p>Bắt đầu bằng cách thêm khách hàng và sản phẩm hoặc nhập dữ liệu CSV.</p>
        <div className="row wrap">
          {can('master-data.party.create') && <a className="btn btn-primary" href={listHref('master-data.party')}>Thêm {entityLabel('master-data.party').toLowerCase()}</a>}
          {can('master-data.product.create') && <a className="btn" href={listHref('master-data.product')}>Thêm {entityLabel('master-data.product').toLowerCase()}</a>}
          {isAdmin() && <a className="btn" href="#/settings/data">Nhập từ CSV</a>}
        </div>
      </div></section>
      : <div className="stats">{picks.map((qname) => <a key={qname} className="card stat" href={listHref(qname)}>
        <span className="stat-label">{entityLabel(qname)}</span><span className="stat-value">{fmtNumber(summary?.[qname] ?? 0)}</span>
      </a>)}</div>}
    <div className="two-col">
      <section className="card" aria-labelledby="recent-title">
        <div className="card-head"><h2 id="recent-title">Hoạt động gần đây</h2><a href="#/events">Xem tất cả</a></div>
        <div className="card-pad">{events === null ? <div className="skeleton" data-h="row" /> : roots.length
          ? <EventTimeline events={roots} />
          : <div className="empty"><h3>Chưa có hoạt động</h3><p>Các bước tự động sẽ hiện ở đây khi phát sinh dữ liệu.</p></div>}
        </div>
      </section>
      <section className="card" aria-labelledby="mods-title">
        <div className="card-head"><h2 id="mods-title">Module của bạn</h2></div>
        <div className="card-pad stack-sm">{app.meta.modules.filter((module) => module.id !== 'master-data').map((module) =>
          <a key={module.id} className="list-link" href={`#/m/${module.id}`}><span>{module.name}</span><span aria-hidden="true">›</span></a>)}
          {app.meta.kpis.length > 0 && <div className="stack-sm"><hr /><div className="label">Chỉ tiêu nên theo dõi</div><ul className="muted small">{app.meta.kpis.map((kpi) => <li key={kpi}>{kpi}</li>)}</ul></div>}
        </div>
      </section>
    </div>
  </div>;
}
