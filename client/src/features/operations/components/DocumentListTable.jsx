import React from 'react';
import { selectableTableRowProps } from '../../../lib/accessibility.js';

/** Controlled document list; the workbench owns filtering and selection. */
export default function DocumentListTable({ documents, selectedId, onSelect, folderName, fmtDateTime, t }) {
  return <section className="table-wrap"><table className="table">
    <thead><tr><th>{t('Tài liệu')}</th><th>{t('Thư mục')}</th><th>{t('Phiên bản')}</th><th>{t('Cập nhật')}</th></tr></thead>
    <tbody>{documents.map((row) => <tr {...selectableTableRowProps} key={row.id} aria-selected={selectedId === row.id}
      className={[selectedId === row.id ? 'selected' : '', 'u-pointer'].filter(Boolean).join(' ')} onClick={() => onSelect(row.id)}>
      <td><strong>{row.title}</strong><div className="small muted">{row.owner || t('Chưa gán người sở hữu')}</div></td>
      <td>{folderName(row.folder)}</td>
      <td>{row.version || 1}{row.file_url ? '' : t('· Chưa có tệp')}</td>
      <td>{fmtDateTime(row.updatedAt || row.createdAt)}</td>
    </tr>)}</tbody>
  </table></section>;
}
