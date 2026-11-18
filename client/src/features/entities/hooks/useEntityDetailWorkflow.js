import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, dataPath, tenantPath } from '../../../lib/api.js';
import { confirmDialog, textDialog, toast } from '../../../lib/feedback.js';
import { descendants, fetchRecordEvents } from '../../../lib/events.js';
import { actionLabel, statusLabel, tone, uiText } from '../../../lib/i18n.js';
import { can, invalidateRefs, loadRefs } from '../../../lib/state.js';
import { listHref } from '../../../lib/routes.js';

const entityChanged = (qname) => window.dispatchEvent(new CustomEvent('osp:entity-changed', { detail: qname }));

export function useEntityDetailWorkflow({ qname, id, definition }) {
  const [record, setRecord] = useState(null);
  const [refs, setRefs] = useState({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState('');
  const [statementFile, setStatementFile] = useState(null);
  const [tab, setTab] = useState('info');
  const [editOpen, setEditOpen] = useState(false);
  const [events, setEvents] = useState(null);
  const latestRead = useRef(0);
  const latestEventRead = useRef(0);
  const mounted = useRef(false);
  const contextRef = useRef({ qname, id });
  contextRef.current = { qname, id };

  const references = useMemo(() => definition?.fields.filter((field) => field.type === 'ref') || [], [definition]);
  const isCurrentContext = (targetQname, targetId) => mounted.current && contextRef.current.qname === targetQname && contextRef.current.id === targetId;

  const reload = useCallback(async () => {
    const request = ++latestRead.current;
    const targetQname = qname;
    const targetId = id;
    const isCurrent = () => latestRead.current === request && isCurrentContext(targetQname, targetId);
    setLoading(true); setError('');
    try {
      const data = await api(dataPath(targetQname, targetId));
      if (!isCurrent()) return;
      setRecord(data);
      const targets = await Promise.all([...new Set(references.map((field) => field.ref))]
        .filter((ref) => can(`${ref}.read`))
        .map(async (ref) => [ref, await loadRefs(ref).catch(() => new Map())]));
      if (isCurrent()) setRefs(Object.fromEntries(targets));
    } catch (reason) {
      if (isCurrent()) setError(reason.message || 'Không mở được bản ghi.');
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [qname, id, references]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      latestRead.current += 1;
      latestEventRead.current += 1;
    };
  }, []);

  useEffect(() => { setWorking(''); }, [qname, id]);

  useEffect(() => {
    latestRead.current += 1;
    void reload();
    return () => { latestRead.current += 1; };
  }, [reload]);

  useEffect(() => {
    if (tab !== 'flow') return undefined;
    let active = true;
    const request = ++latestEventRead.current;
    const targetQname = qname;
    const targetId = id;
    const isCurrent = () => active && latestEventRead.current === request && isCurrentContext(targetQname, targetId);
    setEvents(null);
    fetchRecordEvents(targetId).then((all) => {
      if (!isCurrent()) return;
      const roots = all.filter((event) => event.recordId === targetId).map((event) => event.id);
      setEvents(descendants(all, roots));
    }).catch((reason) => {
      if (isCurrent()) setError(reason.message || 'Không tải được chuỗi sự kiện.');
    });
    return () => { active = false; latestEventRead.current += 1; };
  }, [tab, qname, id]);

  const runAction = async (action, targetStatus) => {
    const targetQname = qname;
    const targetId = id;
    const isCurrent = () => isCurrentContext(targetQname, targetId);
    let body;
    if (targetQname === 'crm.deal' && action === 'lost') {
      const lostReason = await textDialog({
        title: 'Ghi nhận cơ hội thua',
        message: 'Ghi lý do để nhóm bán hàng phân tích và cải thiện quy trình chốt đơn.',
        label: 'Lý do thua (5–1000 ký tự)',
        minLength: 5,
        maxLength: 1000,
        confirmLabel: 'Tiếp tục',
        danger: true,
      });
      if (!lostReason || !isCurrent()) return;
      body = { lost_reason: lostReason };
    }
    if (tone(targetStatus) === 'danger') {
      const confirmed = await confirmDialog({
        title: `${actionLabel(action)}?`,
        message: uiText('Trạng thái sẽ chuyển sang “{status}”. Các mô-đun khác có thể phản ứng theo.')
          .replace('{status}', statusLabel(targetStatus)),
        confirmLabel: actionLabel(action),
        danger: true,
      });
      if (!confirmed || !isCurrent()) return;
    }
    setWorking(action);
    try {
      await api(dataPath(targetQname, targetId, action), { method: 'POST', ...(body ? { body } : {}) });
      invalidateRefs(targetQname);
      entityChanged(targetQname);
      const all = await fetchRecordEvents(targetId).catch(() => []);
      if (!isCurrent()) return;
      const roots = all.filter((event) => event.recordId === targetId && event.type === `${targetQname}.${action}`).slice(-1).map((event) => event.id);
      const chain = descendants(all, roots).filter((event) => !roots.includes(event.id));
      toast(chain.length
        ? uiText('Đã hoàn tất {action}; {count} bước liên mô-đun đã chạy.').replace('{action}', actionLabel(action)).replace('{count}', String(chain.length))
        : uiText('Đã hoàn tất {action}.').replace('{action}', actionLabel(action)), 'success');
      if (chain.length) setTab('flow');
      await reload();
    } catch (reason) {
      if (isCurrent()) toast(uiText(reason.message || 'Không thực hiện được thao tác.'), 'danger');
    } finally {
      if (isCurrent()) setWorking('');
    }
  };

  const remove = async () => {
    const targetQname = qname;
    const targetId = id;
    const isCurrent = () => isCurrentContext(targetQname, targetId);
    const confirmed = await confirmDialog({
      title: uiText('Xóa bản ghi này?'),
      message: uiText('Thao tác không thể hoàn tác. Nếu bản ghi đang được dùng, máy chủ sẽ từ chối xóa.'),
      confirmLabel: uiText('Xóa'),
      danger: true,
    });
    if (!confirmed || !isCurrent()) return;
    setWorking('delete');
    try {
      await api(dataPath(targetQname, targetId), { method: 'DELETE' });
      invalidateRefs(targetQname);
      entityChanged(targetQname);
      toast(uiText('Đã xóa bản ghi.'), 'success');
      if (isCurrent()) location.hash = listHref(targetQname);
    } catch (reason) {
      if (isCurrent()) toast(uiText(reason.message || 'Không xóa được bản ghi.'), 'danger');
    } finally {
      if (isCurrent()) setWorking('');
    }
  };

  const edit = () => setEditOpen(true);
  const onSaved = () => {
    setEditOpen(false); invalidateRefs(qname); entityChanged(qname); void reload();
  };

  const importStatementFile = async () => {
    const file = statementFile;
    if (!file) return;
    const targetQname = qname;
    const targetId = id;
    const isCurrent = () => isCurrentContext(targetQname, targetId);
    const isCamt053 = /\.(xml|camt)$/i.test(file.name);
    const isCasso = /\.json$/i.test(file.name);
    setWorking('import');
    try {
      const endpoint = isCasso ? 'import-casso' : isCamt053 ? 'import-camt053' : 'import';
      const contentType = isCasso ? 'application/json' : isCamt053 ? 'application/xml; charset=utf-8' : 'text/csv; charset=utf-8';
      const content = await file.text();
      if (!isCurrent()) return;
      const payload = isCasso ? JSON.parse(content) : content;
      const result = await api(tenantPath(`/accounting/bank-statements/${targetId}/${endpoint}`), {
        method: 'POST', body: isCasso ? payload : content, headers: { 'content-type': contentType },
      });
      if (!isCurrent()) return;
      setStatementFile(null);
      entityChanged('accounting.bank_statement_line');
      toast(uiText('Đã nhập {imported} dòng; bỏ qua {skipped} dòng trùng.')
        .replace('{imported}', String(result.imported)).replace('{skipped}', String(result.skipped)), 'success');
      await reload();
    } catch (reason) {
      if (isCurrent()) toast(uiText(reason.message || 'Không nhập được tệp sao kê.'), 'danger');
    } finally {
      if (isCurrent()) setWorking('');
    }
  };

  const closeToList = () => {
    if (location.hash.includes(id)) {
      history.replaceState(null, '', listHref(qname));
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    }
  };

  return {
    record, refs, error, loading, working, statementFile, setStatementFile,
    tab, setTab, events, editOpen, setEditOpen, reload, runAction, remove, edit,
    onSaved, importStatementFile, closeToList,
  };
}
