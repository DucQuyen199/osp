import React from 'react';
import { uiText } from '../../../lib/i18n.js';

export default function StockCountLinesEditor({
  lines,
  matchingProducts,
  products,
  units,
  lots,
  locations,
  warehouse,
  productSearch,
  onProductSearchChange,
  onAddLine,
  onUpdateLine,
  onRemoveLine,
  unitForProduct,
}) {
  const activeLocations = [...locations.values()].filter((row) => row.warehouse === warehouse && row.active !== false);

  return <>
    <div className="row wrap" style={{ margin: '16px 0 8px' }}>
      <h3>{uiText('Dòng đếm thực tế')}</h3><span className="grow" />
      <input className="input" style={{ maxWidth: 260 }} type="search" value={productSearch}
        onChange={(event) => onProductSearchChange(event.target.value)}
        placeholder={uiText('Tìm SKU hoặc sản phẩm')} aria-label={uiText('Tìm sản phẩm')} />
      <button className="btn btn-secondary btn-sm" type="button" onClick={onAddLine}>{uiText('Thêm dòng')}</button>
    </div>
    <div className="table-wrap"><table className="table">
      <thead><tr><th>{uiText('Sản phẩm')}</th><th>{uiText('Lô')}</th><th>{uiText('Vị trí')}</th><th>{uiText('Số lượng thực tế (đơn vị gốc)')}</th><th scope="col">{uiText('Thao tác')}</th></tr></thead>
      <tbody>{lines.map((line, index) => {
        const product = products.get(line.product);
        const productLots = [...lots.values()].filter((row) => row.product === line.product);
        const productOptions = product && !matchingProducts.some((row) => row.id === product.id) ? [product, ...matchingProducts] : matchingProducts;
        return <tr key={line.rowId}>
          <td><select className="select" aria-label={`${uiText('Sản phẩm')} ${uiText('dòng')} ${index + 1}`} required value={line.product} onChange={(event) => onUpdateLine(line.rowId, 'product', event.target.value)}>
            <option value="">{uiText('Chọn sản phẩm…')}</option>{productOptions.map((row) => <option key={row.id} value={row.id}>{row.sku} · {row.name} · {units.get(row.uom)?.name || (row.uom ? uiText('đơn vị gốc') : uiText('chưa đặt đơn vị'))}{row.lot_tracked ? ` · ${uiText('theo lô')}` : ''}</option>)}
          </select></td>
          <td><select className="select" aria-label={`${uiText('Lô')} ${uiText('dòng')} ${index + 1}`} value={line.lot} required={Boolean(product?.lot_tracked)} disabled={!product?.lot_tracked} onChange={(event) => onUpdateLine(line.rowId, 'lot', event.target.value)}>
            <option value="">{product?.lot_tracked ? uiText('Chọn lô…') : uiText('Không áp dụng')}</option>{productLots.map((row) => <option key={row.id} value={row.id}>{row.code}{row.expiry ? ` · ${uiText('HSD')} ${row.expiry}` : ''}</option>)}
          </select></td>
          <td><select className="select" aria-label={`${uiText('Vị trí')} ${uiText('dòng')} ${index + 1}`} value={line.location} disabled={!warehouse} onChange={(event) => onUpdateLine(line.rowId, 'location', event.target.value)}>
            <option value="">{uiText('Không gán vị trí')}</option>{activeLocations.map((row) => <option key={row.id} value={row.id}>{row.code} · {row.name}</option>)}
          </select></td>
          <td><div><input className="input num" aria-label={`${uiText('Số lượng thực tế')} ${uiText('dòng')} ${index + 1} (${unitForProduct(line.product)})`} type="number" min="0" step="0.000001" required value={line.counted_qty} onChange={(event) => onUpdateLine(line.rowId, 'counted_qty', event.target.value)} placeholder="0" /><span className="small muted">{unitForProduct(line.product)}</span></div></td>
          <td><button className="btn btn-ghost btn-sm" type="button" disabled={lines.length <= 1} onClick={() => onRemoveLine(line.rowId)} aria-label={`${uiText('Xóa dòng')} ${index + 1}`}>{uiText('Xóa')}</button></td>
        </tr>;
      })}</tbody>
    </table></div>
  </>;
}
