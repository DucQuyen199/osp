import React, { useEffect, useRef } from 'react';
import { actionLabel, statusLabel, tone, uiText } from '../../lib/i18n.js';
import { can, entity, entityLabel, recordLabel } from '../../lib/state.js';
import EntityFormDialog from './EntityFormDialog.jsx';
import EntityDetailTabs from './EntityDetailTabs.jsx';
import { useEntityDetailWorkflow } from './hooks/useEntityDetailWorkflow.js';


export default function EntityDetailPage({ qname, id }) {
  const dialog = useRef(null);
  const definition = entity(qname);
  const workflow = useEntityDetailWorkflow({ qname, id, definition });
  const {
    record, refs, error, loading, working, statementFile, setStatementFile,
    tab, setTab, events, editOpen, setEditOpen, runAction, remove, edit,
    onSaved, importStatementFile, closeToList,
  } = workflow;

  useEffect(() => {
    const node = dialog.current;
    if (node && !node.open) node.showModal();
    return () => { if (node?.open) node.close(); };
  }, []);
  const state = definition?.states && record?.[definition.states.field];
  const canEditRecord = can(`${qname}.update`) && !(qname === 'crm.deal' && ['won', 'lost'].includes(state));
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
              {canEditRecord && <button className="btn btn-sm" type="button" disabled={Boolean(working)} onClick={edit}>{uiText('Sửa')}</button>}
              {qname === 'accounting.bank_statement' && record?.status === 'draft' && can('accounting.bank_statement_line.create') && <>
                <input className="input" type="file" accept=".csv,.xml,.camt,.json,text/csv,application/xml,text/xml,application/json" aria-label={uiText('Tệp sao kê CSV, CAMT.053 hoặc JSON Casso')} disabled={Boolean(working)} onChange={(event) => setStatementFile(event.target.files?.[0] || null)} />
                <button className="btn btn-sm" type="button" disabled={!statementFile || Boolean(working)} onClick={importStatementFile}>{working === 'import' ? uiText('Đang nhập…') : `${uiText('Nhập')} ${statementFile && /\.json$/i.test(statementFile.name) ? 'Casso JSON' : statementFile && /\.(xml|camt)$/i.test(statementFile.name) ? 'CAMT.053' : 'CSV'}`}</button>
              </>}
              {can(`${qname}.delete`) && <button className="btn btn-sm btn-danger" type="button" disabled={Boolean(working)} onClick={remove}>{uiText('Xóa')}</button>}
            </div>
            <EntityDetailTabs
              qname={qname}
              definition={definition}
              record={record}
              refs={refs}
              fields={fields}
              tab={tab}
              events={events}
              currentId={id}
              error={error}
              onTabChange={setTab}
            />
          </div>}
      </div>
    </div>
  </dialog>
  {editOpen && <EntityFormDialog qname={qname} record={record} onClose={() => setEditOpen(false)} onSaved={onSaved} />}
  </>;
}
