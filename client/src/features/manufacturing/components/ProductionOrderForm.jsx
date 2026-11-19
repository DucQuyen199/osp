export default function ProductionOrderForm({
  boms,
  products,
  warehouses,
  workCenters,
  units,
  accounts,
  values,
  lotTracked,
  busy,
  t,
  onChange,
  onSubmit,
}) {
  return <form className="manufacturing-form manufacturing-order-form" onSubmit={onSubmit}>
    <h3>{t('Lập lệnh sản xuất')}</h3>
    <label className="field"><span>{t('BOM *')}</span><select className="select" required value={values.bom} onChange={(event) => onChange('bom', event.target.value)}><option value="">{t('Chọn BOM')}</option>{boms.map((bom) => <option key={bom.id} value={bom.id}>{products.get(bom.product)?.name || bom.product}</option>)}</select></label>
    <label className="field"><span>{t('Số lượng *')}</span><input className="input num" type="number" min="0.000001" step="any" required value={values.qty} onChange={(event) => onChange('qty', event.target.value)}/></label>
    <label className="field"><span>{t('Kho xuất / nhập *')}</span><select className="select" required value={values.warehouse} onChange={(event) => onChange('warehouse', event.target.value)}><option value="">{t('Chọn kho')}</option>{[...warehouses.values()].filter((warehouse) => warehouse.active !== false).map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select></label>
    <label className="field"><span>{t('Trung tâm sản xuất')}</span><select className="select" value={values.center} onChange={(event) => onChange('center', event.target.value)}><option value="">{t('Không lập lịch trung tâm')}</option>{[...workCenters.values()].map((center) => <option key={center.id} value={center.id}>{center.name}{center.capacity_per_day ? ` · ${center.capacity_per_day} ${units.get(center.capacity_uom)?.name || t('chưa đặt đơn vị')}/${t('ngày')}` : ''}</option>)}</select><span className="hint">{t('Công suất trung tâm được gắn với một đơn vị gốc; thành phẩm lập lịch phải dùng đúng đơn vị đó.')}</span></label>
    {values.center && <label className="field"><span>{t('Ngày dự kiến bắt đầu *')}</span><input className="input" type="date" required value={values.date} onChange={(event) => onChange('date', event.target.value)}/></label>}
    {lotTracked && <label className="field"><span>{t('Mã lô thành phẩm *')}</span><input className="input" required maxLength="120" value={values.outputLot} onChange={(event) => onChange('outputLot', event.target.value)}/></label>}
    {lotTracked && <label className="field"><span>{t('Hạn dùng thành phẩm')}</span><input className="input" type="date" value={values.outputExpiry} onChange={(event) => onChange('outputExpiry', event.target.value)}/></label>}
    <label className="field"><span>{t('Hạch toán phế phẩm')}</span><select className="select" value={values.scrapMethod} onChange={(event) => onChange('scrapMethod', event.target.value)}><option value="absorb">{t('Phân bổ vào giá thành phẩm đạt')}</option><option value="expense">{t('Ghi nhận chi phí bất thường')}</option></select></label>
    {values.scrapMethod === 'expense' && <label className="field"><span>{t('Tài khoản chi phí phế phẩm *')}</span><select className="select" required value={values.scrapAccount} onChange={(event) => onChange('scrapAccount', event.target.value)}><option value="">{t('Chọn tài khoản chi phí')}</option>{[...accounts.values()].filter((account) => account.kind === 'expense').map((account) => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}</select></label>}
    <button className="btn btn-primary" type="submit" disabled={busy === 'order' || !values.bom || !values.warehouse}>{busy === 'order' ? t('Đang lập lệnh…') : t('Tạo lệnh')}</button>
  </form>;
}
