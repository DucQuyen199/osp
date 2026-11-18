import React from 'react';

export default function ConsolidatedTrialBalancePanel({
  groups,
  reportGroup,
  reportFrom,
  reportTo,
  ratePolicyDays,
  reportSnapshots,
  selectedSnapshotId,
  report,
  busy,
  loading,
  canUpdateRatePolicy,
  fmtNumber,
  onGroupChange,
  onFromChange,
  onToChange,
  onLoadReport,
  onRatePolicyDaysChange,
  onSaveRatePolicy,
  onOpenSnapshot,
  onSaveSnapshot,
  t,
}) {
  return <section className="card card-pad"><h2>{t('Bảng cân đối phát sinh hợp nhất')}</h2><p className="sub">{t('Số dư từng tenant được đọc trong phạm vi RLS riêng, chỉ cộng sau khi xác minh consent hai chiều và quy đổi theo tỷ giá có hiệu lực cuối kỳ.')}</p><form className="form-grid" onSubmit={onLoadReport}>
      <label className="field"><span className="label">{t('Nhóm công ty')} *</span><select className="input" required value={reportGroup} onChange={(event) => onGroupChange(event.target.value)}><option value="">{t('Chọn nhóm')}</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
      <label className="field"><span className="label">{t('Từ ngày')}</span><input className="input" type="date" value={reportFrom} onChange={(event) => onFromChange(event.target.value)}/></label>
      <label className="field"><span className="label">{t('Đến ngày')}</span><input className="input" type="date" value={reportTo} onChange={(event) => onToChange(event.target.value)}/></label>
      <div className="row full"><span className="grow"/><button className="btn btn-primary" disabled={Boolean(busy) || loading || !reportGroup}>{t('Xem báo cáo')}</button></div>
      </form>
    {reportGroup && canUpdateRatePolicy && <form className="row wrap rate-policy-form" onSubmit={onSaveRatePolicy}><label className="field"><span className="label">{t('Tuổi tối đa của tỷ giá (ngày)')}</span><input className="input" type="number" min="1" step="1" required value={ratePolicyDays} onChange={(event) => onRatePolicyDaysChange(event.target.value)}/></label><span className="sub">{t('Tỷ giá quá hạn sẽ làm báo cáo dừng để tránh quy đổi bằng dữ liệu cũ.')}</span><button className="btn btn-secondary" disabled={Boolean(busy) || !ratePolicyDays}>{t('Lưu chính sách tỷ giá')}</button></form>}
    {reportSnapshots.length > 0 && <section className="snapshot-list" aria-labelledby="report-snapshots-heading"><h3 id="report-snapshots-heading">{t('Lịch sử báo cáo đã lưu')}</h3><ul>{reportSnapshots.map((snapshot) => <li key={snapshot.id}><span>{new Date(snapshot.snapshotAt).toLocaleString()} · {snapshot.from || t('Từ đầu kỳ')} – {snapshot.to} · {snapshot.reportingCurrency}</span><button className="btn btn-secondary btn-sm" type="button" disabled={Boolean(busy)} onClick={() => onOpenSnapshot(snapshot)}>{t('Mở báo cáo đã lưu')}</button></li>)}</ul></section>}
    {report && <div className="row"><span className="faint">{selectedSnapshotId ? t('Đang xem ảnh chụp đã lưu') : t('Báo cáo trực tiếp')}</span><span className="grow"/><button className="btn btn-secondary" type="button" disabled={Boolean(busy) || loading} onClick={onSaveSnapshot}>{busy === 'snapshot' ? t('Đang lưu') : t('Lưu ảnh chụp')}</button></div>}
    {report && <><div className="row"><strong>{t('Tiền tệ báo cáo')}: {report.reportingCurrency}</strong><span className="grow"/><span className="faint">{report.companies?.length || 0} {t('tenant')}</span></div><p className="faint">{t('Cơ sở quy đổi')}: {report.rateBasis} · {t('Phương pháp')}: {report.consolidationMethod}</p><div className="table-wrap"><table className="table"><thead><tr><th>{t('Mã tài khoản')}</th><th>{t('Tài khoản')}</th><th>{t('Dư nợ đầu kỳ')}</th><th>{t('Dư có đầu kỳ')}</th><th>{t('Phát sinh nợ')}</th><th>{t('Phát sinh có')}</th><th>{t('Dư nợ cuối kỳ')}</th><th>{t('Dư có cuối kỳ')}</th></tr></thead><tbody>{report.accounts?.map((account) => <tr key={`${account.code}:${account.kind}`}><td>{account.code}</td><td>{account.name}</td><td className="num">{fmtNumber(String(account.openingDebit ?? 0))}</td><td className="num">{fmtNumber(String(account.openingCredit ?? 0))}</td><td className="num">{fmtNumber(String(account.periodDebit ?? 0))}</td><td className="num">{fmtNumber(String(account.periodCredit ?? 0))}</td><td className="num">{fmtNumber(String(account.closingDebit ?? 0))}</td><td className="num">{fmtNumber(String(account.closingCredit ?? 0))}</td></tr>)}</tbody></table></div></>}</section>
;} 
