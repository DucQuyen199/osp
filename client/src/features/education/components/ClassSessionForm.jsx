import React from 'react';

export default function ClassSessionForm({ classes, employees, recordLabel, form, busy, loading, onChange, onSubmit, t }) {
  return <section className="card card-pad">
    <h2>{t('Lên lịch buổi học')}</h2>
    <form className="form-grid" onSubmit={onSubmit}>
      <label className="field"><span className="label">{t('Lớp *')}</span><select className="select" required value={form.class} onChange={(event) => onChange('class', event.target.value)}><option value="">{t('Chọn lớp')}</option>{classes.map((item) => <option key={item.id} value={item.id}>{item.name}{item.subject ? ` · ${item.subject}` : ''}{item.teacher_employee && employees.has(item.teacher_employee) ? ` · ${recordLabel('hrm.employee', employees.get(item.teacher_employee))}` : item.teacher ? ` · ${item.teacher}` : ''}</option>)}</select></label>
      <label className="field"><span className="label">{t('Chủ đề buổi học *')}</span><input className="input" required value={form.topic} onChange={(event) => onChange('topic', event.target.value)} /></label>
      <label className="field"><span className="label">{t('Bắt đầu *')}</span><input className="input" type="datetime-local" required value={form.starts_at} onChange={(event) => onChange('starts_at', event.target.value)} /></label>
      <label className="field"><span className="label">{t('Kết thúc *')}</span><input className="input" type="datetime-local" required min={form.starts_at} value={form.ends_at} onChange={(event) => onChange('ends_at', event.target.value)} /></label>
      <div className="row full"><span className="grow"/><button className="btn btn-primary" disabled={busy || loading || !form.class}>{t('Lên lịch')}</button></div>
    </form>
  </section>;
}
