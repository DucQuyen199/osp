export default function StudentIntakeForm({ student, pendingParty, busy, loading, onChange, onSubmit, t }) {
  return <section className="card card-pad">
    <h2>{t('Tiếp nhận học viên')}</h2>
    <p className="small muted">{t('Tạo hồ sơ cá nhân và liên kết với hồ sơ học viên trong một luồng.')}</p>
    {pendingParty && <div className="alert warning">{t('Đã tạo liên hệ “{name}”. Gửi lại để hoàn tất hồ sơ học viên mà không tạo liên hệ trùng.').replace('{name}', pendingParty.name)}</div>}
    <form className="form-grid" onSubmit={onSubmit}>
      <label className="field"><span className="label">{t('Họ và tên *')}</span><input className="input" required maxLength="160" value={student.name} disabled={Boolean(pendingParty)} onChange={(event) => onChange('name', event.target.value)}/></label>
      <label className="field"><span className="label">{t('Mã học viên')}</span><input className="input" maxLength="80" value={student.student_code} onChange={(event) => onChange('student_code', event.target.value)}/></label>
      <label className="field"><span className="label">{t('Ngày sinh')}</span><input className="input" type="date" value={student.dob} onChange={(event) => onChange('dob', event.target.value)}/></label>
      <label className="field"><span className="label">{t('Người giám hộ')}</span><input className="input" maxLength="160" value={student.guardian} onChange={(event) => onChange('guardian', event.target.value)}/></label>
      <label className="field"><span className="label">{t('Điện thoại')}</span><input className="input" type="tel" maxLength="80" value={student.phone} disabled={Boolean(pendingParty)} onChange={(event) => onChange('phone', event.target.value)}/></label>
      <label className="field"><span className="label">{t('Email')}</span><input className="input" type="email" maxLength="254" value={student.email} disabled={Boolean(pendingParty)} onChange={(event) => onChange('email', event.target.value)}/></label>
      <div className="row full"><span className="grow"/><button className="btn btn-primary" disabled={busy || loading}>{pendingParty ? t('Hoàn tất hồ sơ') : t('Tiếp nhận học viên')}</button></div>
    </form>
  </section>;
}
