export default function QuotationComposer({
  parties,
  warehouses,
  priceLists,
  activeProducts,
  units,
  selectedUnits,
  quantities,
  party,
  warehouse,
  priceList,
  validUntil,
  shippingAddress,
  note,
  estimate,
  hasLines,
  saving,
  currentDate,
  onPartyChange,
  onWarehouseChange,
  onPriceListChange,
  onValidUntilChange,
  onShippingAddressChange,
  onNoteChange,
  onUnitChange,
  onQuantityChange,
  onSubmit,
  getUnitsFor,
  getPrice,
  recordLabel,
  formatMoney,
  t,
}) {
  return <section className="wholesale-create card">
    <h2>{t('Lập báo giá')}</h2>
    <form onSubmit={onSubmit}>
      <div className="wholesale-form">
        <label className="field">
          <span>{t('Khách hàng / đại lý')}</span>
          <select className="select" required value={party} onChange={(event) => onPartyChange(event.target.value)}>
            <option value="">{t('Chọn khách hàng')}</option>
            {[...parties.values()].map((item) => <option key={item.id} value={item.id}>{recordLabel('master-data.party', item)}</option>)}
          </select>
        </label>
        <label className="field">
          <span>{t('Kho xuất')}</span>
          <select className="select" required value={warehouse} onChange={(event) => onWarehouseChange(event.target.value)}>
            <option value="">{t('Chọn kho')}</option>
            {[...warehouses.values()].map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <label className="field">
          <span>{t('Bảng giá')}</span>
          <select className="select" value={priceList} onChange={(event) => onPriceListChange(event.target.value)}>
            <option value="">{t('Giá bán mặc định')}</option>
            {priceLists.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <label className="field">
          <span>{t('Ngày hết hạn')}</span>
          <input className="input" type="date" min={currentDate} value={validUntil} onChange={(event) => onValidUntilChange(event.target.value)} />
        </label>
        <label className="field wholesale-address">
          <span>{t('Địa chỉ giao hàng')}</span>
          <input className="input" value={shippingAddress} onChange={(event) => onShippingAddressChange(event.target.value)} placeholder={t('Nhập để tạo chuyến giao khi xác nhận đơn')} />
        </label>
        <label className="field wholesale-address">
          <span>{t('Ghi chú')}</span>
          <input className="input" value={note} onChange={(event) => onNoteChange(event.target.value)} />
        </label>
      </div>
      <div className="wholesale-product-grid">
        {activeProducts.map((product) => {
          const unitId = selectedUnits[product.id] || product.uom;
          const productUnits = getUnitsFor(product);
          return <article className="wholesale-product card" key={product.id}>
            <strong>{recordLabel('master-data.product', product)}</strong>
            <span className="num">{formatMoney(getPrice(product, unitId))} / {units.get(unitId)?.name || t('đơn vị')}</span>
            {productUnits.length > 1 && <label className="field">
              <span>{t('Đơn vị bán')}</span>
              <select className="select" value={unitId} onChange={(event) => onUnitChange(product.id, event.target.value)}>
                {productUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}{unit.base_uom ? ` · ${unit.ratio} × ${t('đơn vị gốc')}` : ` · ${t('đơn vị gốc')}`}</option>)}
              </select>
            </label>}
            <label className="field">
              <span>{t('Số lượng')}</span>
              <input className="input" type="number" min="0" step="any" value={quantities[product.id] || ''} onChange={(event) => onQuantityChange(product.id, event.target.value)} />
            </label>
          </article>;
        })}
      </div>
      <div className="wholesale-estimate"><span>{t('Tạm tính theo bảng giá, chưa gồm thuế')}</span><strong className="num">{formatMoney(estimate)}</strong></div>
      <button className="btn btn-primary" type="submit" disabled={saving || !party || !warehouse || !hasLines}>{saving ? t('Đang tạo…') : t('Lưu báo giá nháp')}</button>
    </form>
  </section>;
}
