import React from 'react';
import { PurchaseOrderLinesEditor } from './PurchaseLineEditors.jsx';

export default function PurchaseOrderDraftForm({
  editingId,
  form,
  lines,
  suppliers,
  warehouses,
  products,
  unitsFor,
  taxes,
  taxById,
  total,
  busy,
  onSubmit,
  onFormChange,
  onAddLine,
  onLineChange,
  onRemoveLine,
  onExitEdit,
  lineValue,
  formatMoney,
  label,
  t,
}) {
  return <section className="card card-pad">
    <div className="row wrap">
      <h2>{t(editingId ? 'Sửa đơn mua nháp' : 'Lập đơn mua trực tiếp')}</h2>
      <span className="grow" />
      {editingId && <button className="btn btn-ghost btn-sm" type="button" onClick={onExitEdit}>{t('Thoát chỉnh sửa')}</button>}
    </div>
    <form onSubmit={onSubmit}>
      <div className="form-grid">
        <label className="field"><span className="label">{t('Nhà cung cấp *')}</span><select className="select" required value={form.supplier} onChange={(event) => onFormChange('supplier', event.target.value)}><option value="">{t('Chọn nhà cung cấp')}</option>{[...suppliers.values()].map((row) => <option key={row.id} value={row.id}>{label('master-data.party', row)}</option>)}</select></label>
        <label className="field"><span className="label">{t('Kho nhận *')}</span><select className="select" required value={form.warehouse} onChange={(event) => onFormChange('warehouse', event.target.value)}><option value="">{t('Chọn kho')}</option>{[...warehouses.values()].filter((row) => row.active !== false).map((row) => <option key={row.id} value={row.id}>{label('inventory.warehouse', row)}</option>)}</select></label>
        <label className="field"><span className="label">{t('Ngày giao dự kiến')}</span><input className="input" type="date" value={form.expected_date} onChange={(event) => onFormChange('expected_date', event.target.value)} /></label>
      </div>
      <div className="row wrap u-legacy-c53ea1da23"><strong>{t('Vật tư / hàng hóa')}</strong><span className="grow" /><button className="btn btn-secondary btn-sm" type="button" disabled={!products.size} onClick={onAddLine}>{t('Thêm dòng')}</button></div>
      <PurchaseOrderLinesEditor lines={lines} products={products} unitsFor={unitsFor} taxes={taxes} taxById={taxById} onUpdate={onLineChange} onRemove={onRemoveLine} lineValue={lineValue} />
      <div className="row wrap u-legacy-0ee7f66ad9"><span className="grow" /><strong>{t('Tổng dự kiến có thuế:')} {formatMoney(total)}</strong><button className="btn btn-primary" disabled={Boolean(busy) || !products.size || !warehouses.size || total <= 0}>{t(editingId ? 'Lưu đơn mua nháp' : 'Tạo đơn mua nháp')}</button></div>
    </form>
  </section>;
}
