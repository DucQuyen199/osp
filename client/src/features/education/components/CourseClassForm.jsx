import React from 'react';

export default function CourseClassForm({ classForm, employees, showEmployee, busy, loading, recordLabel, onChange, onSubmit, t }) {
  return <section className="card card-pad">
    <h2>{t('Tạo lớp học')}</h2>
    <form className="form-grid" onSubmit={onSubmit}>
      <label className="field"><span className="label">{t('Tên lớp *')}</span><input className="input" required maxLength="160" value={classForm.name} onChange={(event) => onChange('name', event.target.value)} /></label>
      <label className="field"><span className="label">{t('Môn / chương trình')}</span><input className="input" maxLength="160" value={classForm.subject} onChange={(event) => onChange('subject', event.target.value)} /></label>
      <label className="field"><span className="label">{t('Giáo viên cộng tác')}</span><input className="input" maxLength="160" value={classForm.teacher} onChange={(event) => onChange('teacher', event.target.value)} /><span className="small muted">{t('Nhập cùng một cách viết để phát hiện lịch trùng khi chưa có hồ sơ nhân sự.')}</span></label>
      {showEmployee && <label className="field"><span className="label">{t('Giáo viên thuộc nhân sự')}</span><select className="select" value={classForm.teacher_employee} onChange={(event) => onChange('teacher_employee', event.target.value)}><option value="">{t('Không liên kết hồ sơ')}</option>{[...employees.values()].filter((employee) => employee.status === 'active').map((employee) => <option key={employee.id} value={employee.id}>{recordLabel('hrm.employee', employee)}</option>)}</select><span className="small muted">{t('Lịch của nhân viên được đối chiếu chính xác giữa các lớp.')}</span></label>}
      <label className="field"><span className="label">{t('Ngày bắt đầu')}</span><input className="input" type="date" value={classForm.start_date} onChange={(event) => onChange('start_date', event.target.value)} /></label>
      <label className="field"><span className="label">{t('Sức chứa')}</span><input className="input num" type="number" min="1" step="1" value={classForm.capacity} onChange={(event) => onChange('capacity', event.target.value)} /></label>
      <label className="field"><span className="label">{t('Học phí mỗi kỳ')}</span><input className="input num" type="number" min="0.01" step="any" value={classForm.tuition} onChange={(event) => onChange('tuition', event.target.value)} /></label>
      <div className="row full"><span className="grow"/><button className="btn btn-primary" disabled={busy || loading}>{t('Tạo lớp')}</button></div>
    </form>
  </section>;
}
