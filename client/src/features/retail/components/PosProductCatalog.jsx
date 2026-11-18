import React from 'react';

export default function PosProductCatalog({
  products,
  query,
  quantities,
  selectedUnits,
  units,
  canCreate,
  onQueryChange,
  onScanKeyDown,
  onAddProduct,
  priceFor,
  formatMoney,
  t,
}) {
  return <section className="pos-products-panel">
    <div className="row wrap">
      <h2>{t('Sản phẩm')}</h2>
      <span className="grow" />
      <input
        className="input pos-search"
        type="search"
        placeholder={t('Quét/nhập tên, SKU hoặc mã vạch')}
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={onScanKeyDown}
        aria-label={t('Quét barcode hoặc tìm sản phẩm')}
      />
    </div>
    <p className="small muted">{t('Đặt con trỏ trong ô tìm kiếm rồi quét mã; máy quét gửi Enter để thêm đúng một sản phẩm vào giỏ.')}</p>
    <div className="pos-products">
      {products.map((product) => {
        const uom = selectedUnits[product.id] || product.uom || '';
        return <button
          className={`card pos-product${quantities[product.id] ? ' selected' : ''}`}
          key={product.id}
          type="button"
          disabled={!canCreate}
          onClick={() => onAddProduct(product.id)}
        >
          <strong>{product.name}</strong>
          <span className="small muted">{product.sku || t('Không mã')}</span>
          <span className="num">{formatMoney(priceFor(product, uom))}{units.get(uom)?.name ? ` / ${units.get(uom).name}` : ''}</span>
          {product.tracked !== false && <span className="small faint">{t('Quản lý tồn kho')}</span>}
        </button>;
      })}
    </div>
    {!products.length && <div className="empty">{t('Không có sản phẩm phù hợp.')}</div>}
  </section>;
}
