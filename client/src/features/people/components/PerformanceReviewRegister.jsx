import React from 'react';
import { selectableTableRowProps } from '../../../lib/accessibility.js';

/** Controlled review register; filtering, selection state and review actions stay in the page. */
export default function PerformanceReviewRegister({ reviews, selectedId, onSelect, t }) {
  return <section className="table-wrap"><table className="table">
    <thead><tr><th>{t('Nhân viên / kỳ')}</th><th>{t('Người đánh giá')}</th><th>{t('Trạng thái')}</th></tr></thead>
    <tbody>{reviews.map((review) => <tr
      {...selectableTableRowProps}
      key={review.id}
      aria-selected={selectedId === review.id}
      className={[selectedId === review.id ? 'selected' : '', 'u-pointer'].filter(Boolean).join(' ')}
      onClick={() => onSelect(review.id)}
    >
      <td><strong>{review.employeeName}</strong><div className="small muted">{review.periodLabel}</div></td>
      <td>{review.reviewerName}</td>
      <td><span className="badge plain">{review.statusLabel}</span></td>
    </tr>)}</tbody>
  </table></section>;
}
