import React from 'react';
import { fmtNumber, uiText } from '../../../lib/i18n.js';

export default function EntityListPager({ total, page, pages, loading, onPageChange }) {
  return <div className="pager">
    <span aria-live="polite">{fmtNumber(total)} {uiText('bản ghi')} · {uiText('trang')} {page + 1}/{pages}</span>
    <div className="row">
      <button className="btn btn-sm" type="button" disabled={loading || page === 0} onClick={() => onPageChange((value) => Math.max(0, value - 1))}>{uiText('Trước')}</button>
      <button className="btn btn-sm" type="button" disabled={loading || page >= pages - 1} onClick={() => onPageChange((value) => value + 1)}>{uiText('Sau')}</button>
    </div>
  </div>;
}
