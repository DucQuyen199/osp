import React from 'react';
import { recordHref } from '../../../lib/routes.js';

/** Renders statement lines and their controlled reconciliation actions. */
export default function BankStatementLinesTable({
  lines,
  loading,
  draft,
  busy,
  currencyCode,
  t,
  fmtDate,
  fmtMoney,
  statusLabel,
  candidatesFor,
  paymentLabel,
  journalLabel,
  matcherOpen,
  candidateLoading,
  matchChoices,
  ignoreOpen,
  ignoreReasons,
  permissions,
  onAutoMatch,
  onDeleteLine,
  onFindCandidates,
  onMatchChoiceChange,
  onManualMatch,
  onToggleIgnore,
  onIgnoreReasonChange,
  onIgnoreLine,
}) {
  return <div className="table-wrap u-mt-14">
    {loading ? <div className="skeleton" data-h="row"/> : !lines.length ? <div className="empty">{t('Chưa có giao dịch. Nhập tệp sao kê hoặc thêm dòng thủ công.')}</div> : <table className="table">
      <thead><tr><th>{t('Ngày / tham chiếu')}</th><th>{t('Diễn giải')}</th><th>{t('Chiều')}</th><th>{t('Số tiền')}</th><th>{t('Đối chiếu / thao tác')}</th></tr></thead>
      <tbody>{lines.map((line) => {
        const options = candidatesFor(line);
        const currentChoice = matchChoices[line.id] || (line.payment ? `payment:${line.payment}` : line.journal_entry ? `journal:${line.journal_entry}` : '');
        return <tr key={line.id}>
          <td>{fmtDate(line.transaction_date)}<div className="small muted">{line.reference || t('Không có mã tham chiếu')}</div></td>
          <td>{line.description || '—'}{line.status === 'ignored' && <div className="small muted">{t('Lý do: {reason}').replace('{reason}', line.ignore_reason)}</div>}</td>
          <td>{line.direction === 'credit' ? t('Có · vào') : t('Nợ · ra')}</td>
          <td className="num">{fmtMoney(line.amount, currencyCode)}</td>
          <td><div className="stack-sm">
            <span className={`badge ${line.status === 'matched' ? 'success' : line.status === 'ignored' ? 'plain' : 'warning'}`}>{statusLabel(line.status)}</span>
            {line.status === 'unmatched' && draft && <>
              <div className="row wrap">
                <button className="btn btn-primary btn-sm" disabled={Boolean(busy) || !permissions.match} onClick={() => onAutoMatch(line)}>{t('Tự khớp duy nhất')}</button>
                <button className="btn btn-ghost btn-sm" disabled={Boolean(busy) || !permissions.delete} onClick={() => onDeleteLine(line)}>{t('Xóa dòng')}</button>
              </div>
              {!matcherOpen[line.id]
                ? <button className="btn btn-ghost btn-sm" disabled={Boolean(busy) || !permissions.findCandidates} onClick={() => onFindCandidates(line)}>{t('Tìm chứng từ quanh ngày để khớp')}</button>
                : candidateLoading[line.id]
                  ? <span className="small muted">{t('Đang tìm payment và bút toán…')}</span>
                  : <>
                    <select className="select" aria-label={t('Chọn payment hoặc bút toán đã ghi sổ')} value={currentChoice} disabled={Boolean(busy)} onChange={(event) => onMatchChoiceChange(line, event.target.value)}>
                      <option value="">{t('Chọn chứng từ khớp thủ công…')}</option>
                      {options.payments.length > 0 && <optgroup label={t('Payment ngân hàng')}>{options.payments.map((payment) => <option key={payment.id} value={`payment:${payment.id}`}>{paymentLabel(payment)}</option>)}</optgroup>}
                      {options.journals.length > 0 && <optgroup label={t('Bút toán ngân hàng đã ghi sổ')}>{options.journals.map((entry) => <option key={entry.id} value={`journal:${entry.id}`}>{journalLabel(entry)}</option>)}</optgroup>}
                    </select>
                    {!options.payments.length && !options.journals.length && <span className="small muted">{t('Không thấy chứng từ ghi sổ cùng ngày, chiều và số tiền. Tự khớp vẫn có thể tìm đúng bút toán duy nhất.')}</span>}
                  </>}
              <div className="row wrap">
                <button className="btn btn-secondary btn-sm" disabled={Boolean(busy) || !currentChoice || !permissions.match || !permissions.update} onClick={() => onManualMatch(line)}>{t('Khớp chứng từ đã chọn')}</button>
                <button className="btn btn-ghost btn-sm" disabled={Boolean(busy) || !permissions.ignore || !permissions.update} onClick={() => onToggleIgnore(line)}>{t('Bỏ qua có giải trình')}</button>
              </div>
              {ignoreOpen[line.id] && <>
                <input className="input" maxLength="500" aria-label={t('Lý do bỏ qua giao dịch')} placeholder={t('Nhập lý do bắt buộc')} value={ignoreReasons[line.id] || ''} onChange={(event) => onIgnoreReasonChange(line, event.target.value)}/>
                <button className="btn btn-sm" disabled={Boolean(busy) || !ignoreReasons[line.id]?.trim() || !permissions.update} onClick={() => onIgnoreLine(line)}>{t('Lưu lý do và bỏ qua')}</button>
              </>}
            </>}
            {line.status === 'matched' && <span className="small muted">{line.payment ? <a href={recordHref('accounting.payment', line.payment)}>{t('Mở payment')}</a> : line.journal_entry ? <a href={recordHref('accounting.journal_entry', line.journal_entry)}>{t('Mở bút toán')}</a> : t('Đã khớp')}</span>}
          </div></td>
        </tr>;
      })}</tbody>
    </table>}
  </div>;
}
