import React, { useCallback, useEffect, useState } from 'react';
import { api, tenantPath } from '../../lib/api.js';
import { toast } from '../../lib/feedback.js';
import { fmtDateTime } from '../../lib/i18n.js';
import { app, can } from '../../lib/state.js';
import SettingsTabs from './SettingsTabs.jsx';

export default function FailuresSettingsPage() {
  const [status, setStatus] = useState('open');
  const [entries, setEntries] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const reload = useCallback(async (nextStatus = status) => {
    setError('');
    try { setEntries(await api(tenantPath(`/failures?status=${encodeURIComponent(nextStatus)}`))); }
    catch (reason) { setError(reason.message || 'Không tải được danh sách lỗi.'); }
  }, [status]);

  useEffect(() => { document.title = 'Lỗi tích hợp · Cài đặt · OSP Suite'; reload(); }, [reload]);

  const act = async (entry, action) => {
    if (action === 'dismiss' && !window.confirm('Bỏ qua cảnh báo này? Bạn vẫn có thể xem lại trong bộ lọc đã bỏ qua.')) return;
    setBusy(entry.id);
    setError('');
    try {
      await api(tenantPath(`/failures/${entry.id}/${action}`), { method: 'POST', body: {} });
      toast(action === 'retry' ? 'Đã thử xử lý lại luồng sự kiện.' : 'Đã bỏ qua cảnh báo.', 'success');
      await reload();
    } catch (reason) { setError(reason.message || 'Không xử lý được cảnh báo.'); }
    finally { setBusy(''); }
  };

  if (!can('tenant.admin')) return <div className="page"><div className="alert danger" role="alert">Chỉ quản trị viên mới được xem luồng lỗi.</div></div>;

  return <div className="page">
    <div className="page-head"><div><h1>Cài đặt</h1><p className="sub">Theo dõi và xử lý lỗi tích hợp của “{app.meta.name}”.</p></div></div>
    <SettingsTabs active="failures" />
    <section className="card"><div className="card-head"><h2>Luồng tích hợp lỗi</h2><label className="field"><span className="sr-only">Trạng thái cảnh báo</span><select className="select" value={status} onChange={(event) => setStatus(event.target.value)}><option value="open">Đang mở</option><option value="resolved">Đã xử lý</option><option value="dismissed">Đã bỏ qua</option></select></label></div>
      {error && <div className="card-pad"><div className="alert danger" role="alert">{error}</div></div>}
      {entries.length === 0 ? <div className="card-pad muted">{status === 'open' ? 'Không có luồng lỗi đang mở.' : 'Không có cảnh báo trong trạng thái này.'}</div> : <div className="table-wrap"><table className="table">
        <thead><tr><th>Thời gian</th><th>Sự kiện</th><th>Module</th><th>Lần thử</th><th>Lỗi</th><th><span className="sr-only">Thao tác</span></th></tr></thead>
        <tbody>{entries.map((entry) => <tr key={entry.id}><td className="nowrap">{fmtDateTime(entry.createdAt)}</td><td className="mono small">{entry.eventType}</td><td>{entry.module}</td><td className="right">{entry.attempts}</td><td className="small">{entry.error}</td><td className="right">{status === 'open' && <div className="row wrap"><button className="btn btn-sm btn-primary" type="button" disabled={Boolean(busy)} onClick={() => act(entry, 'retry')}>{busy === entry.id ? 'Đang xử lý…' : 'Thử lại'}</button><button className="btn btn-sm" type="button" disabled={Boolean(busy)} onClick={() => act(entry, 'dismiss')}>Bỏ qua</button></div>}</td></tr>)}</tbody>
      </table></div>}
    </section>
  </div>;
}
