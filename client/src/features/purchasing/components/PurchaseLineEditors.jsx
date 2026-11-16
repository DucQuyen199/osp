import React from 'react';
import { fmtMoney, uiText } from '../../../lib/i18n.js';

export function RequisitionLinesEditor({ lines, products, unitsFor, onProductChange, onChange, onRemove }) {
  const activeProducts = [...products.values()].filter((row) => row.active !== false);

  return lines.map((line, index) => <div className="row wrap" key={index} data-inline-style="inline-43a97fe494">
    <select className="select" required aria-label={`${uiText('Sản phẩm đề nghị dòng')} ${index + 1}`} value={line.product} onChange={(event) => onProductChange(index, event.target.value)}>
      <option value="">{uiText('Chọn hàng hóa')}</option>
      {activeProducts.map((row) => <option key={row.id} value={row.id}>{row.name}{row.sku ? ` · ${row.sku}` : ''}</option>)}
    </select>
    <select className="select" aria-label={`${uiText('Đơn vị đề nghị dòng')} ${index + 1}`} value={line.uom || products.get(line.product)?.uom || ''} onChange={(event) => onChange(index, 'uom', event.target.value)}>
      <option value="">{uiText('Chọn đơn vị')}</option>
      {unitsFor(line.product).map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
    </select>
    <input className="input num" aria-label={uiText('Số lượng cần mua')} type="number" min="0.000001" step="any" required value={line.qty} onChange={(event) => onChange(index, 'qty', event.target.value)} data-inline-style="inline-5e96948257"/>
    <span className="grow"/>
    {lines.length > 1 && <button className="btn btn-ghost btn-sm" type="button" aria-label={uiText('Xóa dòng đề nghị')} onClick={() => onRemove(index)}>{uiText('Bỏ')}</button>}
  </div>);
}

export function PurchaseOrderLinesEditor({ lines, products, unitsFor, taxes, taxById, onUpdate, onRemove, lineValue }) {
  const activeProducts = [...products.values()].filter((row) => row.active !== false);

  return lines.map((line, index) => <div className="row wrap" key={index} data-inline-style="inline-43a97fe494">
    <select className="select" required aria-label={`${uiText('Sản phẩm đặt mua dòng')} ${index + 1}`} value={line.product} onChange={(event) => onUpdate(index, 'product', event.target.value)}>
      <option value="">{uiText('Chọn hàng')}</option>
      {activeProducts.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
    </select>
    {unitsFor(line.product).length > 0 && <select className="select" aria-label={`${uiText('Đơn vị mua dòng')} ${index + 1}`} value={line.uom || products.get(line.product)?.uom || ''} onChange={(event) => onUpdate(index, 'uom', event.target.value)}>
      {unitsFor(line.product).map((unit) => <option key={unit.id} value={unit.id}>{unit.name}{unit.base_uom ? ` · ${unit.ratio} × ${uiText('đơn vị gốc')}` : ` · ${uiText('đơn vị gốc')}`}</option>)}
    </select>}
    <input className="input num" aria-label={`${uiText('Số lượng đặt dòng')} ${index + 1}`} type="number" min="0.000001" step="any" required value={line.qty} onChange={(event) => onUpdate(index, 'qty', event.target.value)} data-inline-style="inline-ebb13c75de"/>
    <input className="input num" aria-label={`${uiText('Đơn giá mua dòng')} ${index + 1}`} type="number" min="0.000001" step="any" required value={line.price} onChange={(event) => onUpdate(index, 'price', event.target.value)} data-inline-style="inline-eb9e070a2e"/>
    <select className="select" aria-label={`${uiText('Thuế dòng')} ${index + 1}`} value={line.tax} onChange={(event) => onUpdate(index, 'tax', event.target.value)}>
      <option value="">{uiText('Không thuế')}</option>
      {taxes.map((tax) => <option key={tax.id} value={tax.id}>{tax.name} · {tax.rate}%</option>)}
    </select>
    <strong>{fmtMoney(lineValue(line, taxById))}</strong>
    {lines.length > 1 && <button className="btn btn-ghost btn-sm" type="button" aria-label={`${uiText('Xóa dòng')} ${index + 1}`} onClick={() => onRemove(index)}>{uiText('Bỏ')}</button>}
  </div>);
}
