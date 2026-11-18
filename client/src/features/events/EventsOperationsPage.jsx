import React from 'react';
import { useDocumentTitle } from '../../lib/useDocumentTitle.js';
import { fmtDateTime, statusLabel, fmtNumber, uiTextWith } from '../../lib/i18n.js';
import { can, recordLabel } from '../../lib/state.js';
import eventsEnglish from './events.en.js';
import { useEventsOperationsData } from './hooks/useEventsOperationsData.js';
import { useEventsOperationsWorkflow } from './hooks/useEventsOperationsWorkflow.js';
import EventTicketRegister from './components/EventTicketRegister.jsx';
const t = (text) => uiTextWith(text, eventsEnglish);
const paymentMethods = [['cash', 'Tiền mặt'], ['card', 'Thẻ'], ['transfer', 'Chuyển khoản'], ['ewallet', 'Ví điện tử'], ['bank', 'Ngân hàng']];
const price = (value) => fmtNumber(String(value || 0), { maximumFractionDigits: 2 });
export default function EventsOperationsPage() {
  useDocumentTitle(`${t('Quản lý sự kiện và quầy vé')} · OSP Suite`);
  const { events, tickets, parties, taxes, loading, error, setError, load } = useEventsOperationsData();
  const {
    selectedEventId, setSelectedEventId, scanCode, setScanCode, ticketMethods, setTicketMethods,
    refundReasons, setRefundReasons, eventForm, setEventForm, ticketForm, setTicketForm,
    busy, notice, clockNow, createEvent, transitionEvent, reserveTicket, ticketAction, scanTicket,
  } = useEventsOperationsWorkflow({ events, tickets, parties, load, setError, t });
  const selectedEvent = events.find((event) => event.id === selectedEventId);
  const eventTickets = tickets.filter((ticket) => ticket.event === selectedEventId);
  const eventStart = selectedEvent?.starts_at ? new Date(selectedEvent.starts_at).getTime() : NaN;
  const ticketRows = eventTickets.map((ticket) => ({
    ...ticket,
    expired: Boolean(ticket.reservation_expires_at && new Date(ticket.reservation_expires_at).getTime() <= clockNow),
    checkInWindow: Boolean(Number.isFinite(eventStart) && clockNow >= eventStart - 2 * 60 * 60 * 1000 && clockNow <= eventStart + 24 * 60 * 60 * 1000),
    refundWindow: !(eventStart <= clockNow),
  }));
  const occupying = eventTickets.filter((ticket) => !['cancelled', 'refunded'].includes(ticket.status)
    && (ticket.status !== 'reserved' || (ticket.reservation_expires_at && new Date(ticket.reservation_expires_at).getTime() > clockNow))).length;
  const remaining = Math.max(0, Number(selectedEvent?.capacity || 0) - occupying);
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
    <section className="card card-pad u-mt-20" ><div className="row wrap"><h2>{t('Sự kiện')}</h2><span className="grow" /><select className="select" aria-label={t("Chọn sự kiện")} value={selectedEventId} onChange={(e) => setSelectedEventId(e.target.value)}><option value="">{t('Chọn sự kiện')}</option>{events.map((event) => <option key={event.id} value={event.id}>{event.name} · {statusLabel(event.status)}</option>)}</select></div>
      {!selectedEvent ? <div className="empty">{t('Chưa có sự kiện.')}</div> : <><EventTicketRegister
        eventName={selectedEvent.name}
        venueLabel={selectedEvent.venue || t('Chưa có địa điểm')}
        startsAtLabel={fmtDateTime(selectedEvent.starts_at)}
        ticketPriceLabel={price(selectedEvent.ticket_price)}
        remaining={remaining}
        capacity={selectedEvent.capacity}
        showPublish={selectedEvent.status === 'draft' && can('events.event.published')}
        showClose={selectedEvent.status === 'published' && can('events.event.closed')}
        busy={busy}
        tickets={ticketRows}
        partyName={(id) => parties.has(id) ? recordLabel('master-data.party', parties.get(id)) : ''}
        paymentMethods={paymentMethods}
        ticketMethods={ticketMethods}
        refundReasons={refundReasons}
        permissions={{ sell: can('events.ticket.sold'), update: can('events.ticket.update'), cancel: can('events.ticket.cancelled'), checkIn: can('events.ticket.checked_in'), refund: can('events.ticket.refunded') }}
        fmtDateTime={fmtDateTime}
        statusLabel={statusLabel}
        price={price}
        t={t}
        onPublish={() => transitionEvent(selectedEvent, 'published')}
        onClose={() => transitionEvent(selectedEvent, 'closed')}
        onMethodChange={(ticket, value) => setTicketMethods((current) => ({ ...current, [ticket.id]: value }))}
        onRefundReasonChange={(ticket, value) => setRefundReasons((current) => ({ ...current, [ticket.id]: value }))}
        onTicketAction={ticketAction}
      >
        {selectedEvent.status === 'published' && can('events.ticket.create') && <form className="row wrap u-mb-16" onSubmit={reserveTicket} ><select className="select" required value={ticketForm.party} onChange={(e) => setTicketForm((x) => ({ ...x, party: e.target.value }))}><option value="">{t('Chọn người tham dự')}</option>{[...parties.values()].filter((party) => party.active !== false).map((party) => <option key={party.id} value={party.id}>{recordLabel('master-data.party', party)}</option>)}</select><button className="btn btn-primary" disabled={busy || loading || !remaining || !ticketForm.party}>{t('Giữ chỗ')}</button></form>}
        {can('events.ticket.checked_in') && <form className="row wrap u-margin-12-0" onSubmit={scanTicket} ><label className="field"><span className="label">{t('Quét mã vé để check-in')}</span><input className="input" autoComplete="off" autoFocus aria-label={t("Quét hoặc nhập mã vé")} placeholder={t("Quét mã vé rồi nhấn Enter")} value={scanCode} onChange={(event) => setScanCode(event.target.value)} /></label><button className="btn btn-primary" disabled={busy || !scanCode.trim()}>{t('Check-in')}</button></form>}
      </EventTicketRegister>
      </>}
    </section>
  </div>;
}
