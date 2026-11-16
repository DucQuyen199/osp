import React from 'react';

export default function LeaveRequestForm({
  form,
  employees,
  busy,
  onSubmit,
  onFieldChange,
  onKindChange,
  onStartDateChange,
  onPartialDayChange,
  recordLabel,
  t,
}) {
  return <section className="card card-pad">
    <h2>{t('Gửi yêu cầu nghỉ phép')}</h2>
    <form onSubmit={onSubmit}>
      <label className="field"><span className="label">{t('Nhân viên *')}</span><select className="select" required value={form.employee} onChange={(event) => onFieldChange('employee', event.target.value)}><option value="">{t('Chọn nhân viên')}</option>{employees.map((row) => <option key={row.id} value={row.id}>{recordLabel('hrm.employee', row)}</option>)}</select></label>
      <div className="form-grid u-legacy-df928149c5">
        <label className="field"><span className="label">{t('Loại nghỉ')}</span><select className="select" value={form.kind} onChange={(event) => onKindChange(event.target.value)}><option value="annual">{t('Phép năm')}</option><option value="sick">{t('Nghỉ ốm')}</option><option value="unpaid">{t('Không lương')}</option><option value="maternity">{t('Thai sản')}</option><option value="other">{t('Khác')}</option></select></label>
        <label className="field"><span className="label">{t('Hưởng lương')}</span><select className="select" value={form.pay_treatment} onChange={(event) => onFieldChange('pay_treatment', event.target.value)}><option value="paid">{t('Có lương')}</option><option value="unpaid">{t('Không lương')}</option></select></label>
        <label className="field"><span className="label">{t('Từ ngày *')}</span><input className="input" required type="date" value={form.start_date} onChange={(event) => onStartDateChange(event.target.value)} /></label>
        <label className="field"><span className="label">{t('Đến ngày *')}</span><input className="input" required min={form.start_date || undefined} type="date" value={form.end_date} onChange={(event) => onFieldChange('end_date', event.target.value)} /></label>
        <label className="field"><span className="label">{t('Buổi nghỉ')}</span><select className="select" value={form.partial_day} onChange={(event) => onPartialDayChange(event.target.value)}><option value="full">{t('Cả ngày')}</option><option value="morning">{t('Buổi sáng')}</option><option value="afternoon">{t('Buổi chiều')}</option></select></label>
      </div>
      <label className="field u-legacy-df928149c5"><span className="label">{t('Lý do')}</span><textarea className="input" rows="2" value={form.reason} onChange={(event) => onFieldChange('reason', event.target.value)} /></label>
      <button className="btn btn-primary u-legacy-df928149c5" disabled={Boolean(busy) || !employees.length}>{t('Gửi duyệt')}</button>
    </form>
  </section>;
}
