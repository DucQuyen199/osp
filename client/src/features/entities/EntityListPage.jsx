import React, { useMemo } from 'react';
import { useDocumentTitle } from '../../lib/useDocumentTitle.js';
import EntityFormDialog from './EntityFormDialog.jsx';
import EntityImportDialog from './EntityImportDialog.jsx';
import EntityListPager from './components/EntityListPager.jsx';
import EntityListToolbar from './components/EntityListToolbar.jsx';
import EntityRecordsTable from './components/EntityRecordsTable.jsx';
import { can, entity, entityLabel, listColumns, moduleOf } from '../../lib/state.js';
import { statusLabel, uiText } from '../../lib/i18n.js';
import { useEntityListWorkflow } from './hooks/useEntityListWorkflow.js';
export default function EntityListPage({ qname }) {
  useDocumentTitle(`${uiText(entityLabel(qname))} · OSP Suite`);
  const definition = entity(qname);
  const module = moduleOf(qname);
  const columns = useMemo(() => (definition ? listColumns(definition) : []), [definition]);
  const workflow = useEntityListWorkflow({ qname, definition, columns });
  const {
    rows, refs, total, pages, query, setQuery, status, setStatus, page, setPage,
    loading, error, formOpen, setFormOpen, importOpen, setImportOpen, selectedIds,
    bulkAction, selectedRows, allRowsSelected, bulkActions, created, exportCsv, refresh, openRecord,
    toggleRow, togglePage, runBulkAction,
  } = workflow;
  if (!definition) return <div className="page"><div className="empty">
    <h3>{uiText('Không tìm thấy dữ liệu này')}</h3>
    <p>{uiText('Module có thể chưa được bật cho doanh nghiệp của bạn.')}</p>
    <a className="btn" href="#/">{uiText('Về trang chủ')}</a>
  </div></div>;
  const canCreate = !definition.systemManaged && can(`${qname}.create`);
  const selectable = Boolean(definition.states && Object.keys(definition.states.actions).some((action) => can(`${qname}.${action}`)));
  const states = definition.states
    ? [...new Set([definition.states.initial, ...Object.values(definition.states.actions).flatMap((action) => [...action.from, action.to])])]
    : [];
  const create = () => setFormOpen(true);
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
      <EntityListToolbar
        entityName={uiText(entityLabel(qname)).toLowerCase()} hasStates={Boolean(definition.states)} states={states}
        query={query} status={status} selectable={selectable} selectedCount={selectedRows.length}
        bulkActions={bulkActions} busy={bulkAction}
        onQueryChange={(value) => { setQuery(value); setPage(0); }}
        onStatusChange={(value) => { setStatus(value); setPage(0); }} onBulkAction={runBulkAction}
      />
      {error && <div className="alert danger" role="alert">{uiText(error)}</div>}
      {loading ? <div className="skeleton" data-h="row" aria-label={uiText('Đang tải danh sách')} />
        : rows.length === 0 ? <div className="empty">
          <h3>{uiText(total ? 'Không có kết quả khớp' : 'Chưa có dữ liệu')}</h3>
          <p>{uiText(total ? 'Thử từ khóa khác hoặc bỏ bộ lọc.' : 'Chưa có bản ghi nào trong trang này.')}</p>
          {!total && canCreate && <button className="btn btn-primary" type="button" onClick={create}>＋ {uiText('Tạo bản ghi')}</button>}
        </div> : <EntityRecordsTable
          qname={qname} definition={definition} columns={columns} rows={rows} refs={refs}
          selectable={selectable} selectedIds={selectedIds} allRowsSelected={allRowsSelected} busy={Boolean(bulkAction)}
          onTogglePage={togglePage} onToggleRow={toggleRow}
          onOpenRecord={openRecord}
        />}
      <EntityListPager total={total} page={page} pages={pages} loading={loading} onPageChange={setPage} />
    </section>
  </div>
  {formOpen && <EntityFormDialog qname={qname} onClose={() => setFormOpen(false)} onSaved={created} />}
  {importOpen && <EntityImportDialog qname={qname} onClose={() => setImportOpen(false)} onDone={refresh} />}
  </>;
}
