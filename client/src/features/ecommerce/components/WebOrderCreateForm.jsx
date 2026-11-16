import React from 'react';
import { recordLabel } from '../../../lib/state.js';

export default function WebOrderCreateForm({
  storefronts,
  parties,
  filteredProducts,
  quantities,
  cartLines,
  storefront,
  party,
  channel,
  address,
  query,
  busy,
  onStorefrontChange,
  onPartyChange,
  onChannelChange,
  onAddressChange,
  onQueryChange,
  onSetQuantity,
  onSubmit,
  t,
}) {
  return <section className="card ecommerce-create"><header><h2>{t('Tạo giỏ hàng / nhận đơn')}</h2><p className="small muted">{t('Tạo giỏ để máy chủ áp dụng đúng giá và thuế; sau đó kiểm tra tổng tiền trước khi xác nhận đặt.')}</p></header><form className="ecommerce-create-form" onSubmit={onSubmit}>
    <label className="field"><span className="label">{t('Gian hàng *')}</span><select className="select" required value={storefront} onChange={(event) => onStorefrontChange(event.target.value)}><option value="">{t('Chọn gian hàng')}</option>{[...storefronts.values()].map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    <label className="field"><span className="label">{t('Khách hàng *')}</span><select className="select" required value={party} onChange={(event) => onPartyChange(event.target.value)}><option value="">{t('Chọn khách hàng')}</option>{[...parties.values()].filter((item) => item.active !== false && item.is_customer !== false).map((item) => <option key={item.id} value={item.id}>{recordLabel('master-data.party', item)}</option>)}</select></label>
    <label className="field"><span className="label">{t('Kênh')}</span><select className="select" value={channel} onChange={(event) => onChannelChange(event.target.value)}><option value="web">Website</option><option value="app">{t('Ứng dụng')}</option><option value="marketplace">{t('Sàn thương mại')}</option></select></label>
    <label className="field"><span className="label">{t('Địa chỉ giao hàng')}</span><input className="input" value={address} onChange={(event) => onAddressChange(event.target.value)} /></label>
    <div className="ecommerce-product-picker"><div className="row wrap"><h3>{t('Sản phẩm')}</h3><span className="grow" /><input className="input" type="search" placeholder={t('Tìm sản phẩm')} value={query} onChange={(event) => onQueryChange(event.target.value)} /></div><div className="ecommerce-products">{filteredProducts.map((product) => <button key={product.id} type="button" className={`card ecommerce-product${quantities[product.id] ? ' selected' : ''}`} onClick={() => onSetQuantity(product.id, (Number(quantities[product.id]) || 0) + 1)}><strong>{product.name}</strong><span className="small muted">{product.sku || ''}</span><span>{quantities[product.id] ? `${t('Đã chọn ·')} ${quantities[product.id]}` : t('Thêm vào giỏ')}</span></button>)}</div></div>
    {cartLines.length > 0 && <div className="ecommerce-cart-lines">{cartLines.map(({ product, qty }) => <div className="ecommerce-cart-line" key={product.id}><span>{product.name}</span><input className="input num" type="number" min="0.001" step="any" aria-label={`${t('Số lượng')} ${product.name}`} value={qty} onChange={(event) => onSetQuantity(product.id, event.target.value)} /><button className="btn btn-ghost btn-sm" type="button" onClick={() => onSetQuantity(product.id, 0)}>{t('Xóa')}</button></div>)}</div>}
    <button className="btn btn-primary" type="submit" disabled={Boolean(busy) || !cartLines.length}>{busy === 'create' ? t('Đang tạo…') : t('Tạo giỏ và tính giá')}</button>
  </form></section>;
}
