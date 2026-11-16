import React, { useEffect, useMemo, useRef, useState } from 'react';
import { localDateTime as businessDateTime, localDateTimeToIso } from '../../lib/dates.js';
import { ApiError, api, dataPath } from '../../lib/api.js';
import { toast } from '../../lib/feedback.js';
import { statusLabel, uiText } from '../../lib/i18n.js';
import {
  entity, entityLabel, fieldLabelOf, invalidateRefs, loadRefs, recordLabel,
} from '../../lib/state.js';
import { listHref } from '../../lib/routes.js';
import { AccountingJournalLines, FieldLines, InventoryLines } from './components/EntityLineEditors.jsx';

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
      toast(editing ? uiText('Đã lưu thay đổi.') : uiText('Đã tạo {entity}.').replace('{entity}', uiText(entityLabel(qname).toLowerCase())), 'success');
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
      <option value="">{field.required ? uiText('— Chọn —') : uiText('— Không chọn —')}</option>
      {(field.options || []).map((option) => <option key={option} value={option}>{statusLabel(option)}</option>)}
    </select>;
    if (field.type === 'ref') return <>
      <select {...common} className="select" value={values[field.name] ?? ''} onChange={(event) => setValue(field.name, event.target.value || undefined)}>
        <option value="">{field.required ? uiText('— Chọn —') : uiText('— Không chọn —')}</option>
        {[...(references[field.ref]?.values() || [])].map((item) => <option key={item.id} value={item.id}>{recordLabel(field.ref, item)}</option>)}
      </select>
      <div className="hint"><a href={listHref(field.ref)}>Quản lý {entityLabel(field.ref).toLowerCase()}</a></div>
    </>;
    if (field.type === 'json') return <textarea {...common} className="textarea mono" value={fieldValue(field)} placeholder={uiText('[] hoặc {}')} spellCheck="false" onChange={(event) => setValue(field.name, event.target.value)} />;
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




