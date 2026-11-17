export default function PosSessionPanel({
  sessions,
  sessionId,
  activeSession,
  activeWarehouse,
  branches,
  warehouses,
  warehouseId,
  branchId,
  openingCash,
  busy,
  canCreate,
  onSessionChange,
  onWarehouseChange,
  onBranchChange,
  onOpeningCashChange,
  onSubmit,
  formatMoney,
  recordLabel,
  t,
}) {
  return <section className="card pos-session-bar">
    <div className="pos-session-select">
      <label className="field">
        <span className="label">{t('Ca đang mở')}</span>
        <select className="select" value={sessionId} onChange={(event) => onSessionChange(event.target.value)}>
          <option value="">{t('Chưa chọn ca')}</option>
          {sessions.map((item) => <option key={item.id} value={item.id}>
            {branches.get(item.branch)?.name || t('Không gán chi nhánh')} · {warehouses.get(item.warehouse)?.name || t('Ca cũ chưa có kho')} · {item.cashier || t('Thu ngân')}
          </option>)}
        </select>
      </label>
      {activeSession && <div className="small muted">
        {t('Kho:')} {activeWarehouse?.name || t('Ca cũ chưa khai báo kho')} · {t('Tiền đầu ca:')} {formatMoney(activeSession.opening_cash || 0)}{activeSession.cashier ? ` · ${activeSession.cashier}` : ''}
      </div>}
    </div>
    {!sessions.length && <div className="small muted">{t('Chưa có ca mở. Tạo ca mới để bắt đầu bán.')}</div>}
    <details className="pos-open-session">
      <summary>{t('Mở ca mới')}</summary>
      <form className="pos-session-form" onSubmit={onSubmit}>
        <label className="field">
          <span className="label">{t('Kho bán hàng *')}</span>
          <select className="select" required value={warehouseId} onChange={(event) => onWarehouseChange(event.target.value)}>
            <option value="">{t('Chọn kho')}</option>
            {[...warehouses.values()].filter((item) => item.active !== false).map((item) => <option key={item.id} value={item.id}>{recordLabel('inventory.warehouse', item)}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="label">{t('Chi nhánh')}</span>
          <select className="select" value={branchId} onChange={(event) => onBranchChange(event.target.value)}>
            <option value="">{t('Không gán chi nhánh')}</option>
            {[...branches.values()].filter((item) => item.active !== false).map((item) => <option key={item.id} value={item.id}>{recordLabel('master-data.branch', item)}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="label">{t('Tiền đầu ca')}</span>
          <input className="input num" type="number" min="0" step="any" value={openingCash} onChange={(event) => onOpeningCashChange(event.target.value)} />
        </label>
        <button className="btn btn-primary" type="submit" disabled={busy || !canCreate}>{busy ? t('Đang mở…') : t('Mở ca')}</button>
      </form>
    </details>
  </section>;
}
