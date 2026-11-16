import React, { useEffect } from 'react';
import { fmtNumber } from '../../lib/i18n.js';
import { app, entityLabel } from '../../lib/state.js';
import { listHref } from '../../lib/routes.js';

export default function ModuleOverviewPage({ moduleId, summary }) {
  const module = app.meta.modules.find((item) => item.id === moduleId);
  useEffect(() => { document.title = `${module?.name || 'Module'} · OSP Suite`; }, [module?.name]);
  if (!module) return <div className="page"><div className="empty"><h3>Module chưa được bật</h3><p>Quản trị viên có thể bật module trong Cài đặt.</p><a className="btn" href="#/">Về trang chủ</a></div></div>;
  return <div className="page">
    <div className="page-head"><div><div className="crumbs"><a href="#/">Trang chủ</a></div><h1>{module.name}</h1><p className="sub">{module.description}</p></div></div>
    <div className="mod-grid">{module.entities.map((entity) => {
      const qname = `${module.id}.${entity.name}`;
      return <a key={qname} className="card mod-card" href={listHref(qname)}>
        <h3>{entityLabel(qname)}</h3><div className="stat-value num">{fmtNumber(summary?.[qname] ?? 0)}</div>
        <span className="faint">{entity.states ? `${Object.keys(entity.states.actions).length} hành động` : 'Danh mục'}</span>
      </a>;
    })}</div>
  </div>;
}
