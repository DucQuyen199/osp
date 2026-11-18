import React from 'react';

export default function BillOfMaterialsSection({
  boms,
  products,
  units,
  unitsFor,
  editingBom,
  product,
  outputQty,
  components,
  busy,
  canCreate,
  canUpdate,
  onSubmit,
  onProductChange,
  onOutputQtyChange,
  onComponentChange,
  onAddComponent,
  onRemoveComponent,
  onReset,
  onEdit,
  t,
}) {
  return <div className="manufacturing-bom-area">
    {(canCreate || canUpdate) && <form className="manufacturing-form" onSubmit={onSubmit}>
      <h3>{editingBom ? t('Sửa BOM') : t('Tạo BOM')}</h3>
      <label className="field"><span>{t('Thành phẩm *')}</span><select className="select" required value={product} disabled={Boolean(editingBom)} onChange={(event) => onProductChange(event.target.value)}><option value="">{t('Chọn thành phẩm')}</option>{[...products.values()].filter((row) => row.active !== false && row.kind !== 'service').map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
      <label className="field"><span>{t('Sản lượng định mức *')}</span><input className="input num" type="number" min="0.000001" step="any" required value={outputQty} onChange={(event) => onOutputQtyChange(event.target.value)} /></label>
      <div className="manufacturing-lines"><h4>{t('Nguyên vật liệu')}</h4>{components.map((component, index) => {
        const options = unitsFor(component.product);
        return <div className="manufacturing-line" key={component.rowId}>
          <select className="select" required aria-label={`${t('Vật tư')} BOM ${index + 1}`} value={component.product} onChange={(event) => onComponentChange(index, 'product', event.target.value)}><option value="">{t('Chọn vật tư')}</option>{[...products.values()].filter((row) => row.active !== false && row.kind !== 'service').map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select>
          <input className="input num" type="number" min="0.000001" step="any" aria-label={`${t('Số lượng')} ${t('Vật tư')} ${index + 1}`} required value={component.qty} onChange={(event) => onComponentChange(index, 'qty', event.target.value)} />
          {options.length > 1 && <select className="select" aria-label={`${t('Vật tư')} ${t('đơn vị gốc')} ${index + 1}`} value={component.uom || products.get(component.product)?.uom || ''} onChange={(event) => onComponentChange(index, 'uom', event.target.value)}>{options.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}{unit.base_uom ? ` · ${unit.ratio} × ${t('đơn vị gốc')}` : ` · ${t('đơn vị gốc')}`}</option>)}</select>}
          {components.length > 1 && <button className="btn btn-ghost btn-sm" type="button" onClick={() => onRemoveComponent(index)}>{t('Bỏ')}</button>}
        </div>;
      })}<button className="btn btn-secondary btn-sm" type="button" onClick={onAddComponent}>{t('Thêm vật tư')}</button></div>
      <div className="row wrap"><button className="btn btn-primary" type="submit" disabled={busy === 'bom' || !(editingBom ? canUpdate : canCreate)}>{busy === 'bom' ? t('Đang lưu…') : editingBom ? t('Lưu BOM') : t('Tạo BOM')}</button>{editingBom && <button className="btn btn-ghost" type="button" onClick={onReset}>{t('Hủy sửa')}</button>}</div>
    </form>}
    <div className="manufacturing-bom-list">{boms.map((bom) => <article className="manufacturing-bom-card" key={bom.id}><div><strong>{products.get(bom.product)?.name || bom.product}</strong><span className="small muted"> · {bom.output_qty || 1} {t('Thành phẩm')} / {t('BOM')}</span><div className="small muted">{(bom.components || []).map((item) => `${products.get(item.product)?.name || t('Vật tư')} ${item.qty} ${units.get(item.uom)?.name || ''}`).join(' · ')}</div></div>{canUpdate && <button className="btn btn-ghost btn-sm" type="button" onClick={() => onEdit(bom)}>{t('Sửa')}</button>}</article>)}{!boms.length && <div className="empty">{t('Chưa có BOM. Tạo định mức trước khi lập lệnh sản xuất.')}</div>}</div>
  </div>;
}
