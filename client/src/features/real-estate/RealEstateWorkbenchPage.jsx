import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useDocumentTitle } from '../../lib/useDocumentTitle.js';
import { useLatestRequest } from '../../lib/useLatestRequest.js';
import { localDate } from '../../lib/dates.js';
import { fmtDate, fmtDateTime, fmtMoney, statusLabel, uiTextWith } from '../../lib/i18n.js';
import { can, loadRefs, recordLabel, loadAllResponse, loadIndependentData } from '../../lib/state.js';
import realEstateEnglish from './real-estate.en.js';
import PropertyInventoryTable from './components/PropertyInventoryTable.jsx';
import SelectedPropertyWorkspace from './components/SelectedPropertyWorkspace.jsx';
import { useRealEstateWorkflow } from './hooks/useRealEstateWorkflow.js';
const t = (text) => uiTextWith(text, realEstateEnglish);
const today = localDate;
const itemsOf = (response) => Array.isArray(response?.items) ? response.items : [];
export default function RealEstateWorkbenchPage() {
  useDocumentTitle(`${t('Sàn giao dịch và cho thuê')} · OSP Suite`);
  const [properties, setProperties] = useState([]);
  const [reservations, setReservations] = useState([]);
  const [viewings, setViewings] = useState([]);
  const [leases, setLeases] = useState([]);
  const [rentCycles, setRentCycles] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [parties, setParties] = useState(new Map());
  const [selectedProperty, setSelectedProperty] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const latestRequest = useLatestRequest();
  const load = useCallback(async (quiet = false) => {
    const isLatest = latestRequest();
    if (!quiet) { setLoading(true); setError(''); }
    try {
      const { data, errors } = await loadIndependentData({
        properties: can('real-estate.property.read') ? loadAllResponse('real-estate.property') : Promise.resolve({ items: [] }),
        reservations: can('real-estate.reservation.read') ? loadAllResponse('real-estate.reservation') : Promise.resolve({ items: [] }),
        viewings: can('real-estate.viewing.read') ? loadAllResponse('real-estate.viewing') : Promise.resolve({ items: [] }),
        leases: can('real-estate.lease.read') ? loadAllResponse('real-estate.lease') : Promise.resolve({ items: [] }),
        rentCycles: can('real-estate.rent_cycle.read') ? loadAllResponse('real-estate.rent_cycle') : Promise.resolve({ items: [] }),
        parties: can('master-data.party.read') ? loadRefs('master-data.party') : Promise.resolve(new Map()),
        invoices: can('accounting.invoice.read') ? loadAllResponse('accounting.invoice') : Promise.resolve({ items: [] }),
      }, {
        properties: { items: [] }, reservations: { items: [] }, viewings: { items: [] }, leases: { items: [] },
        rentCycles: { items: [] }, parties: new Map(), invoices: { items: [] },
      });
      const propertyRows = itemsOf(data.properties);
      if (isLatest()) {
        setProperties(propertyRows); setReservations(itemsOf(data.reservations)); setViewings(itemsOf(data.viewings));
        setLeases(itemsOf(data.leases)); setRentCycles(itemsOf(data.rentCycles)); setInvoices(itemsOf(data.invoices)); setParties(data.parties);
        setSelectedProperty((current) => propertyRows.some((row) => row.id === current) ? current : propertyRows[0]?.id || '');
        if (errors.length) setError(errors.map((reason) => reason?.message || t('Không tải được dữ liệu bất động sản.')).join(' · '));
      }
    } catch (reason) { if (isLatest()) setError(t(reason.message || 'Không tải được dữ liệu bất động sản.')); }
    finally { if (isLatest()) setLoading(false); }
  }, [latestRequest]);
  useEffect(() => { load(); }, [load]);
  const propertyById = useMemo(() => new Map(properties.map((row) => [row.id, row])), [properties]);
  const selected = propertyById.get(selectedProperty);
  const workflow = useRealEstateWorkflow({ properties, parties, selectedProperty, load, setError });
  const {
    propertyForm, setPropertyForm, viewingForm, reservationForm, leaseForm,
    busy, notice, createProperty, createViewing, createReservation, createLease,
    updateViewingField, updateReservationField, updateLeaseField,
    convertReservation, reserveReservation, expireReservation, cancelReservation,
    activateLease, issueRent, terminateLease,
  } = workflow;
  const saleInvoice = selected && invoices.find((row) => row.source === 'property' && row.source_id === selected.id);
  const availableCount = properties.filter((row) => row.status === 'available').length;
  const reservedCount = properties.filter((row) => row.status === 'reserved').length;
  const leasedCount = properties.filter((row) => row.status === 'leased').length;
  const invoiceByCycle = useMemo(() => new Map(invoices.filter((row) => row.source === 'real_estate_rent_cycle').map((row) => [row.source_id, row])), [invoices]);
  const viewingRows = useMemo(() => viewings.filter((row) => row.property === selectedProperty).sort((a, b) => String(a.at || '').localeCompare(String(b.at || ''))), [viewings, selectedProperty]);
  const reservationRows = useMemo(() => reservations.filter((row) => row.property === selectedProperty), [reservations, selectedProperty]);
  const leaseRows = useMemo(() => leases.filter((row) => row.property === selectedProperty), [leases, selectedProperty]);
  const cycleRows = useMemo(() => rentCycles.filter((row) => leaseRows.some((lease) => lease.id === row.lease)).sort((a, b) => String(b.due_date || '').localeCompare(String(a.due_date || ''))), [rentCycles, leaseRows]);
  const reservationActions = (row) => ({
    reserve: row.status === 'draft' && can('real-estate.reservation.reserved'),
    convert: row.status === 'reserved' && can('real-estate.reservation.converted'),
    expire: row.status === 'reserved' && row.expires_on < today() && can('real-estate.reservation.expired'),
    cancel: ['draft', 'reserved'].includes(row.status) && can('real-estate.reservation.cancelled'),
  });
  const leaseActions = (row) => ({
    activate: row.status === 'draft' && can('real-estate.lease.activated'),
    issueRent: row.status === 'active' && row.next_rent_date && row.next_rent_date <= today() && can('real-estate.lease.rent_due'),
    terminate: row.status === 'active' && can('real-estate.lease.terminated'),
  });
  const kindLabel = (kind) => t(({ apartment: 'Căn hộ', house: 'Nhà', land: 'Đất', office: 'Văn phòng', shop: 'Mặt bằng' }[kind] || 'Bất động sản'));
  return <div className="page">
    <div className="page-head"><div><h1>{t("Sàn giao dịch và cho thuê")}</h1><p className="sub">{t("Quản lý giỏ hàng, lịch xem, giữ chỗ, chốt bán và hợp đồng thuê kèm kỳ thu tiền.")}</p></div><button className="btn btn-secondary" type="button" disabled={loading || Boolean(busy)} onClick={() => load()}>{t("Làm mới")}</button></div>
    {error && <div className="alert danger" role="alert">{t(error)}</div>}{notice && <div className="alert success" role="status">{t(notice)}</div>}
    <div className="stats u-mb-16" ><div className="card stat"><span className="stat-label">{t("Đang mở bán / cho thuê")}</span><strong className="stat-value">{availableCount}</strong></div><div className="card stat"><span className="stat-label">{t("Đang giữ chỗ")}</span><strong className="stat-value">{reservedCount}</strong></div><div className="card stat"><span className="stat-label">{t("Đang cho thuê")}</span><strong className="stat-value">{leasedCount}</strong></div></div>
    {can('real-estate.property.create') && <section className="card card-pad"><h2>{t("Đưa bất động sản vào giỏ hàng")}</h2><form className="form-grid" onSubmit={createProperty}>
      <label className="field"><span className="label">{t("Tên / mã căn *")}</span><input className="input" required value={propertyForm.title} onChange={(e) => setPropertyForm({ ...propertyForm, title: e.target.value })} /></label>
      <label className="field"><span className="label">{t("Loại hình")}</span><select className="select" value={propertyForm.kind} onChange={(e) => setPropertyForm({ ...propertyForm, kind: e.target.value })}>{[['apartment','Căn hộ'],['house','Nhà'],['land','Đất'],['office','Văn phòng'],['shop','Mặt bằng']].map(([value,label]) => <option key={value} value={value}>{t(label)}</option>)}</select></label>
      <label className="field"><span className="label">{t("Diện tích (m²)")}</span><input className="input" type="number" min="0.01" step="any" value={propertyForm.area} onChange={(e) => setPropertyForm({ ...propertyForm, area: e.target.value })} /></label>
      <label className="field"><span className="label">{t("Giá niêm yết")}</span><input className="input" type="number" min="0" step="any" value={propertyForm.price} onChange={(e) => setPropertyForm({ ...propertyForm, price: e.target.value })} /></label>
      <label className="field"><span className="label">{t("Địa chỉ")}</span><input className="input" value={propertyForm.address} onChange={(e) => setPropertyForm({ ...propertyForm, address: e.target.value })} /></label>
      <div className="row full"><span className="grow" /><button className="btn btn-primary" disabled={Boolean(busy)}>{t("Thêm bất động sản")}</button></div>
    </form></section>}
    {loading ? <div className="skeleton" data-h="row" /> : !properties.length ? <div className="card card-pad empty">{t("Chưa có bất động sản. Thêm tài sản mới để bắt đầu nhận lịch xem và giữ chỗ.")}</div> : <div className="layout-split u-mt-16" >
      <PropertyInventoryTable properties={properties} selectedId={selectedProperty} onSelect={setSelectedProperty} kindLabel={kindLabel} fmtMoney={fmtMoney} statusLabel={statusLabel} t={t} />
      {selected && <SelectedPropertyWorkspace
          selected={selected} parties={parties} recordLabel={recordLabel}
          viewingForm={viewingForm} reservationForm={reservationForm} leaseForm={leaseForm}
          viewingRows={viewingRows} reservationRows={reservationRows} leaseRows={leaseRows}
          cycleRows={cycleRows} invoiceByCycle={invoiceByCycle} saleInvoice={saleInvoice}
          busy={busy} today={today} kindLabel={kindLabel} fmtDate={fmtDate} fmtDateTime={fmtDateTime}
          fmtMoney={fmtMoney} statusLabel={statusLabel} t={t}
          canCreateViewing={can('real-estate.viewing.create')}
          canCreateReservation={can('real-estate.reservation.create')}
          canCreateLease={can('real-estate.lease.create')}
          canCreateLeaseOrReserve={selected.status === 'available'}
          reservationActions={reservationActions} leaseActions={leaseActions}
          onViewingFieldChange={updateViewingField} onReservationFieldChange={updateReservationField}
          onLeaseFieldChange={updateLeaseField} onCreateViewing={createViewing}
          onCreateReservation={createReservation} onCreateLease={createLease}
          onConvertReservation={convertReservation} onReserveReservation={reserveReservation} onExpireReservation={expireReservation}
          onCancelReservation={cancelReservation} onActivateLease={activateLease}
          onIssueRent={issueRent} onTerminateLease={terminateLease}
        />}
    </div>}
  </div>;
}
