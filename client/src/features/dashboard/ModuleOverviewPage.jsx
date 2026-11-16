import React, { useEffect } from 'react';
import { useDocumentTitle } from '../../lib/useDocumentTitle.js';
import { fmtNumber, uiText } from '../../lib/i18n.js';
import { app, entityLabel } from '../../lib/state.js';
import { listHref } from '../../lib/routes.js';
export default function ModuleOverviewPage({ moduleId, summary }) {
  useDocumentTitle(`${uiText(module?.name || 'Module')} · OSP Suite`);
  const module = app.meta.modules.find((item) => item.id === moduleId);
  useEffect(() => {  }, [module?.name]);
  if (!module) return <div className="page"><div className="empty"><h3>{uiText('Module chưa được bật')}</h3><p>{uiText('Quản trị viên có thể bật module trong Cài đặt.')}</p><a className="btn" href="#/">{uiText('Về trang chủ')}</a></div></div>;
  return <div className="page">
    <div className="page-head"><div><div className="crumbs"><a href="#/">{uiText('Trang chủ')}</a></div><h1>{uiText(module.name)}</h1><p className="sub">{uiText(module.description)}</p></div></div>
    <div className="mod-grid">{module.entities.map((entity) => {
      const qname = `${module.id}.${entity.name}`;
      return <a key={qname} className="card mod-card" href={listHref(qname)}>
        <h2>{entityLabel(qname)}</h2><div className="stat-value num">{fmtNumber(summary?.[qname] ?? 0)}</div>
        <span className="faint">{entity.states ? `${Object.keys(entity.states.actions).length} ${uiText('hành động')}` : uiText('Danh mục')}</span>
      </a>;
    })}</div>
  </div>;
}
