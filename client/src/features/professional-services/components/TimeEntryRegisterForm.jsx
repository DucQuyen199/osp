import React from 'react';

export default function TimeEntryRegisterForm({
  timeForm,
  onFieldChange,
  onSubmit,
  busy,
  today,
  estimatedAmount,
  fmtMoney,
  t,
}) {
  return <form className="form-grid u-mt-20" onSubmit={onSubmit}>
    <h3 className="full">{t('Ghi giờ tính phí')}</h3>
    <label className="field"><span className="label">{t('Chuyên viên *')}</span><input className="input" required value={timeForm.who} onChange={(event) => onFieldChange('who', event.target.value)}/></label>
    <label className="field"><span className="label">{t('Ngày làm việc *')}</span><input className="input" required type="date" max={today} value={timeForm.date} onChange={(event) => onFieldChange('date', event.target.value)}/></label>
    <label className="field"><span className="label">{t('Số giờ *')}</span><input className="input" required type="number" min="0.01" max="24" step="0.01" value={timeForm.hours} onChange={(event) => onFieldChange('hours', event.target.value)}/></label>
    <label className="field"><span className="label">{t('Đơn giá / giờ *')}</span><input className="input" required type="number" min="0" step="any" value={timeForm.rate} onChange={(event) => onFieldChange('rate', event.target.value)}/></label>
    <div className="row full"><span className="grow"/><strong>{t('Phí dự kiến:')} {fmtMoney(estimatedAmount)}</strong><button className="btn btn-primary" disabled={Boolean(busy)}>{t('Ghi giờ công')}</button></div>
  </form>;
}
