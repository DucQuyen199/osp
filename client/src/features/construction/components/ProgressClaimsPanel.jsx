import React from 'react';

export default function ProgressClaimsPanel({
  claimForm,
  claimableContracts,
  claimRows,
  canCreate,
  canApprove,
  busy,
  today,
  onFieldChange,
  onCreateClaim,
  onApproveClaim,
  t,
  fmtDate,
  fmtMoney,
  statusLabel,
}) {
  return <section className="card card-pad u-mt-16">
    <h2>{t('Nghiệm thu và thanh toán theo đợt')}</h2>
    <p className="muted">{t('Mỗi hồ sơ được duyệt sẽ tạo một hóa đơn phải trả theo giá trị nghiệm thu. Máy chủ khóa hợp đồng và chặn lũy kế vượt giá trị hợp đồng.')}</p>
    {canCreate && <form className="form-grid" onSubmit={onCreateClaim}>
      <label className="field"><span className="label">{t('Hợp đồng thầu phụ *')}</span><select className="select" required value={claimForm.subcontract} onChange={(event) => onFieldChange('subcontract', event.target.value)}><option value="">{t('Chọn hợp đồng đã ký')}</option>{claimableContracts.map((contract) => <option key={contract.id} value={contract.id}>{contract.vendorLabel} · {fmtMoney(contract.value)}</option>)}</select></label>
      <label className="field"><span className="label">{t('Ngày nghiệm thu *')}</span><input className="input" type="date" required max={today} value={claimForm.period} onChange={(event) => onFieldChange('period', event.target.value)}/></label>
      <label className="field"><span className="label">{t('Giá trị đề nghị thanh toán *')}</span><input className="input" type="number" required min="0.01" step="any" value={claimForm.amount} onChange={(event) => onFieldChange('amount', event.target.value)}/></label>
      <label className="field"><span className="label">{t('Ghi chú / số biên bản')}</span><input className="input" value={claimForm.notes} onChange={(event) => onFieldChange('notes', event.target.value)}/></label>
      <div className="row full"><span className="grow"/><button className="btn btn-secondary" disabled={Boolean(busy) || !claimForm.subcontract}>{t('Lập hồ sơ nháp')}</button></div>
    </form>}
    <div className="table-wrap u-mt-14"><table className="table"><thead><tr><th>{t('Ngày')}</th><th>{t('Nhà thầu / hợp đồng')}</th><th>{t('Hồ sơ')}</th><th>{t('Giá trị')}</th><th>{t('Trạng thái')}</th><th>{t('Thao tác')}</th></tr></thead><tbody>{claimRows.map(({ row, vendorLabel, scopeLabel, bill }) => <tr key={row.id}>
      <td>{fmtDate(row.period)}</td><td>{vendorLabel}<div className="muted">{scopeLabel || t('Thầu phụ')}</div></td><td>{row.notes || '—'}</td><td>{fmtMoney(row.amount)}</td><td>{statusLabel(row.status)}</td>
      <td>{row.status === 'draft' && canApprove && <button className="btn btn-primary btn-sm" disabled={Boolean(busy)} onClick={() => onApproveClaim(row)}>{t('Duyệt và lập hóa đơn')}</button>}{bill && <a className="btn btn-ghost btn-sm u-ml-6" href={`#/e/accounting/bill/${bill.id}`}>{t('Mở hóa đơn')}</a>}</td>
    </tr>)}</tbody></table></div>
  </section>;
}
