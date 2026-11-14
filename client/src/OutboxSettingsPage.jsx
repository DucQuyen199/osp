import React, { useCallback, useEffect, useState } from 'react';
import { api, tenantPath } from './lib/api.js';
import { toast } from './lib/feedback.js';
import { fmtDateTime } from './lib/i18n.js';
import { app, can } from './lib/state.js';
import SettingsTabs from './SettingsTabs.jsx';

const STATES = ['dead', 'retry', 'processing', 'pending', 'delivered', 'cancelled'];
const LABELS = { dead: 'Dead-letter', retry: 'Đang chờ thử lại', processing: 'Đang gửi', pending: 'Đang chờ', delivered: 'Đã gửi', cancelled: 'Đã hủy' };

export default function OutboxSettingsPage() {
  const [status, setStatus] = useState('dead');
  const [entries, setEntries] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const reload = useCallback(async (nextStatus = status) => {
    setError('');
    try { setEntries(await api(tenantPath(`/outbox?status=${encodeURIComponent(nextStatus)}`))); }
    catch (reason) { setError(reason.message || 'Không tải được webhook outbox.'); }
  }, [status]);

  useEffect(() => { document.title = 'Webhook outbox · Cài đặt · OSP Suite'; reload(); }, [reload]);

  const act = async (entry, action) => {
    if (action === 'dismiss' && !window.confirm('Bỏ qua delivery này? Delivery sẽ bị hủy và không tự thử lại.')) return;
    setBusy(entry.id);
    setError('');
    try {
      await api(tenantPath(`/outbox/${entry.id}/${action}`), { method: 'POST', body: {} });
      toast(action === 'retry' ? 'Đã đưa delivery vào hàng chờ.' : 'Đã hủy delivery.', 'success');
      await reload();
    } catch (reason) { setError(reason.message || 'Không xử lý được delivery.'); }
    finally { setBusy(''); }
  };

  if (!can('tenant.admin')) return <div className="page"><div className="alert danger" role="alert">Chỉ quản trị viên mới được quản lý webhook outbox.</div></div>;

  return <div className="page">
    <div className="page-head"><div><h1>Cài đặt</h1><p className="sub">Theo dõi webhook của doanh nghiệp “{app.meta.name}”.</p></div></div>
    <SettingsTabs active="outbox" />
    <section className="card"><div className="card-head"><h2>Webhook outbox</h2><label className="field"><span className="sr-only">Trạng thái webhook</span><select className="select" value={status} onChange={(event) => setStatus(event.target.value)}>{STATES.map((item) => <option key={item} value={item}>{LABELS[item]}</option>)}</select></label></div>
      {error && <div className="card-pad"><div className="alert danger" role="alert">{error}</div></div>}
      {entries.length === 0 ? <div className="card-pad muted">{status === 'dead' ? 'Không có webhook dead-letter.' : 'Không có delivery trong trạng thái này.'}</div> : <div className="table-wrap"><table className="table">
        <thead><tr><th>Thời gian</th><th>Sự kiện</th><th>Trạng thái</th><th>Lần thử</th><th>Lỗi cuối</th><th><span className="sr-only">Thao tác</span></th></tr></thead>
        <tbody>{entries.map((entry) => <tr key={entry.id}><td className="nowrap">{fmtDateTime(entry.createdAt)}</td><td className="mono small">{entry.eventType}</td><td><span className="badge plain">{LABELS[entry.status] || entry.status}</span></td><td className="right">{entry.attempts}</td><td className="small">{entry.error || ''}</td><td className="right">{status === 'dead' && <div className="row wrap"><button className="btn btn-sm btn-primary" type="button" disabled={Boolean(busy)} onClick={() => act(entry, 'retry')}>{busy === entry.id ? 'Đang xử lý…' : 'Đẩy lại'}</button><button className="btn btn-sm" type="button" disabled={Boolean(busy)} onClick={() => act(entry, 'dismiss')}>Bỏ qua</button></div>}</td></tr>)}</tbody>
      </table></div>}
    </section>
  </div>;
}
