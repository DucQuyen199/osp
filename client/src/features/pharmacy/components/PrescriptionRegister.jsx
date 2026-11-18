import React from 'react';
import { fmtDateTime, fmtNumber, statusLabel } from '../../../lib/i18n.js';

export default function PrescriptionRegister({
  loading,
  prescriptions,
  parties,
  busy,
  canUpdate,
  canVerify,
  canCancel,
  prescriptionLines,
  productName,
  onEdit,
  onTransition,
  t,
}) {
  return <section className="card card-pad u-mt-20">
    <div className="row wrap">
      <h2>{t('Danh sách đơn thuốc')}</h2>
      <span className="grow" />
      <a className="btn btn-secondary" href="#/pos">{t('Mở quầy POS')}</a>
    </div>
    {loading ? <div className="skeleton" data-h="row" /> : prescriptions.length === 0 ? <div className="empty">{t('Chưa có đơn thuốc.')}</div> : <div className="table-wrap">
      <table className="table">
        <thead><tr><th>{t('Số đơn')}</th><th>{t('Khách hàng')}</th><th>{t('Ngày kê')}</th><th>{t('Hiệu lực đến')}</th><th>{t('Thuốc')}</th><th>{t('Trạng thái')}</th><th>{t('Thao tác')}</th></tr></thead>
        <tbody>{prescriptions.map((rx) => <tr key={rx.id}>
          <td><strong>{rx.prescription_no}</strong><div className="small muted">{rx.prescriber}{rx.prescriber_license ? ` · ${rx.prescriber_license}` : ''}</div></td>
          <td>{parties.get(rx.party)?.name || t('Khách hàng')}</td>
          <td>{rx.issued_at}</td>
          <td>{rx.valid_until}</td>
          <td>{prescriptionLines(rx).map((item, index) => <div key={`${item.product}-${item.dosage}-${index}`}>
            {productName(item.product)} · {t('kê')} {item.qty} {item.unitName}
            {item.balance && <span className="small muted"> · {t('tổng kê')} {fmtNumber(item.balance.prescribed)} {item.balance.unit} · {t('đã cấp')} {fmtNumber(item.balance.dispensed)} {item.balance.unit} · {t('còn')} {fmtNumber(item.balance.remaining)} {item.balance.unit}</span>}
            <div className="small muted">{item.dosage}</div>
          </div>)}</td>
          <td>{statusLabel(rx.status)}{rx.dispensed_at && <div className="small muted">{fmtDateTime(rx.dispensed_at)}</div>}</td>
          <td className="row wrap">
            {rx.status === 'draft' && canUpdate && <button className="btn btn-secondary btn-sm" type="button" disabled={busy} onClick={() => onEdit(rx)}>{t('Sửa nháp')}</button>}
            {rx.status === 'draft' && <button className="btn btn-primary btn-sm" type="button" disabled={busy || !canVerify} onClick={() => onTransition(rx, 'verified')}>{t('Xác minh')}</button>}
            {['draft', 'verified'].includes(rx.status) && <button className="btn btn-ghost btn-sm" type="button" disabled={busy || !canCancel} onClick={() => onTransition(rx, 'cancelled')}>{t('Hủy')}</button>}
          </td>
        </tr>)}</tbody>
      </table>
    </div>}
    <p className="small muted">{t('Xác minh là bước nghiệp vụ nội bộ sau khi dược sĩ đối chiếu đơn gốc. Hệ thống không thay thế việc thẩm định tính hợp lệ chuyên môn.')}</p>
  </section>;
}
