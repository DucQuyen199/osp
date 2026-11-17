import React from 'react';
import { selectableTableRowProps } from '../../../lib/accessibility.js';
import { fmtDate, fmtMoney, statusLabel, uiTextWith } from '../../../lib/i18n.js';
import contractEnglish from '../contracts.en.js';

const t = (text) => uiTextWith(text, contractEnglish);

export default function ContractRegisterTable({ canRead, loading, contracts, selectedId, onSelect, partyName }) {
  if (!canRead) return <div className="empty">{t('Bạn chưa có quyền xem hợp đồng.')}</div>;
  if (loading) return <div className="skeleton" data-h="row" />;
  if (!contracts.length) return <div className="empty">{t('Không có hợp đồng trong bộ lọc này.')}</div>;

  return <div className="table-wrap">
    <table className="table">
      <thead><tr>
        <th>{t('Hợp đồng / đối tác')}</th><th>{t('Thời hạn')}</th><th>{t('Giá trị')}</th><th>{t('Trạng thái')}</th>
      </tr></thead>
      <tbody>{contracts.map((contract) => <tr
        {...selectableTableRowProps}
        key={contract.id}
        aria-selected={selectedId === contract.id}
        className={[selectedId === contract.id ? 'selected' : '', 'u-legacy-9463ff4798'].filter(Boolean).join(' ')}
        onClick={() => onSelect(contract.id)}
      >
        <td><strong>{contract.title}</strong><div className="small muted">{partyName(contract.party)}</div></td>
        <td>{fmtDate(contract.start_date)} – {contract.end_date ? fmtDate(contract.end_date) : t('Không thời hạn')}</td>
        <td>{contract.value != null ? fmtMoney(contract.value) : '—'}</td>
        <td><span className={`badge ${contract.status === 'active' ? 'success' : ['terminated', 'expired'].includes(contract.status) ? 'plain' : 'warning'}`}>{statusLabel(contract.status || 'draft')}</span></td>
      </tr>)}</tbody>
    </table>
  </div>;
}
