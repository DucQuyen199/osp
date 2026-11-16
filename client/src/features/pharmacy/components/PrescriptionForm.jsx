import React from 'react';

export default function PrescriptionForm({
  form,
  parties,
  lines,
  products,
  unitsFor,
  recordLabel,
  busy,
  editing,
  canSubmit,
  today,
  t,
  onFormChange,
  onLineChange,
  onAddLine,
  onRemoveLine,
  onSubmit,
  onCancel,
}) {
  return <section className="card card-pad" id="pharmacy-prescription-form">
    <h2>{editing ? t('Chỉnh sửa đơn nháp') : t('Ghi nhận đơn mới')}</h2>
    <form className="form-grid" onSubmit={onSubmit}>
      <label className="field"><span className="label">{t('Số đơn thuốc *')}</span><input className="input" id="pharmacy-prescription-number" required value={form.prescription_no} onChange={(event) => onFormChange('prescription_no', event.target.value)} /></label>
      <label className="field"><span className="label">{t('Khách hàng *')}</span><select className="select" required value={form.party} onChange={(event) => onFormChange('party', event.target.value)}><option value="">{t('Chọn khách hàng')}</option>{[...parties.values()].filter((party) => party.active !== false).map((party) => <option key={party.id} value={party.id}>{recordLabel('master-data.party', party)}</option>)}</select></label>
      <label className="field"><span className="label">{t('Người kê đơn *')}</span><input className="input" required value={form.prescriber} onChange={(event) => onFormChange('prescriber', event.target.value)} /></label>
      <label className="field"><span className="label">{t('Số chứng chỉ hành nghề')}</span><input className="input" value={form.prescriber_license} onChange={(event) => onFormChange('prescriber_license', event.target.value)} /></label>
      <label className="field"><span className="label">{t('Ngày kê *')}</span><input className="input" type="date" max={today} required value={form.issued_at} onChange={(event) => onFormChange('issued_at', event.target.value)} /></label>
      <label className="field"><span className="label">{t('Có hiệu lực đến *')}</span><input className="input" type="date" min={form.issued_at} required value={form.valid_until} onChange={(event) => onFormChange('valid_until', event.target.value)} /></label>
      <div className="field full"><span className="label">{t('Thuốc kê trong đơn *')}</span>
        {lines.map((line, index) => <div className="row wrap u-legacy-8e26c5f7a1" key={index}>
          <select className="select" required aria-label={`${t('Thuốc dòng')} ${index + 1}`} value={line.product} onChange={(event) => onLineChange(index, 'product', event.target.value)}><option value="">{t('Chọn thuốc')}</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name}{product.sku ? ` · ${product.sku}` : ''}</option>)}</select>
          {unitsFor(line.product).length > 0 && <select className="select" aria-label={`${t('Đơn vị thuốc dòng')} ${index + 1}`} value={line.uom || products.find((product) => product.id === line.product)?.uom || ''} onChange={(event) => onLineChange(index, 'uom', event.target.value)}>{unitsFor(line.product).map((unit) => <option key={unit.id} value={unit.id}>{unit.name}{unit.base_uom ? ` (${unit.ratio} × ${t('đơn vị gốc')})` : ` (${t('đơn vị gốc')})`}</option>)}</select>}
          <input className="input" aria-label={`${t('Số lượng dòng')} ${index + 1}`} type="number" min="0.001" step="any" required value={line.qty} onChange={(event) => onLineChange(index, 'qty', event.target.value)} />
          <input className="input" aria-label={`${t('Hướng dẫn sử dụng dòng')} ${index + 1}`} required placeholder={t('Liều dùng / cách dùng')} value={line.dosage} onChange={(event) => onLineChange(index, 'dosage', event.target.value)} />
          <button className="btn btn-ghost btn-sm" type="button" aria-label={`${t('Xóa thuốc dòng')} ${index + 1}`} disabled={lines.length === 1} onClick={() => onRemoveLine(index)}>{t('Bỏ')}</button>
        </div>)}
        <button className="btn btn-secondary btn-sm" type="button" onClick={onAddLine}>{t('Thêm thuốc')}</button>
        {!products.length && <p className="small muted">{t('Chưa có sản phẩm nào được đánh dấu “cần đơn thuốc” trong danh mục.')}</p>}
      </div>
      <label className="field full"><span className="label">{t('Ghi chú')}</span><textarea className="textarea" value={form.notes} onChange={(event) => onFormChange('notes', event.target.value)} /></label>
      <div className="row full"><span className="grow" />{editing && <button className="btn btn-secondary" type="button" disabled={busy} onClick={onCancel}>{t('Hủy chỉnh sửa')}</button>}<button className="btn btn-primary" type="submit" disabled={busy || !canSubmit || !products.length}>{busy ? t('Đang lưu…') : editing ? t('Cập nhật đơn nháp') : t('Lưu đơn nháp')}</button></div>
    </form>
  </section>;
}
