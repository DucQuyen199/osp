import React from 'react';

export default function ReservationCreateForm({
  parties,
  roomTypes,
  party,
  onPartyChange,
  roomType,
  onRoomTypeChange,
  checkIn,
  minCheckIn,
  onCheckInChange,
  checkOut,
  minCheckOut,
  onCheckOutChange,
  guestCount,
  onGuestCountChange,
  busy,
  t,
  fmtMoney,
  recordLabel,
  onSubmit,
}) {
  const selectedRoomType = roomTypes.get(roomType);
  const exceedsCapacity = selectedRoomType?.capacity && Number(guestCount) > Number(selectedRoomType.capacity);

  return <form className="hotel-reservation-form" onSubmit={onSubmit}>
    <label className="field"><span className="label">{t('Khách lưu trú *')}</span><select className="select" required value={party} onChange={(event) => onPartyChange(event.target.value)}><option value="">{t('Chọn khách')}</option>{[...parties.values()].filter((item) => item.active !== false).map((item) => <option key={item.id} value={item.id}>{recordLabel('master-data.party', item)}</option>)}</select></label>
    <label className="field"><span className="label">{t('Loại phòng *')}</span><select className="select" required value={roomType} onChange={(event) => onRoomTypeChange(event.target.value)}><option value="">{t('Chọn loại phòng')}</option>{[...roomTypes.values()].map((item) => <option key={item.id} value={item.id}>{item.name} · {fmtMoney(item.rate)} / {t('đêm')}{item.capacity ? ` · ${t('tối đa')} ${item.capacity} ${t('khách')}` : ''}</option>)}</select></label>
    <label className="field"><span className="label">{t('Ngày nhận *')}</span><input className="input" type="date" min={minCheckIn || undefined} required value={checkIn} onChange={(event) => onCheckInChange(event.target.value)} /></label>
    <label className="field"><span className="label">{t('Ngày trả *')}</span><input className="input" type="date" min={minCheckOut || undefined} required value={checkOut} onChange={(event) => onCheckOutChange(event.target.value)} /></label>
    <label className="field"><span className="label">{t('Số lượng khách *')}</span><input className="input num" type="number" min="1" step="1" required value={guestCount} onChange={(event) => onGuestCountChange(event.target.value)} /><span className="small muted">{selectedRoomType?.capacity ? `${t('Sức chứa tối đa:')} ${selectedRoomType.capacity}` : t('Loại phòng chưa đặt giới hạn sức chứa')}</span></label>
    <button className="btn btn-primary" type="submit" disabled={Boolean(busy) || exceedsCapacity}>{busy === 'create' ? t('Đang đặt…') : t('Tạo đặt phòng')}</button>
  </form>;
}
