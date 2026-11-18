import React, { useEffect, useState } from 'react';
import { useDocumentTitle } from '../../lib/useDocumentTitle.js';
import { api, tenantPath } from '../../lib/api.js';
import { fmtDateTime, uiText } from '../../lib/i18n.js';
import { app, can } from '../../lib/state.js';
import SettingsListPager from './SettingsListPager.jsx';
import SettingsTabs from './SettingsTabs.jsx';
const PAGE_SIZE = 50;
export default function AuditSettingsPage() {
  useDocumentTitle(`${uiText('Nhật ký kiểm toán')} · ${uiText('Cài đặt')} · OSP Suite`);
  const [entries, setEntries] = useState([]);
  const [users, setUsers] = useState([]);
  const [page, setPage] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  useEffect(() => {
    if (!can('tenant.admin')) return undefined;
    const controller = new AbortController();
    setBusy(true);
    setError('');
    setEntries([]);
    api(tenantPath(`/audit/page?limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`), { signal: controller.signal })
      .then((audit) => { setEntries(audit.items || []); setTotal(audit.total || 0); })
      .catch((reason) => { if (reason.name !== 'AbortError') setError(reason.message || uiText('Không tải được nhật ký kiểm toán.')); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [page, reloadKey]);
  useEffect(() => {
    if (!can('tenant.admin')) return;
    api(tenantPath('/users')).then(setUsers).catch(() => setUsers([]));
  }, []);
  const userName = (id) => users.find((user) => user.id === id)?.name || id;
  if (!can('tenant.admin')) return <div className="page"><div className="alert danger" role="alert">{uiText('Chỉ quản trị viên mới được xem nhật ký kiểm toán.')}</div></div>;
  return <div className="page">
    <div className="page-head"><div><h1>{uiText('Cài đặt')}</h1><p className="sub">{uiText('Nhật ký hoạt động của doanh nghiệp')} “{app.meta.name}”.</p></div></div>
    <SettingsTabs active="audit" />
    <section className="card"><div className="card-head"><h2>{uiText('Nhật ký kiểm toán')}</h2></div>
      {error && <div className="card-pad"><div className="alert danger" role="alert">{uiText(error)}</div></div>}
      {busy ? <div className="card-pad"><div className="skeleton" data-h="row" /></div> : error ? <div className="card-pad"><button className="btn btn-secondary btn-sm" type="button" onClick={() => setReloadKey((key) => key + 1)}>{uiText('Thử lại')}</button></div> : entries.length === 0 ? <div className="card-pad muted">{uiText('Chưa có hoạt động nào.')}</div> : <div className="table-wrap"><table className="table">
        <thead><tr><th>{uiText('Thời gian')}</th><th>{uiText('Người thực hiện')}</th><th>{uiText('Hành động')}</th><th>{uiText('Đối tượng')}</th><th>{uiText('Chi tiết')}</th></tr></thead>
        <tbody>{entries.map((entry, index) => <tr key={`${entry.at}:${entry.userId}:${index}`}><td className="nowrap">{fmtDateTime(entry.at)}</td><td>{userName(entry.userId)}</td><td><span className="chip neutral">{entry.action}</span></td><td className="mono small">{entry.target || ''}</td><td className="muted small">{entry.detail || ''}</td></tr>)}</tbody>
      </table></div>}
      {!busy && total > 0 && <SettingsListPager total={total} page={page} pageSize={PAGE_SIZE} onPageChange={setPage} label="Phân trang nhật ký kiểm toán" />}
    </section>
  </div>;
}
