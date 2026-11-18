import React from 'react';
import ManufacturingWipReport from './ManufacturingWipReport.jsx';

export default function ManufacturingWipReportSection({
  report, accounts, offsetAccountId, memo, adjustment, creating,
  canCreateAdjustment, canReadAccounts, formatNumber, formatQuantity, formatMoney,
  statusLabel, orderHref, onOffsetAccountChange, onMemoChange,
  onCreateDraft, t,
}) {
  if (!report) return null;

  return <div className="stack">
    <div className="stats">
      <div className="card stat"><span className="stat-label">{t('Lệnh có số dư WIP')}</span><strong className="stat-value num">{formatNumber(String(report.orderCount || 0))}</strong></div>
      <div className="card stat"><span className="stat-label">{t('Tổng giá trị WIP')}</span><strong className="stat-value num">{formatMoney(report.totalWipValue)}</strong></div>
      {report.ledgerComparisonAvailable && <div className="card stat"><span className="stat-label">{t('Số dư TK 154 trên sổ cái')}</span><strong className="stat-value num">{formatMoney(report.ledgerWipBalance)}</strong></div>}
      {report.ledgerComparisonAvailable && <div className="card stat"><span className="stat-label">{t('Chênh lệch WIP - TK 154')}</span><strong className="stat-value num">{formatMoney(report.wipVariance)}</strong><span className={`badge ${report.reconciled ? 'success' : 'danger'}`}>{report.reconciled ? t('Khớp') : t('Cần đối chiếu')}</span></div>}
    </div>
    {!report.ledgerComparisonAvailable && <div className="alert info" role="status">{t('Bật kế toán và quyền đọc sổ cái để đối chiếu chi tiết với tài khoản 154.')}</div>}
    {report.ledgerComparisonAvailable && !report.reconciled && canCreateAdjustment && canReadAccounts && <section className="card card-pad">
      <div className="card-head"><h2>{t('Tạo bút toán điều chỉnh nháp')}</h2><span className="faint">{t('Kế toán chọn tài khoản đối ứng và duyệt trước khi ghi sổ')}</span></div>
      <div className="toolbar">
        <label className="field"><span className="label">{t('Tài khoản đối ứng')}</span><select className="select" value={offsetAccountId} onChange={(event) => onOffsetAccountChange(event.target.value)}>
          <option value="">{t('Chọn tài khoản')}</option>
          {[...accounts.values()].filter((account) => account.code !== '154').map((account) => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}
        </select></label>
        <label className="field"><span className="label">{t('Diễn giải')}</span><input className="input" maxLength={300} value={memo} onChange={(event) => onMemoChange(event.target.value)} /></label>
        <button className="btn btn-primary" type="button" disabled={creating || !offsetAccountId || !memo.trim()} onClick={onCreateDraft}>{creating ? t('Đang tạo…') : t('Tạo bút toán nháp')}</button>
      </div>
    </section>}
    {adjustment && <div className="alert success" role="status">{adjustment.existing ? t('Đã có bút toán đối chiếu cho chênh lệch này.') : t('Đã tạo bút toán nháp.')} {adjustment.id && <a href={`#/e/accounting/journal_entry/${encodeURIComponent(adjustment.id)}`}>{t('Mở bút toán')}</a>} <span>{t('Trạng thái:')} {statusLabel(adjustment.status)}</span></div>}
    <ManufacturingWipReport report={report} qty={formatQuantity} fmtMoney={formatMoney} statusLabel={statusLabel} orderHref={orderHref} t={t} />
  </div>;
}
