import React from 'react';

export default function SalesReturnRegisterPanel({
  returnableOrders,
  orderId,
  formOrder,
  warehouses,
  selectedInvoice,
  returnInvoiceId,
  formInvoices,
  showInvoiceSelector,
  eligibleLines,
  quantities,
  reason,
  busy,
  submitDisabled,
  partyLabel,
  unitName,
  fmtMoney,
  statusLabel,
  onOrderChange,
  onInvoiceChange,
  onQuantityChange,
  onReasonChange,
  onSubmit,
  t,
}) {
  return <section className="card card-pad">
    <h2>{t('Lập phiếu trả hàng')}</h2>
    <form onSubmit={onSubmit}>
      <label className="field"><span className="label">{t('Đơn bán nguồn')} *</span><select className="select" required value={orderId} onChange={(event) => onOrderChange(event.target.value)}><option value="">{t('Chọn đơn đã xác nhận')}</option>{returnableOrders.map((order) => <option key={order.id} value={order.id}>{order.number || String(order.id).slice(0, 8)} · {partyLabel(order.party) || t('Khách hàng')} · {statusLabel(order.status)}</option>)}</select></label>
      {formOrder && <>
        <div className="small muted u-mt-8">{t('Kho nhận hàng trả')}: {warehouses.get(formOrder.warehouse)?.name || t('Kho của đơn bán')} · {t('Hóa đơn gốc')}: {selectedInvoice ? `${selectedInvoice.number || String(selectedInvoice.id).slice(0, 8)} (${statusLabel(selectedInvoice.status)})` : t('chưa chọn')}</div>
        {showInvoiceSelector && <label className="field u-mt-10"><span className="label">{t('Hóa đơn gốc cho credit note')} *</span><select className="select" required value={returnInvoiceId} onChange={(event) => onInvoiceChange(event.target.value)}><option value="">{t('Chọn hóa đơn đã ghi sổ')}</option>{formInvoices.map((invoice) => <option key={invoice.id} value={invoice.id}>{invoice.number || String(invoice.id).slice(0, 8)} · {statusLabel(invoice.status)} · {fmtMoney(invoice.total || 0)}</option>)}</select></label>}
        {eligibleLines.length ? <div className="table-wrap u-mt-12"><table className="table"><thead><tr><th>{t('Mặt hàng')}</th><th>{t('Đã giao')}</th><th>{t('Còn đủ điều kiện trả')}</th><th>{t('Giá bán')}</th><th>{t('Số lượng trả')}</th></tr></thead><tbody>{eligibleLines.map((line) => <tr key={line.key}>
          <td>{line.name}</td><td>{line.delivered} {unitName(line)}</td><td>{line.remaining} {unitName(line)}</td><td>{fmtMoney(line.price)}</td>
          <td><input className="input num u-max-w-150" aria-label={`${t('Số lượng trả')} ${line.name}`} type="number" min="0" max={line.remaining} step="any" value={quantities[line.key] || ''} onChange={(event) => onQuantityChange(line.key, event.target.value)}/></td>
        </tr>)}</tbody></table></div> : <p className="small muted u-mt-10">{t('Không còn số lượng đủ điều kiện trả. Đơn có giao vận chỉ tính những mặt hàng đã giao thành công.')}</p>}
        <label className="field u-mt-10"><span className="label">{t('Lý do trả hàng')} *</span><textarea className="input" required rows="2" value={reason} onChange={(event) => onReasonChange(event.target.value)}/></label>
      </>}
      <div className="row u-mt-10"><span className="grow"/><button className="btn btn-primary" type="submit" disabled={Boolean(busy) || submitDisabled}>{t('Lập và gửi duyệt')}</button></div>
      {formOrder && !selectedInvoice && <p className="small muted">{t('Cần chọn hóa đơn đã ghi sổ của đơn bán trước khi gửi duyệt để credit note gắn đúng chứng từ.')}</p>}
    </form>
  </section>;
}
