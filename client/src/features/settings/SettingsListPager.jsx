import React from 'react';
import { uiText } from '../../lib/i18n.js';

export default function SettingsListPager({ total, page, pageSize, onPageChange, label }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, pages - 1);
  if (pages <= 1) return null;
  const from = currentPage * pageSize + 1;
  const to = Math.min(total, from + pageSize - 1);
  return <nav className="card-pad row wrap" aria-label={uiText(label)}>
    <span className="small muted">{uiText('{from}–{to} trong {total}').replace('{from}', String(from)).replace('{to}', String(to)).replace('{total}', String(total))}</span>
    <span className="grow" />
    <button className="btn btn-ghost btn-sm" type="button" disabled={currentPage === 0} onClick={() => onPageChange(currentPage - 1)}>{uiText('Trước')}</button>
    <span className="small">{uiText('Trang')} {currentPage + 1} / {pages}</span>
    <button className="btn btn-ghost btn-sm" type="button" disabled={currentPage + 1 >= pages} onClick={() => onPageChange(currentPage + 1)}>{uiText('Sau')}</button>
  </nav>;
}
