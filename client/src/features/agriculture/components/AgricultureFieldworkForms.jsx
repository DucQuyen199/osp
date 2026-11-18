import React from 'react';
import { recordHref } from '../../../lib/routes.js';

export function AgricultureInputForm({
  cycle, inputKinds, inputKind, inputProduct, inputUom, inputWarehouse, inputQty, inputDate,
  products, warehouses, unitsFor, requiresProduct, pesticideIntervalMissing, busy, canCreate,
  today, onSubmit, onKindChange, onProductChange, onUomChange, onWarehouseChange, onQtyChange, onDateChange,
  recordLabel, t,
}) {
  return <form className="card agriculture-panel" onSubmit={onSubmit}>
    <h3>{t('Ghi vật tư canh tác')}</h3>
    <p className="small muted">{t('Vật tư có mã sản phẩm sẽ ghi xuất kho; nước tưới có thể ghi theo sản lượng vận hành mà không trừ tồn kho.')}</p>
    <label className="field"><span className="label">{t('Loại vật tư *')}</span>
      <select className="select" value={inputKind} onChange={(event) => onKindChange(event.target.value)}>
        {inputKinds.map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
      </select>
    </label>
    <label className="field"><span className="label">{t('Sản phẩm')} {requiresProduct ? '*' : t('(nếu trừ kho)')}</span>
      <select className="select" required={requiresProduct} value={inputProduct} onChange={(event) => onProductChange(event.target.value)}>
        <option value="">{requiresProduct ? t('Chọn vật tư') : t('Không trừ kho')}</option>
        {[...products.values()].filter((product) => product.active !== false && product.kind !== 'service').map((product) =>
          <option key={product.id} value={product.id}>{product.name}{product.sku ? ` · ${product.sku}` : ''}</option>)}
      </select>
    </label>
    {pesticideIntervalMissing && <div className="alert danger" role="alert">
      {t('Hồ sơ sản phẩm chưa có số ngày cách ly.')} <a href={recordHref('master-data.product', inputProduct)}>{t('Mở hồ sơ sản phẩm')}</a> {t('và nhập đúng hướng dẫn trên nhãn trước khi ghi nhật ký.')}
    </div>}
    {unitsFor(inputProduct).length > 0 && <label className="field"><span className="label">{t('Đơn vị ghi nhận')}</span>
      <select className="select" value={inputUom || products.get(inputProduct)?.uom || ''} onChange={(event) => onUomChange(event.target.value)}>
        {unitsFor(inputProduct).map((unit) => <option key={unit.id} value={unit.id}>{unit.name}{unit.base_uom ? ` (${unit.ratio} × ${t('base')})` : ` (${t('base')})`}</option>)}
      </select>
    </label>}
    {inputProduct && <label className="field"><span className="label">{t('Kho xuất *')}</span>
      <select className="select" required value={inputWarehouse} onChange={(event) => onWarehouseChange(event.target.value)}>
        <option value="">{t('Chọn kho')}</option>
        {[...warehouses.values()].map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{recordLabel('inventory.warehouse', warehouse)}</option>)}
      </select>
    </label>}
    <div className="agriculture-form-row">
      <label className="field"><span className="label">{t('Lượng sử dụng *')}</span>
        <input className="input num" type="number" required min="0.001" step="any" value={inputQty} onChange={(event) => onQtyChange(event.target.value)}/>
      </label>
      <label className="field"><span className="label">{t('Ngày sử dụng *')}</span>
        <input className="input" type="date" required min={cycle.planted_on} max={today} value={inputDate} onChange={(event) => onDateChange(event.target.value)}/>
      </label>
    </div>
    <button className="btn btn-secondary" type="submit" disabled={Boolean(busy) || (inputProduct && !inputWarehouse) || pesticideIntervalMissing || !canCreate}>
      {busy === 'input' ? t('Đang ghi…') : t('Ghi nhật ký vật tư')}
    </button>
  </form>;
}

export function AgricultureHarvestForm({
  harvestSafety, legacyPesticideApplications, harvestRestriction, harvestDate, products,
  harvestProduct, harvestUom, harvestWarehouse, harvestQty, harvestGrade, harvestLotCode, harvestExpiry,
  warehouses, unitsFor, busy, canCreate, today, plantedOn, formatDate,
  onSubmit, onProductChange, onUomChange, onWarehouseChange, onQtyChange, onDateChange,
  onGradeChange, onLotCodeChange, onExpiryChange, recordLabel, t,
}) {
  return <form className="card agriculture-panel" onSubmit={onSubmit}>
    <h3>{t('Nhập sản lượng thu hoạch')}</h3>
    <p className="small muted">{t('Ghi phiếu sẽ nhập hàng vào kho. Với sản phẩm quản lý lô, cần nhập mã lô để truy xuất nguồn gốc.')}</p>
    {harvestSafety.unknownProducts.length > 0 && <div className="alert danger" role="alert">
      {t('Chưa xác định được thời gian cách ly cho:')} {harvestSafety.unknownProducts.join(', ')}{t('. Hãy cập nhật hồ sơ sản phẩm và đối chiếu nhãn thuốc trước khi thu hoạch.')}
    </div>}
    {legacyPesticideApplications.length > 0 && harvestSafety.unknownProducts.length === 0 && <div className="alert warning" role="status">
      {t('Một số nhật ký thuốc cũ chưa lưu snapshot thời gian cách ly. Hệ thống đang dùng thông tin hiện tại trên hồ sơ sản phẩm; hãy đối chiếu với nhãn thuốc đã dùng.')}
    </div>}
    {harvestRestriction && <div className={`alert ${harvestDate < harvestRestriction ? 'warning' : 'success'}`} role="status">
      {harvestDate < harvestRestriction
        ? `${t('Thời gian cách ly sau lần phun gần nhất kết thúc')} ${formatDate(harvestRestriction)}${t('. Thu hoạch sớm nhất từ ngày này.')}`
        : `${t('Đã qua thời gian cách ly. Có thể thu hoạch từ')} ${formatDate(harvestRestriction)}.`}
    </div>}
    <label className="field"><span className="label">{t('Nông sản *')}</span>
      <select className="select" required value={harvestProduct} onChange={(event) => onProductChange(event.target.value)}>
        <option value="">{t('Chọn nông sản')}</option>
        {[...products.values()].filter((product) => product.active !== false && product.kind !== 'service').map((product) =>
          <option key={product.id} value={product.id}>{product.name}{product.sku ? ` · ${product.sku}` : ''}{product.lot_tracked ? ` · ${t('Quản lý lô')}` : ''}</option>)}
      </select>
    </label>
    {unitsFor(harvestProduct).length > 0 && <label className="field"><span className="label">{t('Đơn vị ghi nhận')}</span>
      <select className="select" value={harvestUom || products.get(harvestProduct)?.uom || ''} onChange={(event) => onUomChange(event.target.value)}>
        {unitsFor(harvestProduct).map((unit) => <option key={unit.id} value={unit.id}>{unit.name}{unit.base_uom ? ` (${unit.ratio} × ${t('base')})` : ` (${t('base')})`}</option>)}
      </select>
    </label>}
    <label className="field"><span className="label">{t('Kho nhận *')}</span>
      <select className="select" required value={harvestWarehouse} onChange={(event) => onWarehouseChange(event.target.value)}>
        <option value="">{t('Chọn kho')}</option>
        {[...warehouses.values()].map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{recordLabel('inventory.warehouse', warehouse)}</option>)}
      </select>
    </label>
    <div className="agriculture-form-row">
      <label className="field"><span className="label">{t('Sản lượng *')}</span>
        <input className="input num" type="number" required min="0.001" step="any" value={harvestQty} onChange={(event) => onQtyChange(event.target.value)}/>
      </label>
      <label className="field"><span className="label">{t('Ngày thu hoạch *')}</span>
        <input className="input" type="date" required min={plantedOn} max={today} value={harvestDate} onChange={(event) => onDateChange(event.target.value)}/>
      </label>
    </div>
    <div className="agriculture-form-row">
      <label className="field"><span className="label">{t('Phân hạng')}</span>
        <input className="input" value={harvestGrade} onChange={(event) => onGradeChange(event.target.value)} placeholder={t('Ví dụ: Loại 1')}/>
      </label>
      <label className="field"><span className="label">{t('Mã lô')}</span>
        <input className="input" required={Boolean(products.get(harvestProduct)?.lot_tracked)} value={harvestLotCode} onChange={(event) => onLotCodeChange(event.target.value)}/>
      </label>
    </div>
    {products.get(harvestProduct)?.lot_tracked && <label className="field"><span className="label">{t('Hạn dùng')}{products.get(harvestProduct)?.expiry_required ? ' *' : ''}</span>
      <input className="input" type="date" min={harvestDate} required={Boolean(products.get(harvestProduct)?.expiry_required)} value={harvestExpiry} onChange={(event) => onExpiryChange(event.target.value)}/>
    </label>}
    <button className="btn btn-primary" type="submit" disabled={Boolean(busy) || harvestSafety.unknownProducts.length > 0 || Boolean(harvestRestriction && harvestDate < harvestRestriction) || !canCreate}>
      {busy === 'harvest' ? t('Đang nhập kho…') : t('Ghi nhận thu hoạch')}
    </button>
  </form>;
}
