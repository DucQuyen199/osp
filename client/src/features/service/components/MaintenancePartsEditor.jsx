import React from 'react';

export default function MaintenancePartsEditor({ parts, products, unitsFor, onAdd, onUpdate, onRemove, t }) {
  return <>
    <div className="row wrap u-legacy-0ee7f66ad9" >
      <strong>{t('Vật tư dự kiến')}</strong>
      <span className="grow" />
      <button className="btn btn-secondary btn-sm" type="button" disabled={!products.size} onClick={onAdd}>{t('Thêm vật tư')}</button>
    </div>
    {parts.map((line, index) => <div className="row wrap u-legacy-43a97fe494" key={index} >
      <select className="select" required value={line.product} onChange={(event) => onUpdate(index, 'product', event.target.value)}>
        <option value="">{t('Chọn vật tư')}</option>
        {[...products.values()].filter((row) => row.active !== false && (row.tracked ?? row.kind === 'goods')).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
      </select>
      {unitsFor(line.product).length > 0 && <select className="select" aria-label={t('Đơn vị tính')} value={line.uom || products.get(line.product)?.uom || ''} onChange={(event) => onUpdate(index, 'uom', event.target.value)}>
        {unitsFor(line.product).map((unit) => <option key={unit.id} value={unit.id}>{unit.name}{unit.base_uom ? ` (${unit.ratio} x ${t('cơ sở')})` : ` (${t('cơ sở')})`}</option>)}
      </select>}
      <input className="input num u-legacy-e0e3ddd79d" aria-label={t('Số lượng vật tư')} type="number" min="0.000001" step="any" required value={line.qty} onChange={(event) => onUpdate(index, 'qty', event.target.value)}  />
      <button className="btn btn-ghost btn-sm" type="button" onClick={() => onRemove(index)}>{t('Bỏ')}</button>
    </div>)}
  </>;
}
