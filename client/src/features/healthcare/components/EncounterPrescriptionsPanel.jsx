import React from 'react';

export default function EncounterPrescriptionsPanel({
  prescriptions, products, units, warehouses, unitsFor, encounterOpen, encounterCompleted,
  warehouseId, items, busy, canCreate, canDispense, onDispense, onWarehouseChange,
  onItemChange, onAddItem, onRemoveItem, onSubmit, recordLabel, statusLabel, t,
}) {
  return <article className="card clinic-record">
    <h3>{t('Đơn thuốc')}</h3>
    {prescriptions.map((prescription) => <div className="clinic-linked-record" key={prescription.id}>
      <div><strong>{prescription.items?.length || 0} loại thuốc · {statusLabel(prescription.status)}</strong>
        <div className="small muted">{prescription.items?.map((item) => `${products.get(item.product)?.name || t('Thuốc')} × ${item.qty} ${item.uom_name || units.get(item.uom)?.name || ''}${item.dosage ? ` · ${item.dosage}` : ''}`).join('; ')}</div>
      </div>
      {prescription.status === 'draft' && <button className="btn btn-primary btn-sm" type="button"
        disabled={busy || !encounterCompleted || !canDispense} onClick={() => onDispense(prescription)}
      >{t('Phát thuốc')}</button>}
    </div>)}
    {encounterOpen && canCreate && <form className="clinic-rx-form" onSubmit={onSubmit}>
      <div className="clinic-inline-fields"><label className="field"><span className="label">{t('Kho cấp phát *')}</span>
        <select className="select" required value={warehouseId} onChange={(event) => onWarehouseChange(event.target.value)}>
          <option value="">{t('Chọn kho')}</option>
          {[...warehouses.values()].filter((warehouse) => warehouse.active !== false).map((warehouse) =>
            <option key={warehouse.id} value={warehouse.id}>{recordLabel('inventory.warehouse', warehouse)}</option>)}
        </select>
      </label></div>
      {items.map((item, index) => <div className="clinic-rx-line" key={index}>
        <select className="select" required aria-label={`${t('Thuốc dòng')} ${index + 1}`} value={item.product}
          onChange={(event) => onItemChange(index, { product: event.target.value, uom: '' })}>
          <option value="">{t('Chọn thuốc')}</option>
          {[...products.values()].filter((product) => product.active !== false && (product.kind || 'goods') === 'goods' && product.tracked !== false).map((product) =>
            <option key={product.id} value={product.id}>{product.name}{product.sku ? ` · ${product.sku}` : ''}</option>)}
        </select>
        {unitsFor(item.product).length > 0 && <select className="select" aria-label={`${t('Đơn vị thuốc')} ${index + 1}`}
          value={item.uom || products.get(item.product)?.uom || ''} onChange={(event) => onItemChange(index, { uom: event.target.value })}>
          {unitsFor(item.product).map((unit) => <option key={unit.id} value={unit.id}>{unit.name}{unit.base_uom ? ` · ${unit.ratio} × ${t('đơn vị gốc')}` : ` · ${t('đơn vị gốc')}`}</option>)}
        </select>}
        <input className="input num" required min="0.001" step="any" type="number" aria-label={t('Số lượng')}
          value={item.qty} onChange={(event) => onItemChange(index, { qty: event.target.value})}/>
        <input className="input" required aria-label={t('Liều dùng')} placeholder={t('Liều dùng / hướng dẫn')}
          value={item.dosage} onChange={(event) => onItemChange(index, { dosage: event.target.value})}/>
        <button className="btn btn-ghost btn-sm" type="button" aria-label={`${t('Xóa thuốc')} ${index + 1}`}
          disabled={items.length === 1} onClick={() => onRemoveItem(index)}>{t('×')}</button>
      </div>)}
      <div className="row wrap">
        <button className="btn btn-secondary btn-sm" type="button" onClick={onAddItem}>{t('Thêm thuốc')}</button>
        <button className="btn btn-primary btn-sm" type="submit" disabled={busy || !warehouseId || !canCreate}>{t('Lưu đơn thuốc nháp')}</button>
      </div>
    </form>}
  </article>;
}
