import { useEffect, useState } from 'react';
import { api, dataPath } from '../../../lib/api.js';
import { localDate, localDateTimeToIso } from '../../../lib/dates.js';
import { uiTextWith } from '../../../lib/i18n.js';
import realEstateEnglish from '../real-estate.en.js';

const t = (text) => uiTextWith(text, realEstateEnglish);
const today = localDate;
const action = (entity, row, verb) => api(dataPath(entity, row.id, verb), { method: 'POST' });

export function useRealEstateWorkflow({ properties, parties, selectedProperty, load, setError }) {
  const [propertyForm, setPropertyForm] = useState({ title: '', kind: 'apartment', address: '', area: '', price: '' });
  const [viewingForm, setViewingForm] = useState({ property: '', party: '', at: '', note: '' });
  const [reservationForm, setReservationForm] = useState({ property: '', party: '', number: '', agreed_price: '', expires_on: today(), notes: '' });
  const [leaseForm, setLeaseForm] = useState({ property: '', tenant: '', rent: '', billing_interval: 'monthly', start_date: today(), end_date: '' });
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const availableProperty = properties.find((row) => row.status === 'available')?.id || '';
    const leaseProperty = properties.find((row) => ['available', 'reserved'].includes(row.status))?.id || '';
    const defaultParty = [...parties.keys()][0] || '';
    setViewingForm((current) => ({ ...current, property: current.property || availableProperty }));
    setReservationForm((current) => ({ ...current, property: current.property || availableProperty, party: current.party || defaultParty }));
    setLeaseForm((current) => ({ ...current, property: current.property || leaseProperty, tenant: current.tenant || defaultParty }));
  }, [properties, parties]);

  async function run(label, operation, success) {
    setBusy(label); setError(''); setNotice('');
    try { await operation(); setNotice(t(success)); await load(true); }
    catch (reason) { setError(t(reason.message || 'Thao tác không thành công.')); await load(true); }
    finally { setBusy(''); }
  }
  async function createProperty(event) {
    event.preventDefault();
    await run('property', () => api(dataPath('real-estate.property'), { method: 'POST', body: {
      ...propertyForm,
      area: propertyForm.area ? String(propertyForm.area) : undefined,
      price: propertyForm.price ? String(propertyForm.price) : undefined,
    } }), 'Đã thêm bất động sản vào giỏ hàng.');
    setPropertyForm({ title: '', kind: 'apartment', address: '', area: '', price: '' });
  }
  async function createViewing(event) {
    event.preventDefault();
    const at = localDateTimeToIso(viewingForm.at);
    if (!at) { setError(t('Giờ xem không hợp lệ trong múi giờ kinh doanh.')); return; }
    await run('viewing', () => api(dataPath('real-estate.viewing'), { method: 'POST', body: {
      ...viewingForm, property: selectedProperty, party: viewingForm.party || undefined, at,
    } }), 'Đã xếp lịch xem bất động sản.');
    setViewingForm((current) => ({ ...current, at: '', note: '' }));
  }
  async function createReservation(event) {
    event.preventDefault();
    await run('reservation', async () => {
      const row = await api(dataPath('real-estate.reservation'), { method: 'POST', body: {
        ...reservationForm, property: selectedProperty, agreed_price: String(reservationForm.agreed_price), status: 'draft',
      } });
      await action('real-estate.reservation', row, 'reserved');
    }, 'Đã xác nhận giữ chỗ; bất động sản đã chuyển trạng thái giữ chỗ.');
    setReservationForm((current) => ({ ...current, number: '', agreed_price: '', notes: '' }));
  }
  async function createLease(event) {
    event.preventDefault();
    await run('lease', () => api(dataPath('real-estate.lease'), { method: 'POST', body: {
      ...leaseForm, property: selectedProperty, rent: String(leaseForm.rent), status: 'draft',
    } }), 'Đã tạo dự thảo hợp đồng thuê. Kích hoạt hợp đồng sau khi chốt điều khoản.');
    setLeaseForm((current) => ({ ...current, rent: '', end_date: '' }));
  }
  async function transition(entity, row, verb, success) {
    await run(`${row.id}:${verb}`, () => action(entity, row, verb), success);
  }
  const updateViewingField = (field, value) => setViewingForm((form) => ({ ...form, [field]: value }));
  const updateReservationField = (field, value) => setReservationForm((form) => ({ ...form, [field]: value }));
  const updateLeaseField = (field, value) => setLeaseForm((form) => ({ ...form, [field]: value }));
  const convertReservation = (row) => transition('real-estate.reservation', row, 'converted', 'Đã chốt giao dịch; tài sản được ghi nhận đã bán và hóa đơn đã tạo.');
  const expireReservation = (row) => transition('real-estate.reservation', row, 'expired', 'Đã hết hạn giữ chỗ; tài sản được giải phóng.');
  const cancelReservation = (row) => transition('real-estate.reservation', row, 'cancelled', 'Đã hủy phiếu giữ chỗ; trạng thái tài sản được cập nhật.');
  const activateLease = (row) => transition('real-estate.lease', row, 'activated', 'Đã kích hoạt hợp đồng; tài sản được chuyển sang đang cho thuê.');
  const issueRent = (row) => transition('real-estate.lease', row, 'rent_due', 'Đã phát hành các kỳ thu tiền thuê đến hạn và hóa đơn.');
  const terminateLease = (row) => transition('real-estate.lease', row, 'terminated', 'Đã kết thúc hợp đồng; tài sản được đưa về trạng thái sẵn sàng.');

  return {
    propertyForm, setPropertyForm, viewingForm, reservationForm, leaseForm,
    busy, notice, createProperty, createViewing, createReservation, createLease,
    updateViewingField, updateReservationField, updateLeaseField,
    convertReservation, expireReservation, cancelReservation,
    activateLease, issueRent, terminateLease,
  };
}
