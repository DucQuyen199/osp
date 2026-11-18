import React from 'react';

export default function RestaurantRecipesPanel({
  recipes, products, units, productOptions, ingredientProducts, unitsFor,
  editingId, productId, outputQty, ingredients, busy, canRead, canCreate, canUpdate,
  onSubmit, onReset, onProductChange, onOutputQtyChange, onIngredientChange,
  onAddIngredient, onRemoveIngredient, onEdit, t,
}) {
  if (!canRead) return null;
  return <section className="card restaurant-recipes">
    <header className="restaurant-order-card-head">
      <div><h2>{t('Công thức món')}</h2><p className="small muted">{t('Định lượng nguyên liệu trên một lần nấu; kho trừ theo đơn vị gốc.')}</p></div>
      {canCreate && <button className="btn" type="button" onClick={onReset}>{t('Công thức mới')}</button>}
    </header>
    {(canCreate || canUpdate) && <form onSubmit={onSubmit} className="restaurant-recipe-form">
      <label className="field"><span>{t('Món trong thực đơn *')}</span>
        <select className="select" required value={productId} disabled={Boolean(editingId)} onChange={(event) => onProductChange(event.target.value)}>
          <option value="">{t('Chọn món')}</option>
          {productOptions.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
        </select>
      </label>
      <label className="field"><span>{t('Khẩu phần đầu ra *')}</span>
        <input className="input num" type="number" min="0.000001" step="any" required value={outputQty} onChange={(event) => onOutputQtyChange(event.target.value)}/>
      </label>
      <div className="restaurant-recipe-lines"><h3>{t('Nguyên liệu')}</h3>
        {ingredients.map((line, index) => {
          const lineUnits = unitsFor(line.product);
          return <div className="row wrap" key={line.rowId}>
            <select className="select" required aria-label={`${t('Nguyên liệu')} ${index + 1}`} value={line.product} onChange={(event) => onIngredientChange(index, 'product', event.target.value)}>
              <option value="">{t('Chọn nguyên liệu')}</option>
              {ingredientProducts.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
            </select>
            <input className="input num" type="number" min="0.000001" step="any" required aria-label={`${t('Lượng nguyên liệu')} ${index + 1}`} value={line.qty} onChange={(event) => onIngredientChange(index, 'qty', event.target.value)}/>
            {lineUnits.length > 1 && <select className="select" aria-label={`${t('Đơn vị nguyên liệu')} ${index + 1}`} value={line.uom || products.get(line.product)?.uom || ''} onChange={(event) => onIngredientChange(index, 'uom', event.target.value)}>
              {lineUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}{unit.base_uom ? ` · ${unit.ratio} × ${t('đơn vị gốc')}` : ` · ${t('đơn vị gốc')}`}</option>)}
            </select>}
            {ingredients.length > 1 && <button className="btn" type="button" aria-label={`${t('Xóa nguyên liệu')} ${index + 1}`} onClick={() => onRemoveIngredient(index)}>{t('Bỏ')}</button>}
          </div>;
        })}
        <button className="btn" type="button" onClick={onAddIngredient}>{t('Thêm nguyên liệu')}</button>
      </div>
      <div className="restaurant-actions">
        <button className="btn btn-primary" type="submit" disabled={busy === 'recipe' || !(editingId ? canUpdate : canCreate)}>
          {busy === 'recipe' ? t('Đang lưu…') : editingId ? t('Lưu công thức') : t('Tạo công thức')}
        </button>
        {editingId && <button className="btn" type="button" onClick={onReset}>{t('Hủy sửa')}</button>}
      </div>
    </form>}
    <div className="restaurant-recipe-list">
      {recipes.map((recipe) => <article className="restaurant-recipe-card" key={recipe.id}>
        <div><strong>{products.get(recipe.product)?.name || recipe.product}</strong>
          <span className="small muted"> {recipe.output_qty || 1} {t('đơn vị đầu ra')} · {(recipe.ingredients || []).length} {t('nguyên liệu')}</span>
          <div className="small muted">{(recipe.ingredients || []).map((ingredient) => `${products.get(ingredient.product)?.name || t('Nguyên liệu')} ${ingredient.qty} ${units.get(ingredient.uom)?.name || ''}`).join(' · ')}</div>
        </div>
        {canUpdate && <button className="btn" type="button" onClick={() => onEdit(recipe)}>{t('Sửa')}</button>}
      </article>)}
      {!recipes.length && <p className="small muted">{t('Chưa có công thức nào.')}</p>}
    </div>
  </section>;
}
