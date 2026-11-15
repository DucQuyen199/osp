import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { localDate } from './lib/dates.js';
import { api, dataPath } from './lib/api.js';
import { fmtDate, fmtDateTime, fmtMoney, statusLabel } from './lib/i18n.js';
import { can, loadRefs, recordLabel, loadAllResponse } from './lib/state.js';

const today = localDate;
const action = (entity, row, verb) => api(dataPath(entity, row.id, verb), { method: 'POST' });
const itemsOf = (response) => Array.isArray(response?.items) ? response.items : [];

export default function RealEstateWorkbenchPage() {
  const [properties, setProperties] = useState([]);
  const [reservations, setReservations] = useState([]);
  const [viewings, setViewings] = useState([]);
  const [leases, setLeases] = useState([]);
  const [rentCycles, setRentCycles] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [parties, setParties] = useState(new Map());
  const [selectedProperty, setSelectedProperty] = useState('');
  const [propertyForm, setPropertyForm] = useState({ title: '', kind: 'apartment', address: '', area: '', price: '' });
  const [viewingForm, setViewingForm] = useState({ property: '', party: '', at: '', note: '' });
  const [reservationForm, setReservationForm] = useState({ property: '', party: '', number: '', agreed_price: '', expires_on: today(), notes: '' });
  const [leaseForm, setLeaseForm] = useState({ property: '', tenant: '', rent: '', billing_interval: 'monthly', start_date: today(), end_date: '' });
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async (quiet = false) => {
    if (!quiet) { setLoading(true); setError(''); }
    try {
      const [propertyRes, reservationRes, viewingRes, leaseRes, cycleRes, partyMap, invoiceRes] = await Promise.all([
        loadAllResponse('real-estate.property'),
        can('real-estate.reservation.read') ? loadAllResponse('real-estate.reservation') : Promise.resolve({ items: [] }),
        can('real-estate.viewing.read') ? loadAllResponse('real-estate.viewing') : Promise.resolve({ items: [] }),
        can('real-estate.lease.read') ? loadAllResponse('real-estate.lease') : Promise.resolve({ items: [] }),
        can('real-estate.rent_cycle.read') ? loadAllResponse('real-estate.rent_cycle') : Promise.resolve({ items: [] }),
        loadRefs('master-data.party'),
        can('accounting.invoice.read') ? loadAllResponse('accounting.invoice') : Promise.resolve({ items: [] }),
      ]);
      const propertyRows = itemsOf(propertyRes);
      setProperties(propertyRows); setReservations(itemsOf(reservationRes)); setViewings(itemsOf(viewingRes));
      setLeases(itemsOf(leaseRes)); setRentCycles(itemsOf(cycleRes)); setInvoices(itemsOf(invoiceRes)); setParties(partyMap);
      setSelectedProperty((current) => propertyRows.some((row) => row.id === current) ? current : propertyRows[0]?.id || '');
      setViewingForm((current) => ({ ...current, property: current.property || propertyRows.find((row) => row.status === 'available')?.id || '' }));
      setReservationForm((current) => ({ ...current, property: current.property || propertyRows.find((row) => row.status === 'available')?.id || '', party: current.party || [...partyMap.keys()][0] || '' }));
      setLeaseForm((current) => ({ ...current, property: current.property || propertyRows.find((row) => ['available', 'reserved'].includes(row.status))?.id || '', tenant: current.tenant || [...partyMap.keys()][0] || '' }));
    } catch (reason) { setError(reason.message || 'Không tải được dữ liệu bất động sản.'); }
    finally { if (!quiet) setLoading(false); }
  }, []);

  useEffect(() => { document.title = 'Sàn giao dịch và cho thuê · OSP Suite'; load(); }, [load]);
  const propertyById = useMemo(() => new Map(properties.map((row) => [row.id, row])), [properties]);
  const selected = propertyById.get(selectedProperty);
  const saleInvoice = selected && invoices.find((row) => row.source === 'property' && row.source_id === selected.id);
  const availableCount = properties.filter((row) => row.status === 'available').length;
  const reservedCount = properties.filter((row) => row.status === 'reserved').length;
  const leasedCount = properties.filter((row) => row.status === 'leased').length;
  const invoiceByCycle = useMemo(() => new Map(invoices.filter((row) => row.source === 'real_estate_rent_cycle').map((row) => [row.source_id, row])), [invoices]);
  const viewingRows = useMemo(() => viewings.filter((row) => row.property === selectedProperty).sort((a, b) => String(a.at || '').localeCompare(String(b.at || ''))), [viewings, selectedProperty]);
  const reservationRows = useMemo(() => reservations.filter((row) => row.property === selectedProperty), [reservations, selectedProperty]);
  const leaseRows = useMemo(() => leases.filter((row) => row.property === selectedProperty), [leases, selectedProperty]);
  const cycleRows = useMemo(() => rentCycles.filter((row) => leaseRows.some((lease) => lease.id === row.lease)).sort((a, b) => String(b.due_date || '').localeCompare(String(a.due_date || ''))), [rentCycles, leaseRows]);

  async function run(label, operation, success) {
    setBusy(label); setError(''); setNotice('');
    try { await operation(); setNotice(success); await load(true); }
    catch (reason) { setError(reason.message || 'Thao tác không thành công.'); await load(true); }
    finally { setBusy(''); }
  }

  async function createProperty(event) {
    event.preventDefault();
    await run('property', () => api(dataPath('real-estate.property'), { method: 'POST', body: { ...propertyForm, area: propertyForm.area ? Number(propertyForm.area) : undefined, price: propertyForm.price ? Number(propertyForm.price) : undefined } }), 'Đã thêm bất động sản vào giỏ hàng.');
    setPropertyForm({ title: '', kind: 'apartment', address: '', area: '', price: '' });
  }

  async function createViewing(event) {
    event.preventDefault();
    await run('viewing', () => api(dataPath('real-estate.viewing'), { method: 'POST', body: { ...viewingForm, property: selectedProperty, party: viewingForm.party || undefined, at: viewingForm.at ? new Date(viewingForm.at).toISOString() : undefined } }), 'Đã xếp lịch xem bất động sản.');
    setViewingForm((current) => ({ ...current, at: '', note: '' }));
  }

  async function createReservation(event) {
    event.preventDefault();
    await run('reservation', async () => {
      const row = await api(dataPath('real-estate.reservation'), { method: 'POST', body: { ...reservationForm, property: selectedProperty, agreed_price: Number(reservationForm.agreed_price), status: 'draft' } });
      await action('real-estate.reservation', row, 'reserved');
    }, 'Đã xác nhận giữ chỗ; bất động sản đã chuyển trạng thái giữ chỗ.');
    setReservationForm((current) => ({ ...current, number: '', agreed_price: '', notes: '' }));
  }

  async function createLease(event) {
    event.preventDefault();
    await run('lease', () => api(dataPath('real-estate.lease'), { method: 'POST', body: { ...leaseForm, property: selectedProperty, rent: Number(leaseForm.rent), status: 'draft' } }), 'Đã tạo dự thảo hợp đồng thuê. Kích hoạt hợp đồng sau khi chốt điều khoản.');
    setLeaseForm((current) => ({ ...current, rent: '', end_date: '' }));
  }

  async function transition(entity, row, verb, success) {
    await run(`${row.id}:${verb}`, () => action(entity, row, verb), success);
  }

  const kindLabel = (kind) => ({ apartment: 'Căn hộ', house: 'Nhà', land: 'Đất', office: 'Văn phòng', shop: 'Mặt bằng' }[kind] || 'Bất động sản');

  return <div className="page">
    <div className="page-head"><div><h1>Sàn giao dịch và cho thuê</h1><p className="sub">Quản lý giỏ hàng, lịch xem, giữ chỗ, chốt bán và hợp đồng thuê kèm kỳ thu tiền.</p></div><button className="btn btn-secondary" type="button" disabled={loading || Boolean(busy)} onClick={() => load()}>Làm mới</button></div>
    {error && <div className="alert danger" role="alert">{error}</div>}{notice && <div className="alert success" role="status">{notice}</div>}
    <div className="stats" style={{ marginBottom: 16 }}><div className="card stat"><span className="stat-label">Đang mở bán / cho thuê</span><strong className="stat-value">{availableCount}</strong></div><div className="card stat"><span className="stat-label">Đang giữ chỗ</span><strong className="stat-value">{reservedCount}</strong></div><div className="card stat"><span className="stat-label">Đang cho thuê</span><strong className="stat-value">{leasedCount}</strong></div></div>

    {can('real-estate.property.create') && <section className="card card-pad"><h2>Đưa bất động sản vào giỏ hàng</h2><form className="form-grid" onSubmit={createProperty}>
      <label className="field"><span className="label">Tên / mã căn *</span><input className="input" required value={propertyForm.title} onChange={(e) => setPropertyForm({ ...propertyForm, title: e.target.value })} /></label>
      <label className="field"><span className="label">Loại hình</span><select className="select" value={propertyForm.kind} onChange={(e) => setPropertyForm({ ...propertyForm, kind: e.target.value })}>{[['apartment','Căn hộ'],['house','Nhà'],['land','Đất'],['office','Văn phòng'],['shop','Mặt bằng']].map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="field"><span className="label">Diện tích (m²)</span><input className="input" type="number" min="0.01" step="any" value={propertyForm.area} onChange={(e) => setPropertyForm({ ...propertyForm, area: e.target.value })} /></label>
      <label className="field"><span className="label">Giá niêm yết</span><input className="input" type="number" min="0" step="any" value={propertyForm.price} onChange={(e) => setPropertyForm({ ...propertyForm, price: e.target.value })} /></label>
      <label className="field"><span className="label">Địa chỉ</span><input className="input" value={propertyForm.address} onChange={(e) => setPropertyForm({ ...propertyForm, address: e.target.value })} /></label>
      <div className="row full"><span className="grow" /><button className="btn btn-primary" disabled={Boolean(busy)}>Thêm bất động sản</button></div>
    </form></section>}

    {loading ? <div className="skeleton" data-h="row" /> : !properties.length ? <div className="card card-pad empty">Chưa có bất động sản. Thêm tài sản mới để bắt đầu nhận lịch xem và giữ chỗ.</div> : <div className="layout-split" style={{ marginTop: 16 }}>
      <section className="card card-pad"><h2>Danh mục bất động sản</h2><div className="table-wrap"><table className="table"><thead><tr><th>Tài sản</th><th>Diện tích</th><th>Giá niêm yết</th><th>Trạng thái</th></tr></thead><tbody>{properties.map((row) => <tr key={row.id} className={selectedProperty === row.id ? 'selected' : ''} onClick={() => setSelectedProperty(row.id)} style={{ cursor: 'pointer' }}><td><strong>{row.title}</strong><div className="small muted">{kindLabel(row.kind)} · {row.address || 'Chưa có địa chỉ'}</div></td><td>{row.area ? `${row.area} m²` : '—'}</td><td>{fmtMoney(row.sale_price || row.price || 0)}</td><td>{statusLabel(row.status)}</td></tr>)}</tbody></table></div></section>
      {selected && <section className="card card-pad"><div className="row wrap"><div><h2>{selected.title}</h2><div className="small muted">{kindLabel(selected.kind)} · {selected.address || 'Chưa có địa chỉ'} · {selected.area ? `${selected.area} m²` : 'Chưa nhập diện tích'}</div></div><span className="grow"/><span className="badge warning">{statusLabel(selected.status)}</span></div>

        {can('real-estate.viewing.create') && <form className="form-grid" style={{ marginTop: 16 }} onSubmit={createViewing}><h3 className="full">Lịch xem</h3><label className="field"><span className="label">Khách quan tâm</span><select className="select" value={viewingForm.party} onChange={(e) => setViewingForm({ ...viewingForm, party: e.target.value })}><option value="">Chưa xác định</option>{[...parties.values()].map((party) => <option key={party.id} value={party.id}>{recordLabel('master-data.party', party)}</option>)}</select></label><label className="field"><span className="label">Thời gian *</span><input className="input" required type="datetime-local" value={viewingForm.at} onChange={(e) => setViewingForm({ ...viewingForm, at: e.target.value })}/></label><label className="field full"><span className="label">Ghi chú</span><input className="input" value={viewingForm.note} onChange={(e) => setViewingForm({ ...viewingForm, note: e.target.value })}/></label><div className="row full"><span className="grow"/><button className="btn btn-secondary" disabled={Boolean(busy)}>Xếp lịch xem</button></div></form>}
        {viewingRows.length > 0 && <div className="table-wrap"><table className="table"><thead><tr><th>Lịch xem</th><th>Khách</th><th>Ghi chú</th></tr></thead><tbody>{viewingRows.map((row) => <tr key={row.id}><td>{row.at ? fmtDateTime(row.at) : 'Chưa xếp lịch'}</td><td>{parties.has(row.party) ? recordLabel('master-data.party', parties.get(row.party)) : '—'}</td><td>{row.note || '—'}</td></tr>)}</tbody></table></div>}

        {can('real-estate.reservation.create') && <form className="form-grid" style={{ marginTop: 20 }} onSubmit={createReservation}><h3 className="full">Giữ chỗ / chốt bán</h3><label className="field"><span className="label">Khách mua *</span><select className="select" required value={reservationForm.party} onChange={(e) => setReservationForm({ ...reservationForm, party: e.target.value })}><option value="">Chọn khách</option>{[...parties.values()].map((party) => <option key={party.id} value={party.id}>{recordLabel('master-data.party', party)}</option>)}</select></label><label className="field"><span className="label">Số phiếu *</span><input className="input" required value={reservationForm.number} onChange={(e) => setReservationForm({ ...reservationForm, number: e.target.value })}/></label><label className="field"><span className="label">Giá thỏa thuận *</span><input className="input" required type="number" min="0.01" step="any" value={reservationForm.agreed_price} onChange={(e) => setReservationForm({ ...reservationForm, agreed_price: e.target.value })}/></label><label className="field"><span className="label">Giữ chỗ đến *</span><input className="input" required type="date" min={today()} value={reservationForm.expires_on} onChange={(e) => setReservationForm({ ...reservationForm, expires_on: e.target.value })}/></label><label className="field full"><span className="label">Điều khoản / ghi chú</span><input className="input" value={reservationForm.notes} onChange={(e) => setReservationForm({ ...reservationForm, notes: e.target.value })}/></label><div className="row full"><span className="grow"/><button className="btn btn-primary" disabled={Boolean(busy) || selected.status !== 'available'}>Xác nhận giữ chỗ</button></div></form>}
        {reservationRows.length > 0 && <div className="table-wrap" style={{ marginTop: 12 }}><table className="table"><thead><tr><th>Phiếu</th><th>Khách</th><th>Giá</th><th>Hạn giữ</th><th>Trạng thái / thao tác</th></tr></thead><tbody>{reservationRows.map((row) => <tr key={row.id}><td>{row.number}</td><td>{parties.has(row.party) ? recordLabel('master-data.party', parties.get(row.party)) : '—'}</td><td>{fmtMoney(row.agreed_price || 0)}</td><td>{fmtDate(row.expires_on)}</td><td><span className="badge warning">{statusLabel(row.status)}</span>{row.status === 'reserved' && can('real-estate.reservation.converted') && <button className="btn btn-primary btn-sm" style={{ marginLeft: 8 }} disabled={Boolean(busy)} onClick={() => transition('real-estate.reservation', row, 'converted', 'Đã chốt giao dịch; tài sản được ghi nhận đã bán và hóa đơn đã tạo.')}>Chốt bán</button>}{row.status === 'reserved' && row.expires_on < today() && can('real-estate.reservation.expired') && <button className="btn btn-secondary btn-sm" style={{ marginLeft: 6 }} disabled={Boolean(busy)} onClick={() => transition('real-estate.reservation', row, 'expired', 'Đã hết hạn giữ chỗ; tài sản được giải phóng.')}>Đánh dấu hết hạn</button>}{['draft','reserved'].includes(row.status) && can('real-estate.reservation.cancelled') && <button className="btn btn-ghost btn-sm" style={{ marginLeft: 6 }} disabled={Boolean(busy)} onClick={() => transition('real-estate.reservation', row, 'cancelled', 'Đã hủy phiếu giữ chỗ; trạng thái tài sản được cập nhật.')}>Hủy</button>}</td></tr>)}</tbody></table></div>}

        {can('real-estate.lease.create') && <form className="form-grid" style={{ marginTop: 20 }} onSubmit={createLease}><h3 className="full">Hợp đồng thuê</h3><label className="field"><span className="label">Bên thuê *</span><select className="select" required value={leaseForm.tenant} onChange={(e) => setLeaseForm({ ...leaseForm, tenant: e.target.value })}><option value="">Chọn bên thuê</option>{[...parties.values()].map((party) => <option key={party.id} value={party.id}>{recordLabel('master-data.party', party)}</option>)}</select></label><label className="field"><span className="label">Tiền thuê mỗi kỳ *</span><input className="input" required type="number" min="0.01" step="any" value={leaseForm.rent} onChange={(e) => setLeaseForm({ ...leaseForm, rent: e.target.value })}/></label><label className="field"><span className="label">Chu kỳ thu</span><select className="select" value={leaseForm.billing_interval} onChange={(e) => setLeaseForm({ ...leaseForm, billing_interval: e.target.value })}><option value="monthly">Hàng tháng</option><option value="quarterly">Hàng quý</option><option value="yearly">Hàng năm</option></select></label><label className="field"><span className="label">Ngày bắt đầu *</span><input className="input" required type="date" value={leaseForm.start_date} onChange={(e) => setLeaseForm({ ...leaseForm, start_date: e.target.value })}/></label><label className="field"><span className="label">Ngày kết thúc *</span><input className="input" required type="date" min={leaseForm.start_date} value={leaseForm.end_date} onChange={(e) => setLeaseForm({ ...leaseForm, end_date: e.target.value })}/></label><div className="row full"><span className="grow"/><button className="btn btn-secondary" disabled={Boolean(busy) || selected.status !== 'available'}>Tạo dự thảo thuê</button></div></form>}
        {leaseRows.length > 0 && <div className="table-wrap" style={{ marginTop: 12 }}><table className="table"><thead><tr><th>Bên thuê</th><th>Tiền thuê</th><th>Thời hạn</th><th>Trạng thái / thao tác</th></tr></thead><tbody>{leaseRows.map((row) => <tr key={row.id}><td>{parties.has(row.tenant) ? recordLabel('master-data.party', parties.get(row.tenant)) : '—'}<div className="small muted">{({monthly:'Hàng tháng',quarterly:'Hàng quý',yearly:'Hàng năm'}[row.billing_interval] || 'Hàng tháng')}</div></td><td>{fmtMoney(row.rent || 0)}</td><td>{fmtDate(row.start_date)} – {fmtDate(row.end_date)}</td><td><span className="badge warning">{statusLabel(row.status)}</span>{row.status === 'draft' && can('real-estate.lease.activated') && <button className="btn btn-primary btn-sm" style={{ marginLeft: 8 }} disabled={Boolean(busy)} onClick={() => transition('real-estate.lease', row, 'activated', 'Đã kích hoạt hợp đồng; tài sản được chuyển sang đang cho thuê.')}>Kích hoạt</button>}{row.status === 'active' && row.next_rent_date && row.next_rent_date <= today() && can('real-estate.lease.rent_due') && <button className="btn btn-secondary btn-sm" style={{ marginLeft: 8 }} disabled={Boolean(busy)} onClick={() => transition('real-estate.lease', row, 'rent_due', 'Đã phát hành các kỳ thu tiền thuê đến hạn và hóa đơn.')}>Phát hành kỳ đến hạn</button>}{row.status === 'active' && can('real-estate.lease.terminated') && <button className="btn btn-ghost btn-sm" style={{ marginLeft: 6 }} disabled={Boolean(busy)} onClick={() => transition('real-estate.lease', row, 'terminated', 'Đã kết thúc hợp đồng; tài sản được đưa về trạng thái sẵn sàng.')}>Kết thúc thuê</button>}</td></tr>)}</tbody></table></div>}
        {cycleRows.length > 0 && <div className="table-wrap" style={{ marginTop: 16 }}><h3>Kỳ thu tiền thuê đã phát hành</h3><table className="table"><thead><tr><th>Kỳ thuê</th><th>Đến hạn</th><th>Số tiền</th><th>Hóa đơn</th></tr></thead><tbody>{cycleRows.map((row) => <tr key={row.id}><td>{fmtDate(row.period_start)} – {fmtDate(row.period_end)}</td><td>{fmtDate(row.due_date)}</td><td>{fmtMoney(row.amount)}</td><td>{invoiceByCycle.has(row.id) ? <a href={`#/e/accounting/invoice/${invoiceByCycle.get(row.id).id}`}>{statusLabel(invoiceByCycle.get(row.id).status)}</a> : 'Đang tạo'}</td></tr>)}</tbody></table></div>}
        {selected.status === 'sold' && selected.buyer && <p className="small muted" style={{ marginTop: 12 }}>Đã bán cho {parties.has(selected.buyer) ? recordLabel('master-data.party', parties.get(selected.buyer)) : 'khách hàng'} với giá {fmtMoney(selected.sale_price || 0)}. {saleInvoice ? <a href={`#/e/accounting/invoice/${saleInvoice.id}`}>Mở hóa đơn {statusLabel(saleInvoice.status)}</a> : 'Hóa đơn bán được tạo theo sự kiện giao dịch.'}</p>}
      </section>}
    </div>}
  </div>;
}
