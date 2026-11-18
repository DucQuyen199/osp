import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useDocumentTitle } from '../../lib/useDocumentTitle.js';
import { useLatestRequest } from '../../lib/useLatestRequest.js';
import { selectableTableRowProps } from '../../lib/accessibility.js';
import { localDate as businessDate } from '../../lib/dates.js';
import { fmtDateTime, fmtMoney, statusLabel, uiTextWith } from '../../lib/i18n.js';
import { can, loadRefs, recordLabel, loadAllResponse } from '../../lib/state.js';
import wellnessEnglish from './wellness.en.js';
import BookingRequestForm from './components/BookingRequestForm.jsx';
import { useWellnessBookingWorkflow } from './hooks/useWellnessBookingWorkflow.js';
const t = (text) => uiTextWith(text, wellnessEnglish);
const itemsOf = (response) => Array.isArray(response?.items) ? response.items : [];
const localDate = (value) => {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : businessDate(date);
};
export default function WellnessBookingPage({ healthcare = false }) {
  useDocumentTitle(`${t(healthcare ? 'Lịch hẹn khám' : 'Lịch dịch vụ và hội viên')} · OSP Suite`);
  const [bookings, setBookings] = useState([]);
  const [resources, setResources] = useState([]);
  const [services, setServices] = useState([]);
  const [clinicPatients, setClinicPatients] = useState([]);
  const [parties, setParties] = useState(new Map());
  const [invoices, setInvoices] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const latestRequest = useLatestRequest();
  const load = useCallback(async (quiet = false) => {
    const isLatest = latestRequest();
    if (!quiet) { setLoading(true); setError(''); }
    try {
      const [bookingRes, resourceRes, serviceRes, partyMap, invoiceRes, clinicPatientRes] = await Promise.all([
        can('booking.booking.read') ? loadAllResponse('booking.booking') : Promise.resolve({ items: [] }),
        can('booking.resource.read') ? loadAllResponse('booking.resource') : Promise.resolve({ items: [] }),
        can('booking.service.read') ? loadAllResponse('booking.service') : Promise.resolve({ items: [] }),
        can('master-data.party.read') ? loadRefs('master-data.party') : Promise.resolve(new Map()),
        can('accounting.invoice.read') ? loadAllResponse('accounting.invoice') : Promise.resolve({ items: [] }),
        healthcare && can('clinic.patient.read') ? loadAllResponse('clinic.patient') : Promise.resolve({ items: [] }),
      ]);
      const rows = itemsOf(bookingRes).sort((a, b) => String(a.starts_at || '').localeCompare(String(b.starts_at || '')));
      const resourceRows = itemsOf(resourceRes); const serviceRows = itemsOf(serviceRes);
      if (isLatest()) {
        setBookings(rows); setResources(resourceRows); setServices(serviceRows); setParties(partyMap); setInvoices(itemsOf(invoiceRes));
        setClinicPatients(itemsOf(clinicPatientRes));
        setSelectedId((current) => rows.some((row) => row.id === current) ? current : rows[0]?.id || '');
      }
    } catch (reason) { if (isLatest()) setError(t(reason.message || 'Không tải được lịch hẹn.')); }
    finally { if (isLatest()) setLoading(false); }
  }, [healthcare, latestRequest]);
  useEffect(() => { load(); }, [load, healthcare]);
  const resourceById = useMemo(() => new Map(resources.map((row) => [row.id, row])), [resources]);
  const serviceById = useMemo(() => new Map(services.map((row) => [row.id, row])), [services]);
  const invoiceByBooking = useMemo(() => new Map(invoices.filter((row) => row.source === 'booking').map((row) => [row.source_id, row])), [invoices]);
  const selected = bookings.find((row) => row.id === selectedId);
  const bookableParties = useMemo(() => healthcare
    ? [...new Set(clinicPatients.map((patient) => patient.party).filter(Boolean))].map((id) => parties.get(id)).filter(Boolean)
    : [...parties.values()], [healthcare, clinicPatients, parties]);
  const today = localDate(new Date());
  const todays = bookings.filter((row) => localDate(row.starts_at) === today);
  const confirmed = todays.filter((row) => row.status === 'confirmed').length;
  const inProgress = todays.filter((row) => row.status === 'checked_in').length;
  const completed = todays.filter((row) => row.status === 'completed').length;
  const workflow = useWellnessBookingWorkflow({ healthcare, resources, services, clinicPatients, parties, bookableParties, selected, load, setError, t });
  const {
    form, setForm, editingBooking, setEditingBooking, editForm, setEditForm,
    resourceForm, setResourceForm, serviceForm, setServiceForm, busy, notice,
    createBooking, createResource, createService, change, startEditBooking, saveBooking,
  } = workflow;
  const selectedService = serviceById.get(form.service);
  const canNoShow = (row) => row.status === 'confirmed' && row.ends_at && new Date(row.ends_at).getTime() <= Date.now();
  const canExpire = (row) => row.status === 'requested' && row.ends_at && new Date(row.ends_at).getTime() <= Date.now();
  const kindLabel = (kind) => (healthcare
    ? ({ staff: 'Bác sĩ', room: 'Phòng khám', equipment: 'Thiết bị y tế' }[kind] || t('Tài nguyên'))
    : ({ staff: 'Kỹ thuật viên', room: 'Phòng', equipment: 'Thiết bị', table: 'Bàn', court: 'Sân' }[kind] || t('Tài nguyên')));
  return <div className="page">
    <div className="page-head"><div><h1>{t(healthcare ? 'Lịch hẹn khám' : 'Lịch dịch vụ và hội viên')}</h1><p className="sub">{t(healthcare ? 'Điều phối bác sĩ và phòng khám, quản lý lịch bệnh nhân, check-in và ghi nhận khách vắng.' : 'Điều phối kỹ thuật viên/phòng, quản lý lịch khách, check-in, hoàn tất và ghi nhận khách vắng.')}</p></div><button className="btn btn-secondary" type="button" disabled={loading || Boolean(busy)} onClick={() => load()}>{t('Làm mới')}</button></div>
    {error && <div className="alert danger" role="alert">{t(error)}</div>}{notice && <div className="alert success" role="status">{t(notice)}</div>}
    <div className="stats u-mb-16" ><div className="card stat"><span className="stat-label">{t('Lịch hôm nay')}</span><strong className="stat-value">{todays.length}</strong></div><div className="card stat"><span className="stat-label">{t('Đã xác nhận')}</span><strong className="stat-value">{confirmed}</strong></div><div className="card stat"><span className="stat-label">{t('Đang phục vụ')}</span><strong className="stat-value">{inProgress}</strong></div><div className="card stat"><span className="stat-label">{t('Đã hoàn tất')}</span><strong className="stat-value">{completed}</strong></div></div>
    {can('booking.booking.create') && resources.length > 0 && <BookingRequestForm
      healthcare={healthcare} form={form} bookableParties={bookableParties}
      resources={resources} services={services} requiresManualEnd={!selectedService || !selectedService.duration_min}
      kindLabel={kindLabel} fmtMoney={fmtMoney} busy={busy} recordLabel={recordLabel}
      onFieldChange={(field, value) => setForm((current) => ({ ...current, [field]: value }))}
      onServiceChange={(service) => setForm((current) => ({ ...current, service, ends_at: '' }))}
      onSubmit={createBooking} t={t}
    />}
    {can('booking.resource.create') && <section className="card card-pad u-mt-16" ><h2>{t('Danh mục vận hành')}</h2><div className="layout-split"><form className="form-grid" onSubmit={createResource}><h3 className="full">{t('Tài nguyên')}</h3><label className="field"><span className="label">{t('Tên kỹ thuật viên / phòng *')}</span><input className="input" required value={resourceForm.name} onChange={(e) => setResourceForm({ ...resourceForm, name: e.target.value })}/></label><label className="field"><span className="label">{t('Loại')}</span><select className="select" value={resourceForm.kind} onChange={(e) => setResourceForm({ ...resourceForm, kind: e.target.value })}>{[['staff','Kỹ thuật viên'],['room','Phòng'],['equipment','Thiết bị']].map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label><div className="row full"><span className="grow"/><button className="btn btn-secondary" disabled={Boolean(busy)}>{t('Thêm tài nguyên')}</button></div></form>
      {can('booking.service.create') && <form className="form-grid" onSubmit={createService}><h3 className="full">{t('Dịch vụ')}</h3><label className="field"><span className="label">{t('Tên dịch vụ *')}</span><input className="input" required value={serviceForm.name} onChange={(e) => setServiceForm({ ...serviceForm, name: e.target.value })}/></label><label className="field"><span className="label">{t('Thời lượng (phút) *')}</span><input className="input" type="number" min="1" step="1" required value={serviceForm.duration_min} onChange={(e) => setServiceForm({ ...serviceForm, duration_min: e.target.value })}/></label><label className="field"><span className="label">{t('Giá niêm yết *')}</span><input className="input" type="number" min="0" step="any" required value={serviceForm.price} onChange={(e) => setServiceForm({ ...serviceForm, price: e.target.value })}/></label><div className="row full"><span className="grow"/><button className="btn btn-secondary" disabled={Boolean(busy)}>{t('Thêm dịch vụ')}</button></div></form>}</div></section>}
    {loading ? <div className="skeleton" data-h="row"/> : <div className="layout-split u-mt-16" >
      <section className="card card-pad"><h2>{t('Lịch hẹn')}</h2>{!bookings.length ? <p className="empty">{t('Chưa có lịch hẹn.')}</p> : <div className="table-wrap"><table className="table"><thead><tr><th>{t('Giờ / khách')}</th><th>{t('Dịch vụ / tài nguyên')}</th><th>{t('Trạng thái')}</th></tr></thead><tbody>{bookings.map((row) => <tr {...selectableTableRowProps} key={row.id} aria-selected={selectedId === row.id} className={[selectedId === row.id ? 'selected' : '', 'u-pointer'].filter(Boolean).join(' ')} onClick={() => { setSelectedId(row.id); setEditingBooking(false); }} ><td><strong>{fmtDateTime(row.starts_at)}</strong><div className="small muted">{parties.has(row.party) ? recordLabel('master-data.party', parties.get(row.party)) : row.party ? `${t('Khách')} ${row.party.slice(0, 8)}` : t('Khách vãng lai')}</div></td><td>{serviceById.get(row.service)?.name || t('Dịch vụ')}<div className="small muted">{resourceById.get(row.resource)?.name || t('Tài nguyên')}</div></td><td>{statusLabel(row.status)}</td></tr>)}</tbody></table></div>}</section>
      {selected && <section className="card card-pad"><div className="row wrap"><div><h2>{serviceById.get(selected.service)?.name || t('Lịch dịch vụ')}</h2><div className="small muted">{parties.has(selected.party) ? recordLabel('master-data.party', parties.get(selected.party)) : selected.party ? `${t('Khách')} ${selected.party.slice(0,8)}` : t('Khách vãng lai')} · {resourceById.get(selected.resource)?.name || t('Tài nguyên')}</div></div><span className="grow"/><span className="badge warning">{statusLabel(selected.status)}</span></div>
        <dl className="dl u-mt-14" ><dt>{t('Bắt đầu')}</dt><dd>{fmtDateTime(selected.starts_at)}</dd><dt>{t('Kết thúc')}</dt><dd>{fmtDateTime(selected.ends_at)}</dd><dt>{t('Giá dịch vụ')}</dt><dd>{fmtMoney(selected.price || 0)}</dd><dt>{t('Ghi chú')}</dt><dd>{selected.note || '—'}</dd></dl>
        <div className="row wrap u-mt-14" >{selected.status === 'requested' && can('booking.booking.update') && <button className="btn btn-secondary" disabled={Boolean(busy)} onClick={() => editingBooking ? setEditingBooking(false) : startEditBooking(selected)}>{editingBooking ? t('Đóng chỉnh sửa') : t('Sửa lịch chờ')}</button>}{selected.status === 'requested' && can('booking.booking.confirmed') && <button className="btn btn-primary" disabled={Boolean(busy) || new Date(selected.starts_at).getTime() <= Date.now()} onClick={() => change(selected, 'confirmed')}>{t('Xác nhận lịch')}</button>}{selected.status === 'confirmed' && can('booking.booking.checked_in') && <button className="btn btn-primary" disabled={Boolean(busy) || Date.now() < new Date(selected.starts_at).getTime() || Date.now() >= new Date(selected.ends_at).getTime()} onClick={() => change(selected, 'checked_in')}>{t('Check-in')}</button>}{selected.status === 'checked_in' && !healthcare && can('booking.booking.completed') && <button className="btn btn-primary" disabled={Boolean(busy)} onClick={() => change(selected, 'completed')}>{t('Hoàn tất dịch vụ')}</button>}{selected.status === 'checked_in' && healthcare && <span className="small muted">{t('Hoàn tất dịch vụ trong hồ sơ lượt khám.')}</span>}{['requested','confirmed'].includes(selected.status) && can('booking.booking.cancelled') && <button className="btn btn-ghost" disabled={Boolean(busy) || new Date(selected.starts_at).getTime() <= Date.now()} onClick={() => change(selected, 'cancelled')}>{t('Hủy lịch')}</button>}{canExpire(selected) && can('booking.booking.expired') && <button className="btn btn-ghost" disabled={Boolean(busy)} onClick={() => change(selected, 'expired')}>{t('Đóng yêu cầu hết hạn')}</button>}{canNoShow(selected) && can('booking.booking.no_show') && <button className="btn btn-ghost" disabled={Boolean(busy)} onClick={() => change(selected, 'no_show')}>{t('Ghi nhận vắng mặt')}</button>}</div>
        {editingBooking && selected.status === 'requested' && <form className="card card-pad u-mt-12"  onSubmit={saveBooking}><h3>{t('Chỉnh lịch chờ')}</h3><div className="form-grid"><label className="field"><span className="label">{t('Tài nguyên *')}</span><select className="select" required value={editForm.resource} onChange={(event) => setEditForm({ ...editForm, resource: event.target.value })}>{resources.map((row) => <option key={row.id} value={row.id}>{row.name} · {t(kindLabel(row.kind))}</option>)}</select></label><label className="field"><span className="label">{t('Dịch vụ')}</span><select className="select" value={editForm.service} onChange={(event) => setEditForm({ ...editForm, service: event.target.value, price: '' })}><option value="">{t('Không gắn dịch vụ')}</option>{services.map((row) => <option key={row.id} value={row.id}>{row.name} · {row.duration_min || '—'} phút</option>)}</select></label><label className="field"><span className="label">{t('Bắt đầu *')}</span><input className="input" required type="datetime-local" value={editForm.starts_at} onChange={(event) => setEditForm({ ...editForm, starts_at: event.target.value })}/></label><label className="field"><span className="label">{t('Kết thúc *')}</span><input className="input" required type="datetime-local" min={editForm.starts_at} value={editForm.ends_at} onChange={(event) => setEditForm({ ...editForm, ends_at: event.target.value })}/></label><label className="field"><span className="label">{t('Giá thỏa thuận')}</span><input className="input" type="number" min="0" step="any" value={editForm.price} onChange={(event) => setEditForm({ ...editForm, price: event.target.value })}/></label><label className="field"><span className="label">{t('Ghi chú')}</span><input className="input" maxLength="2000" value={editForm.note} onChange={(event) => setEditForm({ ...editForm, note: event.target.value })}/></label></div><div className="row u-mt-10" ><span className="grow"/><button className="btn btn-primary" disabled={Boolean(busy)}>{t('Lưu thay đổi')}</button></div></form>}
        {healthcare && selected.status === 'checked_in' && <p className="u-mt-12"><a className="btn btn-secondary btn-sm" href="#/clinic">{t('Mở hồ sơ phòng khám')}</a></p>}
        {invoiceByBooking.has(selected.id) && <p className="u-mt-12"><a className="btn btn-secondary btn-sm" href={`#/e/accounting/invoice/${invoiceByBooking.get(selected.id).id}`}>{t('Mở hóa đơn')} {statusLabel(invoiceByBooking.get(selected.id).status)}</a></p>}
      </section>}
    </div>}
  </div>;
}
