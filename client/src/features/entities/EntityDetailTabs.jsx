import React from 'react';
import { fmtDate, fmtDateTime, fmtMoney, fmtNumber, statusLabel, tone, uiText } from '../../lib/i18n.js';
import { fieldLabelOf, recordLabel } from '../../lib/state.js';
import { recordHref } from '../../lib/routes.js';
import EventTimeline from '../../components/EventTimeline.jsx';

function FieldValue({ qname, field, value, refs, definition, record }) {
  if (value == null || value === '') return <span className="faint">—</span>;
  if (field.type === 'money') {
    const currency = refs['master-data.currency']?.get(record?.currency);
    return <span className="num">{fmtMoney(value, currency?.code)}</span>;
  }
  if (field.type === 'number') return <span className="num">{fmtNumber(value)}</span>;
  if (field.type === 'date') return fmtDate(value);
  if (field.type === 'datetime') return fmtDateTime(value);
  if (field.type === 'bool') return <span className={`badge plain ${value ? 'success' : ''}`}>{uiText(value ? 'Có' : 'Không')}</span>;
  if (field.type === 'enum') {
    return field.name === 'status' || definition.states?.field === field.name
      ? <span className={`badge ${tone(value)}`}>{statusLabel(value)}</span>
      : statusLabel(value);
  }
  if (field.type === 'ref') {
    const related = refs[field.ref]?.get(value);
    return <a href={recordHref(field.ref, value)}>{related ? recordLabel(field.ref, related) : `#${String(value).slice(0, 8)}`}</a>;
  }
  if (field.type === 'json') return <pre className="mono small">{JSON.stringify(value, null, 2)}</pre>;
  if (field.type === 'text') return <span className="pre-wrap">{String(value)}</span>;
  return String(value);
}

export default function EntityDetailTabs({
  qname,
  definition,
  record,
  refs,
  fields,
  tab,
  events,
  currentId,
  error,
  onTabChange,
}) {
  return <>
    <div className="tabs" role="tablist" aria-label={uiText('Thông tin bản ghi')}>
      <button className="tab" type="button" role="tab" aria-selected={tab === 'info'} onClick={() => onTabChange('info')}>{uiText('Thông tin')}</button>
      <button className="tab" type="button" role="tab" aria-selected={tab === 'flow'} onClick={() => onTabChange('flow')}>{uiText('Hệ quả liên mô-đun')}</button>
    </div>
    {error && <div className="alert danger" role="alert">{uiText(error)}</div>}
    {tab === 'info' ? <dl className="dl">{fields.map((field) => <React.Fragment key={field.name}>
      <dt>{uiText(fieldLabelOf(qname, field.name))}</dt>
      <dd><FieldValue qname={qname} field={field} value={record[field.name]} refs={refs} definition={definition} record={record}/></dd>
    </React.Fragment>)}
      <dt>{uiText('Ngày tạo')}</dt><dd>{fmtDateTime(record.createdAt)}</dd>
      <dt>{uiText('Cập nhật')}</dt><dd>{fmtDateTime(record.updatedAt)}</dd>
      <dt>{uiText('Mã')}</dt><dd className="mono small">{record.id}</dd>
    </dl> : <div className="stack">
      <p className="muted">{uiText('Các bước đã chạy từ bản ghi này, gồm cả phản ứng tự động ở những mô-đun khác.')}</p>
      {events ? <EventTimeline events={events} currentId={currentId}/> : <div className="skeleton" data-h="row" aria-label={uiText('Đang tải chuỗi sự kiện')}/>}
    </div>}
  </>;
}
