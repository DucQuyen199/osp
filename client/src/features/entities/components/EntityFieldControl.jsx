import React from 'react';
import { listHref } from '../../../lib/routes.js';
import { entityLabel, fieldLabelOf, recordLabel } from '../../../lib/state.js';
import { statusLabel, uiText } from '../../../lib/i18n.js';
import { AccountingJournalLines, FieldLines, InventoryLines } from './EntityLineEditors.jsx';

export default function EntityFieldControl({
  qname,
  field,
  displayValue,
  references,
  values,
  error,
  inputRef,
  onChange,
}) {
  const id = `entity-field-${field.name}`;
  const common = {
    id,
    ref: inputRef,
    'aria-invalid': error ? 'true' : undefined,
    'aria-describedby': error ? `${id}-error` : undefined,
  };
  if (field.type === 'bool') return <label className="check" htmlFor={id}>
    <input {...common} type="checkbox" checked={Boolean(values[field.name])} onChange={(event) => onChange(field.name, event.target.checked)} />
    {uiText(fieldLabelOf(qname, field.name))}
  </label>;
  if (field.type === 'json' && (field.name === 'adjustment_lines' || (field.name === 'lines' && qname === 'inventory.stock_transfer')))
    return <div {...common}><InventoryLines value={values[field.name]} countMode={field.name === 'adjustment_lines'} fromWarehouse={field.name === 'adjustment_lines' ? values.warehouse : values.from_warehouse} toWarehouse={values.to_warehouse} onChange={(next) => onChange(field.name, next.length ? next : undefined)} /></div>;
  if (field.type === 'json' && field.name === 'lines' && qname === 'accounting.journal_entry')
    return <div {...common}><AccountingJournalLines value={values[field.name]} onChange={(next) => onChange(field.name, next.length ? next : undefined)} /></div>;
  if (field.type === 'json' && field.name === 'lines')
    return <div {...common}><FieldLines qname={qname} value={values[field.name]} onChange={(next) => onChange(field.name, next.length ? next : undefined)}
      priceList={values.price_list} salesOrder={values.sales_order} purchaseOrder={values.purchase_order} inspection={values.inspection} /></div>;
  if (field.type === 'enum') return <select {...common} className="select" value={values[field.name] ?? ''} onChange={(event) => onChange(field.name, event.target.value || undefined)}>
    <option value="">{field.required ? uiText('— Chọn —') : uiText('— Không chọn —')}</option>
    {(field.options || []).map((option) => <option key={option} value={option}>{statusLabel(option)}</option>)}
  </select>;
  if (field.type === 'ref') return <>
    <select {...common} className="select" value={values[field.name] ?? ''} onChange={(event) => onChange(field.name, event.target.value || undefined)}>
      <option value="">{field.required ? uiText('— Chọn —') : uiText('— Không chọn —')}</option>
      {[...(references[field.ref]?.values() || [])].map((item) => <option key={item.id} value={item.id}>{recordLabel(field.ref, item)}</option>)}
    </select>
    <div className="hint"><a href={listHref(field.ref)}>{uiText('Quản lý')} {uiText(entityLabel(field.ref).toLowerCase())}</a></div>
  </>;
  if (field.type === 'json') return <textarea {...common} className="textarea mono" value={displayValue} placeholder={uiText('[] hoặc {}')} spellCheck="false" onChange={(event) => onChange(field.name, event.target.value)} />;
  if (field.type === 'text') return <textarea {...common} className="textarea" value={values[field.name] ?? ''} onChange={(event) => onChange(field.name, event.target.value)} />;
  const types = { date: 'date', datetime: 'datetime-local', number: 'number', money: 'number' };
  return <input {...common} className={['number', 'money'].includes(field.type) ? 'input num' : 'input'}
    type={field.name === 'email' ? 'email' : types[field.type] || 'text'}
    step={['number', 'money'].includes(field.type) ? 'any' : undefined}
    inputMode={['number', 'money'].includes(field.type) ? 'decimal' : undefined}
    autoComplete={field.name === 'email' ? 'email' : 'off'}
    value={displayValue} onChange={(event) => onChange(field.name, event.target.value)} />;
}
