import React, { useEffect, useState } from 'react';
import { api, tenantPath } from '../../../lib/api.js';
import { fmtMoney, statusLabel, uiText } from '../../../lib/i18n.js';
import { fieldLabelOf, loadRefs, recordLabel } from '../../../lib/state.js';

export function FieldLines({ qname, value, onChange, priceList, salesOrder, purchaseOrder, inspection }) {
  const discountEnabled = qname.startsWith('sales.') || qname === 'crm.deal';
  const lotEnabled = ['purchasing.purchase_order', 'purchasing.purchase_receipt', 'purchasing.purchase_return'].includes(qname);
  const [products, setProducts] = useState(new Map());
  const [taxes, setTaxes] = useState(new Map());
  const [lots, setLots] = useState(new Map());
  const [preview, setPreview] = useState(null);
  const rows = Array.isArray(value) && value.length ? value : [{}];
  const previewEnabled = ['sales.quotation', 'sales.sales_order', 'sales.sales_return', 'purchasing.purchase_order', 'purchasing.purchase_receipt', 'purchasing.purchase_return'].includes(qname);
  const previewRequest = JSON.stringify({ entity: qname, document: {
    lines: rows, price_list: priceList, sales_order: salesOrder,
    purchase_order: purchaseOrder, inspection,
  } });

  useEffect(() => {
    if (!previewEnabled) { setPreview(null); return undefined; }
    const hasLines = rows.some((row) => row.product || row.qty || row.price);
    if (!hasLines) { setPreview(null); return undefined; }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api(tenantPath('/business/preview'), { method: 'POST', body: JSON.parse(previewRequest), signal: controller.signal })
        .then(setPreview)
        .catch((error) => { if (!controller.signal.aborted) setPreview(null); });
    }, 350);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [previewEnabled, previewRequest]);

  useEffect(() => {
    let active = true;
    const requests = [loadRefs('master-data.product')];
    if (discountEnabled) requests.push(loadRefs('master-data.tax'));
    if (lotEnabled) requests.push(loadRefs('inventory.lot'));
    Promise.all(requests).then((loaded) => {
      if (!active) return;
      setProducts(loaded[0]);
      if (discountEnabled) setTaxes(loaded[1] || new Map());
      if (lotEnabled) setLots(loaded[discountEnabled ? 2 : 1] || new Map());
    });
    return () => { active = false; };
  }, [discountEnabled, lotEnabled]);

  const update = (index, patch) => onChange(rows.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row));
  const remove = (index) => {
    const next = rows.filter((_, rowIndex) => rowIndex !== index);
    onChange(next.length ? next : [{}]);
  };
  const rowClass = discountEnabled ? 'sales-lines-row' : lotEnabled ? 'purchasing-lines-row' : '';
  const headers = discountEnabled
    ? ['Sản phẩm', 'Số lượng', 'Đơn giá', 'CK (%)', 'Thuế', '']
    : lotEnabled ? ['Sản phẩm', 'Số lượng', 'Đơn giá', 'Lô', ''] : ['Sản phẩm', 'Số lượng', 'Đơn giá', ''];

  return <div className="lines">
    <div className={`lines-row lines-head${rowClass ? ` ${rowClass}` : ''}`} aria-hidden="true">{headers.map((header) => <span key={header}>{uiText(header)}</span>)}</div>
    {rows.map((row, index) => {
      const productLots = [...lots.values()].filter((lot) => !row.product || lot.product === row.product);
      return <div key={row.id || index} className={`lines-row${rowClass ? ` ${rowClass}` : ''}`}>
        <select className="select" aria-label={`${uiText('Sản phẩm')} ${uiText('dòng')} ${index + 1}`} value={row.product || ''}
          onChange={(event) => {
            const product = event.target.value || undefined;
            const selected = products.get(product);
            update(index, { product, ...(!row.price && selected?.price ? { price: Number(selected.price) } : {}) });
          }}>
          <option value="">{uiText('— Chọn sản phẩm —')}</option>
          {[...products.values()].map((product) => <option key={product.id} value={product.id}>{product.name}{product.sku ? ` (${product.sku})` : ''}</option>)}
        </select>
        <input className="input num" type="number" min="0" step="any" value={row.qty ?? ''} aria-label={`${uiText('Số lượng')} ${uiText('dòng')} ${index + 1}`}
          onChange={(event) => update(index, { qty: event.target.value === '' ? undefined : Number(event.target.value) })} />
        <input className="input num" type="number" min="0" step="any" value={row.price ?? ''} aria-label={`${uiText('Đơn giá')} ${uiText('dòng')} ${index + 1}`}
          onChange={(event) => update(index, { price: event.target.value === '' ? undefined : Number(event.target.value) })} />
        {discountEnabled && <>
          <input className="input num" type="number" min="0" max="100" step="0.01" value={row.discount_pct ?? 0} aria-label={`${uiText('Chiết khấu (%)')} ${uiText('dòng')} ${index + 1}`}
            onChange={(event) => update(index, { discount_pct: event.target.value === '' ? 0 : Number(event.target.value) })} />
          <select className="select" aria-label={`${uiText('Thuế')} ${uiText('dòng')} ${index + 1}`} value={row.tax || ''}
            onChange={(event) => update(index, { tax: event.target.value || undefined })}>
            <option value="">{uiText('Không thuế')}</option>
            {[...taxes.values()].map((tax) => <option key={tax.id} value={tax.id}>{tax.name} ({Number(tax.rate) || 0}%)</option>)}
          </select>
        </>}
        {lotEnabled && <select className="select" aria-label={`${uiText('Lô hàng')} ${uiText('dòng')} ${index + 1}`} value={row.lot || ''}
          onChange={(event) => update(index, { lot: event.target.value || undefined })}>
          <option value="">{uiText('Không chọn lô')}</option>
          {productLots.map((lot) => <option key={lot.id} value={lot.id}>{lot.code}{lot.expiry ? ` · ${lot.expiry}` : ''}</option>)}
        </select>}
        <button className="btn btn-ghost btn-icon btn-sm" type="button" aria-label={`${uiText('Xóa')} ${uiText('dòng')} ${index + 1}`} onClick={() => remove(index)}>×</button>
      </div>;
    })}
    <div className="lines-foot">
      <button className="btn btn-sm" type="button" onClick={() => onChange([...rows, {}])}>{uiText('Thêm dòng')}</button>
      <span>{uiText('Tạm tính')}: <strong className="num">{preview ? fmtMoney(preview.total) : '—'}</strong></span>
    </div>
  </div>;
}

export function InventoryLines({ value, countMode, onChange, fromWarehouse, toWarehouse }) {
  const [products, setProducts] = useState(new Map());
  const [lots, setLots] = useState(new Map());
  const [locations, setLocations] = useState(new Map());
  const rows = Array.isArray(value) && value.length ? value : [{}];

  useEffect(() => {
    let active = true;
    Promise.all([loadRefs('master-data.product'), loadRefs('inventory.lot'), loadRefs('inventory.warehouse_location')]).then(([productMap, lotMap, locationMap]) => {
      if (active) { setProducts(productMap); setLots(lotMap); setLocations(locationMap); }
    });
    return () => { active = false; };
  }, []);

  const update = (index, patch) => onChange(rows.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row));
  const remove = (index) => {
    const next = rows.filter((_, rowIndex) => rowIndex !== index);
    onChange(next.length ? next : [{}]);
  };
  return <div className="lines">
    <div className={`lines-row lines-head ${countMode ? 'inventory-count-row' : 'inventory-transfer-row'}`} aria-hidden="true">
      {(countMode ? ['Sản phẩm', 'Số lượng thực tế', 'Lô hàng', 'Vị trí', ''] : ['Sản phẩm', 'Số lượng', 'Lô hàng', 'Vị trí xuất', 'Vị trí nhận', '']).map((header) => <span key={header}>{uiText(header)}</span>)}
    </div>
    {rows.map((row, index) => <div key={row.id || index} className={`lines-row ${countMode ? 'inventory-count-row' : 'inventory-transfer-row'}`}>
      <select className="select" aria-label={`${uiText('Sản phẩm')} ${uiText('dòng')} ${index + 1}`} value={row.product || ''} onChange={(event) => update(index, { product: event.target.value || undefined })}>
        <option value="">{uiText('Select product')}</option>
        {[...products.values()].map((product) => <option key={product.id} value={product.id}>{product.name}{product.sku ? ` (${product.sku})` : ''}</option>)}
      </select>
      <input className="input num" type="number" min="0" step="any" value={countMode ? (row.counted_qty ?? row.qty ?? '') : (row.qty ?? '')}
        aria-label={`${uiText(countMode ? 'Số lượng thực tế' : 'Số lượng')} ${uiText('dòng')} ${index + 1}`}
        onChange={(event) => update(index, { [countMode ? 'counted_qty' : 'qty']: event.target.value === '' ? undefined : Number(event.target.value) })} />
      <select className="select" aria-label={`${uiText('Lô hàng')} ${uiText('dòng')} ${index + 1}`} value={row.lot || ''} onChange={(event) => update(index, { lot: event.target.value || undefined })}>
        <option value="">{uiText('No lot')}</option>
        {[...lots.values()].filter((lot) => !row.product || lot.product === row.product).map((lot) => <option key={lot.id} value={lot.id}>{lot.code}{lot.expiry ? ` · ${lot.expiry}` : ''}</option>)}
      </select>
      {countMode && <select className="select" aria-label={`Vị trí kiểm kê dòng ${index + 1}`} value={row.location || ''} disabled={!fromWarehouse} onChange={(event) => update(index, { location: event.target.value || undefined })}>
        <option value="">{uiText('Bin chưa gán')}</option>
        {[...locations.values()].filter((location) => location.warehouse === fromWarehouse && location.active !== false).map((location) => <option key={location.id} value={location.id}>{location.code} · {location.name}</option>)}
      </select>}
      {!countMode && <>
        <select className="select" aria-label={`Vị trí xuất dòng ${index + 1}`} value={row.from_location || ''} disabled={!fromWarehouse} onChange={(event) => update(index, { from_location: event.target.value || undefined })}>
          <option value="">{uiText('Không chỉ định vị trí xuất')}</option>
          {[...locations.values()].filter((location) => location.warehouse === fromWarehouse && location.active !== false).map((location) => <option key={location.id} value={location.id}>{location.code} · {location.name}</option>)}
        </select>
        <select className="select" aria-label={`Vị trí nhận dòng ${index + 1}`} value={row.to_location || ''} disabled={!toWarehouse} onChange={(event) => update(index, { to_location: event.target.value || undefined })}>
          <option value="">{uiText('Không chỉ định vị trí nhận')}</option>
          {[...locations.values()].filter((location) => location.warehouse === toWarehouse && location.active !== false).map((location) => <option key={location.id} value={location.id}>{location.code} · {location.name}</option>)}
        </select>
      </>}
      <button className="btn btn-ghost btn-icon btn-sm" type="button" aria-label={`${uiText('Xóa dòng')} ${index + 1}`} onClick={() => remove(index)}>×</button>
    </div>)}
    <div className="lines-foot"><button className="btn btn-sm" type="button" onClick={() => onChange([...rows, {}])}>{uiText('Thêm dòng')}</button></div>
  </div>;
}

export function AccountingJournalLines({ value, onChange }) {
  const [accounts, setAccounts] = useState(new Map());
  const [departments, setDepartments] = useState(new Map());
  const rows = Array.isArray(value) && value.length ? value : [{}];

  useEffect(() => {
    let active = true;
    Promise.all([loadRefs('accounting.account'), loadRefs('hrm.department')]).then(([accountMap, departmentMap]) => {
      if (active) { setAccounts(accountMap); setDepartments(departmentMap); }
    });
    return () => { active = false; };
  }, []);

  const update = (index, patch) => onChange(rows.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row));
  const remove = (index) => {
    const next = rows.filter((_, rowIndex) => rowIndex !== index);
    onChange(next.length ? next : [{}]);
  };
  const headers = ['account', 'department', 'debit', 'credit'].map((name) => fieldLabelOf('accounting.journal_entry', name));
  return <div className="lines">
    <div className="lines-row lines-head accounting-journal-row" aria-hidden="true">{headers.map((header) => <span key={header}>{header}</span>)}</div>
    {rows.map((row, index) => <div key={row.id || index} className="lines-row accounting-journal-row">
      <select className="select" aria-label={`${uiText('Tài khoản')} ${uiText('dòng')} ${index + 1}`} value={row.account || ''}
        onChange={(event) => update(index, { account: event.target.value || undefined })}>
        <option value="">{uiText('— Chọn tài khoản —')}</option>
        {[...accounts.values()].map((account) => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}
      </select>
      <select className="select" aria-label={`${uiText('Phòng ban dòng')} ${index + 1}`} value={row.department || ''}
        onChange={(event) => update(index, { department: event.target.value || undefined })}>
        <option value="">{uiText('Chưa phân bổ')}</option>
        {[...departments.values()].map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
      </select>
      <input className="input num" type="number" min="0" step="any" value={row.debit ?? ''} aria-label={`${uiText('Nợ dòng')} ${index + 1}`}
        onChange={(event) => update(index, { debit: event.target.value === '' ? undefined : Number(event.target.value) })} />
      <input className="input num" type="number" min="0" step="any" value={row.credit ?? ''} aria-label={`${uiText('Có dòng')} ${index + 1}`}
        onChange={(event) => update(index, { credit: event.target.value === '' ? undefined : Number(event.target.value) })} />
      <button className="btn btn-ghost btn-icon btn-sm" type="button" aria-label={`${uiText('Xóa dòng')} ${index + 1}`} onClick={() => remove(index)}>×</button>
    </div>)}
    <div className="lines-foot"><button className="btn btn-sm" type="button" onClick={() => onChange([...rows, {}])}>{uiText('Thêm dòng')}</button></div>
  </div>;
}
