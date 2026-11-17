export default function PosCashOperationsPanel({
  movements,
  direction,
  amount,
  accountId,
  reason,
  accounts,
  busy,
  canCreate,
  canPost,
  canDelete,
  onDirectionChange,
  onAmountChange,
  onAccountChange,
  onReasonChange,
  onSubmit,
  onPost,
  onRemove,
  formatMoney,
  t,
}) {
  return <details className="pos-cash-panel">
    <summary>{t('Thu / chi quỹ tiền mặt')}</summary>
    <form className="pos-cash-form" onSubmit={onSubmit}>
      <label className="field">
        <span className="label">{t('Loại giao dịch')}</span>
        <select className="select" value={direction} onChange={(event) => onDirectionChange(event.target.value)}>
          <option value="cash_out">{t('Chi tiền')}</option>
          <option value="cash_in">{t('Nộp tiền vào quỹ')}</option>
        </select>
      </label>
      <label className="field">
        <span className="label">{t('Số tiền')}</span>
        <input className="input num" required type="number" min="0.01" step="any" value={amount} onChange={(event) => onAmountChange(event.target.value)} />
      </label>
      <label className="field">
        <span className="label">{t('Tài khoản đối ứng')}</span>
        <select className="select" required value={accountId} onChange={(event) => onAccountChange(event.target.value)}>
          <option value="">{t('Chọn tài khoản')}</option>
          {[...accounts.values()].filter((item) => !['111', '112'].includes(String(item.code)) && item.active !== false).map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}
        </select>
      </label>
      <label className="field">
        <span className="label">{t('Lý do')}</span>
        <input className="input" required value={reason} onChange={(event) => onReasonChange(event.target.value)} />
      </label>
      <button className="btn btn-secondary" type="submit" disabled={busy || !canCreate || !canPost}>{t('Ghi nhận')}</button>
    </form>
    {movements.map((movement) => <div className="pos-pending-item" key={movement.id}>
      <div>
        <strong>{t(movement.direction === 'cash_in' ? 'Nộp quỹ' : 'Chi quỹ')} · {formatMoney(movement.amount)}</strong>
        <div className="small muted">{movement.reason}</div>
      </div>
      <button className="btn btn-primary btn-sm" type="button" disabled={busy || !canPost} onClick={() => onPost(movement)}>{t('Ghi sổ')}</button>
      <button className="btn btn-ghost btn-sm" type="button" disabled={busy || !canDelete} onClick={() => onRemove(movement)}>{t('Xóa')}</button>
    </div>)}
  </details>;
}
