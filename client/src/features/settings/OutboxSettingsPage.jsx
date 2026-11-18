import React, { useCallback, useEffect, useState } from 'react';
import { useDocumentTitle } from '../../lib/useDocumentTitle.js';
import { api, tenantPath } from '../../lib/api.js';
import { confirmDialog, toast } from '../../lib/feedback.js';
import { fmtDateTime, uiText } from '../../lib/i18n.js';
import { app, can } from '../../lib/state.js';
import SettingsTabs from './SettingsTabs.jsx';
const STATES = ['dead', 'retry', 'processing', 'pending', 'delivered', 'cancelled'];
const LABELS = { dead: 'Dead-letter', retry: 'Đang chờ thử lại', processing: 'Đang gửi', pending: 'Đang chờ', delivered: 'Đã gửi', cancelled: 'Đã hủy' };
const PAGE_SIZE = 50;
export default function OutboxSettingsPage() {
  useDocumentTitle(`${uiText('Outbox tích hợp')} · ${uiText('Cài đặt')} · OSP Suite`);
  const [status, setStatus] = useState('dead');
  const [entries, setEntries] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const reload = useCallback(async (nextStatus = status, nextPage = page) => {
    setError('');
    try {
      const query = new URLSearchParams({ status: nextStatus, limit: String(PAGE_SIZE), offset: String(nextPage * PAGE_SIZE) });
      const response = await api(tenantPath(`/outbox?${query}`));
      setEntries(Array.isArray(response?.items) ? response.items : []);
      const nextTotal = Number(response?.total || 0);
      setTotal(nextTotal);
      if (nextPage > 0 && nextPage * PAGE_SIZE >= nextTotal) {
        setPage(Math.max(0, Math.ceil(nextTotal / PAGE_SIZE) - 1));
      }
    }
    catch (reason) { setError(reason.message || uiText('Không tải được webhook outbox.')); }
  }, [status, page]);
  const changeStatus = (nextStatus) => { setStatus(nextStatus); setPage(0); };
  useEffect(() => {  reload(); }, [reload]);
  const act = async (entry, action) => {
    if (action === 'dismiss' && !await confirmDialog({ title: uiText('Hủy delivery'), message: uiText('Bỏ qua delivery này? Delivery sẽ bị hủy và không tự thử lại.'), danger: true, confirmLabel: uiText('Hủy delivery') })) return;
    setBusy(entry.id);
    setError('');
    try {
      await api(tenantPath(`/outbox/${entry.id}/${action}`), { method: 'POST', body: {} });
      toast(action === 'retry' ? uiText('Đã đưa delivery vào hàng chờ.') : uiText('Đã hủy delivery.'), 'success');
      await reload(status, page);
    } catch (reason) { setError(reason.message || uiText('Không xử lý được delivery.')); }
    finally { setBusy(''); }
  };
  if (!can('tenant.admin')) return <div className="page"><div className="alert danger" role="alert">{uiText('Chỉ quản trị viên mới được quản lý webhook outbox.')}</div></div>;
  return <div className="page">
    <div className="page-head"><div><h1>{uiText('Cài đặt')}</h1><p className="sub">{uiText('Theo dõi webhook của doanh nghiệp')} “{app.meta.name}”.</p></div></div>
    <SettingsTabs active="outbox" />
    <section className="card"><div className="card-head"><h2>{uiText('Outbox tích hợp')}</h2><label className="field"><span className="sr-only">{uiText('Trạng thái giao nhận')}</span><select className="select" value={status} onChange={(event) => changeStatus(event.target.value)}>{STATES.map((item) => <option key={item} value={item}>{uiText(LABELS[item])}</option>)}</select></label></div>
      {error && <div className="card-pad"><div className="alert danger" role="alert">{uiText(error)}</div></div>}
      {entries.length === 0 ? <div className="card-pad muted">{uiText(status === 'dead' ? 'Không có webhook dead-letter.' : 'Không có delivery trong trạng thái này.')}</div> : <div className="table-wrap"><table className="table">
        <thead><tr><th>{uiText('Thời gian')}</th><th>{uiText('Đích')}</th><th>{uiText('Sự kiện')}</th><th>{uiText('Trạng thái')}</th><th>{uiText('Lần thử')}</th><th>{uiText('Lỗi cuối')}</th><th><span className="sr-only">{uiText('Thao tác')}</span></th></tr></thead>
        <tbody>{entries.map((entry) => <tr key={entry.id}><td className="nowrap">{fmtDateTime(entry.createdAt)}</td><td><span className="badge plain">{entry.destinationKind === 'connector' ? 'Connector' : 'Webhook'}</span><div className="mono small muted">{String(entry.destinationId || entry.webhookId || '').slice(0, 8)}</div></td><td className="mono small">{entry.eventType}</td><td><span className="badge plain">{uiText(LABELS[entry.status] || entry.status)}</span></td><td className="right">{entry.attempts}</td><td className="small">{entry.error || ''}</td><td className="right">{status === 'dead' && <div className="row wrap"><button className="btn btn-sm btn-primary" type="button" disabled={Boolean(busy)} onClick={() => act(entry, 'retry')}>{busy === entry.id ? uiText('Đang xử lý…') : uiText('Đẩy lại')}</button><button className="btn btn-sm" type="button" disabled={Boolean(busy)} onClick={() => act(entry, 'dismiss')}>{uiText('Bỏ qua')}</button></div>}</td></tr>)}</tbody>
      </table></div>}
      {total > PAGE_SIZE && <nav className="card-pad row wrap" aria-label={uiText('Điều hướng trang delivery')}>
        <span className="small muted">{uiText('{from}–{to} trong {total}').replace('{from}', String(page * PAGE_SIZE + 1)).replace('{to}', String(Math.min(total, (page + 1) * PAGE_SIZE))).replace('{total}', String(total))}</span>
        <span className="grow" />
        <button className="btn btn-ghost btn-sm" type="button" disabled={page === 0} onClick={() => setPage((current) => current - 1)}>{uiText('Trước')}</button>
        <span className="small">{uiText('Trang')} {page + 1} / {Math.ceil(total / PAGE_SIZE)}</span>
        <button className="btn btn-ghost btn-sm" type="button" disabled={(page + 1) * PAGE_SIZE >= total} onClick={() => setPage((current) => current + 1)}>{uiText('Sau')}</button>
      </nav>}
    </section>
  </div>;
}
