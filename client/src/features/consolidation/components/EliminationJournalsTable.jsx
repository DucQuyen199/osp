import React from 'react';

export default function EliminationJournalsTable({ rows, groupId, t }) {
  const groupRows = rows.filter((row) => row.group === groupId);
  if (!groupRows.length) return <div className="empty">{t('Chưa có bút toán loại trừ cho nhóm này.')}</div>;
  return <div className="table-wrap"><table className="table"><thead><tr><th>{t('Ngày')}</th><th>{t('Lý do')}</th><th>{t('Trạng thái')}</th></tr></thead><tbody>{groupRows.map((row) => <tr key={row.id}><td>{row.posting_date}</td><td>{row.memo}</td><td>{t(row.status || 'draft')}</td></tr>)}</tbody></table></div>;
}
