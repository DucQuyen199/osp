import React from 'react';

export default function SelectedPropertyWorkspace({
  selected,
  parties,
  recordLabel,
  viewingForm,
  reservationForm,
  leaseForm,
  viewingRows,
  reservationRows,
  leaseRows,
  cycleRows,
  invoiceByCycle,
  saleInvoice,
  busy,
  today,
  kindLabel,
  fmtDate,
  fmtDateTime,
  fmtMoney,
  statusLabel,
  t,
  canCreateViewing,
  canCreateReservation,
  canCreateLease,
  canCreateLeaseOrReserve,
  reservationActions,
  leaseActions,
  onViewingFieldChange,
  onReservationFieldChange,
  onLeaseFieldChange,
  onCreateViewing,
  onCreateReservation,
  onCreateLease,
  onConvertReservation,
  onReserveReservation,
  onExpireReservation,
  onCancelReservation,
  onActivateLease,
  onIssueRent,
  onTerminateLease,
}) {
  return <section className="card card-pad"><div className="row wrap"><div><h2>{selected.title}</h2><div className="small muted">{kindLabel(selected.kind)} · {selected.address || t('Chưa có địa chỉ')} · {selected.area ? `${selected.area} m²` : t('Chưa nhập diện tích')}</div></div><span className="grow"/><span className="badge warning">{statusLabel(selected.status)}</span></div>
        {canCreateViewing && <form className="form-grid u-mt-16"  onSubmit={onCreateViewing}><h3 className="full">{t("Lịch xem")}</h3><label className="field"><span className="label">{t("Khách quan tâm")}</span><select className="select" value={viewingForm.party} onChange={(e) => onViewingFieldChange('party', e.target.value)}><option value="">{t("Chưa xác định")}</option>{[...parties.values()].map((party) => <option key={party.id} value={party.id}>{recordLabel('master-data.party', party)}</option>)}</select></label><label className="field"><span className="label">{t("Thời gian *")}</span><input className="input" required type="datetime-local" value={viewingForm.at} onChange={(e) => onViewingFieldChange('at', e.target.value)}/></label><label className="field full"><span className="label">{t("Ghi chú")}</span><input className="input" value={viewingForm.note} onChange={(e) => onViewingFieldChange('note', e.target.value)}/></label><div className="row full"><span className="grow"/><button className="btn btn-secondary" disabled={Boolean(busy)}>{t("Xếp lịch xem")}</button></div></form>}
        {viewingRows.length > 0 && <div className="table-wrap"><table className="table"><thead><tr><th>{t("Lịch xem")}</th><th>{t("Khách")}</th><th>{t("Ghi chú")}</th></tr></thead><tbody>{viewingRows.map((row) => <tr key={row.id}><td>{row.at ? fmtDateTime(row.at) : t('Chưa xếp lịch')}</td><td>{parties.has(row.party) ? recordLabel('master-data.party', parties.get(row.party)) : '—'}</td><td>{row.note || '—'}</td></tr>)}</tbody></table></div>}
        {canCreateReservation && <form className="form-grid u-mt-20"  onSubmit={onCreateReservation}><h3 className="full">{t("Giữ chỗ / chốt bán")}</h3><label className="field"><span className="label">{t("Khách mua *")}</span><select className="select" required value={reservationForm.party} onChange={(e) => onReservationFieldChange('party', e.target.value)}><option value="">{t("Chọn khách")}</option>{[...parties.values()].map((party) => <option key={party.id} value={party.id}>{recordLabel('master-data.party', party)}</option>)}</select></label><label className="field"><span className="label">{t("Số phiếu *")}</span><input className="input" required value={reservationForm.number} onChange={(e) => onReservationFieldChange('number', e.target.value)}/></label><label className="field"><span className="label">{t("Giá thỏa thuận *")}</span><input className="input" required type="number" min="0.01" step="any" value={reservationForm.agreed_price} onChange={(e) => onReservationFieldChange('agreed_price', e.target.value)}/></label><label className="field"><span className="label">{t("Giữ chỗ đến *")}</span><input className="input" required type="date" min={today()} value={reservationForm.expires_on} onChange={(e) => onReservationFieldChange('expires_on', e.target.value)}/></label><label className="field full"><span className="label">{t("Điều khoản / ghi chú")}</span><input className="input" value={reservationForm.notes} onChange={(e) => onReservationFieldChange('notes', e.target.value)}/></label><div className="row full"><span className="grow"/><button className="btn btn-primary" disabled={Boolean(busy) || !canCreateLeaseOrReserve}>{t("Xác nhận giữ chỗ")}</button></div></form>}
        {reservationRows.length > 0 && <div className="table-wrap u-mt-12" ><table className="table"><thead><tr><th>{t("Phiếu")}</th><th>{t("Khách")}</th><th>{t("Giá")}</th><th>{t("Hạn giữ")}</th><th>{t("Trạng thái / thao tác")}</th></tr></thead><tbody>{reservationRows.map((row) => <tr key={row.id}><td>{row.number}</td><td>{parties.has(row.party) ? recordLabel('master-data.party', parties.get(row.party)) : '—'}</td><td>{fmtMoney(row.agreed_price || 0)}</td><td>{fmtDate(row.expires_on)}</td><td><span className="badge warning">{statusLabel(row.status)}</span>{reservationActions(row).reserve && <button className="btn btn-primary btn-sm u-ml-8" disabled={Boolean(busy)} onClick={() => onReserveReservation(row)}>{t("Xác nhận giữ chỗ")}</button>}{reservationActions(row).convert && <button className="btn btn-primary btn-sm u-ml-8"  disabled={Boolean(busy)} onClick={() => onConvertReservation(row)}>{t("Chốt bán")}</button>}{reservationActions(row).expire && <button className="btn btn-secondary btn-sm u-ml-6"  disabled={Boolean(busy)} onClick={() => onExpireReservation(row)}>{t("Đánh dấu hết hạn")}</button>}{reservationActions(row).cancel && <button className="btn btn-ghost btn-sm u-ml-6"  disabled={Boolean(busy)} onClick={() => onCancelReservation(row)}>{t("Hủy")}</button>}</td></tr>)}</tbody></table></div>}
        {canCreateLease && <form className="form-grid u-mt-20"  onSubmit={onCreateLease}><h3 className="full">{t("Hợp đồng thuê")}</h3><label className="field"><span className="label">{t("Bên thuê *")}</span><select className="select" required value={leaseForm.tenant} onChange={(e) => onLeaseFieldChange('tenant', e.target.value)}><option value="">{t("Chọn bên thuê")}</option>{[...parties.values()].map((party) => <option key={party.id} value={party.id}>{recordLabel('master-data.party', party)}</option>)}</select></label><label className="field"><span className="label">{t("Tiền thuê mỗi kỳ *")}</span><input className="input" required type="number" min="0.01" step="any" value={leaseForm.rent} onChange={(e) => onLeaseFieldChange('rent', e.target.value)}/></label><label className="field"><span className="label">{t("Chu kỳ thu")}</span><select className="select" value={leaseForm.billing_interval} onChange={(e) => onLeaseFieldChange('billing_interval', e.target.value)}><option value="monthly">{t("Hàng tháng")}</option><option value="quarterly">{t("Hàng quý")}</option><option value="yearly">{t("Hàng năm")}</option></select></label><label className="field"><span className="label">{t("Ngày bắt đầu *")}</span><input className="input" required type="date" value={leaseForm.start_date} onChange={(e) => onLeaseFieldChange('start_date', e.target.value)}/></label><label className="field"><span className="label">{t("Ngày kết thúc *")}</span><input className="input" required type="date" min={leaseForm.start_date} value={leaseForm.end_date} onChange={(e) => onLeaseFieldChange('end_date', e.target.value)}/></label><div className="row full"><span className="grow"/><button className="btn btn-secondary" disabled={Boolean(busy) || !canCreateLeaseOrReserve}>{t("Tạo dự thảo thuê")}</button></div></form>}
        {leaseRows.length > 0 && <div className="table-wrap u-mt-12" ><table className="table"><thead><tr><th>{t("Bên thuê")}</th><th>{t("Tiền thuê")}</th><th>{t("Thời hạn")}</th><th>{t("Trạng thái / thao tác")}</th></tr></thead><tbody>{leaseRows.map((row) => <tr key={row.id}><td>{parties.has(row.tenant) ? recordLabel('master-data.party', parties.get(row.tenant)) : '—'}<div className="small muted">{t(({monthly:'Hàng tháng',quarterly:'Hàng quý',yearly:'Hàng năm'}[row.billing_interval] || 'Hàng tháng'))}</div></td><td>{fmtMoney(row.rent || 0)}</td><td>{fmtDate(row.start_date)} – {fmtDate(row.end_date)}</td><td><span className="badge warning">{statusLabel(row.status)}</span>{leaseActions(row).activate && <button className="btn btn-primary btn-sm u-ml-8"  disabled={Boolean(busy)} onClick={() => onActivateLease(row)}>{t("Kích hoạt")}</button>}{leaseActions(row).issueRent && <button className="btn btn-secondary btn-sm u-ml-8"  disabled={Boolean(busy)} onClick={() => onIssueRent(row)}>{t("Phát hành kỳ đến hạn")}</button>}{leaseActions(row).terminate && <button className="btn btn-ghost btn-sm u-ml-6"  disabled={Boolean(busy)} onClick={() => onTerminateLease(row)}>{t("Kết thúc thuê")}</button>}</td></tr>)}</tbody></table></div>}
        {cycleRows.length > 0 && <div className="table-wrap u-mt-16" ><h3>{t("Kỳ thu tiền thuê đã phát hành")}</h3><table className="table"><thead><tr><th>{t("Kỳ thuê")}</th><th>{t("Đến hạn")}</th><th>{t("Số tiền")}</th><th>{t("Hóa đơn")}</th></tr></thead><tbody>{cycleRows.map((row) => <tr key={row.id}><td>{fmtDate(row.period_start)} – {fmtDate(row.period_end)}</td><td>{fmtDate(row.due_date)}</td><td>{fmtMoney(row.amount)}</td><td>{invoiceByCycle.has(row.id) ? <a href={`#/e/accounting/invoice/${invoiceByCycle.get(row.id).id}`}>{statusLabel(invoiceByCycle.get(row.id).status)}</a> : t('Đang tạo')}</td></tr>)}</tbody></table></div>}
        {selected.status === 'sold' && selected.buyer && <p className="small muted u-mt-12" >{t('Đã bán cho')} {parties.has(selected.buyer) ? recordLabel('master-data.party', parties.get(selected.buyer)) : t('khách hàng')} {t('với giá')} {fmtMoney(selected.sale_price || 0)}. {saleInvoice ? <a href={`#/e/accounting/invoice/${saleInvoice.id}`}>{t('Mở hóa đơn')} {statusLabel(saleInvoice.status)}</a> : t('Hóa đơn bán được tạo theo sự kiện giao dịch.')}</p>}
      </section>
;}
