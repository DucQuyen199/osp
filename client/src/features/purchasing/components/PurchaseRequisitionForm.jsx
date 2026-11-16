import React from 'react';
import { RequisitionLinesEditor } from './PurchaseLineEditors.jsx';

export default function PurchaseRequisitionForm({
  editingId,
  form,
  lines,
  suppliers,
  warehouses,
  products,
  unitsFor,
  busy,
  onSubmit,
  onFormChange,
  onAddLine,
  onProductChange,
  onLineChange,
  onRemoveLine,
  onExitEdit,
  label,
  t,
}) {
  return <section className="card card-pad">
    <div className="row wrap">
      <h2>{t(editingId ? 'Sửa đề nghị mua nháp' : 'Đề nghị mua nội bộ')}</h2>
      <span className="grow" />
      {editingId && <button className="btn btn-ghost btn-sm" type="button" onClick={onExitEdit}>{t('Thoát chỉnh sửa')}</button>}
    </div>
    <p className="small muted">{t('Ghi nhu cầu hàng hóa và kho nhận. Sau khi phê duyệt, hệ thống sinh đơn mua nháp có liên kết nguồn; đơn mua vẫn cần giá và phê duyệt riêng trước khi đặt hàng.')}</p>
    <form onSubmit={onSubmit}>
      <div className="form-grid">
        <label className="field"><span className="label">{t('Phương thức mua')} *</span><select className="select" value={form.sourcing_method} onChange={(event) => onFormChange('sourcing_method', event.target.value)}><option value="direct">{t('Mua trực tiếp')}</option><option value="competitive">{t('So sánh báo giá nhà cung cấp')}</option></select></label>
        <label className="field"><span className="label">{t('Nhà cung cấp')} *</span><select className="select" required={form.sourcing_method === 'direct'} disabled={form.sourcing_method === 'competitive'} value={form.supplier} onChange={(event) => onFormChange('supplier', event.target.value)}><option value="">{t('Chọn nhà cung cấp')}</option>{[...suppliers.values()].map((row) => <option key={row.id} value={row.id}>{label('master-data.party', row)}</option>)}</select></label>
        <label className="field"><span className="label">{t('Kho nhận')} *</span><select className="select" required value={form.warehouse} onChange={(event) => onFormChange('warehouse', event.target.value)}><option value="">{t('Chọn kho')}</option>{[...warehouses.values()].filter((row) => row.active !== false).map((row) => <option key={row.id} value={row.id}>{label('inventory.warehouse', row)}</option>)}</select></label>
        <label className="field"><span className="label">{t('Người yêu cầu')}</span><input className="input" maxLength="160" value={form.requested_by} onChange={(event) => onFormChange('requested_by', event.target.value)} /></label>
        <label className="field"><span className="label">{t('Lý do / mục đích')}</span><input className="input" maxLength="500" value={form.reason} onChange={(event) => onFormChange('reason', event.target.value)} /></label>
      </div>
      <div className="row wrap u-legacy-0ee7f66ad9">
        <strong>{t('Danh sách hàng cần mua')}</strong><span className="grow" />
        <button className="btn btn-secondary btn-sm" type="button" disabled={!products.size} onClick={onAddLine}>{t('Thêm dòng')}</button>
      </div>
      <RequisitionLinesEditor lines={lines} products={products} unitsFor={unitsFor} onProductChange={onProductChange} onChange={onLineChange} onRemove={onRemoveLine} />
      <div className="row u-legacy-0ee7f66ad9"><span className="grow" /><button className="btn btn-primary" disabled={Boolean(busy) || !products.size || !warehouses.size}>{t(editingId ? 'Lưu đề nghị nháp' : 'Tạo đề nghị nháp')}</button></div>
    </form>
  </section>;
}
