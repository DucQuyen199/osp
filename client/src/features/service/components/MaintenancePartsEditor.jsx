import React from 'react';

export default function MaintenancePartsEditor({ parts, products, unitsFor, onAdd, onUpdate, onRemove }) {
  return <>
    <div className="row wrap" style={{ marginTop: 12 }}>
      <strong>Vật tư dự kiến</strong>
      <span className="grow" />
      <button className="btn btn-secondary btn-sm" type="button" disabled={!products.size} onClick={onAdd}>Thêm vật tư</button>
    </div>
    {parts.map((line, index) => <div className="row wrap" key={index} style={{ marginTop: 8 }}>
      <select className="select" required value={line.product} onChange={(event) => onUpdate(index, 'product', event.target.value)}>
        <option value="">Chọn vật tư</option>
        {[...products.values()].filter((row) => row.active !== false && (row.tracked ?? row.kind === 'goods')).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
      </select>
      {unitsFor(line.product).length > 0 && <select className="select" aria-label="Đơn vị tính" value={line.uom || products.get(line.product)?.uom || ''} onChange={(event) => onUpdate(index, 'uom', event.target.value)}>
        {unitsFor(line.product).map((unit) => <option key={unit.id} value={unit.id}>{unit.name}{unit.base_uom ? ` (${unit.ratio} x cơ sở)` : ' (cơ sở)'}</option>)}
      </select>}
      <input className="input num" aria-label="Số lượng vật tư" type="number" min="0.000001" step="any" required value={line.qty} onChange={(event) => onUpdate(index, 'qty', event.target.value)} style={{ maxWidth: 140 }} />
      <button className="btn btn-ghost btn-sm" type="button" onClick={() => onRemove(index)}>Bỏ</button>
    </div>)}
  </>;
}
