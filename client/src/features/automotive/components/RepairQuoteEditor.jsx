import React from 'react';
import { repairQuoteLineTotal } from '../domain/repairQuoteTotals.js';

export default function RepairQuoteEditor({
  draft,
  products,
  productChoices,
  warehouses,
  unitsFor,
  unitRatio,
  fmtMoney,
  t,
  busy,
  onDraftChange,
  onLineChange,
  onAddLine,
  onRemoveLine,
  onSubmit,
  onCancel,
}) {
  const needsWarehouse = draft.lines.some((line) => {
    const product = products.get(line.product);
    return product && (product.tracked ?? (product.kind === 'goods'));
  });

  return <form className="workshop-intake card" onSubmit={onSubmit}>
    <header className="workshop-section-head"><div><h3>{t('Điều chỉnh báo giá')}</h3><p className="small muted">{t('Bảng giá sản phẩm hiện tại sẽ được áp dụng khi lưu. Khách cần duyệt báo giá đã cập nhật trước khi sửa chữa.')}</p></div><button type="button" className="btn" onClick={onAddLine} disabled={!productChoices.length}>{t('Thêm dòng')}</button></header>
    <div className="workshop-form">
      <label className="field workshop-complaint"><span>{t('Khách mô tả / yêu cầu')}</span><textarea className="input textarea" value={draft.complaint} onChange={(event) => onDraftChange('complaint', event.target.value)} /></label>
      <label className="field"><span>{t('Kho phụ tùng xuất')}</span><select className="select" required={needsWarehouse} value={draft.warehouseId} onChange={(event) => onDraftChange('warehouseId', event.target.value)}><option value="">{t('Chọn khi có phụ tùng theo dõi tồn')}</option>{[...warehouses.values()].map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    </div>
    <div className="workshop-lines"><div className="workshop-section-head"><h4>{t('Phụ tùng và công việc')}</h4></div>
      {draft.lines.map((line, index) => {
        const product = products.get(line.product);
        return <div className="workshop-line" key={`${line.product}:${index}`}>
          <select className="select" required value={line.product} aria-label={`${t('Phụ tùng / dịch vụ')} ${index + 1}`} onChange={(event) => onLineChange(index, 'product', event.target.value)}><option value="">{t('Chọn phụ tùng / dịch vụ')}</option>{productChoices.map((item) => <option key={item.id} value={item.id}>{item.name} · {fmtMoney(item.price || 0)}</option>)}</select>
          {unitsFor(line.product).length > 0 && <select className="select" aria-label={`${t('Đơn vị tính')} ${index + 1}`} value={line.uom || products.get(line.product)?.uom || ''} onChange={(event) => onLineChange(index, 'uom', event.target.value)}>{unitsFor(line.product).map((unit) => <option key={unit.id} value={unit.id}>{unit.name}{unit.base_uom ? ` (${unit.ratio} × ${t('base')})` : ` (${t('base')})`}</option>)}</select>}
          <input className="input" type="number" min="0.001" step="any" required aria-label={`${t('Số lượng')} ${index + 1}`} value={line.qty} onChange={(event) => onLineChange(index, 'qty', event.target.value)} />
          <strong className="num">{fmtMoney(repairQuoteLineTotal(product?.price, unitRatio(line), line.qty))}</strong>
          <button type="button" className="btn btn-danger" aria-label={`${t('Xóa dòng')} ${index + 1}`} disabled={draft.lines.length === 1} onClick={() => onRemoveLine(index)}>×</button>
        </div>;
      })}
    </div>
    {needsWarehouse && !draft.warehouseId && <p className="small muted">{t('Lệnh có phụ tùng theo dõi tồn kho cần chọn kho trước khi lưu.')}</p>}
    <div className="row wrap"><span className="grow"/><button type="button" className="btn" disabled={Boolean(busy)} onClick={onCancel}>{t('Hủy')}</button><button type="submit" className="btn btn-primary" disabled={Boolean(busy) || (needsWarehouse && !draft.warehouseId) || !draft.lines.length}>{busy ? t('Đang lưu…') : t('Lưu báo giá')}</button></div>
  </form>;
}
