import { uiText } from '../../../lib/i18n.js';
import { recordLabel } from '../../../lib/state.js';

export default function WorkSchedulePatternForm({
  patternForm,
  matchingEmployees,
  employeeFilter,
  maxEndDate,
  dayLimit,
  busy,
  canApply,
  onSubmit,
  onEmployeeFilterChange,
  onEmployeeToggle,
  onFieldChange,
  onStartDateChange,
  onCycleDayToggle,
  onCycleFieldChange,
  onCycleDayRemove,
  onCycleDayAdd,
}) {
  return <form className="form-grid" onSubmit={onSubmit}>
    <fieldset className="field u-box-reset">
      <legend className="label">{uiText('Nhân viên trong đội * (')}{patternForm.employees.length}/50)</legend>
      <input className="input" value={employeeFilter} onChange={(event) => onEmployeeFilterChange(event.target.value)} placeholder={uiText('Tìm theo tên hoặc mã nhân viên')}/>
      <div className="row wrap u-mt-8-gap-12">{matchingEmployees.map((employee) => <label className="row small" key={employee.id}>
        <input type="checkbox" checked={patternForm.employees.includes(employee.id)} disabled={!patternForm.employees.includes(employee.id) && patternForm.employees.length >= 50} onChange={(event) => onEmployeeToggle(employee.id, event.target.checked)}/>
        {recordLabel('hrm.employee', employee)}
      </label>)}</div>
      {!matchingEmployees.length && <span className="small muted">{uiText('Không tìm thấy nhân viên đang làm việc phù hợp.')}</span>}
      <span className="small muted">{uiText('Chọn tối đa 50 nhân viên; phạm vi tối đa hiện tại là')} {dayLimit} {uiText('ngày để không vượt giới hạn 40.000 dòng và trần 10 năm.')}</span>
    </fieldset>
    <label className="field"><span className="label">{uiText('Ngày bắt đầu chu kỳ *')}</span><input className="input" required type="date" value={patternForm.start_date} onChange={(event) => onStartDateChange(event.target.value)}/></label>
    <label className="field"><span className="label">{uiText('Sinh lịch đến ngày *')}</span><input className="input" required min={patternForm.start_date} max={maxEndDate} type="date" value={patternForm.end_date} onChange={(event) => onFieldChange('end_date', event.target.value)}/></label>
    <label className="field"><span className="label">{uiText('Múi giờ IANA *')}</span><input className="input" required value={patternForm.timezone} onChange={(event) => onFieldChange('timezone', event.target.value)} placeholder="Asia/Ho_Chi_Minh"/></label>
    <div className="field u-grid-column-full"><span className="label">{uiText('Các ngày trong chu kỳ (lặp từ ngày bắt đầu)')}</span><div className="stack u-mt-8">
      {patternForm.cycle.map((day, index) => <div className="row wrap card card-pad u-gap-12" key={day.rowId}>
        <strong>{uiText('Ngày')}{index + 1}</strong>
        <label className="row small"><input type="checkbox" checked={day.is_working} onChange={(event) => onCycleDayToggle(index, event.target.checked)}/>{uiText('Có ca làm')}</label>
        {day.is_working && <>
          <label className="field"><span className="label">{uiText('Bắt đầu')}</span><input className="input" type="time" required value={day.start_time} onChange={(event) => onCycleFieldChange(index, 'start_time', event.target.value)}/></label>
          <label className="field"><span className="label">{uiText('Kết thúc')}</span><input className="input" type="time" required value={day.end_time} onChange={(event) => onCycleFieldChange(index, 'end_time', event.target.value)}/></label>
          <label className="field"><span className="label">{uiText('Nghỉ (phút)')}</span><input className="input num" type="number" min="0" max="1439" step="1" value={day.break_minutes} onChange={(event) => onCycleFieldChange(index, 'break_minutes', Number(event.target.value))}/></label>
        </>}
        <button type="button" className="btn btn-ghost btn-sm" disabled={patternForm.cycle.length <= 1} onClick={() => onCycleDayRemove(index)}>{uiText('Xóa ngày')}</button>
      </div>)}
      <button type="button" className="btn btn-secondary btn-sm" disabled={patternForm.cycle.length >= 31} onClick={onCycleDayAdd}>{uiText('Thêm ngày vào chu kỳ')}</button>
    </div></div>
    <div className="row"><span className="grow"/><button className="btn btn-primary" disabled={Boolean(busy) || !patternForm.employees.length || patternForm.employees.length > 50 || !patternForm.start_date || !patternForm.end_date || patternForm.end_date < patternForm.start_date || !patternForm.cycle.length}>{uiText(canApply ? 'Tạo và áp dụng lịch' : 'Lưu mẫu nháp')}</button></div>
  </form>;
}
