import { useEffect, useState } from 'react';
import { localDateTime as businessDateTime, localDateTimeToIso } from '../../../lib/dates.js';
import { api, dataPath } from '../../../lib/api.js';

const localDateTime = () => businessDateTime(new Date(Date.now() + 3600000));
const bookingAction = (row, verb) => api(dataPath('booking.booking', row.id, verb), { method: 'POST' });

export function useWellnessBookingWorkflow({
  healthcare, resources, services, clinicPatients, parties, bookableParties, selected, load, setError, t,
}) {
  const [form, setForm] = useState({ party: '', resource: '', service: '', starts_at: localDateTime(), ends_at: '', price: '', note: '' });
  const [editingBooking, setEditingBooking] = useState(false);
  const [editForm, setEditForm] = useState({ resource: '', service: '', starts_at: '', ends_at: '', price: '', note: '' });
  const [resourceForm, setResourceForm] = useState({ name: '', kind: 'staff' });
  const [serviceForm, setServiceForm] = useState({ name: '', duration_min: '', price: '' });
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const patientPartyIds = new Set(clinicPatients.map((patient) => patient.party).filter(Boolean));
    const availableParties = healthcare
      ? [...patientPartyIds].filter((id) => parties.has(id))
      : [...parties.keys()];
    setForm((current) => ({
      ...current,
      party: availableParties.includes(current.party) ? current.party : availableParties[0] || '',
      resource: current.resource || resources[0]?.id || '',
      service: current.service || services[0]?.id || '',
    }));
  }, [healthcare, clinicPatients, parties, resources, services]);

  async function run(key, operation, success) {
    setBusy(key); setError(''); setNotice('');
    try {
      await operation();
      await load(true);
      setNotice(t(success));
      return true;
    } catch (reason) {
      setError(t(reason.message || 'Thao tác không thành công.'));
      await load(true);
      return false;
    } finally { setBusy(''); }
  }

  async function createBooking(event) {
    event.preventDefault();
    const succeeded = await run('booking', async () => {
      if (healthcare && !bookableParties.some((party) => party.id === form.party)) {
        throw new Error(t('Chọn hồ sơ bệnh nhân đã đăng ký trước khi đặt lịch khám.'));
      }
      const startsAt = localDateTimeToIso(form.starts_at);
      const endsAt = form.ends_at ? localDateTimeToIso(form.ends_at) : undefined;
      if (!startsAt || (form.ends_at && !endsAt)) throw new Error(t('Giờ hẹn không hợp lệ trong múi giờ kinh doanh.'));
      const body = { resource: form.resource, service: form.service || undefined, party: form.party || undefined, starts_at: startsAt, note: form.note.trim() || undefined };
      if (endsAt) body.ends_at = endsAt;
      if (form.price !== '') body.price = String(form.price).trim();
      await api(dataPath('booking.booking'), { method: 'POST', body });
    }, 'Đã tiếp nhận lịch hẹn. Tài nguyên và khung giờ sẽ được kiểm tra trùng lịch ở máy chủ.');
    if (succeeded) setForm((current) => ({ ...current, note: '', price: '', ends_at: '' }));
  }

  async function createResource(event) {
    event.preventDefault();
    const succeeded = await run('resource', () => api(dataPath('booking.resource'), { method: 'POST', body: resourceForm }), 'Đã thêm kỹ thuật viên hoặc phòng vào danh mục tài nguyên.');
    if (succeeded) setResourceForm({ name: '', kind: 'staff' });
  }

  async function createService(event) {
    event.preventDefault();
    const succeeded = await run('service', () => api(dataPath('booking.service'), { method: 'POST', body: { ...serviceForm, duration_min: Number(serviceForm.duration_min), price: String(serviceForm.price) } }), 'Đã thêm dịch vụ và giá niêm yết.');
    if (succeeded) setServiceForm({ name: '', duration_min: '', price: '' });
  }

  async function change(row, verb) {
    const messages = {
      confirmed: 'Đã xác nhận lịch và khóa khung giờ tài nguyên.',
      checked_in: healthcare ? 'Đã check-in và tạo lượt khám trong hồ sơ phòng khám.' : 'Đã check-in khách.',
      completed: 'Đã hoàn tất dịch vụ; hóa đơn được tạo theo cấu hình kế toán.',
      cancelled: 'Đã hủy lịch.', no_show: 'Đã ghi nhận khách vắng mặt.',
      expired: 'Đã đóng yêu cầu lịch chưa xác nhận sau khi hết khung giờ.',
    };
    await run(`${row.id}:${verb}`, () => bookingAction(row, verb), messages[verb]);
  }

  function startEditBooking(row) {
    setEditForm({
      resource: row.resource || '', service: row.service || '',
      starts_at: row.starts_at ? businessDateTime(new Date(row.starts_at)) : '',
      ends_at: row.ends_at ? businessDateTime(new Date(row.ends_at)) : '',
      price: row.price ?? '', note: row.note || '',
    });
    setEditingBooking(true);
  }

  async function saveBooking(event) {
    event.preventDefault();
    if (!selected) return;
    const succeeded = await run(`${selected.id}:update`, async () => {
      const startsAt = localDateTimeToIso(editForm.starts_at);
      const endsAt = localDateTimeToIso(editForm.ends_at);
      if (!startsAt || !endsAt || new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
        throw new Error(t('Giờ bắt đầu và kết thúc không hợp lệ.'));
      }
      const body = { resource: editForm.resource, service: editForm.service || null, starts_at: startsAt, note: editForm.note.trim() };
      const originalEnd = selected.ends_at ? businessDateTime(new Date(selected.ends_at)) : '';
      const editService = services.find((row) => row.id === editForm.service);
      const serviceHasDuration = Number(editService?.duration_min) > 0;
      if (editForm.ends_at !== originalEnd || !serviceHasDuration) body.ends_at = endsAt;
      if (editForm.price !== '') body.price = String(editForm.price).trim();
      await api(dataPath('booking.booking', selected.id), { method: 'PATCH', body });
    }, 'Đã cập nhật lịch chờ; máy chủ đã tính lại thời lượng dịch vụ và kiểm tra xung đột tài nguyên.');
    if (succeeded) setEditingBooking(false);
  }

  return {
    form, setForm, editingBooking, setEditingBooking, editForm, setEditForm,
    resourceForm, setResourceForm, serviceForm, setServiceForm, busy, notice,
    createBooking, createResource, createService, change, startEditBooking, saveBooking,
  };
}
