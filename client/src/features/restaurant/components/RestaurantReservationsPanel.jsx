import React from 'react';

export default function RestaurantReservationsPanel({
  reservations, tables, form, busy, permissions, onFormChange, onCreate,
  onAssignTable, onTransition, formatDateTime, statusLabel, t,
}) {
  if (!permissions.read) return null;

  return <section className="card card-pad restaurant-reservations">
    <h2>{t('Đặt bàn và danh sách chờ')}</h2>
    <p className="small muted">{t('Yêu cầu chưa xác nhận chưa giữ bàn. Khi xác nhận, hệ thống khóa bàn và ngăn đặt trùng giờ.')}</p>
    {permissions.create && <form className="form-grid" onSubmit={onCreate}>
      <label className="field"><span className="label">{t('Tên khách *')}</span>
        <input className="input" required maxLength="160" value={form.guest_name} onChange={(event) => onFormChange('guest_name', event.target.value)}/>
      </label>
      <label className="field"><span className="label">{t('Điện thoại')}</span>
        <input className="input" maxLength="80" value={form.phone} onChange={(event) => onFormChange('phone', event.target.value)}/>
      </label>
      <label className="field"><span className="label">{t('Bàn')}</span>
        <select className="select" value={form.table} onChange={(event) => onFormChange('table', event.target.value)}>
          <option value="">{t('Danh sách chờ, chưa chọn bàn')}</option>
          {tables.map((table) => <option key={table.id} value={table.id}>{table.name}{table.seats ? ` · ${table.seats} ${t('chỗ')}` : ''}</option>)}
        </select>
      </label>
      <label className="field"><span className="label">{t('Số khách *')}</span>
        <input className="input num" required type="number" min="1" step="1" value={form.guest_count} onChange={(event) => onFormChange('guest_count', event.target.value)}/>
      </label>
      <label className="field"><span className="label">{t('Bắt đầu *')}</span>
        <input className="input" required type="datetime-local" value={form.starts_at} onChange={(event) => onFormChange('starts_at', event.target.value)}/>
      </label>
      <label className="field"><span className="label">{t('Kết thúc *')}</span>
        <input className="input" required type="datetime-local" min={form.starts_at} value={form.ends_at} onChange={(event) => onFormChange('ends_at', event.target.value)}/>
      </label>
      <label className="field full"><span className="label">{t('Ghi chú')}</span>
        <input className="input" maxLength="1000" value={form.note} onChange={(event) => onFormChange('note', event.target.value)}/>
      </label>
      <div className="row full"><span className="grow"/>
        <button className="btn btn-primary" disabled={busy === 'reservation:create'}>
          {busy === 'reservation:create' ? t('Đang lưu…') : t('Ghi nhận yêu cầu')}
        </button>
      </div>
    </form>}
    {!reservations.length ? <div className="empty">{t('Chưa có yêu cầu đặt bàn.')}</div>
      : <div className="table-wrap u-legacy-c53ea1da23"><table className="table">
        <thead><tr>
          <th>{t('Thời gian')}</th><th>{t('Khách')}</th><th>{t('Bàn')}</th>
          <th>{t('Số khách')}</th><th>{t('Trạng thái')}</th><th>{t('Thao tác')}</th>
        </tr></thead>
        <tbody>{reservations.map((reservation) => <tr key={reservation.id}>
          <td>{formatDateTime(reservation.starts_at)} – {formatDateTime(reservation.ends_at)}</td>
          <td><strong>{reservation.guest_name}</strong>{reservation.phone && <div className="small muted">{reservation.phone}</div>}{reservation.note && <div className="small muted">{reservation.note}</div>}</td>
          <td>{['confirmed', 'arrived'].includes(reservation.status) && !reservation.table && permissions.update
            ? <select className="select" aria-label={t('Gán bàn cho đặt chỗ')} value="" disabled={Boolean(busy)} onChange={(event) => onAssignTable(reservation, event.target.value)}>
              <option value="">{t('Chọn bàn')}</option>
              {tables.map((table) => <option key={table.id} value={table.id}>{table.name}{table.seats ? ` · ${table.seats} ${t('chỗ')}` : ''}</option>)}
            </select>
            : tables.find((table) => table.id === reservation.table)?.name || t('Danh sách chờ')}
          </td>
          <td>{reservation.guest_count}</td><td>{statusLabel(reservation.status)}</td>
          <td><div className="row wrap">
            {reservation.status === 'requested' && permissions.confirm && <button className="btn btn-primary" type="button" disabled={Boolean(busy)} onClick={() => onTransition(reservation, 'confirmed')}>{t('Xác nhận')}</button>}
            {reservation.status === 'confirmed' && permissions.arrived && <button className="btn" type="button" disabled={Boolean(busy)} onClick={() => onTransition(reservation, 'arrived')}>{t('Khách đã đến')}</button>}
            {['requested', 'confirmed'].includes(reservation.status) && permissions.cancel && <button className="btn" type="button" disabled={Boolean(busy)} onClick={() => onTransition(reservation, 'cancelled')}>{t('Hủy')}</button>}
            {reservation.status === 'confirmed' && permissions.noShow && <button className="btn" type="button" disabled={Boolean(busy)} onClick={() => onTransition(reservation, 'no_show')}>{t('Vắng mặt')}</button>}
            {reservation.status === 'arrived' && permissions.complete && <button className="btn" type="button" disabled={Boolean(busy)} onClick={() => onTransition(reservation, 'completed')}>{t('Hoàn tất')}</button>}
          </div></td>
        </tr>)}</tbody>
      </table></div>}
  </section>;
}
