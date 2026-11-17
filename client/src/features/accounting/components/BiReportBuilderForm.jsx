export default function BiReportBuilderForm({
  sources,
  selectedSource,
  sourceFields,
  numericFields,
  groupFields,
  name,
  operation,
  field,
  group,
  search,
  filter,
  filterValue,
  schedule,
  recipients,
  saving,
  onNameChange,
  onSourceChange,
  onOperationChange,
  onFieldChange,
  onGroupChange,
  onSearchChange,
  onFilterChange,
  onFilterValueChange,
  onScheduleChange,
  onRecipientsChange,
  onSubmit,
  onClose,
  t,
}) {
  return <section className="card report-section">
    <div className="card-head">
      <h2>{t('Thiết kế báo cáo')}</h2>
      <button className="btn btn-ghost" type="button" onClick={onClose}>{t('Đóng')}</button>
    </div>
    <form className="card-pad stack" onSubmit={onSubmit}>
      <div className="form-grid">
        <label className="field">
          <span>{t('Tên báo cáo')}</span>
          <input className="input" required maxLength={160} value={name} onChange={(event) => onNameChange(event.target.value)} />
        </label>
        <label className="field">
          <span>{t('Nguồn dữ liệu')}</span>
          <select className="input" required value={selectedSource?.qname || ''} onChange={(event) => onSourceChange(event.target.value)}>
            <option value="">{t('Chọn module và dữ liệu')}</option>
            {sources.map((source) => <option key={source.qname} value={source.qname}>{source.label}</option>)}
          </select>
        </label>
        <label className="field">
          <span>{t('Kiểu kết quả')}</span>
          <select className="input" value={operation} onChange={(event) => onOperationChange(event.target.value)}>
            <option value="rows">{t('Danh sách bản ghi')}</option>
            <option value="count">{t('Đếm bản ghi')}</option>
            <option value="sum">{t('Tổng')}</option>
            <option value="avg">{t('Trung bình')}</option>
            <option value="min">{t('Nhỏ nhất')}</option>
            <option value="max">{t('Lớn nhất')}</option>
          </select>
        </label>
        {operation !== 'rows' && operation !== 'count' && <label className="field">
          <span>{t('Trường số cần tính')}</span>
          <select className="input" required value={field} onChange={(event) => onFieldChange(event.target.value)}>
            <option value="">{t('Chọn trường')}</option>
            {numericFields.map((item) => <option key={item.name} value={item.name}>{item.label || item.name}</option>)}
          </select>
        </label>}
        {operation !== 'rows' && <label className="field">
          <span>{t('Nhóm theo (không bắt buộc)')}</span>
          <select className="input" value={group} onChange={(event) => onGroupChange(event.target.value)}>
            <option value="">{t('Không nhóm')}</option>
            {groupFields.map((item) => <option key={item.name} value={item.name}>{item.label || item.name}</option>)}
          </select>
        </label>}
        <label className="field">
          <span>{t('Tìm kiếm văn bản (không bắt buộc)')}</span>
          <input className="input" value={search} onChange={(event) => onSearchChange(event.target.value)} />
        </label>
        <label className="field">
          <span>{t('Lịch chạy snapshot')}</span>
          <select className="input" value={schedule} onChange={(event) => onScheduleChange(event.target.value)}>
            <option value="">{t('Chạy thủ công')}</option>
            <option value="daily">{t('Hằng ngày')}</option>
            <option value="weekly">{t('Hằng tuần')}</option>
          </select>
          <span className="small muted">{t('Lịch dùng UTC; snapshot tiếp theo chạy sau một chu kỳ.')}</span>
        </label>
        <label className="field">
          <span>{t('Email nhận báo cáo (không bắt buộc)')}</span>
          <textarea className="input" rows="3" value={recipients} onChange={(event) => onRecipientsChange(event.target.value)} placeholder="name@example.com, team@example.com" disabled={!schedule} />
          <span className="small muted">{t('Đính kèm CSV sau mỗi lần chạy theo lịch; cần cấu hình SMTP hoặc email provider.')}</span>
        </label>
        <label className="field">
          <span>{t('Lọc theo trường (không bắt buộc)')}</span>
          <select className="input" value={filter} onChange={(event) => onFilterChange(event.target.value)}>
            <option value="">{t('Không lọc')}</option>
            {sourceFields.filter((item) => item.type !== 'json').map((item) => <option key={item.name} value={item.name}>{item.label || item.name}</option>)}
          </select>
        </label>
        {filter && <label className="field">
          <span>{t('Giá trị lọc chính xác')}</span>
          <input className="input" value={filterValue} onChange={(event) => onFilterValueChange(event.target.value)} />
        </label>}
      </div>
      {!sources.length && <p className="small muted">{t('Bạn chưa có quyền đọc nguồn dữ liệu nào để thiết kế báo cáo.')}</p>}
      <div className="row">
        <button className="btn btn-primary" type="submit" disabled={saving || !selectedSource}>{saving ? t('Đang lưu…') : t('Lưu và chạy báo cáo')}</button>
      </div>
    </form>
  </section>;
}
