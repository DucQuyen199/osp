import React from 'react';

/** Controlled reservation picker for the hotel front desk. */
export default function ReservationListCards({
  reservations = [],
  selectedId,
  parties,
  rooms,
  roomTypes,
  onSelect,
  recordLabel,
  fmtDate,
  fmtMoney,
  statusLabel,
  reservationStatus,
  t,
}) {
  if (!reservations.length) return <div className="empty">{t('Không có đặt phòng theo bộ lọc.')}</div>;

  return <div className="hotel-reservation-cards">
    {reservations.map((reservation) => <button
      className={`card hotel-reservation-card${selectedId === reservation.id ? ' selected' : ''}`}
      type="button"
      key={reservation.id}
      onClick={() => onSelect(reservation)}
    >
      <strong>{recordLabel('master-data.party', parties.get(reservation.party))}</strong>
      <span>{fmtDate(reservation.check_in)} → {fmtDate(reservation.check_out)} · {reservation.nights || '—'} {t('đêm')} · {reservation.guest_count || 1} {t('khách')}</span>
      <span className="small muted">
        {roomTypes.get(reservation.room_type)?.name || t('Chưa rõ loại phòng')}
        {reservation.room ? ` · ${t('Phòng')} ${rooms.get(reservation.room)?.number || ''}` : ` · ${t('Chưa phân phòng')}`}
      </span>
      <span className={`badge ${reservationStatus(reservation.status)}`}>{statusLabel(reservation.status)}</span>
      <strong className="num">{fmtMoney(reservation.total || 0)}</strong>
    </button>)}
  </div>;
}
