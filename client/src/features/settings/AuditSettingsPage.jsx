import React, { useEffect, useState } from 'react';
import { api, tenantPath } from '../../lib/api.js';
import { fmtDateTime } from '../../lib/i18n.js';
import { app, can } from '../../lib/state.js';
import SettingsTabs from './SettingsTabs.jsx';

export default function AuditSettingsPage() {
  const [entries, setEntries] = useState([]);
  const [users, setUsers] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    document.title = 'Nhật ký kiểm toán · Cài đặt · OSP Suite';
    Promise.all([api(tenantPath('/audit?limit=300')), api(tenantPath('/users'))])
      .then(([audit, userRows]) => { setEntries(audit); setUsers(userRows); })
      .catch((reason) => setError(reason.message || 'Không tải được nhật ký kiểm toán.'))
      .finally(() => setBusy(false));
  }, []);

  const userName = (id) => users.find((user) => user.id === id)?.name || id;
  if (!can('tenant.admin')) return <div className="page"><div className="alert danger" role="alert">Chỉ quản trị viên mới được xem nhật ký kiểm toán.</div></div>;

  return <div className="page">
    <div className="page-head"><div><h1>Cài đặt</h1><p className="sub">Nhật ký hoạt động của doanh nghiệp “{app.meta.name}”.</p></div></div>
    <SettingsTabs active="audit" />
    <section className="card"><div className="card-head"><h2>Nhật ký kiểm toán</h2></div>
      {error && <div className="card-pad"><div className="alert danger" role="alert">{error}</div></div>}
      {busy ? <div className="card-pad"><div className="skeleton" data-h="row" /></div> : entries.length === 0 ? <div className="card-pad muted">Chưa có hoạt động nào.</div> : <div className="table-wrap"><table className="table">
        <thead><tr><th>Thời gian</th><th>Người thực hiện</th><th>Hành động</th><th>Đối tượng</th><th>Chi tiết</th></tr></thead>
        <tbody>{entries.map((entry, index) => <tr key={`${entry.at}:${entry.userId}:${index}`}><td className="nowrap">{fmtDateTime(entry.at)}</td><td>{userName(entry.userId)}</td><td><span className="chip neutral">{entry.action}</span></td><td className="mono small">{entry.target || ''}</td><td className="muted small">{entry.detail || ''}</td></tr>)}</tbody>
      </table></div>}
    </section>
  </div>;
}
