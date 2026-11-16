import React, { useEffect, useState } from 'react';
import { useDocumentTitle } from '../../lib/useDocumentTitle.js';
import { api, tenantPath } from '../../lib/api.js';
import { fmtDateTime, uiText } from '../../lib/i18n.js';
import { app, can } from '../../lib/state.js';
import SettingsTabs from './SettingsTabs.jsx';
export default function AuditSettingsPage() {
  useDocumentTitle(`${uiText('Nhật ký kiểm toán')} · ${uiText('Cài đặt')} · OSP Suite`);
  const [entries, setEntries] = useState([]);
  const [users, setUsers] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  useEffect(() => {
    Promise.all([api(tenantPath('/audit?limit=300')), api(tenantPath('/users'))])
      .then(([audit, userRows]) => { setEntries(audit); setUsers(userRows); })
      .catch((reason) => setError(reason.message || uiText('Không tải được nhật ký kiểm toán.')))
      .finally(() => setBusy(false));
  }, []);
  const userName = (id) => users.find((user) => user.id === id)?.name || id;
  if (!can('tenant.admin')) return <div className="page"><div className="alert danger" role="alert">{uiText('Chỉ quản trị viên mới được xem nhật ký kiểm toán.')}</div></div>;
  return <div className="page">
    <div className="page-head"><div><h1>{uiText('Cài đặt')}</h1><p className="sub">{uiText('Nhật ký hoạt động của doanh nghiệp')} “{app.meta.name}”.</p></div></div>
    <SettingsTabs active="audit" />
    <section className="card"><div className="card-head"><h2>{uiText('Nhật ký kiểm toán')}</h2></div>
      {error && <div className="card-pad"><div className="alert danger" role="alert">{uiText(error)}</div></div>}
      {busy ? <div className="card-pad"><div className="skeleton" data-h="row" /></div> : entries.length === 0 ? <div className="card-pad muted">{uiText('Chưa có hoạt động nào.')}</div> : <div className="table-wrap"><table className="table">
        <thead><tr><th>{uiText('Thời gian')}</th><th>{uiText('Người thực hiện')}</th><th>{uiText('Hành động')}</th><th>{uiText('Đối tượng')}</th><th>{uiText('Chi tiết')}</th></tr></thead>
        <tbody>{entries.map((entry, index) => <tr key={`${entry.at}:${entry.userId}:${index}`}><td className="nowrap">{fmtDateTime(entry.at)}</td><td>{userName(entry.userId)}</td><td><span className="chip neutral">{entry.action}</span></td><td className="mono small">{entry.target || ''}</td><td className="muted small">{entry.detail || ''}</td></tr>)}</tbody>
      </table></div>}
    </section>
  </div>;
}
