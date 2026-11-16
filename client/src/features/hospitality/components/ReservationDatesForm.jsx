import React from 'react';

const nextDay = (value) => {
  if (!value) return '';
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
};

export default function ReservationDatesForm({
  values,
  capacity,
  minCheckIn,
  busy,
  t,
  onChange,
  onSubmit,
  onCancel,
}) {
  const exceedsCapacity = capacity && Number(values.guest_count) > Number(capacity);

  return <form className="card hotel-detail-card form-grid" onSubmit={onSubmit}>
    <header className="hotel-detail-head full"><div><h3>{t('Chỉnh sửa đặt phòng')}</h3><p className="small muted">{t('Có thể đổi ngày lưu trú và số khách trước khi nhận phòng; giá theo loại phòng đã chọn được giữ nguyên.')}</p></div></header>
    <label className="field"><span className="label">{t('Ngày nhận *')}</span><input className="input" type="date" required min={minCheckIn} value={values.check_in} onChange={(event) => onChange('check_in', event.target.value)} /></label>
    <label className="field"><span className="label">{t('Ngày trả *')}</span><input className="input" type="date" required min={values.check_in ? nextDay(values.check_in) : minCheckIn} value={values.check_out} onChange={(event) => onChange('check_out', event.target.value)} /></label>
    <label className="field"><span className="label">{t('Số lượng khách *')}</span><input className="input num" type="number" min="1" step="1" required value={values.guest_count} onChange={(event) => onChange('guest_count', event.target.value)} />{capacity && <span className="small muted">{t('Sức chứa tối đa:')} {capacity}</span>}</label>
    <div className="row wrap full"><span className="grow" /><button className="btn btn-secondary" type="button" disabled={Boolean(busy)} onClick={onCancel}>{t('Hủy')}</button><button className="btn btn-primary" type="submit" disabled={Boolean(busy) || Boolean(exceedsCapacity) || !values.check_out || values.check_out <= values.check_in}>{busy ? t('Đang lưu…') : t('Lưu thay đổi')}</button></div>
  </form>;
}
