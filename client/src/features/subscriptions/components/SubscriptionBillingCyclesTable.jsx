import React from 'react';

/** Renders the controlled billing-cycle and invoice register. */
export default function SubscriptionBillingCyclesTable({
  cycles = [], parties, subscriptions, planById, invoiceByCycle,
  fmtDate, fmtMoney, statusLabel, recordLabel, isInvoiceDue, t,
}) {
  return <section className="card card-pad">
    <h2>{t('Kỳ thu và hóa đơn')}</h2>
    {!cycles.length ? <p className="empty">{t('Kỳ thu đầu tiên được tạo khi kích hoạt thuê bao có giá gói lớn hơn 0.')}</p> : <div className="table-wrap">
      <table className="table">
        <thead><tr><th>{t('Khách hàng')}</th><th>{t('Đến hạn')}</th><th>{t('Số tiền đã chụp')}</th><th>{t('Trạng thái / hóa đơn')}</th></tr></thead>
        <tbody>{cycles.map((row) => {
          const subscription = subscriptions.find((item) => item.id === row.subscription);
          const planName = planById.get(subscription?.plan)?.name || t('Thuê bao');
          const invoice = invoiceByCycle.get(row.id);
          return <tr key={row.id}>
            <td>{parties.has(row.party) ? recordLabel('master-data.party', parties.get(row.party)) : t('Khách hàng')}<div className="small muted">{planName}</div></td>
            <td>{fmtDate(row.due_date)}</td>
            <td>{fmtMoney(row.amount)}</td>
            <td><span className="badge warning">{statusLabel(row.status)}</span>{invoice && <a className="btn btn-ghost btn-sm u-ml-6" href={`#/e/accounting/invoice/${invoice.id}`}>{statusLabel(invoice.status)} · {t('mở hóa đơn')}</a>}{isInvoiceDue(row) && <span className="small muted u-ml-6">{t('Hệ thống sẽ phát hành hóa đơn đến hạn.')}</span>}</td>
          </tr>;
        })}</tbody>
      </table>
    </div>}
    <p className="small muted u-mt-12">{t('Thanh toán được ghi nhận trên hóa đơn kế toán. Khi hóa đơn được thanh toán, hệ thống tự chốt kỳ thu và lên lịch kỳ tiếp theo; không ghi nhận thanh toán thủ công trên thuê bao.')}</p>
  </section>;
}
