import React from 'react';

export default function BookingRequestForm({
  healthcare,
  form,
  bookableParties,
  resources,
  services,
  requiresManualEnd,
  kindLabel,
  fmtMoney,
  busy,
  recordLabel,
  onFieldChange,
  onServiceChange,
  onSubmit,
  t,
}) {
  return <section className="card card-pad"><h2>{t(healthcare ? 'Đặt lịch khám' : 'Đặt lịch dịch vụ')}</h2><form className="form-grid" onSubmit={onSubmit}>
      <label className="field"><span className="label">{t(healthcare ? 'Bệnh nhân' : 'Khách hàng')}</span><select className="select" required={healthcare} value={form.party} onChange={(e) => onFieldChange('party', e.target.value)}><option value="">{t(healthcare ? 'Chọn hồ sơ bệnh nhân' : 'Khách chưa đăng ký')}</option>{bookableParties.map((party) => <option key={party.id} value={party.id}>{recordLabel('master-data.party', party)}</option>)}</select>{healthcare && !bookableParties.length && <span className="small muted">{t('Đăng ký hồ sơ bệnh nhân trước khi đặt lịch khám.')}</span>}</label>
      <label className="field"><span className="label">{t(healthcare ? 'Bác sĩ / phòng khám *' : 'Kỹ thuật viên / phòng *')}</span><select className="select" required value={form.resource} onChange={(e) => onFieldChange('resource', e.target.value)}><option value="">{t('Chọn tài nguyên')}</option>{resources.map((row) => <option key={row.id} value={row.id}>{row.name} · {t(kindLabel(row.kind))}</option>)}</select></label>
      {services.length > 0 && <label className="field"><span className="label">{t(healthcare ? 'Dịch vụ khám' : 'Dịch vụ')}</span><select className="select" value={form.service} onChange={(e) => onServiceChange(e.target.value)}><option value="">{t('Lịch không gắn dịch vụ')}</option>{services.map((row) => <option key={row.id} value={row.id}>{row.name} · {row.duration_min || '—'} phút · {fmtMoney(row.price || 0)}</option>)}</select></label>}
      <label className="field"><span className="label">{t('Bắt đầu *')}</span><input className="input" required type="datetime-local" value={form.starts_at} onChange={(e) => onFieldChange('starts_at', e.target.value)}/></label>
      {requiresManualEnd && <label className="field"><span className="label">{t('Kết thúc *')}</span><input className="input" required type="datetime-local" min={form.starts_at} value={form.ends_at} onChange={(e) => onFieldChange('ends_at', e.target.value)}/></label>}
      <label className="field"><span className="label">{t('Giá thỏa thuận (để trống dùng giá dịch vụ)')}</span><input className="input" type="number" min="0" step="any" value={form.price} onChange={(e) => onFieldChange('price', e.target.value)}/></label>
      <label className="field"><span className="label">{t('Ghi chú')}</span><input className="input" value={form.note} onChange={(e) => onFieldChange('note', e.target.value)}/></label>
      <div className="row full"><span className="grow"/><button className="btn btn-primary" disabled={Boolean(busy)}>{t('Tiếp nhận lịch')}</button></div>
    </form></section>
;}