export default function SalaryRevisionForm({ form, employees, busy, onFieldChange, onSubmit, recordLabel, t }) {
  return <section className="card card-pad">
    <h2>{t('Đề nghị điều chỉnh lương')}</h2>
    <form onSubmit={onSubmit}>
      <label className="field">
        <span className="label">{t('Nhân viên *')}</span>
        <select className="select" required value={form.employee} onChange={(event) => onFieldChange('employee', event.target.value)}>
          <option value="">{t('Chọn nhân viên')}</option>
          {employees.map((row) => <option key={row.id} value={row.id}>{recordLabel('hrm.employee', row)}</option>)}
        </select>
      </label>
      <div className="form-grid u-mt-10">
        <label className="field">
          <span className="label">{t('Ngày hiệu lực *')}</span>
          <input className="input" required type="date" value={form.effective_from} onChange={(event) => onFieldChange('effective_from', event.target.value)} />
        </label>
        <label className="field">
          <span className="label">{t('Lương cơ bản mới *')}</span>
          <input className="input num" required type="number" min="0.01" step="any" value={form.base_salary} onChange={(event) => onFieldChange('base_salary', event.target.value)} />
        </label>
      </div>
      <label className="field u-mt-10">
        <span className="label">{t('Lý do *')}</span>
        <textarea className="input" required rows="2" value={form.reason} onChange={(event) => onFieldChange('reason', event.target.value)} />
      </label>
      <button className="btn btn-primary u-mt-10" disabled={Boolean(busy)}>{t('Gửi duyệt điều chỉnh')}</button>
    </form>
  </section>;
}
