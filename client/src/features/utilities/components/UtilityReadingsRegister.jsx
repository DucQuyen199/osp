import React from 'react';

/** Controlled presentation for meter-reading history and linked bill actions. */
export default function UtilityReadingsRegister({ selectedMeter, readings, canReadBills, busy, t }) {
  if (!selectedMeter) return <div className="empty">{t('Chọn một công tơ để xem lịch sử.')}</div>;
  if (!readings.length) return <div className="empty">{t('Chưa có chỉ số.')}</div>;

  return <div className="table-wrap"><table className="table">
    <thead><tr><th>{t('Kỳ')}</th><th>{t('Chỉ số trước')}</th><th>{t('Chỉ số mới')}</th><th>{t('Tiêu thụ')}</th><th>{t('Đơn giá')}</th><th>{t('Thành tiền')}</th><th>{t('Hóa đơn')}</th></tr></thead>
    <tbody>{readings.map((reading) => <tr key={reading.id}>
      <td>{reading.period}</td>
      <td>{reading.previousReading}</td>
      <td>{reading.reading}</td>
      <td>{reading.consumption}</td>
      <td>{reading.rate}</td>
      <td>{reading.amount}{reading.amountDetails.map((detail, index) => <div className="small muted" key={index}>{detail}</div>)}</td>
      <td>{!canReadBills ? '—' : reading.bill ? <span>{reading.bill.status} {reading.bill.invoiceHref && <a href={reading.bill.invoiceHref}>{t('· Mở hóa đơn phải thu')}</a>}</span> : reading.canCreateBill && <button className="btn btn-secondary btn-sm" type="button" disabled={busy} onClick={reading.onCreateBill}>{t('Lập hóa đơn nháp')}</button>}</td>
    </tr>)}</tbody>
  </table></div>;
}
