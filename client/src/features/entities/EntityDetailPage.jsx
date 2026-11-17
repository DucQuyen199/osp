import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api, dataPath, tenantPath } from '../../lib/api.js';
import { confirmDialog, textDialog, toast } from '../../lib/feedback.js';
import { descendants, eventTitle, fetchEvents, moduleName } from '../../lib/events.js';
import {
  actionLabel, fmtAgo, fmtDate, fmtDateTime, fmtMoney, fmtNumber, fmtTime, statusLabel, tone, uiText,
} from '../../lib/i18n.js';
import {
  can, entity, entityLabel, fieldLabelOf, invalidateRefs, loadRefs, recordLabel,
} from '../../lib/state.js';
import { listHref, recordHref } from '../../lib/routes.js';
import EntityFormDialog from './EntityFormDialog.jsx';

const entityChanged = (qname) => window.dispatchEvent(new CustomEvent('osp:entity-changed', { detail: qname }));

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
    const record = refs[field.ref]?.get(value);
    return <a href={recordHref(field.ref, value)}>{record ? recordLabel(field.ref, record) : `#${String(value).slice(0, 8)}`}</a>;
  }
  if (field.type === 'json') return <pre className="mono small">{JSON.stringify(value, null, 2)}</pre>;
  if (field.type === 'text') return <span className="pre-wrap">{String(value)}</span>;
  return String(value);
}

export function EventTimeline({ events, currentId }) {
  if (!events.length) return <div className="empty"><h3>{uiText('Chưa có sự kiện')}</h3><p>{uiText('Các bước liên mô-đun sẽ xuất hiện tại đây.')}</p></div>;
  return <ol className="timeline" aria-label={uiText('Chuỗi sự kiện')}>
    {events.map((event) => {
      const title = eventTitle(event.type);
      const failed = event.handled.some((effect) => effect.outcome === 'error');
      const effects = event.handled.filter((effect) => effect.outcome !== 'skipped');
      return <li key={event.id} className={`tl-item depth-${Math.min(event.depth, 3)}${failed ? ' err' : ''}`}>
        <span className="tl-dot" />
      <div className="tl-title">{uiText(title.entity)} · {uiText(title.verb)}</div>
        <div className="tl-meta">
          {fmtTime(event.at)} · {fmtAgo(event.at)}{event.depth > 0 ? ` · bước ${event.depth + 1} của chuỗi` : ''}
          {event.recordId && event.recordId !== currentId && entity(title.qname) && <>
            {' · '}<a href={recordHref(title.qname, event.recordId)}>{uiText('Mở bản ghi')}</a>
          </>}
        </div>
        {effects.length > 0 && <div className="tl-effects">{effects.map((effect, index) =>
          <span key={`${event.id}:${index}`} className={`effect ${effect.outcome === 'ok' ? 'ok' : 'error'}`} title={effect.detail || ''}>
            {effect.outcome === 'ok' ? '✓' : '×'} {uiText(moduleName(effect.module))}{effect.outcome === 'error' ? `: ${uiText(effect.detail)}` : ''}
          </span>)}
        </div>}
      </li>;
    })}
  </ol>;
}

export default function EntityDetailPage({ qname, id }) {
  const dialog = useRef(null);
  const [record, setRecord] = useState(null);
  const [refs, setRefs] = useState({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState('');
  const [statementFile, setStatementFile] = useState(null);
  const [tab, setTab] = useState('info');
  const [editOpen, setEditOpen] = useState(false);
  const [events, setEvents] = useState(null);
  const definition = entity(qname);
  const references = useMemo(() => definition?.fields.filter((field) => field.type === 'ref') || [], [definition]);

  const reload = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api(dataPath(qname, id));
      setRecord(data);
      const targets = await Promise.all([...new Set(references.map((field) => field.ref))]
        .filter((ref) => can(`${ref}.read`))
        .map(async (ref) => [ref, await loadRefs(ref).catch(() => new Map())]));
      setRefs(Object.fromEntries(targets));
    } catch (reason) {
      setError(reason.message || 'Không mở được bản ghi.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const node = dialog.current;
    if (node && !node.open) node.showModal();
    return () => { if (node?.open) node.close(); };
  }, []);

  useEffect(() => { reload(); }, [qname, id]);

  useEffect(() => {
    if (tab !== 'flow') return;
    let active = true;
    fetchEvents(1000).then((all) => {
      if (!active) return;
      const roots = all.filter((event) => event.recordId === id).map((event) => event.id);
      setEvents(descendants(all, roots));
    }).catch((reason) => { if (active) setError(reason.message || 'Không tải được chuỗi sự kiện.'); });
    return () => { active = false; };
  }, [tab, id]);

  const closeToList = () => {
    if (location.hash.includes(id)) {
      history.replaceState(null, '', listHref(qname));
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    }
  };

  const runAction = async (action, targetStatus) => {
    let body;
    if (qname === 'crm.deal' && action === 'lost') {
      const lostReason = await textDialog({
        title: 'Ghi nhận cơ hội thua',
        message: 'Ghi lý do để nhóm bán hàng phân tích và cải thiện quy trình chốt đơn.',
        label: 'Lý do thua (5–1000 ký tự)',
        minLength: 5,
        maxLength: 1000,
        confirmLabel: 'Tiếp tục',
        danger: true,
      });
      if (!lostReason) return;
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
      if (!confirmed) return;
    }
    setWorking(action);
    try {
      await api(dataPath(qname, id, action), { method: 'POST', ...(body ? { body } : {}) });
      invalidateRefs(qname);
      entityChanged(qname);
      const all = await fetchEvents(1000).catch(() => []);
      const roots = all.filter((event) => event.recordId === id && event.type === `${qname}.${action}`).slice(-1).map((event) => event.id);
      const chain = descendants(all, roots).filter((event) => !roots.includes(event.id));
      toast(chain.length
        ? uiText('Đã hoàn tất {action}; {count} bước liên mô-đun đã chạy.').replace('{action}', actionLabel(action)).replace('{count}', String(chain.length))
        : uiText('Đã hoàn tất {action}.').replace('{action}', actionLabel(action)), 'success');
      if (chain.length) setTab('flow');
      await reload();
    } catch (reason) {
      toast(uiText(reason.message || 'Không thực hiện được thao tác.'), 'danger');
    } finally {
      setWorking('');
    }
  };

  const remove = async () => {
    const confirmed = await confirmDialog({
      title: uiText('Xóa bản ghi này?'),
      message: uiText('Thao tác không thể hoàn tác. Nếu bản ghi đang được dùng, máy chủ sẽ từ chối xóa.'),
      confirmLabel: uiText('Xóa'),
      danger: true,
    });
    if (!confirmed) return;
    setWorking('delete');
    try {
      await api(dataPath(qname, id), { method: 'DELETE' });
      invalidateRefs(qname);
      entityChanged(qname);
      toast(uiText('Đã xóa bản ghi.'), 'success');
      location.hash = listHref(qname);
    } catch (reason) {
      toast(uiText(reason.message || 'Không xóa được bản ghi.'), 'danger');
    } finally {
      setWorking('');
    }
  };

  const edit = () => setEditOpen(true);
  const importStatementFile = async () => {
    if (!statementFile) return;
    const isCamt053 = /\.(xml|camt)$/i.test(statementFile.name);
    setWorking('import');
    try {
      const endpoint = isCamt053 ? 'import-camt053' : 'import';
      const contentType = isCamt053 ? 'application/xml; charset=utf-8' : 'text/csv; charset=utf-8';
      const result = await api(tenantPath(`/accounting/bank-statements/${id}/${endpoint}`), {
        method: 'POST', body: await statementFile.text(), headers: { 'content-type': contentType },
      });
      setStatementFile(null);
      entityChanged('accounting.bank_statement_line');
      toast(uiText('Đã nhập {imported} dòng; bỏ qua {skipped} dòng trùng.')
        .replace('{imported}', String(result.imported)).replace('{skipped}', String(result.skipped)), 'success');
      await reload();
    } catch (reason) {
      toast(uiText(reason.message || 'Không nhập được tệp sao kê.'), 'danger');
    } finally {
      setWorking('');
    }
  };
  const state = definition?.states && record?.[definition.states.field];
  const actions = definition?.states
    ? Object.entries(definition.states.actions).filter(([action, transition]) => transition.from.includes(state) && can(`${qname}.${action}`) && !(qname === 'helpdesk.ticket' && action === 'responded') && !(qname === 'accounting.journal_entry' && ['posted', 'rejected'].includes(action)) && !(qname === 'accounting.journal_entry' && action === 'submitted' && record?.source) && (qname !== 'crm.deal' || action !== 'lost' || can(`${qname}.update`)))
    : [];
  const fields = definition?.fields.filter((field) => field.name !== definition.states?.field && !field.system) || [];

  return <>
  <dialog ref={dialog} className="drawer wide" aria-labelledby="detail-title"
    onCancel={(event) => { event.preventDefault(); closeToList(); }}
    onClick={(event) => { if (event.target === dialog.current) closeToList(); }}>
    <div className="drawer-form">
      <header className="drawer-head">
        <div className="stack-sm">
          {record && <div className="faint">{uiText(entityLabel(qname))}</div>}
          <h2 id="detail-title">{loading ? uiText('Đang tải…') : error ? uiText('Không mở được bản ghi') : uiText(recordLabel(qname, record))}</h2>
          {state && <span className={`badge ${tone(state)}`}>{statusLabel(state)}</span>}
        </div>
        <button className="btn btn-ghost btn-icon" type="button" aria-label={uiText('Đóng')} onClick={closeToList}>×</button>
      </header>
      <div className="drawer-body">
        {loading ? <div className="skeleton" data-h="row" aria-label={uiText('Đang tải bản ghi')} /> : error
          ? <div className="alert danger" role="alert">{uiText(error)}</div>
          : <div className="stack">
            <div className="row wrap">
              {actions.map(([action, transition], index) => <button key={action} className={`btn btn-sm${index === 0 && tone(transition.to) !== 'danger' ? ' btn-primary' : ''}`} type="button" disabled={Boolean(working)} onClick={() => runAction(action, transition.to)}>
                {working === action ? uiText('Đang xử lý…') : actionLabel(action)}
              </button>)}
              {qname === 'inventory.lot' && can('inventory.lot.read') && can('inventory.stock_move.read') && <a className="btn btn-sm" href={`#/reports/inventory/lots/${encodeURIComponent(id)}/traceability`}>{uiText('Truy xuất lô')}</a>}
              <span className="grow" />
              {can(`${qname}.update`) && <button className="btn btn-sm" type="button" disabled={Boolean(working)} onClick={edit}>{uiText('Sửa')}</button>}
              {qname === 'accounting.bank_statement' && record?.status === 'draft' && can('accounting.bank_statement_line.create') && <>
                <input className="input" type="file" accept=".csv,.xml,.camt,text/csv,application/xml,text/xml" aria-label={uiText('Tệp sao kê CSV hoặc CAMT.053')} disabled={Boolean(working)} onChange={(event) => setStatementFile(event.target.files?.[0] || null)} />
                <button className="btn btn-sm" type="button" disabled={!statementFile || Boolean(working)} onClick={importStatementFile}>{working === 'import' ? uiText('Đang nhập…') : `${uiText('Nhập')} ${statementFile && /\.(xml|camt)$/i.test(statementFile.name) ? 'CAMT.053' : 'CSV'}`}</button>
              </>}
              {can(`${qname}.delete`) && <button className="btn btn-sm btn-danger" type="button" disabled={Boolean(working)} onClick={remove}>{uiText('Xóa')}</button>}
            </div>
            <div className="tabs" role="tablist" aria-label={uiText('Thông tin bản ghi')}>
              <button className="tab" type="button" role="tab" aria-selected={tab === 'info'} onClick={() => setTab('info')}>{uiText('Thông tin')}</button>
              <button className="tab" type="button" role="tab" aria-selected={tab === 'flow'} onClick={() => setTab('flow')}>{uiText('Hệ quả liên mô-đun')}</button>
            </div>
            {error && <div className="alert danger" role="alert">{uiText(error)}</div>}
            {tab === 'info' ? <>
              <dl className="dl">{fields.map((field) => <React.Fragment key={field.name}>
                <dt>{uiText(fieldLabelOf(qname, field.name))}</dt>
                <dd><FieldValue qname={qname} field={field} value={record[field.name]} refs={refs} definition={definition} record={record} /></dd>
              </React.Fragment>)}
                <dt>{uiText('Ngày tạo')}</dt><dd>{fmtDateTime(record.createdAt)}</dd>
                <dt>{uiText('Cập nhật')}</dt><dd>{fmtDateTime(record.updatedAt)}</dd>
                <dt>{uiText('Mã')}</dt><dd className="mono small">{record.id}</dd>
              </dl>
            </> : <div className="stack">
              <p className="muted">{uiText('Các bước đã chạy từ bản ghi này, gồm cả phản ứng tự động ở những mô-đun khác.')}</p>
              {events ? <EventTimeline events={events} currentId={id} /> : <div className="skeleton" data-h="row" aria-label={uiText('Đang tải chuỗi sự kiện')} />}
            </div>}
          </div>}
      </div>
    </div>
  </dialog>
  {editOpen && <EntityFormDialog qname={qname} record={record} onClose={() => setEditOpen(false)} onSaved={() => { setEditOpen(false); invalidateRefs(qname); entityChanged(qname); reload(); }} />}
  </>;
}
