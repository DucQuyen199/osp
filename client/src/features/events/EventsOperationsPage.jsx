import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { localDateTime, localDateTimeToIso } from '../../lib/dates.js';
import { api, dataPath } from '../../lib/api.js';
import { fmtDateTime, statusLabel, fmtNumber, uiTextWith } from '../../lib/i18n.js';
import { can, loadRefs, recordLabel, loadAllResponse } from '../../lib/state.js';
import eventsEnglish from './events.en.js';

const t = (text) => uiTextWith(text, eventsEnglish);

const inMinutes = (minutes) => localDateTime(new Date(Date.now() + minutes * 60000));
const paymentMethods = [['cash', 'Tiền mặt'], ['card', 'Thẻ'], ['transfer', 'Chuyển khoản'], ['ewallet', 'Ví điện tử'], ['bank', 'Ngân hàng']];
const price = (value) => fmtNumber(Number(value || 0), { maximumFractionDigits: 2 });

export default function EventsOperationsPage() {
  const [events, setEvents] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [parties, setParties] = useState(new Map());
  const [taxes, setTaxes] = useState(new Map());
  const [selectedEventId, setSelectedEventId] = useState('');
  const [scanCode, setScanCode] = useState('');
  const [ticketMethods, setTicketMethods] = useState({});
  const [refundReasons, setRefundReasons] = useState({});
  const [eventForm, setEventForm] = useState({ name: '', venue: '', starts_at: inMinutes(60 * 24), capacity: '100', reservation_minutes: '15', ticket_price: '', ticket_tax: '' });
  const [ticketForm, setTicketForm] = useState({ party: '' });
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [clockNow, setClockNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [eventRes, ticketRes, partyMap, taxMap] = await Promise.all([
        loadAllResponse('events.event'), loadAllResponse('events.ticket'),
        loadRefs('master-data.party'), loadRefs('master-data.tax'),
      ]);
      const eventItems = eventRes.items || [];
      setEvents(eventItems.sort((a, b) => String(a.starts_at || '').localeCompare(String(b.starts_at || ''))));
      setTickets((ticketRes.items || []).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))));
      setParties(partyMap); setTaxes(taxMap);
      setSelectedEventId((current) => current && eventItems.some((item) => item.id === current) ? current : eventItems.find((item) => item.status === 'published')?.id || eventItems[0]?.id || '');
      setTicketForm((current) => ({ ...current, party: current.party || [...partyMap.keys()][0] || '' }));
    } catch (reason) { setError(t(reason.message || 'Không tải được danh sách sự kiện và vé.')); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { document.title = `${t('Quản lý sự kiện và quầy vé')} · OSP Suite`; load(); }, [load]);
  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);
  const selectedEvent = events.find((event) => event.id === selectedEventId);
  const eventTickets = tickets.filter((ticket) => ticket.event === selectedEventId);
  const occupying = eventTickets.filter((ticket) => !['cancelled', 'refunded'].includes(ticket.status)
    && (ticket.status !== 'reserved' || (ticket.reservation_expires_at && new Date(ticket.reservation_expires_at).getTime() > clockNow))).length;
  const remaining = Math.max(0, Number(selectedEvent?.capacity || 0) - occupying);

  async function createEvent(event) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      const { ticket_tax, ...fields } = eventForm;
      const startsAt = localDateTimeToIso(eventForm.starts_at);
      if (!startsAt) throw new Error('Giờ bắt đầu không hợp lệ trong múi giờ kinh doanh.');
      await api(dataPath('events.event'), { method: 'POST', body: { ...fields, ...(ticket_tax ? { ticket_tax } : {}), starts_at: startsAt, capacity: Number(eventForm.capacity), reservation_minutes: Number(eventForm.reservation_minutes), ticket_price: Number(eventForm.ticket_price), status: 'draft' } });
      setEventForm((current) => ({ ...current, name: '', venue: '', ticket_price: '' })); setNotice(t('Đã tạo sự kiện nháp. Kiểm tra thông tin rồi công bố để mở bán vé.')); await load();
    } catch (reason) { setError(t(reason.message || 'Không thể tạo sự kiện.')); }
    finally { setBusy(false); }
  }

  async function transitionEvent(event, action) {
    setBusy(true); setError(''); setNotice('');
    try {
      await api(dataPath('events.event', event.id, action), { method: 'POST' });
      setNotice(action === 'published' ? t('Đã công bố sự kiện và mở bán vé.') : t('Đã đóng bán vé cho sự kiện.')); await load();
    } catch (reason) { setError(t(reason.message || 'Không thể cập nhật sự kiện.')); }
    finally { setBusy(false); }
  }

  async function reserveTicket(event) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      await api(dataPath('events.ticket'), { method: 'POST', body: { event: selectedEventId, party: ticketForm.party, status: 'reserved' } });
      setNotice(t('Đã giữ chỗ. Vé sẽ tự hết hạn sau thời gian giữ chỗ của sự kiện nếu chưa bán.')); await load();
    } catch (reason) { setError(t(reason.message || 'Không thể giữ chỗ vé.')); }
    finally { setBusy(false); }
  }

  async function ticketAction(ticket, action) {
    setBusy(true); setError(''); setNotice('');
    try {
      const body = {};
      if (action === 'sold') {
        const method = ticketMethods[ticket.id] || ticket.method;
        if (!method) throw new Error('Chọn phương thức thanh toán trước khi bán vé.');
        body.method = method;
      }
      if (action === 'refunded') {
        const reason = (refundReasons[ticket.id] || '').trim();
        if (!reason || reason.length > 500) throw new Error('Nhập lý do hoàn vé từ 1 đến 500 ký tự trước khi xử lý.');
        body.refund_reason = reason;
      }
      await api(dataPath('events.ticket', ticket.id, action), { method: 'POST', ...(Object.keys(body).length ? { body } : {}) });
      setNotice(action === 'sold' ? t('Đã bán vé và ghi nhận thanh toán.') : action === 'checked_in' ? t('Đã check-in người tham dự.') : action === 'refunded' ? t('Đã hoàn vé và ghi nhận bút toán hoàn tiền.') : t('Đã hủy chỗ giữ vé.')); await load();
    } catch (reason) { setError(t(reason.message || 'Không thể xử lý vé.')); }
    finally { setBusy(false); }
  }

  async function scanTicket(event) {
    event.preventDefault(); setError(''); setNotice('');
    const code = scanCode.trim().toUpperCase();
    if (!code) return;
    const ticket = tickets.find((item) => String(item.ticket_code || '').toUpperCase() === code);
    if (!ticket) { setError(t('Không tìm thấy mã vé. Kiểm tra mã rồi quét lại.')); return; }
    if (ticket.status !== 'sold') { setError(`${t('Vé đang ở trạng thái')} “${statusLabel(ticket.status)}” ${t('không thể check-in.')}`); return; }
    const eventRecord = events.find((item) => item.id === ticket.event);
    const startsAt = eventRecord?.starts_at ? new Date(eventRecord.starts_at).getTime() : NaN;
    if (!Number.isFinite(startsAt) || clockNow < startsAt - 2 * 60 * 60 * 1000 || clockNow > startsAt + 24 * 60 * 60 * 1000) {
      setError(t('Check-in chỉ mở từ 2 giờ trước đến 24 giờ sau giờ bắt đầu sự kiện.')); return;
    }
    setSelectedEventId(ticket.event); setScanCode('');
    await ticketAction(ticket, 'checked_in');
  }

  return <div className="page">
    <div className="page-head"><div><h1>{t('Sự kiện và quầy vé')}</h1><p className="sub">{t('Quản lý công bố, sức chứa, giữ chỗ, thanh toán vé, check-in và hoàn vé.')}</p></div><button className="btn btn-secondary" type="button" disabled={loading || busy} onClick={load}>{t('Làm mới')}</button></div>
    {error && <div className="alert danger" role="alert">{t(error)}</div>}{notice && <div className="alert success" role="status">{t(notice)}</div>}

    {can('events.event.create') && <section className="card card-pad"><h2>{t('Tạo sự kiện')}</h2><form className="form-grid" onSubmit={createEvent}>
      <label className="field"><span className="label">{t('Tên sự kiện *')}</span><input className="input" required value={eventForm.name} onChange={(e) => setEventForm((x) => ({ ...x, name: e.target.value }))} /></label>
      <label className="field"><span className="label">{t('Địa điểm')}</span><input className="input" value={eventForm.venue} onChange={(e) => setEventForm((x) => ({ ...x, venue: e.target.value }))} /></label>
      <label className="field"><span className="label">{t('Bắt đầu *')}</span><input className="input" type="datetime-local" required value={eventForm.starts_at} onChange={(e) => setEventForm((x) => ({ ...x, starts_at: e.target.value }))} /></label>
      <label className="field"><span className="label">{t('Sức chứa *')}</span><input className="input num" type="number" min="1" step="1" required value={eventForm.capacity} onChange={(e) => setEventForm((x) => ({ ...x, capacity: e.target.value }))} /></label>
      <label className="field"><span className="label">{t('Giá vé (đã gồm thuế) *')}</span><input className="input num" type="number" min="0.01" step="any" required value={eventForm.ticket_price} onChange={(e) => setEventForm((x) => ({ ...x, ticket_price: e.target.value }))} /></label>
      <label className="field"><span className="label">{t('Giữ chỗ (phút)')}</span><input className="input num" type="number" min="5" max="60" step="1" required value={eventForm.reservation_minutes} onChange={(e) => setEventForm((x) => ({ ...x, reservation_minutes: e.target.value }))} /></label>
      <label className="field"><span className="label">{t('Thuế vé')}</span><select className="select" value={eventForm.ticket_tax} onChange={(e) => setEventForm((x) => ({ ...x, ticket_tax: e.target.value }))}><option value="">{t('Không áp thuế')}</option>{[...taxes.values()].filter((tax) => tax.active !== false).map((tax) => <option key={tax.id} value={tax.id}>{recordLabel('master-data.tax', tax)}</option>)}</select></label>
      <div className="row full"><span className="grow" /><button className="btn btn-primary" disabled={busy || loading}>{t('Lưu sự kiện nháp')}</button></div>
    </form></section>}

    <section className="card card-pad" data-inline-style="inline-eee3f850c9"><div className="row wrap"><h2>{t('Sự kiện')}</h2><span className="grow" /><select className="select" aria-label={t("Chọn sự kiện")} value={selectedEventId} onChange={(e) => setSelectedEventId(e.target.value)}><option value="">{t('Chọn sự kiện')}</option>{events.map((event) => <option key={event.id} value={event.id}>{event.name} · {statusLabel(event.status)}</option>)}</select></div>
      {!selectedEvent ? <div className="empty">{t('Chưa có sự kiện.')}</div> : <><div className="row wrap" data-inline-style="inline-0e001e227c"><div><strong>{selectedEvent.name}</strong><div className="small muted">{selectedEvent.venue || t('Chưa có địa điểm')} · {fmtDateTime(selectedEvent.starts_at)} · Vé {price(selectedEvent.ticket_price)} · Còn {remaining}/{selectedEvent.capacity}</div></div><span className="grow" />{selectedEvent.status === 'draft' && can('events.event.published') && <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => transitionEvent(selectedEvent, 'published')}>{t('Công bố')}</button>}{selectedEvent.status === 'published' && can('events.event.closed') && <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => transitionEvent(selectedEvent, 'closed')}>{t('Đóng bán vé')}</button>}</div>
        {selectedEvent.status === 'published' && can('events.ticket.create') && <form className="row wrap" onSubmit={reserveTicket} data-inline-style="inline-bf4a218e05"><select className="select" required value={ticketForm.party} onChange={(e) => setTicketForm((x) => ({ ...x, party: e.target.value }))}><option value="">{t('Chọn người tham dự')}</option>{[...parties.values()].filter((party) => party.active !== false).map((party) => <option key={party.id} value={party.id}>{recordLabel('master-data.party', party)}</option>)}</select><button className="btn btn-primary" disabled={busy || loading || !remaining || !ticketForm.party}>{t('Giữ chỗ')}</button></form>}
        {can('events.ticket.checked_in') && <form className="row wrap" onSubmit={scanTicket} data-inline-style="inline-0e001e227c"><label className="field"><span className="label">{t('Quét mã vé để check-in')}</span><input className="input" autoComplete="off" autoFocus aria-label={t("Quét hoặc nhập mã vé")} placeholder={t("Quét mã vé rồi nhấn Enter")} value={scanCode} onChange={(event) => setScanCode(event.target.value)} /></label><button className="btn btn-primary" disabled={busy || !scanCode.trim()}>{t('Check-in')}</button></form>}
        {!eventTickets.length ? <div className="empty">{t('Chưa có vé cho sự kiện này.')}</div> : <div className="table-wrap"><table className="table"><thead><tr><th>{t('Mã vé')}</th><th>{t('Người tham dự')}</th><th>{t('Giá vé')}</th><th>{t('Trạng thái')}</th><th>{t('Hạn giữ chỗ')}</th><th>{t('Thao tác')}</th></tr></thead><tbody>{eventTickets.map((ticket) => { const party = parties.get(ticket.party); const expired = ticket.reservation_expires_at && new Date(ticket.reservation_expires_at).getTime() <= clockNow; const checkInWindow = selectedEvent.starts_at && clockNow >= new Date(selectedEvent.starts_at).getTime() - 2 * 60 * 60 * 1000 && clockNow <= new Date(selectedEvent.starts_at).getTime() + 24 * 60 * 60 * 1000; return <tr key={ticket.id}><td className="mono small">{ticket.ticket_code || '—'}</td><td>{party ? recordLabel('master-data.party', party) : t('Khách tham dự')}</td><td>{price(ticket.price)}</td><td>{statusLabel(ticket.status)}{ticket.method && <div className="small muted">{statusLabel(ticket.method)}</div>}</td><td>{ticket.reservation_expires_at ? fmtDateTime(ticket.reservation_expires_at) : '—'}{ticket.status === 'reserved' && expired && <div className="small muted">{t('Đã hết hạn; tác vụ nền sẽ giải phóng chỗ.')}</div>}</td><td className="row wrap">{ticket.status === 'reserved' && can('events.ticket.sold') && can('events.ticket.update') && <><select className="select" aria-label={t("Phương thức thanh toán vé")} value={ticketMethods[ticket.id] || ticket.method || ''} onChange={(e) => setTicketMethods((x) => ({ ...x, [ticket.id]: e.target.value }))}><option value="">{t('Phương thức')}</option>{paymentMethods.map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</select><button className="btn btn-primary btn-sm" disabled={busy || expired || !(ticketMethods[ticket.id] || ticket.method)} onClick={() => ticketAction(ticket, 'sold')}>{t('Bán vé')}</button>{can('events.ticket.cancelled') && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => ticketAction(ticket, 'cancelled')}>{t('Hủy giữ chỗ')}</button>}</>}{ticket.status === 'sold' && can('events.ticket.checked_in') && <button className="btn btn-primary btn-sm" disabled={busy || !checkInWindow} title={!checkInWindow ? t('Check-in mở từ 2 giờ trước đến 24 giờ sau giờ bắt đầu') : undefined} onClick={() => ticketAction(ticket, 'checked_in')}>{t('Check-in')}</button>}{ticket.status === 'sold' && can('events.ticket.refunded') && can('events.ticket.update') && <><input className="input" aria-label={t("Lý do hoàn vé")} placeholder={t("Lý do hoàn vé")} maxLength="500" value={refundReasons[ticket.id] || ''} onChange={(e) => setRefundReasons((x) => ({ ...x, [ticket.id]: e.target.value }))} /><button className="btn btn-ghost btn-sm" disabled={busy || !refundReasons[ticket.id]?.trim() || new Date(selectedEvent.starts_at).getTime() <= clockNow} onClick={() => ticketAction(ticket, 'refunded')}>{t('Hoàn vé')}</button></>}</td></tr>; })}</tbody></table></div>}
        <p className="small muted">{t('Bán vé ghi nhận thanh toán và thuế. Check-in chỉ mở từ 2 giờ trước đến 24 giờ sau giờ bắt đầu; vé đã check-in không thể hoàn.')}</p>
      </>}
    </section>
  </div>;
}
