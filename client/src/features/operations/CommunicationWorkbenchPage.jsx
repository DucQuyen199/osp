import React, { useCallback, useEffect, useState } from 'react';
import { useDocumentTitle } from '../../lib/useDocumentTitle.js';
import { useLatestRequest } from '../../lib/useLatestRequest.js';
import { localDateTime, localDateTimeToIso } from '../../lib/dates.js';
import { api, dataPath } from '../../lib/api.js';
import { fmtDateTime, statusLabel, uiTextWith } from '../../lib/i18n.js';
import { can, loadRefs, recordLabel } from '../../lib/state.js';
import EntityListPager from '../entities/components/EntityListPager.jsx';
import communicationEnglish from './communication.en.js';
const t = (text) => uiTextWith(text, communicationEnglish);
const rows = (response) => Array.isArray(response?.items) ? response.items : [];
const channelLabels = { email: 'Email', sms: 'SMS' };
const deliveryLabels = { queued: 'Đang chờ', processing: 'Đang gửi', retry: 'Chờ gửi lại', sent: 'Đã gửi', failed: 'Thất bại' };
const reminderLabels = { pending: 'Đã lên lịch', queued: 'Đã xếp hàng gửi', cancelled: 'Đã hủy' };
const REMINDER_PAGE_SIZE = 25;
const MESSAGE_PAGE_SIZE = 50;
const MESSAGE_STATUSES = ['queued', 'processing', 'retry', 'sent', 'failed'];
const pageRequest = (qname, page, pageSize, sort, dir, filters = {}) => {
  const query = new URLSearchParams({ limit: String(pageSize), offset: String(page * pageSize), sort, dir, ...filters });
  return api(`${dataPath(qname)}?${query}`);
};
export default function CommunicationWorkbenchPage() {
  useDocumentTitle(`${t('Lịch nhắc và nhật ký gửi')} · OSP Suite`);
  const [reminders, setReminders] = useState([]);
  const [reminderTotal, setReminderTotal] = useState(0);
  const [reminderPage, setReminderPage] = useState(0);
  const [messages, setMessages] = useState([]);
  const [messageTotal, setMessageTotal] = useState(0);
  const [messagePage, setMessagePage] = useState(0);
  const [messageCounts, setMessageCounts] = useState({});
  const [pendingReminderCount, setPendingReminderCount] = useState(0);
  const [parties, setParties] = useState(new Map());
  const [form, setForm] = useState({ party: '', channel: 'email', subject: '', body: '', send_at: '' });
  const [filter, setFilter] = useState('all');
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const latestRequest = useLatestRequest();
  const load = useCallback(async (quiet = false) => {
    const isLatest = latestRequest();
    if (!quiet) { setLoading(true); setError(''); }
    try {
      const [reminderRes, messageRes, partyMap, reminderPendingRes, messageCountPairs] = await Promise.all([
        can('communication.reminder.read') ? pageRequest('communication.reminder', reminderPage, REMINDER_PAGE_SIZE, 'send_at', 'asc', filter === 'all' ? {} : { status: filter }) : Promise.resolve({ items: [], total: 0 }),
        can('communication.message_log.read') ? pageRequest('communication.message_log', messagePage, MESSAGE_PAGE_SIZE, 'createdAt', 'desc') : Promise.resolve({ items: [], total: 0 }),
        can('master-data.party.read') ? loadRefs('master-data.party') : Promise.resolve(new Map()),
        can('communication.reminder.read') ? pageRequest('communication.reminder', 0, 1, 'send_at', 'asc', { status: 'pending' }) : Promise.resolve({ total: 0 }),
        can('communication.message_log.read')
          ? Promise.all(MESSAGE_STATUSES.map(async (status) => [status, await pageRequest('communication.message_log', 0, 1, 'createdAt', 'desc', { status })]))
          : Promise.resolve([]),
      ]);
      const reminderRows = rows(reminderRes);
      const messageRows = rows(messageRes);
      const nextReminderTotal = Number(reminderRes.total || 0);
      const nextMessageTotal = Number(messageRes.total || 0);
      if (isLatest()) {
        if (reminderPage > 0 && reminderPage * REMINDER_PAGE_SIZE >= nextReminderTotal) setReminderPage(Math.max(0, Math.ceil(nextReminderTotal / REMINDER_PAGE_SIZE) - 1));
        if (messagePage > 0 && messagePage * MESSAGE_PAGE_SIZE >= nextMessageTotal) setMessagePage(Math.max(0, Math.ceil(nextMessageTotal / MESSAGE_PAGE_SIZE) - 1));
        setReminders(reminderRows); setReminderTotal(nextReminderTotal); setMessages(messageRows); setMessageTotal(nextMessageTotal); setParties(partyMap);
        setPendingReminderCount(Number(reminderPendingRes?.total || 0));
        setMessageCounts(Object.fromEntries(messageCountPairs.map(([status, response]) => [status, Number(response.total || 0)])));
        setForm((current) => ({ ...current, party: current.party && partyMap.has(current.party) ? current.party : [...partyMap.keys()][0] || '' }));
      }
    } catch (reason) { if (isLatest()) setError(t(reason.message || 'Không tải được lịch và nhật ký gửi.')); }
    finally { if (isLatest()) setLoading(false); }
  }, [filter, messagePage, reminderPage, latestRequest]);
  useEffect(() => { load(); }, [load]);
  const deliveryCounts = messageCounts;
  const partiesForChannel = (channel) => [...parties.values()].filter((party) => channel === 'email'
    ? Boolean(party.email?.trim()) : Boolean(party.phone?.trim()));
  const eligibleParties = partiesForChannel(form.channel);
  async function run(key, operation, message) {
    setBusy(key); setError(''); setNotice('');
    try { await operation(); await load(true); setNotice(t(message)); }
    catch (reason) { setError(t(reason.message || 'Thao tác không thành công.')); }
    finally { setBusy(''); }
  }
  async function create(event) {
    event.preventDefault();
    if (!eligibleParties.some((party) => party.id === form.party)) { setError(t('Người nhận cần có địa chỉ phù hợp với kênh gửi.')); return; }
    if (!form.send_at || !form.body.trim()) return;
    const sendAt = localDateTimeToIso(form.send_at);
    if (!sendAt) { setError(t('Thời điểm gửi không hợp lệ trong múi giờ kinh doanh.')); return; }
    const payload = { party: form.party, channel: form.channel, body: form.body.trim(), send_at: sendAt };
    if (form.subject.trim()) payload.subject = form.subject.trim();
    await run('create', async () => {
      await api(dataPath('communication.reminder'), { method: 'POST', body: payload });
      setForm((current) => ({ ...current, subject: '', body: '', send_at: '' }));
    }, 'Đã lên lịch nhắc. Hệ thống sẽ xếp hàng gửi khi đến giờ.');
  }
  const cancel = (reminder) => run(`${reminder.id}:cancelled`, () => api(dataPath('communication.reminder', reminder.id, 'cancelled'), { method: 'POST' }), 'Đã hủy lịch nhắc.');
  const recipient = (id) => parties.has(id) ? recordLabel('master-data.party', parties.get(id)) : id || '—';
  return <div className="page">
    <div className="page-head"><div><h1>{t('Lịch nhắc và nhật ký gửi')}</h1><p className="sub">{t('Lên lịch email hoặc SMS cho liên hệ và theo dõi trạng thái gửi trong cùng một nơi.')}</p></div><button className="btn btn-secondary" type="button" disabled={loading || Boolean(busy)} onClick={() => load()}>{t('Làm mới')}</button></div>
    {error && <div className="alert danger" role="alert">{t(error)}</div>}{notice && <div className="alert success" role="status">{t(notice)}</div>}
    <div className="stats u-mb-16" ><div className="card stat"><span className="stat-label">{t('Lịch nhắc đang chờ')}</span><strong className="stat-value">{pendingReminderCount}</strong></div><div className="card stat"><span className="stat-label">{t('Tin đang chờ gửi')}</span><strong className="stat-value">{(deliveryCounts.queued || 0) + (deliveryCounts.retry || 0) + (deliveryCounts.processing || 0)}</strong></div><div className="card stat"><span className="stat-label">{t('Gửi thất bại')}</span><strong className="stat-value">{deliveryCounts.failed || 0}</strong></div></div>
    {can('communication.reminder.create') && <section className="card card-pad"><h2>{t('Lên lịch nhắc')}</h2><form className="form-grid" onSubmit={create}>
      <label className="field"><span className="label">{t('Người nhận *')}</span><select className="select" required value={form.party} onChange={(event) => setForm({ ...form, party: event.target.value })}><option value="">{t('Chọn liên hệ')}</option>{eligibleParties.map((party) => <option key={party.id} value={party.id}>{recordLabel('master-data.party', party)}{form.channel === 'email' ? ` · ${party.email}` : ` · ${party.phone}`}</option>)}</select>{!eligibleParties.length && <span className="small muted">{t('Không có liên hệ nào có địa chỉ phù hợp với kênh gửi.')}</span>}</label>
      <label className="field"><span className="label">{t('Kênh')}</span><select className="select" value={form.channel} onChange={(event) => {
        const channel = event.target.value;
        const candidates = partiesForChannel(channel);
        setForm((current) => ({ ...current, channel, party: candidates.some((party) => party.id === current.party) ? current.party : candidates[0]?.id || '' }));
      }}><option value="email">Email</option><option value="sms">SMS</option></select></label>
      <label className="field"><span className="label">{t('Thời điểm gửi *')}</span><input className="input" required type="datetime-local" min={localDateTime()} value={form.send_at} onChange={(event) => setForm({ ...form, send_at: event.target.value })}/></label>
      <label className="field"><span className="label">{t('Tiêu đề')}</span><input className="input" maxLength="240" value={form.subject} onChange={(event) => setForm({ ...form, subject: event.target.value })}/></label>
      <label className="field full"><span className="label">{t('Nội dung *')}</span><textarea className="input" required rows="4" maxLength="10000" value={form.body} onChange={(event) => setForm({ ...form, body: event.target.value })}/></label>
      <div className="row full"><span className="grow small muted">{t('Kênh gửi phải được cấu hình ở máy chủ. Lịch nhắc chưa đến giờ có thể hủy.')}</span><button className="btn btn-primary" disabled={Boolean(busy) || !eligibleParties.some((party) => party.id === form.party)}>{t('Lên lịch')}</button></div>
    </form></section>}
    {can('communication.reminder.read') && <section className="card card-pad u-mt-16" ><div className="row wrap"><div><h2>{t('Lịch nhắc')}</h2><p className="small muted">{t('Các lịch đến hạn được hệ thống tự động xếp hàng gửi.')}</p></div><span className="grow"/><label className="field"><span className="label">{t('Trạng thái')}</span><select className="select" value={filter} onChange={(event) => { setFilter(event.target.value); setReminderPage(0); }}><option value="all">{t('Tất cả')}</option><option value="pending">{t('Đã lên lịch')}</option><option value="queued">{t('Đã xếp hàng gửi')}</option><option value="cancelled">{t('Đã hủy')}</option></select></label></div>
      {loading ? <div className="skeleton" data-h="row"/> : !reminders.length ? <div className="empty">{t('Không có lịch nhắc trong bộ lọc này.')}</div> : <div className="table-wrap"><table className="table"><thead><tr><th>{t('Thời điểm')}</th><th>{t('Người nhận')}</th><th>{t('Kênh')}</th><th>{t('Tiêu đề / nội dung')}</th><th>{t('Trạng thái')}</th><th/></tr></thead><tbody>{reminders.map((row) => <tr key={row.id}><td>{fmtDateTime(row.send_at)}</td><td>{recipient(row.party)}</td><td>{t(channelLabels[row.channel] || row.channel)}</td><td><strong>{row.subject || t('Nhắc việc')}</strong><div className="small muted">{row.body}</div></td><td><span className={`badge ${row.status === 'queued' ? 'success' : row.status === 'pending' ? 'warning' : 'plain'}`}>{t(reminderLabels[row.status] || statusLabel(row.status))}</span></td><td>{row.status === 'pending' && can('communication.reminder.cancelled') && <button className="btn btn-ghost btn-sm" type="button" disabled={Boolean(busy)} onClick={() => cancel(row)}>{t('Hủy')}</button>}</td></tr>)}</tbody></table></div>}
      <EntityListPager total={reminderTotal} page={reminderPage} pages={Math.max(1, Math.ceil(reminderTotal / REMINDER_PAGE_SIZE))} loading={loading} onPageChange={setReminderPage} />
    </section>}
    {can('communication.message_log.read') && <section className="card card-pad u-mt-16" ><h2>{t('Nhật ký gửi gần đây')}</h2>{loading ? <div className="skeleton" data-h="row"/> : !messages.length ? <div className="empty">{t('Chưa có tin nhắn được xếp hàng gửi.')}</div> : <div className="table-wrap"><table className="table"><thead><tr><th>{t('Thời điểm')}</th><th>{t('Người nhận')}</th><th>{t('Kênh')}</th><th>{t('Tiêu đề')}</th><th>{t('Trạng thái')}</th><th>{t('Lần thử')}</th><th>{t('Lỗi gần nhất')}</th></tr></thead><tbody>{messages.map((row) => <tr key={row.id}><td>{fmtDateTime(row.createdAt)}</td><td>{recipient(row.recipient)}</td><td>{t(channelLabels[row.channel] || row.channel)}</td><td>{row.subject || '—'}</td><td><span className={`badge ${row.status === 'sent' ? 'success' : row.status === 'failed' ? 'danger' : 'warning'}`}>{t(deliveryLabels[row.status] || statusLabel(row.status))}</span></td><td>{row.attempts || 0}</td><td className="small">{row.last_error || '—'}</td></tr>)}</tbody></table></div>}<EntityListPager total={messageTotal} page={messagePage} pages={Math.max(1, Math.ceil(messageTotal / MESSAGE_PAGE_SIZE))} loading={loading} onPageChange={setMessagePage} /></section>}
  </div>;
}
