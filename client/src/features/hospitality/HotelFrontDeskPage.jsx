import React, { useMemo } from 'react';
import { useDocumentTitle } from '../../lib/useDocumentTitle.js';
import { localDate } from '../../lib/dates.js';
import { fmtDate, fmtDateTime, fmtMoney, statusLabel, uiTextWith } from '../../lib/i18n.js';
import { app, can, recordLabel } from '../../lib/state.js';
import hotelEnglish from './hotel.en.js';
import ReservationCreateForm from './components/ReservationCreateForm.jsx';
import ReservationDatesForm from './components/ReservationDatesForm.jsx';
import ReservationListCards from './components/ReservationListCards.jsx';
import SelectedReservationPanel from './components/SelectedReservationPanel.jsx';
import { useHotelFrontDeskData } from './hooks/useHotelFrontDeskData.js';
import { useHotelFrontDeskWorkflow } from './hooks/useHotelFrontDeskWorkflow.js';
const t = (text) => uiTextWith(text, hotelEnglish);
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
  const data = useHotelFrontDeskData(accountingEnabled);
  const { reservations, parties, rooms, roomTypes, charges, invoices, loading, error, setError, load: loadData } = data;
  const workflow = useHotelFrontDeskWorkflow({ data: { reservations, rooms, load: loadData }, setDataError: setError, t });
  const {
    selected, selectedId, setSelectedId, noShowReasons, setNoShowReasons, filter, setFilter,
    party, setParty, roomType, setRoomType, checkIn, setCheckIn, checkOut, setCheckOut,
    guestCount, setGuestCount, assignment, setAssignment, chargeDescription, setChargeDescription,
    chargeAmount, setChargeAmount, extendedCheckout, setExtendedCheckout, reservationEdit,
    setReservationEdit, busy, notice, load, createReservation, assignRoom, transition,
    addCharge, extendStay, startReservationEdit, updateReservationEdit, saveReservationEdit,
  } = workflow;
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
