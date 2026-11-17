import React, { useEffect, useMemo, useState } from 'react';
import { useDocumentTitle } from '../../lib/useDocumentTitle.js';
import { api, dataPath, tenantPath } from '../../lib/api.js';
import { confirmDialog, toast } from '../../lib/feedback.js';
import EntityFormDialog from './EntityFormDialog.jsx';
import EntityImportDialog from './EntityImportDialog.jsx';
import {
  can, entity, entityLabel, fieldLabelOf, invalidateRefs, listColumns, loadRefs, moduleOf, recordLabel,
} from '../../lib/state.js';
import {
  actionLabel, fmtDate, fmtDateTime, fmtMoney, fmtNumber, statusLabel, tone, uiText,
} from '../../lib/i18n.js';
import { recordHref } from '../../lib/routes.js';
const PAGE_SIZE = 25;
function FieldValue({ qname, field, record, definition, refs }) {
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
    const label = definition.states?.field === field.name || field.name === 'status'
      ? statusLabel(value)
      : statusLabel(value);
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
export default function EntityListPage({ qname }) {
  useDocumentTitle(`${uiText(entityLabel(qname))} · OSP Suite`);
  const definition = entity(qname);
  const module = moduleOf(qname);
  const columns = useMemo(() => (definition ? listColumns(definition) : []), [definition]);
  const [rows, setRows] = useState([]);
  const [refs, setRefs] = useState({});
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [bulkAction, setBulkAction] = useState('');
  useEffect(() => {
    setSelectedIds(new Set());
  }, [qname, page, status, debouncedQuery, reloadKey]);
  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => clearTimeout(timeout);
  }, [query]);
  useEffect(() => {
    const changed = (event) => {
      if (!event.detail || event.detail === qname) setReloadKey((value) => value + 1);
    };
    window.addEventListener('osp:entity-changed', changed);
    return () => window.removeEventListener('osp:entity-changed', changed);
  }, [qname]);
  useEffect(() => {
    if (!definition) return undefined;
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setError('');
    const params = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String(page * PAGE_SIZE),
      sort: 'createdAt',
      dir: 'desc',
    });
    if (definition.states && status) params.set(definition.states.field, status);
    if (debouncedQuery) params.set('q', debouncedQuery);
    const refsToLoad = new Set(columns.filter((field) => field.type === 'ref').map((field) => field.ref));
    if (qname.startsWith('accounting.')) refsToLoad.add('master-data.currency');
    Promise.all([
      api(`${dataPath(qname)}?${params}`, { signal: controller.signal }),
      Promise.all([...refsToLoad].map(async (ref) => [ref, await loadRefs(ref)])),
    ]).then(([result, loadedRefs]) => {
      if (!active) return;
      setRows(result.items);
      setTotal(result.total);
      setRefs(Object.fromEntries(loadedRefs));
    }).catch((reason) => {
      if (active && reason.name !== 'AbortError') setError(reason.message || 'Không tải được danh sách.');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
      controller.abort();
    };
  }, [definition, qname, columns, page, status, debouncedQuery, reloadKey]);
  if (!definition) return <div className="page"><div className="empty">
    <h3>{uiText('Không tìm thấy dữ liệu này')}</h3>
    <p>{uiText('Module có thể chưa được bật cho doanh nghiệp của bạn.')}</p>
    <a className="btn" href="#/">{uiText('Về trang chủ')}</a>
  </div></div>;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const canCreate = !definition.systemManaged && can(`${qname}.create`);
  const selectable = Boolean(definition.states && Object.keys(definition.states.actions).some((action) => can(`${qname}.${action}`)));
  const selectedRows = rows.filter((record) => selectedIds.has(record.id));
  const bulkActions = definition.states && selectedRows.length
    ? Object.entries(definition.states.actions).filter(([action, transition]) =>
      can(`${qname}.${action}`) && selectedRows.every((record) => transition.from.includes(record[definition.states.field])))
    : [];
  const allRowsSelected = rows.length > 0 && rows.every((record) => selectedIds.has(record.id));
  const states = definition.states
    ? [...new Set([definition.states.initial, ...Object.values(definition.states.actions).flatMap((action) => [...action.from, action.to])])]
    : [];
  const create = () => setFormOpen(true);
  const created = (record) => {
      setFormOpen(false);
      setReloadKey((value) => value + 1);
      location.hash = recordHref(qname, record.id);
  };
  const exportCsv = async () => {
    try {
      const response = await api(tenantPath(`/export/${qname.replace('.', '/')}`), { raw: true });
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = `${qname}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (reason) {
      setError(reason.message || 'Không xuất được dữ liệu.');
    }
  };
  const toggleRow = (id) => setSelectedIds((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const togglePage = () => setSelectedIds((current) => {
    const next = new Set(current);
    if (allRowsSelected) rows.forEach((record) => next.delete(record.id));
    else rows.forEach((record) => next.add(record.id));
    return next;
  });
  const runBulkAction = async (action, transition) => {
    if (selectedRows.length > 1 || tone(transition.to) === 'danger') {
      const confirmed = await confirmDialog({
        title: uiText('{action} {count} bản ghi?').replace('{action}', actionLabel(action)).replace('{count}', String(selectedRows.length)),
        message: uiText('Trạng thái sẽ chuyển sang “{status}”. Các mô-đun khác có thể chạy phản ứng theo từng bản ghi; nếu một bản ghi lỗi, cả lô sẽ được hoàn tác.').replace('{status}', statusLabel(transition.to)),
        confirmLabel: actionLabel(action),
        danger: true,
      });
      if (!confirmed) return;
    }
    setBulkAction(action);
    setError('');
    try {
      const result = await api(dataPath(qname, '', `bulk/${action}`), {
        method: 'POST',
        body: { ids: selectedRows.map((record) => record.id) },
      });
      invalidateRefs(qname);
      window.dispatchEvent(new CustomEvent('osp:entity-changed', { detail: qname }));
      setSelectedIds(new Set());
      toast(uiText('Đã xử lý {action}: {count} bản ghi.').replace('{action}', actionLabel(action)).replace('{count}', fmtNumber(result.count)), 'success');
    } catch (reason) {
      setError(reason.message || 'Không xử lý được các bản ghi đã chọn.');
    } finally {
      setBulkAction('');
    }
  };
  return <>
  <div className="page">
    <div className="page-head">
      <div>
        <div className="crumbs"><a href="#/">{uiText('Trang chủ')}</a> / {uiText(module?.name || '')}</div>
        <h1>{uiText(entityLabel(qname))}</h1>
        <p className="sub">{definition.states
          ? `Quy trình: ${statusLabel(definition.states.initial)} → ${[...new Set(Object.values(definition.states.actions).map((action) => statusLabel(action.to)))].join(', ')}`
          : uiText(definition.label)}</p>
      </div>
      <div className="row wrap">
        {can('tenant.export') && <button className="btn" type="button" onClick={exportCsv}>{uiText('Xuất CSV')}</button>}
        {can('tenant.import') && canCreate && <button className="btn" type="button" onClick={() => setImportOpen(true)}>{uiText('Nhập CSV')}</button>}
        {canCreate && <button className="btn btn-primary" type="button" onClick={create}>＋ {uiText('Tạo')} {uiText(entityLabel(qname)).toLowerCase()}</button>}
      </div>
    </div>
    <section className="card" aria-label={`${uiText('Danh sách')} ${uiText(entityLabel(qname)).toLowerCase()}`}>
      <div className="toolbar">
        <label className="search">
          <span className="sr-only">{uiText('Tìm')} {uiText(entityLabel(qname)).toLowerCase()}</span>
          <input className="input" type="search" value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} placeholder={`${uiText('Tìm')} ${uiText(entityLabel(qname)).toLowerCase()}…`} />
        </label>
        {definition.states && <label>
          <span className="sr-only">{uiText('Lọc theo trạng thái')}</span>
          <select className="select" value={status} onChange={(event) => { setStatus(event.target.value); setPage(0); }}>
            <option value="">{uiText('Mọi trạng thái')}</option>
            {states.map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}
          </select>
        </label>}
      </div>
      {selectable && selectedRows.length > 0 && <div className="toolbar" aria-label={uiText('Thao tác hàng loạt')}>
        <span className="muted">{uiText('Đã chọn')} {fmtNumber(selectedRows.length)} {uiText('bản ghi')}</span>
        {bulkActions.map(([action, transition]) => <button key={action} className="btn btn-sm" type="button" disabled={Boolean(bulkAction)} onClick={() => runBulkAction(action, transition)}>
          {bulkAction === action ? uiText('Đang xử lý…') : actionLabel(action)}
        </button>)}
      </div>}
      {error && <div className="alert danger" role="alert">{uiText(error)}</div>}
      {loading ? <div className="skeleton" data-h="row" aria-label={uiText('Đang tải danh sách')} />
        : rows.length === 0 ? <div className="empty">
          <h3>{uiText(total ? 'Không có kết quả khớp' : 'Chưa có dữ liệu')}</h3>
          <p>{uiText(total ? 'Thử từ khóa khác hoặc bỏ bộ lọc.' : 'Chưa có bản ghi nào trong trang này.')}</p>
          {!total && canCreate && <button className="btn btn-primary" type="button" onClick={create}>＋ {uiText('Tạo bản ghi')}</button>}
        </div> : <div className="table-wrap">
          <table className="table">
            <caption className="sr-only">{uiText('Danh sách')} {uiText(entityLabel(qname)).toLowerCase()}</caption>
            <thead><tr>{selectable && <th scope="col"><input className="bulk-select" type="checkbox" aria-label={uiText('Chọn tất cả bản ghi trên trang')} checked={allRowsSelected} disabled={Boolean(bulkAction)} onChange={togglePage} /></th>}{columns.map((field) => <th key={field.name} scope="col" className={['money', 'number'].includes(field.type) ? 'right' : ''}>{uiText(fieldLabelOf(qname, field.name))}</th>)}{columns.length === 0 && <th scope="col">{uiText('Mở bản ghi')}</th>}</tr></thead>
            <tbody>{rows.map((record) => <tr key={record.id} className="clickable" onClick={() => { location.hash = recordHref(qname, record.id); }}>
              {selectable && <td><input className="bulk-select" type="checkbox" aria-label={`${uiText('Chọn')} ${uiText(recordLabel(qname, record))}`} checked={selectedIds.has(record.id)} disabled={Boolean(bulkAction)} onClick={(event) => event.stopPropagation()} onChange={() => toggleRow(record.id)} /></td>}
              {columns.length === 0 && <td><a href={recordHref(qname, record.id)} aria-label={`${uiText('Mở bản ghi')} ${record.id}`} onClick={(event) => event.stopPropagation()}>{String(record.id).slice(0, 8)}</a></td>}
              {columns.map((field, index) => <td key={field.name} className={['money', 'number'].includes(field.type) ? 'right' : ''}>
                {index === 0 && field.type !== 'ref'
                  ? <a href={recordHref(qname, record.id)} onClick={(event) => event.stopPropagation()}><FieldValue qname={qname} field={field} record={record} definition={definition} refs={refs} /></a>
                  : <FieldValue qname={qname} field={field} record={record} definition={definition} refs={refs} />}
              </td>)}
            </tr>)}</tbody>
          </table>
        </div>}
      <div className="pager">
        <span aria-live="polite">{fmtNumber(total)} {uiText('bản ghi')} · {uiText('trang')} {page + 1}/{pages}</span>
        <div className="row">
          <button className="btn btn-sm" type="button" disabled={loading || page === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>{uiText('Trước')}</button>
          <button className="btn btn-sm" type="button" disabled={loading || page >= pages - 1} onClick={() => setPage((value) => value + 1)}>{uiText('Sau')}</button>
        </div>
      </div>
    </section>
  </div>
  {formOpen && <EntityFormDialog qname={qname} onClose={() => setFormOpen(false)} onSaved={created} />}
  {importOpen && <EntityImportDialog qname={qname} onClose={() => setImportOpen(false)} onDone={() => setReloadKey((value) => value + 1)} />}
  </>;
}
