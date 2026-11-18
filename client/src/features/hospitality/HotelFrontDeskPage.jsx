import React, { useEffect, useMemo, useState } from 'react';
import { useDocumentTitle } from '../../lib/useDocumentTitle.js';
import { localDate } from '../../lib/dates.js';
import { api, dataPath } from '../../lib/api.js';
import { fmtDate, fmtDateTime, fmtMoney, statusLabel, uiTextWith } from '../../lib/i18n.js';
import { app, can, recordLabel } from '../../lib/state.js';
import hotelEnglish from './hotel.en.js';
import ReservationCreateForm from './components/ReservationCreateForm.jsx';
import ReservationDatesForm from './components/ReservationDatesForm.jsx';
import ReservationListCards from './components/ReservationListCards.jsx';
import SelectedReservationPanel from './components/SelectedReservationPanel.jsx';
import { useHotelFrontDeskData } from './hooks/useHotelFrontDeskData.js';
const t = (text) => uiTextWith(text, hotelEnglish);
const itemsOf = (response) => Array.isArray(response?.items) ? response.items : [];
const today = localDate;
const activeStay = (reservation) => ['booked', 'checked_in'].includes(reservation.status);
const nextDay = (value) => {
  if (!value) return '';
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
};
export default function HotelFrontDeskPage() {
  useDocumentTitle(`${t('Lễ tân khách sạn')} · OSP Suite`);
  const accountingEnabled = app.meta?.modules?.some((module) => module.id === 'accounting') || false;
  const { reservations, parties, rooms, roomTypes, charges, invoices, loading, error, setError, load: loadData } = useHotelFrontDeskData(accountingEnabled);
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
  const [reservationEdit, setReservationEdit] = useState(null);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const load = async (preserveNotice = false) => {
    if (!preserveNotice) setNotice('');
    await loadData();
  };
  useEffect(() => {
    setSelectedId((current) => reservations.some((item) => item.id === current) ? current : reservations.find((item) => item.check_in === today() && ['booked', 'checked_in'].includes(item.status))?.id || reservations[0]?.id || '');
  }, [reservations]);
  const selected = reservations.find((item) => item.id === selectedId) || null;
  const noShowReason = selected ? noShowReasons[selected.id] ?? selected.no_show_reason ?? '' : '';
  const selectedCharges = useMemo(() => charges.filter((item) => item.reservation === selectedId), [charges, selectedId]);
  const selectedInvoice = invoices.find((item) => item.source === 'reservation' && item.source_id === selectedId);
  const visible = reservations.filter((item) => filter === 'all' || item.status === filter || (filter === 'arrivals' && item.check_in === today() && item.status === 'booked') || (filter === 'departures' && item.check_out === today() && item.status === 'checked_in'));
  const assignmentRoomType = selected?.room_type || roomType;
  const typeRooms = [...rooms.values()].filter((room) => room.room_type === assignmentRoomType && room.status !== 'maintenance');
  const overlappingStays = selected?.check_in && selected?.check_out
    ? reservations.filter((reservation) => reservation.id !== selected.id
      && activeStay(reservation)
      && (rooms.get(reservation.room)?.room_type || reservation.room_type) === assignmentRoomType
      && reservation.check_in < selected.check_out
      && reservation.check_out > selected.check_in)
    : [];
  const roomTypeHasCapacity = overlappingStays.length < typeRooms.length;
  const availableRooms = typeRooms.filter((room) => {
    if (!selected?.check_in || !selected?.check_out) return true;
    if (!roomTypeHasCapacity) return false;
    return !overlappingStays.some((reservation) => reservation.room === room.id);
  });
  const arrivalsToday = reservations.filter((item) => item.status === 'booked' && item.check_in === today()).length;
  const departuresToday = reservations.filter((item) => item.status === 'checked_in' && item.check_out === today()).length;
  const occupiedRooms = [...rooms.values()].filter((room) => room.status === 'occupied').length;
  const occupancy = rooms.size ? Math.round(occupiedRooms / rooms.size * 100) : 0;
  const createReservation = async (event) => {
    event.preventDefault(); setBusy('create'); setError(''); setNotice('');
    try {
      const created = await api(dataPath('hotel.reservation'), { method: 'POST', body: { party, room_type: roomType, check_in: checkIn, check_out: checkOut, guest_count: Number(guestCount) } });
      await load(true); setSelectedId(created.id); setNotice(t('Đã tạo đặt phòng. Giá phòng và số đêm được hệ thống tính theo loại phòng.'));
    } catch (reason) { setError(t(reason.message || 'Không tạo được đặt phòng. Kiểm tra sức chứa và lịch phòng.')); }
    finally { setBusy(''); }
  };
  const assignRoom = async (reservation) => {
    if (!assignment) return;
    setBusy(`${reservation.id}:assign`); setError(''); setNotice('');
    try { await api(dataPath('hotel.reservation', reservation.id), { method: 'PATCH', body: { room: assignment } }); await load(true); setNotice(t('Đã phân phòng cho đặt phòng.')); }
    catch (reason) { setError(t(reason.message || 'Không phân được phòng. Hệ thống kiểm tra trùng lịch và loại phòng.')); }
    finally { setBusy(''); }
  };
  const transition = async (reservation, action) => {
    setBusy(`${reservation.id}:${action}`); setError(''); setNotice('');
    try {
      if (action === 'no_show') {
        const reason = noShowReason.trim();
        if (!reason) throw new Error(t('Nhập lý do trước khi ghi nhận khách vắng mặt.'));
        await api(dataPath('hotel.reservation', reservation.id, action), { method: 'POST', body: { no_show_reason: reason } });
        await load(true);
        setNotice(t('Đã ghi nhận khách vắng mặt và giải phóng lịch phòng.'));
        return;
      }
      const result = await api(dataPath('hotel.reservation', reservation.id, action), { method: 'POST' });
      await load(true);
      setNotice(action === 'checked_in' ? t('Đã nhận phòng.') : action === 'checked_out' ? `${t("Đã trả phòng và chốt folio")} ${fmtMoney(result.total || reservation.total || 0)}.` : action === 'no_show' ? t('Đã ghi nhận khách vắng mặt và giải phóng lịch phòng.') : t('Đã hủy đặt phòng.'));
    } catch (reason) { setError(t(reason.message || (action === 'checked_in' ? 'Chưa thể nhận phòng. Cần phòng trống và đúng ngày nhận.' : 'Không cập nhật được đặt phòng.'))); }
    finally { setBusy(''); }
  };
  const addCharge = async (event) => {
    event.preventDefault(); if (!selected) return;
    setBusy('charge'); setError(''); setNotice('');
    try {
      await api(dataPath('hotel.folio_charge'), { method: 'POST', body: { reservation: selected.id, description: chargeDescription.trim(), amount: String(chargeAmount) } });
      setChargeDescription(''); setChargeAmount(''); await load(true); setNotice(t('Đã ghi phí phát sinh vào folio.'));
    } catch (reason) { setError(t(reason.message || 'Không ghi được khoản phí. Chỉ thêm phí trước khi trả phòng.')); }
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
      setNotice(t('Đã gia hạn lưu trú. Hệ thống đã kiểm tra lịch phòng và tính lại số đêm, tổng tiền theo giá phòng đã chốt khi đặt.'));
    } catch (reason) { setError(t(reason.message || 'Không gia hạn được. Phòng có thể đã được đặt cho khoảng thời gian mới.')); }
    finally { setBusy(''); }
  };
  const startReservationEdit = (reservation) => {
    setReservationEdit({ reservationId: reservation.id, check_in: reservation.check_in, check_out: reservation.check_out, guest_count: String(reservation.guest_count || 1) });
  };
  const updateReservationEdit = (field, value) => {
    setReservationEdit((current) => ({
      ...current,
      [field]: value,
      ...(field === 'check_in' && current.check_out <= value ? { check_out: '' } : {}),
    }));
  };
  const saveReservationEdit = async (event) => {
    event.preventDefault();
    if (!selected || reservationEdit?.reservationId !== selected.id || reservationEdit.check_out <= reservationEdit.check_in) return;
    setBusy(`${selected.id}:edit`); setError(''); setNotice('');
    try {
      await api(dataPath('hotel.reservation', selected.id), {
        method: 'PATCH',
        body: { check_in: reservationEdit.check_in, check_out: reservationEdit.check_out, guest_count: Number(reservationEdit.guest_count) },
      });
      setReservationEdit(null);
      await load(true);
      setNotice(t('Đã cập nhật đặt phòng. Hệ thống đã kiểm tra sức chứa và lịch phòng.'));
    } catch (reason) {
      setError(t(reason.message || 'Không cập nhật được đặt phòng. Kiểm tra sức chứa và lịch phòng.'));
    } finally { setBusy(''); }
  };
  const reservationStatus = (status) => status === 'booked' ? 'warning' : status === 'checked_in' ? 'success' : status === 'checked_out' ? 'plain' : 'danger';
  return <div className="page hotel-frontdesk-page">
    <div className="page-head"><div><h1>{t('Lễ tân khách sạn')}</h1><p className="sub">{t('Đặt phòng theo loại phòng, phân phòng, nhận/trả khách và cộng phí phát sinh vào folio. Hóa đơn được tạo khi trả phòng.')}</p></div><button className="btn btn-secondary" type="button" disabled={loading || Boolean(busy)} onClick={() => load()}>{loading ? t('Đang tải…') : t('Làm mới')}</button></div>
    <div className="row wrap hotel-frontdesk-summary"><span className="badge warning">{t("Nhận phòng hôm nay")}: {arrivalsToday}</span><span className="badge plain">{t("Trả phòng hôm nay")}: {departuresToday}</span><span className="badge success">{t("Công suất hiện tại")}: {occupancy}%</span><a className="small" href="#/reports/hotel/housekeeping-board">{t('Mở bảng buồng phòng')}</a></div>
    {error && <div className="alert danger" role="alert">{t(error)}</div>}{notice && <div className="alert success" role="status">{t(notice)}</div>}
    {loading ? <div className="card-pad"><div className="skeleton" data-h="row" /></div> : <>
      {can('hotel.reservation.create') && <section className="card hotel-reservation-create"><h2>{t('Đặt phòng mới')}</h2><ReservationCreateForm
        parties={parties}
        roomTypes={roomTypes}
        party={party}
        onPartyChange={setParty}
        roomType={roomType}
        onRoomTypeChange={setRoomType}
        checkIn={checkIn}
        minCheckIn={today()}
        onCheckInChange={(value) => { setCheckIn(value); if (checkOut && checkOut <= value) setCheckOut(''); }}
        checkOut={checkOut}
        minCheckOut={nextDay(checkIn)}
        onCheckOutChange={setCheckOut}
        guestCount={guestCount}
        onGuestCountChange={setGuestCount}
        busy={busy}
        t={t}
        fmtMoney={fmtMoney}
        recordLabel={recordLabel}
        onSubmit={createReservation}
      /></section>}
      <div className="hotel-frontdesk-layout"><section className="hotel-reservation-list"><header className="hotel-list-head"><h2>{t('Đặt phòng')}</h2><select className="select" aria-label={t("Lọc đặt phòng")} value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">{t('Tất cả')}</option><option value="arrivals">{t('Nhận hôm nay')}</option><option value="departures">{t('Trả hôm nay')}</option><option value="booked">{t('Đã đặt')}</option><option value="checked_in">{t('Đang lưu trú')}</option><option value="checked_out">{t('Đã trả')}</option><option value="no_show">{t('Vắng mặt')}</option><option value="cancelled">{t('Đã hủy')}</option></select></header>
        <ReservationListCards reservations={visible} selectedId={selectedId} parties={parties} rooms={rooms} roomTypes={roomTypes} onSelect={(reservation) => { setSelectedId(reservation.id); setAssignment(reservation.room || ''); }} recordLabel={recordLabel} fmtDate={fmtDate} fmtMoney={fmtMoney} statusLabel={statusLabel} reservationStatus={reservationStatus} t={t} />
      </section>
      <section className="hotel-reservation-detail">{selected ? <>
        {selected.status === 'booked' && can('hotel.reservation.update') && reservationEdit?.reservationId !== selected.id && <button className="btn btn-secondary" type="button" disabled={Boolean(busy)} onClick={() => startReservationEdit(selected)}>{t('Chỉnh sửa đặt phòng')}</button>}
        {selected.status === 'booked' && can('hotel.reservation.update') && reservationEdit?.reservationId === selected.id && <ReservationDatesForm values={reservationEdit} capacity={roomTypes.get(selected.room_type)?.capacity} minCheckIn={today()} busy={busy === `${selected.id}:edit`} t={t} onChange={updateReservationEdit} onSubmit={saveReservationEdit} onCancel={() => setReservationEdit(null)} />}
        <SelectedReservationPanel
          reservation={selected}
          guestLabel={recordLabel('master-data.party', parties.get(selected.party))}
          roomTypeName={roomTypes.get(selected.room_type)?.name || t('Loại phòng')}
          assignedRoomNumber={selected.room ? rooms.get(selected.room)?.number || '' : ''}
          availableRooms={availableRooms}
          assignment={assignment}
          onAssignmentChange={setAssignment}
          onAssignRoom={() => assignRoom(selected)}
          canAssignRoom={can('hotel.reservation.update')}
          showRoomAssignment={selected.status === 'booked'}
          statusTone={reservationStatus(selected.status)}
          statusLabel={statusLabel}
          t={t}
          fmtDate={fmtDate}
          fmtMoney={fmtMoney}
          noShowReason={noShowReason}
          showNoShowTools={selected.status === 'booked' && selected.check_in < today() && can('hotel.reservation.no_show') && can('hotel.reservation.update')}
          noShowHasCharges={selectedCharges.length > 0}
          canRecordNoShow={selectedCharges.length === 0}
          onNoShowReasonChange={(value) => setNoShowReasons((current) => ({ ...current, [selected.id]: value }))}
          onNoShow={() => transition(selected, 'no_show')}
          busy={busy}
          canCheckIn={selected.status === 'booked' && can('hotel.reservation.checked_in')}
          canCheckOut={selected.status === 'checked_in' && can('hotel.reservation.checked_out')}
          canCancel={selected.status === 'booked' && can('hotel.reservation.cancelled')}
          onTransition={(action) => transition(selected, action)}
          invoice={selectedInvoice}
          canOpenInvoice={can('accounting.invoice.read')}
          selectedCharges={selectedCharges}
          canAddCharge={['booked', 'checked_in'].includes(selected.status) && can('hotel.folio_charge.create')}
          chargeDescription={chargeDescription}
          chargeAmount={chargeAmount}
          onChargeDescriptionChange={setChargeDescription}
          onChargeAmountChange={setChargeAmount}
          onAddCharge={addCharge}
          extensionPanel={selected.status === 'checked_in' && can('hotel.reservation.update') && <form className="card hotel-detail-card" onSubmit={extendStay}>
            <header className="hotel-detail-head"><div><h3>{t('Gia hạn lưu trú')}</h3><p className="small muted">{t('Chỉ kéo dài ngày trả. Khách, phòng và giá đã chốt được giữ nguyên.')}</p></div></header>
            <label className="field"><span className="label">{t('Ngày trả mới')}</span><input className="input" type="date" min={nextDay(selected.check_out)} required value={extendedCheckout[selected.id] || ''} onChange={(event) => setExtendedCheckout((current) => ({ ...current, [selected.id]: event.target.value }))} /></label>
            <div><button className="btn btn-primary" type="submit" disabled={Boolean(busy) || !extendedCheckout[selected.id] || extendedCheckout[selected.id] <= selected.check_out}>{busy === selected.id + ':extend' ? t('Đang kiểm tra lịch phòng…') : t('Kiểm tra và gia hạn')}</button></div>
          </form>}
        />
      </> : <div className="empty card-pad">{t('Chọn một đặt phòng để nhận/trả khách và xem folio.')}</div>}</section></div>
    </>}
  </div>;
}
