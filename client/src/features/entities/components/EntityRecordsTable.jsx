import React from 'react';
import { recordHref } from '../../../lib/routes.js';
import { entityLabel, fieldLabelOf, recordLabel } from '../../../lib/state.js';
import { fmtDate, fmtDateTime, fmtMoney, fmtNumber, statusLabel, tone, uiText } from '../../../lib/i18n.js';

function FieldValue({ field, record, definition, refs }) {
  const value = record[field.name];
  if (value == null || value === '') return <span className="faint">—</span>;
  if (field.type === 'money') {
    const currencyId = record.currency;
    const currency = refs['master-data.currency']?.get(currencyId);
    return <span className="num">{fmtMoney(value, currency?.code)}</span>;
  }
  if (field.type === 'number') return <span className="num">{fmtNumber(value)}</span>;
  if (field.type === 'date') return fmtDate(value);
  if (field.type === 'datetime') return fmtDateTime(value);
  if (field.type === 'bool') return <span className={`badge plain ${value ? 'success' : ''}`}>{uiText(value ? 'Có' : 'Không')}</span>;
  if (field.type === 'enum') {
    const label = statusLabel(value);
    return field.name === 'status' || definition.states?.field === field.name
      ? <span className={`badge ${tone(value)}`}>{label}</span>
      : label;
  }
  if (field.type === 'ref') {
    const target = refs[field.ref]?.get(value);
    const targetName = target ? recordLabel(field.ref, target) : `#${String(value).slice(0, 8)}`;
    return <a href={recordHref(field.ref, value)} onClick={(event) => event.stopPropagation()}>{targetName}</a>;
  }
  if (field.type === 'json') return Array.isArray(value) ? `${value.length} dòng` : '{…}';
  if (field.type === 'text') {
    const text = String(value);
    return text.length > 80 ? `${text.slice(0, 80)}…` : text;
  }
  return String(value);
}

export default function EntityRecordsTable({
  qname,
  definition,
  columns,
  rows,
  refs,
  selectable,
  selectedIds,
  allRowsSelected,
  busy,
  onTogglePage,
  onToggleRow,
  onOpenRecord,
}) {
  return <div className="table-wrap">
    <table className="table">
      <caption className="sr-only">{uiText('Danh sách')} {uiText(entityLabel(qname)).toLowerCase()}</caption>
      <thead><tr>
        {selectable && <th scope="col"><input className="bulk-select" type="checkbox" aria-label={uiText('Chọn tất cả bản ghi trên trang')} checked={allRowsSelected} disabled={busy} onChange={onTogglePage} /></th>}
        {columns.map((field) => <th key={field.name} scope="col" className={['money', 'number'].includes(field.type) ? 'right' : ''}>{uiText(fieldLabelOf(qname, field.name))}</th>)}
        {columns.length === 0 && <th scope="col">{uiText('Mở bản ghi')}</th>}
      </tr></thead>
      <tbody>{rows.map((record) => <tr key={record.id} className="clickable" onClick={() => onOpenRecord(record)}>
        {selectable && <td><input className="bulk-select" type="checkbox" aria-label={`${uiText('Chọn')} ${uiText(recordLabel(qname, record))}`} checked={selectedIds.has(record.id)} disabled={busy} onClick={(event) => event.stopPropagation()} onChange={() => onToggleRow(record.id)} /></td>}
        {columns.length === 0 && <td><a href={recordHref(qname, record.id)} aria-label={`${uiText('Mở bản ghi')} ${record.id}`} onClick={(event) => event.stopPropagation()}>{String(record.id).slice(0, 8)}</a></td>}
        {columns.map((field, index) => <td key={field.name} className={['money', 'number'].includes(field.type) ? 'right' : ''}>
          {index === 0 && field.type !== 'ref'
            ? <a href={recordHref(qname, record.id)} onClick={(event) => event.stopPropagation()}><FieldValue field={field} record={record} definition={definition} refs={refs} /></a>
            : <FieldValue field={field} record={record} definition={definition} refs={refs} />}
        </td>)}
      </tr>)}</tbody>
    </table>
  </div>;
}
