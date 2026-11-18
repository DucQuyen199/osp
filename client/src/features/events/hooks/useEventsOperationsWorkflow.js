import { useEffect, useState } from 'react';
import { api, dataPath } from '../../../lib/api.js';
import { localDateTime, localDateTimeToIso } from '../../../lib/dates.js';
import { statusLabel } from '../../../lib/i18n.js';

const inMinutes = (minutes) => localDateTime(new Date(Date.now() + minutes * 60000));

export function useEventsOperationsWorkflow({ events, tickets, parties, load, setError, t }) {
  const [selectedEventId, setSelectedEventId] = useState('');
  const [scanCode, setScanCode] = useState('');
  const [ticketMethods, setTicketMethods] = useState({});
  const [refundReasons, setRefundReasons] = useState({});
  const [eventForm, setEventForm] = useState({ name: '', venue: '', starts_at: inMinutes(60 * 24), capacity: '100', reservation_minutes: '15', ticket_price: '', ticket_tax: '' });
  const [ticketForm, setTicketForm] = useState({ party: '' });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [clockNow, setClockNow] = useState(() => Date.now());

  useEffect(() => {
    setSelectedEventId((current) => current && events.some((item) => item.id === current)
      ? current : events.find((item) => item.status === 'published')?.id || events[0]?.id || '');
  }, [events]);
  useEffect(() => {
    setTicketForm((current) => ({ ...current, party: current.party || [...parties.keys()][0] || '' }));
  }, [parties]);
  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  async function createEvent(event) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      const { ticket_tax, ...fields } = eventForm;
      const startsAt = localDateTimeToIso(eventForm.starts_at);
      if (!startsAt) throw new Error('Giờ bắt đầu không hợp lệ trong múi giờ kinh doanh.');
      await api(dataPath('events.event'), { method: 'POST', body: { ...fields, ...(ticket_tax ? { ticket_tax } : {}), starts_at: startsAt, capacity: Number(eventForm.capacity), reservation_minutes: Number(eventForm.reservation_minutes), ticket_price: String(eventForm.ticket_price), status: 'draft' } });
      setEventForm((current) => ({ ...current, name: '', venue: '', ticket_price: '' }));
      setNotice(t('Đã tạo sự kiện nháp. Kiểm tra thông tin rồi công bố để mở bán vé.'));
      await load();
    } catch (reason) { setError(t(reason.message || 'Không thể tạo sự kiện.')); }
    finally { setBusy(false); }
  }

  async function transitionEvent(event, action) {
    setBusy(true); setError(''); setNotice('');
    try {
      await api(dataPath('events.event', event.id, action), { method: 'POST' });
      setNotice(action === 'published' ? t('Đã công bố sự kiện và mở bán vé.') : t('Đã đóng bán vé cho sự kiện.'));
      await load();
    } catch (reason) { setError(t(reason.message || 'Không thể cập nhật sự kiện.')); }
    finally { setBusy(false); }
  }

  async function reserveTicket(event) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      await api(dataPath('events.ticket'), { method: 'POST', body: { event: selectedEventId, party: ticketForm.party, status: 'reserved' } });
      setNotice(t('Đã giữ chỗ. Vé sẽ tự hết hạn sau thời gian giữ chỗ của sự kiện nếu chưa bán.'));
      await load();
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
      setNotice(action === 'sold' ? t('Đã bán vé và ghi nhận thanh toán.') : action === 'checked_in' ? t('Đã check-in người tham dự.') : action === 'refunded' ? t('Đã hoàn vé và ghi nhận bút toán hoàn tiền.') : t('Đã hủy chỗ giữ vé.'));
      await load();
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

  return {
    selectedEventId, setSelectedEventId, scanCode, setScanCode, ticketMethods, setTicketMethods,
    refundReasons, setRefundReasons, eventForm, setEventForm, ticketForm, setTicketForm,
    busy, notice, clockNow, createEvent, transitionEvent, reserveTicket, ticketAction, scanTicket,
  };
}
