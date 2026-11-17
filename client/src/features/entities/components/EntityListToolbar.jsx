import React from 'react';
import { actionLabel, fmtNumber, statusLabel, uiText } from '../../../lib/i18n.js';

export default function EntityListToolbar({
  entityName,
  hasStates,
  states,
  query,
  status,
  selectable,
  selectedCount,
  bulkActions,
  busy,
  onQueryChange,
  onStatusChange,
  onBulkAction,
}) {
  return <>
    <div className="toolbar">
      <label className="search">
        <span className="sr-only">{uiText('Tìm')} {entityName}</span>
        <input className="input" type="search" value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder={`${uiText('Tìm')} ${entityName}…`} />
      </label>
      {hasStates && <label>
        <span className="sr-only">{uiText('Lọc theo trạng thái')}</span>
        <select className="select" value={status} onChange={(event) => onStatusChange(event.target.value)}>
          <option value="">{uiText('Mọi trạng thái')}</option>
          {states.map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}
        </select>
      </label>}
    </div>
    {selectable && selectedCount > 0 && <div className="toolbar" aria-label={uiText('Thao tác hàng loạt')}>
      <span className="muted">{uiText('Đã chọn')} {fmtNumber(selectedCount)} {uiText('bản ghi')}</span>
      {bulkActions.map(([action, transition]) => <button key={action} className="btn btn-sm" type="button" disabled={Boolean(busy)} onClick={() => onBulkAction(action, transition)}>
        {busy === action ? uiText('Đang xử lý…') : actionLabel(action)}
      </button>)}
    </div>}
  </>;
}
