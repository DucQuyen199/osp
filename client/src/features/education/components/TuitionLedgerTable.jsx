import React from 'react';
import { fmtDate, fmtMoney, statusLabel } from '../../../lib/i18n.js';

export default function TuitionLedgerTable({ fees, loading, studentById, parties, invoiceByFee, busy, canIssue, onIssue, recordLabel, t, }) {
  if (loading) return <div className="skeleton" data-h="row" />;
  if (!fees.length) return <div className="empty">{t('Chưa có khoản học phí. Tạo khoản nháp ở trên rồi phát hành để sinh hóa đơn.')}</div>;

  const sortedFees = [...fees].sort((a, b) => String(b.due_date || b.created_at || '').localeCompare(String(a.due_date || a.created_at || '')));
  return <div className="table-wrap"><table className="table">
    <thead><tr><th>{t('Học viên')}</th><th>{t('Kỳ / nội dung')}</th><th>{t('Số tiền')}</th><th>{t('Hạn thu')}</th><th>{t('Trạng thái / hóa đơn')}</th><th>{t('Thao tác')}</th></tr></thead>
    <tbody>{sortedFees.map((fee) => {
      const student = studentById.get(fee.student);
      const party = parties.get(student?.party);
      const invoice = invoiceByFee.get(fee.id);
      return <tr key={fee.id}>
        <td>{party ? recordLabel('master-data.party', party) : student?.student_code || t('Học viên')}<div className="small muted">{student?.student_code || ''}</div></td>
        <td>{fee.period || fee.note || t('Khoản thu')}</td>
        <td className="num">{fmtMoney(fee.amount || 0)}</td>
        <td>{fee.due_date ? fmtDate(fee.due_date) : '—'}</td>
        <td><span className={`badge ${fee.status === 'paid' ? 'success' : fee.status === 'issued' ? 'warning' : 'plain'}`}>{statusLabel(fee.status)}</span>
          {invoice && <div><a className="btn btn-ghost btn-sm" href={`#/e/accounting/invoice/${invoice.id}`}>{statusLabel(invoice.status)} · {t('mở hóa đơn')}</a></div>}
        </td>
        <td>{fee.status === 'draft' && canIssue && <button className="btn btn-primary btn-sm" disabled={Boolean(busy) || !fee.party || Number(fee.amount) <= 0} onClick={() => onIssue(fee)}>{t('Phát hành')}</button>}
          {fee.status === 'issued' && !invoice && <span className="small muted">{t('Đang tạo hóa đơn')}</span>}
        </td>
      </tr>;
    })}</tbody>
  </table></div>;
}
