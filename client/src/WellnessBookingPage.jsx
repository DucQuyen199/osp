import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { localDate as businessDate, localDateTime as businessDateTime, localDateTimeToIso } from './lib/dates.js';
import { api, dataPath } from './lib/api.js';
import { fmtDateTime, fmtMoney, statusLabel } from './lib/i18n.js';
import { can, loadRefs, recordLabel, loadAllResponse } from './lib/state.js';

const itemsOf = (response) => Array.isArray(response?.items) ? response.items : [];
const localDate = (value) => {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : businessDate(date);
};
const action = (row, verb) => api(dataPath('booking.booking', row.id, verb), { method: 'POST' });

export default function WellnessBookingPage({ healthcare = false }) {
  const [bookings, setBookings] = useState([]);
  const [resources, setResources] = useState([]);
  const [services, setServices] = useState([]);
  const [clinicPatients, setClinicPatients] = useState([]);
  const [parties, setParties] = useState(new Map());
  const [invoices, setInvoices] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [form, setForm] = useState({ party: '', resource: '', service: '', starts_at: businessDateTime(new Date(Date.now() + 3600000)), ends_at: '', price: '', note: '' });
  const [resourceForm, setResourceForm] = useState({ name: '', kind: 'staff' });
  const [serviceForm, setServiceForm] = useState({ name: '', duration_min: '', price: '' });
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async (quiet = false) => {
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
      setBookings(rows); setResources(resourceRows); setServices(serviceRows); setParties(partyMap); setInvoices(itemsOf(invoiceRes));
      setClinicPatients(itemsOf(clinicPatientRes));
      setSelectedId((current) => rows.some((row) => row.id === current) ? current : rows[0]?.id || '');
      const patientPartyIds = new Set(itemsOf(clinicPatientRes).map((patient) => patient.party).filter(Boolean));
      const availableParties = healthcare ? [...patientPartyIds].filter((id) => partyMap.has(id)) : [...partyMap.keys()];
      setForm((current) => ({ ...current, party: availableParties.includes(current.party) ? current.party : availableParties[0] || '', resource: current.resource || resourceRows[0]?.id || '', service: current.service || serviceRows[0]?.id || '' }));
    } catch (reason) { setError(reason.message || 'Không tải được lịch hẹn.'); }
    finally { if (!quiet) setLoading(false); }
  }, []);

  useEffect(() => { document.title = 'Lịch dịch vụ và hội viên · OSP Suite'; load(); }, [load]);
  const resourceById = useMemo(() => new Map(resources.map((row) => [row.id, row])), [resources]);
  const serviceById = useMemo(() => new Map(services.map((row) => [row.id, row])), [services]);
  const invoiceByBooking = useMemo(() => new Map(invoices.filter((row) => row.source === 'booking').map((row) => [row.source_id, row])), [invoices]);
  const selected = bookings.find((row) => row.id === selectedId);
  const bookableParties = healthcare
    ? [...new Set(clinicPatients.map((patient) => patient.party).filter(Boolean))].map((id) => parties.get(id)).filter(Boolean)
    : [...parties.values()];
  const today = localDate(new Date());
  const todays = bookings.filter((row) => localDate(row.starts_at) === today);
  const confirmed = todays.filter((row) => row.status === 'confirmed').length;
  const inProgress = todays.filter((row) => row.status === 'checked_in').length;
  const completed = todays.filter((row) => row.status === 'completed').length;
  const selectedService = serviceById.get(form.service);

  async function run(key, operation, success) {
    setBusy(key); setError(''); setNotice('');
    try { await operation(); setNotice(success); await load(true); }
    catch (reason) { setError(reason.message || 'Thao tác không thành công.'); await load(true); }
    finally { setBusy(''); }
  }

  async function createBooking(event) {
    event.preventDefault();
    await run('booking', async () => {
      if (healthcare && !bookableParties.some((party) => party.id === form.party)) throw new Error('Chọn hồ sơ bệnh nhân đã đăng ký trước khi đặt lịch khám.');
      const startsAt = localDateTimeToIso(form.starts_at);
      const endsAt = form.ends_at ? localDateTimeToIso(form.ends_at) : undefined;
      if (!startsAt || (form.ends_at && !endsAt)) throw new Error('Giờ hẹn không hợp lệ trong múi giờ kinh doanh.');
      const body = { resource: form.resource, service: form.service || undefined, party: form.party || undefined, starts_at: startsAt, note: form.note.trim() || undefined };
      if (endsAt) body.ends_at = endsAt;
      if (form.price !== '') body.price = Number(form.price);
      await api(dataPath('booking.booking'), { method: 'POST', body });
    }, 'Đã tiếp nhận lịch hẹn. Tài nguyên và khung giờ sẽ được kiểm tra trùng lịch ở máy chủ.');
    setForm((current) => ({ ...current, note: '', price: '', ends_at: '' }));
  }

  async function createResource(event) {
    event.preventDefault();
    await run('resource', () => api(dataPath('booking.resource'), { method: 'POST', body: resourceForm }), 'Đã thêm kỹ thuật viên hoặc phòng vào danh mục tài nguyên.');
    setResourceForm({ name: '', kind: 'staff' });
  }

  async function createService(event) {
    event.preventDefault();
    await run('service', () => api(dataPath('booking.service'), { method: 'POST', body: { ...serviceForm, duration_min: Number(serviceForm.duration_min), price: Number(serviceForm.price) } }), 'Đã thêm dịch vụ và giá niêm yết.');
    setServiceForm({ name: '', duration_min: '', price: '' });
  }

  async function change(row, verb) {
    const messages = { confirmed: 'Đã xác nhận lịch và khóa khung giờ tài nguyên.', checked_in: 'Đã check-in khách.', completed: 'Đã hoàn tất dịch vụ; hóa đơn được tạo theo cấu hình kế toán.', cancelled: 'Đã hủy lịch.', no_show: 'Đã ghi nhận khách vắng mặt.' };
    await run(`${row.id}:${verb}`, () => action(row, verb), messages[verb]);
  }

  const canNoShow = (row) => row.status === 'confirmed' && row.ends_at && new Date(row.ends_at).getTime() <= Date.now();
  const kindLabel = (kind) => (healthcare
    ? ({ staff: 'Bác sĩ', room: 'Phòng khám', equipment: 'Thiết bị y tế' }[kind] || 'Tài nguyên')
    : ({ staff: 'Kỹ thuật viên', room: 'Phòng', equipment: 'Thiết bị', table: 'Bàn', court: 'Sân' }[kind] || 'Tài nguyên'));

  return <div className="page">
    <div className="page-head"><div><h1>{healthcare ? 'Lịch hẹn khám' : 'Lịch dịch vụ và hội viên'}</h1><p className="sub">{healthcare ? 'Điều phối bác sĩ và phòng khám, quản lý lịch bệnh nhân, check-in và ghi nhận khách vắng.' : 'Điều phối kỹ thuật viên/phòng, quản lý lịch khách, check-in, hoàn tất và ghi nhận khách vắng.'}</p></div><button className="btn btn-secondary" type="button" disabled={loading || Boolean(busy)} onClick={() => load()}>Làm mới</button></div>
    {error && <div className="alert danger" role="alert">{error}</div>}{notice && <div className="alert success" role="status">{notice}</div>}
    <div className="stats" style={{ marginBottom: 16 }}><div className="card stat"><span className="stat-label">Lịch hôm nay</span><strong className="stat-value">{todays.length}</strong></div><div className="card stat"><span className="stat-label">Đã xác nhận</span><strong className="stat-value">{confirmed}</strong></div><div className="card stat"><span className="stat-label">Đang phục vụ</span><strong className="stat-value">{inProgress}</strong></div><div className="card stat"><span className="stat-label">Đã hoàn tất</span><strong className="stat-value">{completed}</strong></div></div>
    {can('booking.booking.create') && resources.length > 0 && <section className="card card-pad"><h2>{healthcare ? 'Đặt lịch khám' : 'Đặt lịch dịch vụ'}</h2><form className="form-grid" onSubmit={createBooking}>
      <label className="field"><span className="label">{healthcare ? 'Bệnh nhân' : 'Khách hàng'}</span><select className="select" required={healthcare} value={form.party} onChange={(e) => setForm({ ...form, party: e.target.value })}><option value="">{healthcare ? 'Chọn hồ sơ bệnh nhân' : 'Khách chưa đăng ký'}</option>{bookableParties.map((party) => <option key={party.id} value={party.id}>{recordLabel('master-data.party', party)}</option>)}</select>{healthcare && !bookableParties.length && <span className="small muted">Đăng ký hồ sơ bệnh nhân trước khi đặt lịch khám.</span>}</label>
      <label className="field"><span className="label">{healthcare ? 'Bác sĩ / phòng khám *' : 'Kỹ thuật viên / phòng *'}</span><select className="select" required value={form.resource} onChange={(e) => setForm({ ...form, resource: e.target.value })}><option value="">Chọn tài nguyên</option>{resources.map((row) => <option key={row.id} value={row.id}>{row.name} · {kindLabel(row.kind)}</option>)}</select></label>
      {services.length > 0 && <label className="field"><span className="label">{healthcare ? 'Dịch vụ khám' : 'Dịch vụ'}</span><select className="select" value={form.service} onChange={(e) => setForm({ ...form, service: e.target.value, ends_at: '' })}><option value="">Lịch không gắn dịch vụ</option>{services.map((row) => <option key={row.id} value={row.id}>{row.name} · {row.duration_min || '—'} phút · {fmtMoney(row.price || 0)}</option>)}</select></label>}
      <label className="field"><span className="label">Bắt đầu *</span><input className="input" required type="datetime-local" value={form.starts_at} onChange={(e) => setForm({ ...form, starts_at: e.target.value })}/></label>
      {(!selectedService || !selectedService.duration_min) && <label className="field"><span className="label">Kết thúc *</span><input className="input" required type="datetime-local" min={form.starts_at} value={form.ends_at} onChange={(e) => setForm({ ...form, ends_at: e.target.value })}/></label>}
      <label className="field"><span className="label">Giá thỏa thuận (để trống dùng giá dịch vụ)</span><input className="input" type="number" min="0" step="any" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })}/></label>
      <label className="field"><span className="label">Ghi chú</span><input className="input" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })}/></label>
      <div className="row full"><span className="grow"/><button className="btn btn-primary" disabled={Boolean(busy)}>Tiếp nhận lịch</button></div>
    </form></section>}

    {can('booking.resource.create') && <section className="card card-pad" style={{ marginTop: 16 }}><h2>Danh mục vận hành</h2><div className="layout-split"><form className="form-grid" onSubmit={createResource}><h3 className="full">Tài nguyên</h3><label className="field"><span className="label">Tên kỹ thuật viên / phòng *</span><input className="input" required value={resourceForm.name} onChange={(e) => setResourceForm({ ...resourceForm, name: e.target.value })}/></label><label className="field"><span className="label">Loại</span><select className="select" value={resourceForm.kind} onChange={(e) => setResourceForm({ ...resourceForm, kind: e.target.value })}>{[['staff','Kỹ thuật viên'],['room','Phòng'],['equipment','Thiết bị']].map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label><div className="row full"><span className="grow"/><button className="btn btn-secondary" disabled={Boolean(busy)}>Thêm tài nguyên</button></div></form>
      {can('booking.service.create') && <form className="form-grid" onSubmit={createService}><h3 className="full">Dịch vụ</h3><label className="field"><span className="label">Tên dịch vụ *</span><input className="input" required value={serviceForm.name} onChange={(e) => setServiceForm({ ...serviceForm, name: e.target.value })}/></label><label className="field"><span className="label">Thời lượng (phút) *</span><input className="input" type="number" min="1" step="1" required value={serviceForm.duration_min} onChange={(e) => setServiceForm({ ...serviceForm, duration_min: e.target.value })}/></label><label className="field"><span className="label">Giá niêm yết *</span><input className="input" type="number" min="0" step="any" required value={serviceForm.price} onChange={(e) => setServiceForm({ ...serviceForm, price: e.target.value })}/></label><div className="row full"><span className="grow"/><button className="btn btn-secondary" disabled={Boolean(busy)}>Thêm dịch vụ</button></div></form>}</div></section>}

    {loading ? <div className="skeleton" data-h="row"/> : <div className="layout-split" style={{ marginTop: 16 }}>
      <section className="card card-pad"><h2>Lịch hẹn</h2>{!bookings.length ? <p className="empty">Chưa có lịch hẹn.</p> : <div className="table-wrap"><table className="table"><thead><tr><th>Giờ / khách</th><th>Dịch vụ / tài nguyên</th><th>Trạng thái</th></tr></thead><tbody>{bookings.map((row) => <tr key={row.id} className={selectedId === row.id ? 'selected' : ''} onClick={() => setSelectedId(row.id)} style={{ cursor: 'pointer' }}><td><strong>{fmtDateTime(row.starts_at)}</strong><div className="small muted">{parties.has(row.party) ? recordLabel('master-data.party', parties.get(row.party)) : row.party ? `Khách ${row.party.slice(0, 8)}` : 'Khách vãng lai'}</div></td><td>{serviceById.get(row.service)?.name || 'Dịch vụ'}<div className="small muted">{resourceById.get(row.resource)?.name || 'Tài nguyên'}</div></td><td>{statusLabel(row.status)}</td></tr>)}</tbody></table></div>}</section>
      {selected && <section className="card card-pad"><div className="row wrap"><div><h2>{serviceById.get(selected.service)?.name || 'Lịch dịch vụ'}</h2><div className="small muted">{parties.has(selected.party) ? recordLabel('master-data.party', parties.get(selected.party)) : selected.party ? `Khách ${selected.party.slice(0,8)}` : 'Khách vãng lai'} · {resourceById.get(selected.resource)?.name || 'Tài nguyên'}</div></div><span className="grow"/><span className="badge warning">{statusLabel(selected.status)}</span></div>
        <dl className="dl" style={{ marginTop: 14 }}><dt>Bắt đầu</dt><dd>{fmtDateTime(selected.starts_at)}</dd><dt>Kết thúc</dt><dd>{fmtDateTime(selected.ends_at)}</dd><dt>Giá dịch vụ</dt><dd>{fmtMoney(selected.price || 0)}</dd><dt>Ghi chú</dt><dd>{selected.note || '—'}</dd></dl>
        <div className="row wrap" style={{ marginTop: 14 }}>{selected.status === 'requested' && can('booking.booking.confirmed') && <button className="btn btn-primary" disabled={Boolean(busy) || new Date(selected.starts_at).getTime() <= Date.now()} onClick={() => change(selected, 'confirmed')}>Xác nhận lịch</button>}{selected.status === 'confirmed' && can('booking.booking.checked_in') && <button className="btn btn-primary" disabled={Boolean(busy) || Date.now() < new Date(selected.starts_at).getTime() || Date.now() >= new Date(selected.ends_at).getTime()} onClick={() => change(selected, 'checked_in')}>Check-in</button>}{selected.status === 'checked_in' && can('booking.booking.completed') && <button className="btn btn-primary" disabled={Boolean(busy)} onClick={() => change(selected, 'completed')}>Hoàn tất dịch vụ</button>}{['requested','confirmed'].includes(selected.status) && can('booking.booking.cancelled') && <button className="btn btn-ghost" disabled={Boolean(busy) || new Date(selected.starts_at).getTime() <= Date.now()} onClick={() => change(selected, 'cancelled')}>Hủy lịch</button>}{canNoShow(selected) && can('booking.booking.no_show') && <button className="btn btn-ghost" disabled={Boolean(busy)} onClick={() => change(selected, 'no_show')}>Ghi nhận vắng mặt</button>}</div>
        {invoiceByBooking.has(selected.id) && <p style={{ marginTop: 12 }}><a className="btn btn-secondary btn-sm" href={`#/e/accounting/invoice/${invoiceByBooking.get(selected.id).id}`}>Mở hóa đơn {statusLabel(invoiceByBooking.get(selected.id).status)}</a></p>}
      </section>}
    </div>}
  </div>;
}
