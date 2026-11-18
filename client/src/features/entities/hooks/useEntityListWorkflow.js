import { useEffect, useMemo, useState } from 'react';
import { api, dataPath, tenantPath } from '../../../lib/api.js';
import { confirmDialog, toast } from '../../../lib/feedback.js';
import { actionLabel, fmtNumber, statusLabel, tone, uiText } from '../../../lib/i18n.js';
import { recordHref } from '../../../lib/routes.js';
import { can, invalidateRefs, loadRefs } from '../../../lib/state.js';

const PAGE_SIZE = 25;

export function useEntityListWorkflow({ qname, definition, columns }) {
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

  useEffect(() => { setSelectedIds(new Set()); }, [qname, page, status, debouncedQuery, reloadKey]);
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
      limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE), sort: 'createdAt', dir: 'desc',
    });
    if (definition.states && status) params.set(definition.states.field, status);
    if (debouncedQuery) params.set('q', debouncedQuery);
    const refsToLoad = new Set(columns.filter((field) => field.type === 'ref').map((field) => field.ref));
    if (qname.startsWith('accounting.')) refsToLoad.add('master-data.currency');
    for (const ref of refsToLoad) if (!can(`${ref}.read`)) refsToLoad.delete(ref);
    Promise.all([
      api(`${dataPath(qname)}?${params}`, { signal: controller.signal }),
      Promise.all([...refsToLoad].map(async (ref) => [ref, await loadRefs(ref).catch(() => new Map())])),
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
    return () => { active = false; controller.abort(); };
  }, [definition, qname, columns, page, status, debouncedQuery, reloadKey]);

  const selectedRows = useMemo(() => rows.filter((record) => selectedIds.has(record.id)), [rows, selectedIds]);
  const allRowsSelected = rows.length > 0 && rows.every((record) => selectedIds.has(record.id));
  const bulkActions = definition?.states && selectedRows.length
    ? Object.entries(definition.states.actions).filter(([action, transition]) =>
      can(`${qname}.${action}`)
      && !(qname === 'accounting.journal_entry' && ['posted', 'rejected'].includes(action))
      && !(qname === 'accounting.journal_entry' && action === 'submitted' && selectedRows.some((record) => record.source))
      && selectedRows.every((record) => transition.from.includes(record[definition.states.field])))
    : [];

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
    } catch (reason) { setError(reason.message || 'Không xuất được dữ liệu.'); }
  };
  const toggleRow = (id) => setSelectedIds((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
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
        confirmLabel: actionLabel(action), danger: true,
      });
      if (!confirmed) return;
    }
    setBulkAction(action);
    setError('');
    try {
      const result = await api(dataPath(qname, '', `bulk/${action}`), {
        method: 'POST', body: { ids: selectedRows.map((record) => record.id) },
      });
      invalidateRefs(qname);
      window.dispatchEvent(new CustomEvent('osp:entity-changed', { detail: qname }));
      setSelectedIds(new Set());
      toast(uiText('Đã xử lý {action}: {count} bản ghi.').replace('{action}', actionLabel(action)).replace('{count}', fmtNumber(result.count)), 'success');
    } catch (reason) {
      setError(reason.message || 'Không xử lý được các bản ghi đã chọn.');
    } finally { setBulkAction(''); }
  };

  return {
    rows, refs, total, query, setQuery, status, setStatus, page, setPage,
    loading, error, formOpen, setFormOpen, importOpen, setImportOpen, selectedIds,
    bulkAction, selectedRows, allRowsSelected, bulkActions, created, exportCsv,
    toggleRow, togglePage, runBulkAction,
  };
}
