import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api, dataPath } from './lib/api.js';
import { fmtDate, fmtDateTime, fmtMoney, statusLabel } from './lib/i18n.js';
import { app, can, loadRefs, recordLabel } from './lib/state.js';
import { recordHref } from './lib/routes.js';

const itemsOf = (response) => Array.isArray(response?.items) ? response.items : [];
const today = () => new Date().toISOString().slice(0, 10);
const nextDay = (value) => {
  if (!value) return '';
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
};

export default function HotelFrontDeskPage() {
  const [reservations, setReservations] = useState([]);
  const [parties, setParties] = useState(new Map());
  const [rooms, setRooms] = useState(new Map());
  const [roomTypes, setRoomTypes] = useState(new Map());
  const [charges, setCharges] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [noShowReasons, setNoShowReasons] = useState({});
  const [filter, setFilter] = useState('all');
  const [party, setParty] = useState('');
  const [roomType, setRoomType] = useState('');
  const [checkIn, setCheckIn] = useState(today());
  const [checkOut, setCheckOut] = useState('');
  const [guestCount, setGuestCount] = useState('1');
  const [assignment, setAssignment] = useState('');
  const [chargeDescription, setChargeDescription] = useState('');
  const [chargeAmount, setChargeAmount] = useState('');
  const [extendedCheckout, setExtendedCheckout] = useState({});
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async (preserveNotice = false) => {
    setLoading(true); setError(''); if (!preserveNotice) setNotice('');
    try {
      const accountingEnabled = app.meta?.modules?.some((module) => module.id === 'accounting') && can('accounting.invoice.read');
      const [reservationResponse, partyMap, roomMap, roomTypeMap, chargeResponse, invoiceResponse] = await Promise.all([
        api(`${dataPath('hotel.reservation')}?limit=1000`), loadRefs('master-data.party'),
        loadRefs('hotel.room'), loadRefs('hotel.room_type'), api(`${dataPath('hotel.folio_charge')}?limit=1000`),
        accountingEnabled ? api(`${dataPath('accounting.invoice')}?limit=1000`) : Promise.resolve({ items: [] }),
      ]);
      const next = itemsOf(reservationResponse).sort((a, b) => String(a.check_in || '').localeCompare(String(b.check_in || '')) || String(a.created_at || '').localeCompare(String(b.created_at || '')));
      setReservations(next); setParties(partyMap); setRooms(roomMap); setRoomTypes(roomTypeMap);
      setCharges(itemsOf(chargeResponse)); setInvoices(itemsOf(invoiceResponse));
      setSelectedId((current) => next.some((item) => item.id === current) ? current : next.find((item) => item.check_in === today() && ['booked', 'checked_in'].includes(item.status))?.id || next[0]?.id || '');
    } catch (reason) { setError(reason.message || 'Không tải được dữ liệu lễ tân.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { document.title = 'Lễ tân khách sạn · OSP Suite'; load(); }, [load]);

  const selected = reservations.find((item) => item.id === selectedId) || null;
  const noShowReason = selected ? noShowReasons[selected.id] ?? selected.no_show_reason ?? '' : '';
  const selectedCharges = useMemo(() => charges.filter((item) => item.reservation === selectedId), [charges, selectedId]);
  const selectedInvoice = invoices.find((item) => item.source === 'reservation' && item.source_id === selectedId);
  const visible = reservations.filter((item) => filter === 'all' || item.status === filter || (filter === 'arrivals' && item.check_in === today() && item.status === 'booked') || (filter === 'departures' && item.check_out === today() && item.status === 'checked_in'));
  const availableRooms = [...rooms.values()].filter((room) => room.room_type === (selected?.room_type || roomType) && room.status === 'vacant');
  const arrivalsToday = reservations.filter((item) => item.status === 'booked' && item.check_in === today()).length;
  const departuresToday = reservations.filter((item) => item.status === 'checked_in' && item.check_out === today()).length;
  const occupiedRooms = [...rooms.values()].filter((room) => room.status === 'occupied').length;
  const occupancy = rooms.size ? Math.round(occupiedRooms / rooms.size * 100) : 0;

  const createReservation = async (event) => {
    event.preventDefault(); setBusy('create'); setError(''); setNotice('');
    try {
      const created = await api(dataPath('hotel.reservation'), { method: 'POST', body: { party, room_type: roomType, check_in: checkIn, check_out: checkOut, guest_count: Number(guestCount) } });
      await load(true); setSelectedId(created.id); setNotice('Đã tạo đặt phòng. Giá phòng và số đêm được hệ thống tính theo loại phòng.');
    } catch (reason) { setError(reason.message || 'Không tạo được đặt phòng. Kiểm tra sức chứa và lịch phòng.'); }
    finally { setBusy(''); }
  };

  const assignRoom = async (reservation) => {
    if (!assignment) return;
    setBusy(`${reservation.id}:assign`); setError(''); setNotice('');
    try { await api(dataPath('hotel.reservation', reservation.id), { method: 'PATCH', body: { room: assignment } }); await load(true); setNotice('Đã phân phòng cho đặt phòng.'); }
    catch (reason) { setError(reason.message || 'Không phân được phòng. Hệ thống kiểm tra trùng lịch và loại phòng.'); }
    finally { setBusy(''); }
  };

  const transition = async (reservation, action) => {
    setBusy(`${reservation.id}:${action}`); setError(''); setNotice('');
    try {
      if (action === 'no_show') {
        const reason = noShowReason.trim();
        if (!reason) throw new Error('Nhập lý do trước khi ghi nhận khách vắng mặt.');
        await api(dataPath('hotel.reservation', reservation.id), { method: 'PATCH', body: { no_show_reason: reason } });
      }
      const result = await api(dataPath('hotel.reservation', reservation.id, action), { method: 'POST' });
      await load(true);
      setNotice(action === 'checked_in' ? 'Đã nhận phòng.' : action === 'checked_out' ? `Đã trả phòng và chốt folio ${fmtMoney(result.total || reservation.total || 0)}.` : action === 'no_show' ? 'Đã ghi nhận khách vắng mặt và giải phóng lịch phòng.' : 'Đã hủy đặt phòng.');
    } catch (reason) { setError(reason.message || (action === 'checked_in' ? 'Chưa thể nhận phòng. Cần phòng trống và đúng ngày nhận.' : 'Không cập nhật được đặt phòng.')); }
    finally { setBusy(''); }
  };

  const addCharge = async (event) => {
    event.preventDefault(); if (!selected) return;
    setBusy('charge'); setError(''); setNotice('');
    try {
      await api(dataPath('hotel.folio_charge'), { method: 'POST', body: { reservation: selected.id, description: chargeDescription.trim(), amount: Number(chargeAmount) } });
      setChargeDescription(''); setChargeAmount(''); await load(true); setNotice('Đã ghi phí phát sinh vào folio.');
    } catch (reason) { setError(reason.message || 'Không ghi được khoản phí. Chỉ thêm phí trước khi trả phòng.'); }
    finally { setBusy(''); }
  };

  const extendStay = async (event) => {
    event.preventDefault(); if (!selected) return;
    const newCheckout = extendedCheckout[selected.id] || '';
    if (!newCheckout || newCheckout <= selected.check_out) return;
    setBusy(`${selected.id}:extend`); setError(''); setNotice('');
    try {
      await api(dataPath('hotel.reservation', selected.id), { method: 'PATCH', body: { check_out: newCheckout } });
      setExtendedCheckout((current) => { const next = { ...current }; delete next[selected.id]; return next; });
      await load(true);
      setNotice('Đã gia hạn lưu trú. Hệ thống đã kiểm tra lịch phòng và tính lại số đêm, tổng tiền theo giá phòng đã chốt khi đặt.');
    } catch (reason) { setError(reason.message || 'Không gia hạn được. Phòng có thể đã được đặt cho khoảng thời gian mới.'); }
    finally { setBusy(''); }
  };

  const reservationStatus = (status) => status === 'booked' ? 'warning' : status === 'checked_in' ? 'success' : status === 'checked_out' ? 'plain' : 'danger';

  return <div className="page hotel-frontdesk-page">
    <div className="page-head"><div><h1>Lễ tân khách sạn</h1><p className="sub">Đặt phòng theo loại phòng, phân phòng, nhận/trả khách và cộng phí phát sinh vào folio. Hóa đơn được tạo khi trả phòng.</p></div><button className="btn btn-secondary" type="button" disabled={loading || Boolean(busy)} onClick={() => load()}>{loading ? 'Đang tải…' : 'Làm mới'}</button></div>
    <div className="row wrap hotel-frontdesk-summary"><span className="badge warning">Nhận phòng hôm nay: {arrivalsToday}</span><span className="badge plain">Trả phòng hôm nay: {departuresToday}</span><span className="badge success">Công suất hiện tại: {occupancy}%</span><a className="small" href="#/reports/hotel/housekeeping-board">Mở bảng buồng phòng</a></div>
    {error && <div className="alert danger" role="alert">{error}</div>}{notice && <div className="alert success" role="status">{notice}</div>}
    {loading ? <div className="card-pad"><div className="skeleton" data-h="row" /></div> : <>
      {can('hotel.reservation.create') && <section className="card hotel-reservation-create"><h2>Đặt phòng mới</h2><form className="hotel-reservation-form" onSubmit={createReservation}>
        <label className="field"><span className="label">Khách lưu trú *</span><select className="select" required value={party} onChange={(event) => setParty(event.target.value)}><option value="">Chọn khách</option>{[...parties.values()].filter((item) => item.active !== false).map((item) => <option key={item.id} value={item.id}>{recordLabel('master-data.party', item)}</option>)}</select></label>
        <label className="field"><span className="label">Loại phòng *</span><select className="select" required value={roomType} onChange={(event) => setRoomType(event.target.value)}><option value="">Chọn loại phòng</option>{[...roomTypes.values()].map((item) => <option key={item.id} value={item.id}>{item.name} · {fmtMoney(item.rate)} / đêm{item.capacity ? ` · tối đa ${item.capacity} khách` : ''}</option>)}</select></label>
        <label className="field"><span className="label">Ngày nhận *</span><input className="input" type="date" min={today()} required value={checkIn} onChange={(event) => setCheckIn(event.target.value)} /></label>
        <label className="field"><span className="label">Ngày trả *</span><input className="input" type="date" min={checkIn} required value={checkOut} onChange={(event) => setCheckOut(event.target.value)} /></label>
        <label className="field"><span className="label">Số lượng khách *</span><input className="input num" type="number" min="1" step="1" required value={guestCount} onChange={(event) => setGuestCount(event.target.value)} /><span className="small muted">{roomTypes.get(roomType)?.capacity ? `Sức chứa tối đa: ${roomTypes.get(roomType).capacity}` : 'Loại phòng chưa đặt giới hạn sức chứa'}</span></label>
        <button className="btn btn-primary" type="submit" disabled={Boolean(busy) || (roomTypes.get(roomType)?.capacity && Number(guestCount) > Number(roomTypes.get(roomType).capacity)) || !can('hotel.reservation.create')}>{busy === 'create' ? 'Đang đặt…' : 'Tạo đặt phòng'}</button>
      </form></section>}
      <div className="hotel-frontdesk-layout"><section className="hotel-reservation-list"><header className="hotel-list-head"><h2>Đặt phòng</h2><select className="select" aria-label="Lọc đặt phòng" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">Tất cả</option><option value="arrivals">Nhận hôm nay</option><option value="departures">Trả hôm nay</option><option value="booked">Đã đặt</option><option value="checked_in">Đang lưu trú</option><option value="checked_out">Đã trả</option><option value="no_show">Vắng mặt</option><option value="cancelled">Đã hủy</option></select></header>
        {visible.length ? <div className="hotel-reservation-cards">{visible.map((reservation) => <button className={`card hotel-reservation-card${selectedId === reservation.id ? ' selected' : ''}`} type="button" key={reservation.id} onClick={() => { setSelectedId(reservation.id); setAssignment(reservation.room || ''); }}><strong>{recordLabel('master-data.party', parties.get(reservation.party))}</strong><span>{fmtDate(reservation.check_in)} → {fmtDate(reservation.check_out)} · {reservation.nights || '—'} đêm · {reservation.guest_count || 1} khách</span><span className="small muted">{roomTypes.get(reservation.room_type)?.name || 'Chưa rõ loại phòng'}{reservation.room ? ` · Phòng ${rooms.get(reservation.room)?.number || ''}` : ' · Chưa phân phòng'}</span><span className={`badge ${reservationStatus(reservation.status)}`}>{statusLabel(reservation.status)}</span><strong className="num">{fmtMoney(reservation.total || 0)}</strong></button>)}</div> : <div className="empty">Không có đặt phòng theo bộ lọc.</div>}
      </section>
      <section className="hotel-reservation-detail">{selected ? <>
        <article className="card hotel-detail-card"><header className="hotel-detail-head"><div><h2>{recordLabel('master-data.party', parties.get(selected.party))}</h2><p className="small muted">{roomTypes.get(selected.room_type)?.name || 'Loại phòng'} · {selected.guest_count || 1} khách · {selected.nights || '—'} đêm · {fmtDate(selected.check_in)} đến {fmtDate(selected.check_out)}</p></div><span className={`badge ${reservationStatus(selected.status)}`}>{statusLabel(selected.status)}</span></header>
          <div className="hotel-folio-total"><span>Phòng {selected.room ? rooms.get(selected.room)?.number || '' : 'chưa phân'} · {fmtMoney(selected.nightly_rate || 0)} / đêm</span><strong>{fmtMoney(selected.total || 0)}</strong></div>
          {selected.status === 'no_show' && selected.no_show_reason && <div className="alert warning" role="status">Lý do khách vắng mặt: {selected.no_show_reason}</div>}
          {selected.status === 'booked' && <div className="hotel-checkin-tools"><label className="field"><span className="label">Phân phòng</span><select className="select" value={assignment} onChange={(event) => setAssignment(event.target.value)}><option value="">Chọn phòng trống</option>{availableRooms.map((room) => <option key={room.id} value={room.id}>{room.number}{room.floor ? ` · Tầng ${room.floor}` : ''}</option>)}</select></label><button className="btn btn-secondary" type="button" disabled={Boolean(busy) || !assignment || assignment === selected.room || !can('hotel.reservation.update')} onClick={() => assignRoom(selected)}>Lưu phòng</button></div>}
          {selected.status === 'booked' && selected.check_in < today() && can('hotel.reservation.no_show') && can('hotel.reservation.update') && <div className="hotel-no-show-tools">{selectedCharges.length > 0 && <div className="alert warning" role="status">Đặt phòng còn phí folio; cần xử lý folio trước khi ghi nhận khách vắng mặt.</div>}<label className="field"><span className="label">Lý do khách vắng mặt *</span><textarea className="textarea" rows="2" maxLength="500" required value={noShowReason} onChange={(event) => setNoShowReasons((current) => ({ ...current, [selected.id]: event.target.value }))} placeholder="Ví dụ: khách không đến, không liên lạc được" /></label>{selectedCharges.length === 0 && <button className="btn btn-secondary" type="button" disabled={Boolean(busy) || !noShowReason.trim()} onClick={() => transition(selected, 'no_show')}>Ghi nhận khách vắng mặt</button>}</div>}
          <footer className="row wrap hotel-detail-actions">{selected.status === 'booked' && can('hotel.reservation.checked_in') && <button className="btn btn-primary" type="button" disabled={Boolean(busy) || !selected.room} title={!selected.room ? 'Phân phòng trước khi nhận khách' : ''} onClick={() => transition(selected, 'checked_in')}>Nhận phòng</button>}{selected.status === 'checked_in' && can('hotel.reservation.checked_out') && <button className="btn btn-primary" type="button" disabled={Boolean(busy)} onClick={() => transition(selected, 'checked_out')}>Trả phòng · chốt folio</button>}{selected.status === 'booked' && can('hotel.reservation.cancelled') && <button className="btn btn-secondary" type="button" disabled={Boolean(busy)} onClick={() => transition(selected, 'cancelled')}>Hủy đặt phòng</button>}{selectedInvoice && can('accounting.invoice.read') && <a className="btn btn-secondary" href={recordHref('accounting.invoice', selectedInvoice.id)}>Mở hóa đơn · {statusLabel(selectedInvoice.status)}</a>}</footer>
        </article>
        {selected.status === 'checked_in' && can('hotel.reservation.update') && <form className="card hotel-detail-card" onSubmit={extendStay}>
          <header className="hotel-detail-head"><div><h3>Gia hạn lưu trú</h3><p className="small muted">Chỉ kéo dài ngày trả. Khách, phòng và giá đã chốt được giữ nguyên.</p></div></header>
          <label className="field"><span className="label">Ngày trả mới</span><input className="input" type="date" min={nextDay(selected.check_out)} required value={extendedCheckout[selected.id] || ''} onChange={(event) => setExtendedCheckout((current) => ({ ...current, [selected.id]: event.target.value }))} /></label>
          <div><button className="btn btn-primary" type="submit" disabled={Boolean(busy) || !extendedCheckout[selected.id] || extendedCheckout[selected.id] <= selected.check_out}>{busy === `${selected.id}:extend` ? 'Đang kiểm tra lịch phòng…' : 'Kiểm tra và gia hạn'}</button></div>
        </form>}
        <article className="card hotel-detail-card"><header className="hotel-detail-head"><div><h3>Folio và phí phát sinh</h3><p className="small muted">Các khoản ghi vào folio sẽ cộng vào hóa đơn khi trả phòng.</p></div><strong>{fmtMoney(selected.total || 0)}</strong></header>
          {selectedCharges.length ? <div className="hotel-charge-list">{selectedCharges.map((charge) => <div className="hotel-charge-row" key={charge.id}><span>{charge.description}</span><strong>{fmtMoney(charge.amount)}</strong></div>)}</div> : <div className="small muted">Chưa có phí phát sinh.</div>}
          {['booked', 'checked_in'].includes(selected.status) && can('hotel.folio_charge.create') && <form className="hotel-charge-form" onSubmit={addCharge}><label className="field"><span className="label">Mô tả khoản phí *</span><input className="input" required value={chargeDescription} onChange={(event) => setChargeDescription(event.target.value)} placeholder="Ví dụ: minibar, giặt ủi" /></label><label className="field"><span className="label">Số tiền *</span><input className="input num" required type="number" min="0" step="any" value={chargeAmount} onChange={(event) => setChargeAmount(event.target.value)} /></label><button className="btn btn-secondary" type="submit" disabled={Boolean(busy)}>{busy === 'charge' ? 'Đang ghi…' : 'Ghi phí'}</button></form>}
        </article>
      </> : <div className="empty card-pad">Chọn một đặt phòng để nhận/trả khách và xem folio.</div>}</section></div>
    </>}
  </div>;
}
