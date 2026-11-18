import React from 'react';

export default function EmployeeIntakeForm({
  form,
  departments,
  positions,
  weekdays,
  busy,
  onSubmit,
  onFieldChange,
  onWeekdayToggle,
  recordLabel,
  t,
}) {
  return <section className="card card-pad u-mt-16">
    <h2>{t('Tiếp nhận nhân viên')}</h2>
    <form onSubmit={onSubmit}>
      <div className="form-grid">
        <label className="field"><span className="label">{t('Họ và tên *')}</span><input className="input" required value={form.name} onChange={(event) => onFieldChange('name', event.target.value)} /></label>
        <label className="field"><span className="label">{t('Mã nhân viên')}</span><input className="input" value={form.code} onChange={(event) => onFieldChange('code', event.target.value)} /></label>
        <label className="field"><span className="label">Email</span><input className="input" type="email" value={form.email} onChange={(event) => onFieldChange('email', event.target.value)} /></label>
        <label className="field"><span className="label">{t('Điện thoại')}</span><input className="input" type="tel" value={form.phone} onChange={(event) => onFieldChange('phone', event.target.value)} /></label>
        <label className="field"><span className="label">{t('Phòng ban')}</span><select className="select" value={form.department} onChange={(event) => onFieldChange('department', event.target.value)}><option value="">{t('Chọn phòng ban')}</option>{[...departments.values()].map((row) => <option key={row.id} value={row.id}>{recordLabel('hrm.department', row)}</option>)}</select></label>
        <label className="field"><span className="label">{t('Chức danh')}</span><select className="select" value={form.position} onChange={(event) => onFieldChange('position', event.target.value)}><option value="">{t('Chọn chức danh')}</option>{[...positions.values()].map((row) => <option key={row.id} value={row.id}>{recordLabel('hrm.position', row)}</option>)}</select></label>
        <label className="field"><span className="label">{t('Ngày vào làm')}</span><input className="input" type="date" value={form.hire_date} onChange={(event) => onFieldChange('hire_date', event.target.value)} /></label>
        <label className="field"><span className="label">{t('Lương cơ bản ban đầu')}</span><input className="input num" type="number" min="0" step="any" value={form.base_salary} onChange={(event) => onFieldChange('base_salary', event.target.value)} /></label>
      </div>
      <div className="field u-grid-column-full">
        <label className="row small"><input type="checkbox" checked={form.customSchedule} onChange={(event) => onFieldChange('customSchedule', event.target.checked)} />{t('Lịch tuần và giờ chuẩn riêng cho nhân viên')}</label>
        {form.customSchedule && <div className="form-grid u-mt-8">
          <label className="field"><span className="label">{t('Giờ chuẩn mỗi ngày')}</span><input className="input num" type="number" min="1" max="24" step="0.25" value={form.standard_hours_per_day} onChange={(event) => onFieldChange('standard_hours_per_day', event.target.value)} /></label>
          <fieldset className="field u-box-reset"><legend className="label">{t('Ngày làm việc')}</legend><div className="row wrap u-gap-10">{weekdays.map(([day, label]) => <label className="row small u-gap-5" key={day}><input type="checkbox" checked={form.work_weekdays.includes(day)} onChange={() => onWeekdayToggle(day)} />{label}</label>)}</div></fieldset>
          <span className="small muted u-grid-column-full">{t('Nếu không bật, nhân viên dùng lịch làm việc và giờ chuẩn của kỳ lương.')}</span>
        </div>}
      </div>
      <div className="row u-mt-12"><span className="grow" /><button className="btn btn-primary" disabled={Boolean(busy) || (form.customSchedule && !form.work_weekdays.length)}>{t('Tạo hồ sơ')}</button></div>
    </form>
  </section>;
}
