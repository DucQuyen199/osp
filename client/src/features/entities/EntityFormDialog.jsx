import React, { useEffect, useMemo, useRef, useState } from 'react';
import { localDateTime as businessDateTime, localDateTimeToIso } from '../../lib/dates.js';
import { ApiError, api, dataPath, tenantPath } from '../../lib/api.js';
import { toast } from '../../lib/feedback.js';
import { fmtMoney, statusLabel, uiText } from '../../lib/i18n.js';
import {
  entity, entityLabel, fieldLabelOf, invalidateRefs, loadRefs, recordLabel,
} from '../../lib/state.js';
import { listHref } from '../../lib/routes.js';

const SYSTEM_MANAGED_FIELDS = {
  'events.event': ['ticket_tax_rate', 'ticket_tax_name'],
  'events.ticket': ['price', 'tax_rate', 'tax_name', 'tax_amount', 'net_amount'],
  'accounting.payment': ['tax_rate', 'tax_name', 'tax_amount'],
};

function toLocalInput(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return businessDateTime(date);
}

function FieldLines({ qname, value, onChange, priceList, salesOrder, purchaseOrder, inspection }) {
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

function InventoryLines({ value, countMode, onChange, fromWarehouse, toWarehouse }) {
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

function AccountingJournalLines({ value, onChange }) {
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

export default function EntityFormDialog({ qname, record, onClose, onSaved }) {
  const definition = entity(qname);
  const editing = Boolean(record);
  const dialog = useRef(null);
  const inputRefs = useRef({});
  const fields = useMemo(() => definition?.fields.filter((field) => field.name !== definition.states?.field && !definition.computed[field.name] && !field.system) || [], [definition]);
  const computed = definition?.fields.filter((field) => definition.computed[field.name]) || [];
  const [values, setValues] = useState(() => Object.fromEntries(fields.map((field) => [field.name, record?.[field.name]])));
  const [references, setReferences] = useState({});
  const [errors, setErrors] = useState({});
  const [generalErrors, setGeneralErrors] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const node = dialog.current;
    if (node && !node.open) node.showModal();
    node?.querySelector('input:not([type=checkbox]), select, textarea')?.focus();
    return () => { if (node?.open) node.close(); };
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([...new Set(fields.filter((field) => field.type === 'ref').map((field) => field.ref))]
      .map(async (ref) => [ref, await loadRefs(ref)]))
      .then((entries) => { if (active) setReferences(Object.fromEntries(entries)); });
    return () => { active = false; };
  }, [fields]);

  const close = () => { dialog.current?.close(); onClose?.(); };
  const setValue = (name, value) => setValues((current) => ({ ...current, [name]: value }));
  const clearErrors = () => { setErrors({}); setGeneralErrors([]); };
  const showErrors = (messages) => {
    const fieldErrors = {};
    const otherErrors = [];
    for (const message of messages) {
      const field = fields.find((candidate) => new RegExp(`(^|[:;\\s])${candidate.name}(\\s|:|$)`).test(message));
      if (field) fieldErrors[field.name] = message.replace(new RegExp(`\\b${field.name}\\b`), fieldLabelOf(qname, field.name));
      else otherErrors.push(message);
    }
    setErrors(fieldErrors);
    setGeneralErrors(otherErrors.length ? otherErrors : (messages.length && !Object.keys(fieldErrors).length ? messages : []));
    const first = fields.find((field) => fieldErrors[field.name]);
    if (first) inputRefs.current[first.name]?.focus();
  };

  const fieldValue = (field) => {
    if (field.type === 'datetime') return toLocalInput(values[field.name]);
    if (field.type === 'json' && !(field.name === 'lines'
      || field.name === 'adjustment_lines'
      || (field.name === 'lines' && qname === 'inventory.stock_transfer'))) {
      const value = values[field.name];
      return value == null ? '' : typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    }
    return values[field.name] ?? (field.type === 'bool' ? false : '');
  };

  const readField = (field) => {
    const value = values[field.name];
    if (field.type === 'number' || field.type === 'money') return value === '' || value == null ? undefined : Number(value);
    if (field.type === 'datetime') {
      if (!value) return undefined;
      const instant = localDateTimeToIso(value);
      if (!instant) throw new Error(`${fieldLabelOf(qname, field.name)}: giờ không hợp lệ trong múi giờ kinh doanh`);
      return instant;
    }
    if (field.type === 'json') {
      if (field.name === 'lines') {
        const rows = Array.isArray(value) ? value : [];
        if (qname === 'accounting.journal_entry') {
          const populated = rows.filter((row) => row.account || row.debit || row.credit);
          return populated.length ? populated : undefined;
        }
        const populated = rows.filter((row) => row.product || row.qty || row.price);
        return populated.length ? populated : undefined;
      }
      if (field.name === 'adjustment_lines') {
        const rows = Array.isArray(value) ? value : [];
        const populated = rows.filter((row) => row.product || row.counted_qty || row.qty || row.lot || row.location || row.direction);
        return populated.length ? populated : undefined;
      }
      if (value == null || value === '') return undefined;
      try { return typeof value === 'string' ? JSON.parse(value) : value; }
      catch { throw new Error(`${fieldLabelOf(qname, field.name)}: không phải JSON hợp lệ`); }
    }
    if (field.type === 'bool') return Boolean(value);
    if (field.type === 'string' || field.type === 'text') return String(value || '').trim() || undefined;
    return value === '' || value == null ? undefined : value;
  };

  const save = async (event) => {
    event.preventDefault();
    clearErrors();
    const payload = {};
    try {
      for (const field of fields) {
        if (SYSTEM_MANAGED_FIELDS[qname]?.includes(field.name)) continue;
        const value = readField(field);
        if (editing) payload[field.name] = value === undefined ? null : value;
        else if (value !== undefined) payload[field.name] = value;
      }
    } catch (reason) {
      showErrors([reason.message]);
      return;
    }
    setSaving(true);
    try {
      const saved = editing
        ? await api(dataPath(qname, record.id), { method: 'PATCH', body: payload })
        : await api(dataPath(qname), { method: 'POST', body: payload });
      invalidateRefs(qname);
      toast(editing ? 'Đã lưu thay đổi.' : `Đã tạo ${entityLabel(qname).toLowerCase()}.`, 'success');
      dialog.current?.close();
      onSaved?.(saved);
    } catch (reason) {
      if (reason instanceof ApiError && Array.isArray(reason.details)) showErrors(reason.details);
      else showErrors([reason.message || 'Không lưu được dữ liệu.']);
    } finally {
      setSaving(false);
    }
  };

  const renderControl = (field) => {
    const id = `entity-field-${field.name}`;
    const common = {
      id,
      ref: (node) => { inputRefs.current[field.name] = node; },
      'aria-invalid': errors[field.name] ? 'true' : undefined,
      'aria-describedby': errors[field.name] ? `${id}-error` : undefined,
    };
    if (field.type === 'bool') return <label className="check" htmlFor={id}>
      <input {...common} type="checkbox" checked={Boolean(values[field.name])} onChange={(event) => setValue(field.name, event.target.checked)} />
      {fieldLabelOf(qname, field.name)}
    </label>;
    if (field.type === 'json' && (field.name === 'adjustment_lines' || (field.name === 'lines' && qname === 'inventory.stock_transfer')))
      return <div {...common}><InventoryLines value={values[field.name]} countMode={field.name === 'adjustment_lines'} fromWarehouse={field.name === 'adjustment_lines' ? values.warehouse : values.from_warehouse} toWarehouse={values.to_warehouse} onChange={(value) => setValue(field.name, value.length ? value : undefined)} /></div>;
    if (field.type === 'json' && field.name === 'lines' && qname === 'accounting.journal_entry')
      return <div {...common}><AccountingJournalLines value={values[field.name]} onChange={(value) => setValue(field.name, value.length ? value : undefined)} /></div>;
    if (field.type === 'json' && field.name === 'lines')
      return <div {...common}><FieldLines qname={qname} value={values[field.name]} onChange={(value) => setValue(field.name, value.length ? value : undefined)}
        priceList={values.price_list} salesOrder={values.sales_order} purchaseOrder={values.purchase_order} inspection={values.inspection} /></div>;
    if (field.type === 'enum') return <select {...common} className="select" value={values[field.name] ?? ''} onChange={(event) => setValue(field.name, event.target.value || undefined)}>
      <option value="">{field.required ? '— Chọn —' : '— Không chọn —'}</option>
      {(field.options || []).map((option) => <option key={option} value={option}>{statusLabel(option)}</option>)}
    </select>;
    if (field.type === 'ref') return <>
      <select {...common} className="select" value={values[field.name] ?? ''} onChange={(event) => setValue(field.name, event.target.value || undefined)}>
        <option value="">{field.required ? '— Chọn —' : '— Không chọn —'}</option>
        {[...(references[field.ref]?.values() || [])].map((item) => <option key={item.id} value={item.id}>{recordLabel(field.ref, item)}</option>)}
      </select>
      <div className="hint"><a href={listHref(field.ref)}>Quản lý {entityLabel(field.ref).toLowerCase()}</a></div>
    </>;
    if (field.type === 'json') return <textarea {...common} className="textarea mono" value={fieldValue(field)} placeholder="[] hoặc {}" spellCheck="false" onChange={(event) => setValue(field.name, event.target.value)} />;
    if (field.type === 'text') return <textarea {...common} className="textarea" value={values[field.name] ?? ''} onChange={(event) => setValue(field.name, event.target.value)} />;
    const types = { date: 'date', datetime: 'datetime-local', number: 'number', money: 'number' };
    return <input {...common} className={['number', 'money'].includes(field.type) ? 'input num' : 'input'}
      type={field.name === 'email' ? 'email' : types[field.type] || 'text'}
      step={['number', 'money'].includes(field.type) ? 'any' : undefined}
      inputMode={['number', 'money'].includes(field.type) ? 'decimal' : undefined}
      autoComplete={field.name === 'email' ? 'email' : 'off'}
      value={fieldValue(field)} onChange={(event) => setValue(field.name, event.target.value)} />;
  };

  const title = `${uiText(editing ? 'Sửa' : 'Tạo')} ${uiText(entityLabel(qname)).toLowerCase()}`;
  return <dialog ref={dialog} className="drawer" aria-labelledby="entity-form-title" onCancel={(event) => { event.preventDefault(); close(); }}>
    <form className="drawer-form" noValidate onSubmit={save}>
      <header className="drawer-head">
        <div><h2 id="entity-form-title">{title}</h2><p className="faint">{uiText(definition.label)}</p></div>
        <button className="btn btn-ghost btn-icon" type="button" aria-label={uiText('Đóng')} onClick={close}>×</button>
      </header>
      <div className="drawer-body stack">
        {generalErrors.length > 0 && <div className="alert danger" role="alert"><strong>{uiText('Chưa lưu được')}</strong><ul>{generalErrors.map((message, index) => <li key={index}>{uiText(message)}</li>)}</ul></div>}
        <div className="form-grid">
          {fields.filter((field) => !SYSTEM_MANAGED_FIELDS[qname]?.includes(field.name)).map((field) => <div key={field.name} className={`field${['text', 'json'].includes(field.type) ? ' full' : ''}`}>
            {field.type === 'bool' ? renderControl(field) : <>
              <label htmlFor={`entity-field-${field.name}`}>{uiText(fieldLabelOf(qname, field.name))}{field.required && <><span className="req" aria-hidden="true">*</span><span className="sr-only"> ({uiText('bắt buộc')})</span></>}</label>
              {renderControl(field)}
            </>}
            {errors[field.name] && <div className="error-text" id={`entity-field-${field.name}-error`}>{uiText(errors[field.name])}</div>}
          </div>)}
        </div>
        {computed.length > 0 && <p className="hint">{uiText('Tự tính')}: {computed.map((field) => uiText(fieldLabelOf(qname, field.name))).join(', ')}.</p>}
      </div>
      <footer className="drawer-foot">
        <button className="btn" type="button" disabled={saving} onClick={close}>{uiText('Hủy')}</button>
        <button className="btn btn-primary" type="submit" disabled={saving}>{saving ? uiText('Đang lưu…') : editing ? uiText('Lưu thay đổi') : uiText('Tạo mới')}</button>
      </footer>
    </form>
  </dialog>;
}




