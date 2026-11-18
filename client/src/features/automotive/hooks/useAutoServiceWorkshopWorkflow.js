import { useEffect, useState } from 'react';
import { api, dataPath } from '../../../lib/api.js';

export function useAutoServiceWorkshopWorkflow({
  load,
  vehicleId,
  setVehicleId,
  vehicleById,
  productChoices,
  selected,
  currentVehicle,
  lastOdometerByVehicle,
  setSelectedId,
  setError,
  setNotice,
  t,
}) {
  const [party, setParty] = useState('');
  const [plate, setPlate] = useState('');
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [vin, setVin] = useState('');
  const [odometer, setOdometer] = useState('');
  const [odometerReading, setOdometerReading] = useState('');
  const [intakeOdometer, setIntakeOdometer] = useState('');
  const [declineReasons, setDeclineReasons] = useState({});
  const [warehouseId, setWarehouseId] = useState('');
  const [complaint, setComplaint] = useState('');
  const [draftLines, setDraftLines] = useState([]);
  const [quoteDraft, setQuoteDraft] = useState(null);
  const [busy, setBusy] = useState('');

  useEffect(() => {
    const reading = currentVehicle ? lastOdometerByVehicle.get(currentVehicle.id) ?? currentVehicle.odometer : null;
    setOdometerReading(reading == null ? '' : String(reading));
  }, [currentVehicle?.id, lastOdometerByVehicle]);
  useEffect(() => {
    const reading = lastOdometerByVehicle.get(vehicleId);
    setIntakeOdometer(reading == null ? '' : String(reading));
  }, [vehicleId, lastOdometerByVehicle]);

  async function createVehicle(event) {
    event.preventDefault(); setBusy('vehicle'); setError(''); setNotice('');
    try {
      const created = await api(dataPath('auto-service.vehicle'), { method: 'POST', body: {
        party, plate: plate.trim(), make: make.trim() || undefined, model: model.trim() || undefined,
        vin: vin.trim() || undefined, odometer: odometer === '' ? undefined : Number(odometer),
      } });
      setPlate(''); setMake(''); setModel(''); setVin(''); setOdometer('');
      await load(true); setVehicleId(created.id); setNotice(`${t('Đã tiếp nhận xe')} ${created.plate}.`);
    } catch (reason) { setError(t(reason.message || 'Không tiếp nhận được xe.')); }
    finally { setBusy(''); }
  }

  const addLine = () => setDraftLines((current) => [...current, { rowId: crypto.randomUUID(), product: productChoices[0]?.id || '', qty: '1', uom: '' }]);
  const updateLine = (index, key, value) => setDraftLines((current) => current.map((line, i) => i === index ? { ...line, [key]: value, ...(key === 'product' ? { uom: '' } : {}) } : line));

  async function createOrder(event) {
    event.preventDefault(); if (!vehicleId || !draftLines.length || intakeOdometer === '') return;
    const vehicle = vehicleById.get(vehicleId);
    setBusy('order'); setError(''); setNotice('');
    try {
      const created = await api(dataPath('auto-service.repair_order'), { method: 'POST', body: {
        vehicle: vehicleId, party: vehicle.party, odometer_reading: Number(intakeOdometer), warehouse: warehouseId || undefined, complaint: complaint.trim() || undefined,
        lines: draftLines.map((line) => ({ product: line.product, qty: String(line.qty), ...(line.uom ? { uom: line.uom } : {}) })),
      } });
      setDraftLines([]); setComplaint(''); await load(true); setSelectedId(created.id);
      setNotice(`${t('Đã lập lệnh')} ${String(created.id).slice(0, 8)}${t('. Đơn giá và tổng tiền do server lấy theo danh mục sản phẩm.')}`);
    } catch (reason) { setError(t(reason.message || 'Không lập được lệnh sửa chữa. Kiểm tra phụ tùng, giá và kho.')); }
    finally { setBusy(''); }
  }

  async function transition(order, action) {
    if (action === 'quote_declined') {
      const reason = declineReasons[order.id]?.trim() || '';
      if (reason.length < 5 || reason.length > 500) {
        setError(t('Nhập lý do khách từ chối báo giá (5–500 ký tự).'));
        return;
      }
    }
    setBusy(`${order.id}:${action}`); setError(''); setNotice('');
    try {
      await api(dataPath('auto-service.repair_order', order.id, action), {
        method: 'POST',
        ...(action === 'quote_declined' ? { body: { declined_reason: declineReasons[order.id].trim() } } : {}),
      });
      await load(true);
      const messages = { approved: 'Đã ghi nhận khách duyệt báo giá.', quote_declined: 'Đã lưu lý do khách từ chối; có thể tiếp nhận lệnh mới cho xe này.', started: 'Đã đưa xe vào sửa chữa.', completed: 'Đã hoàn tất sửa chữa; hệ thống ghi nhận xuất kho và lập hóa đơn.', delivered: 'Đã ghi nhận bàn giao xe.' };
      setNotice(t(messages[action]));
    } catch (reason) { setError(t(reason.message || 'Không chuyển được trạng thái. Kiểm tra tồn kho phụ tùng và dữ liệu liên quan.')); await load(true); }
    finally { setBusy(''); }
  }

  const startQuoteEdit = (order) => setQuoteDraft({
    repairOrderId: order.id,
    complaint: order.complaint || '',
    warehouseId: order.warehouse || '',
    lines: (order.lines || []).map((line) => ({ rowId: crypto.randomUUID(), product: line.product || '', qty: String(line.qty ?? ''), uom: line.uom || '' })),
  });
  const updateQuoteDraft = (field, value) => setQuoteDraft((current) => ({ ...current, [field]: value }));
  const updateQuoteLine = (index, field, value) => setQuoteDraft((current) => ({
    ...current,
    lines: current.lines.map((line, row) => row === index ? { ...line, [field]: value, ...(field === 'product' ? { uom: '' } : {}) } : line),
  }));
  const addQuoteLine = () => setQuoteDraft((current) => current && ({
    ...current,
    lines: [...current.lines, { rowId: crypto.randomUUID(), product: productChoices[0]?.id || '', qty: '1', uom: '' }],
  }));
  const removeQuoteLine = (index) => setQuoteDraft((current) => ({
    ...current,
    lines: current.lines.filter((_, row) => row !== index),
  }));

  async function saveQuoteEdit(event) {
    event.preventDefault();
    if (!selected || selected.status !== 'intake' || quoteDraft?.repairOrderId !== selected.id || !quoteDraft.lines.length) return;
    setBusy(`${selected.id}:quote`); setError(''); setNotice('');
    try {
      await api(dataPath('auto-service.repair_order', selected.id), {
        method: 'PATCH',
        body: {
          complaint: quoteDraft.complaint.trim(),
          warehouse: quoteDraft.warehouseId || null,
          lines: quoteDraft.lines.map((line) => ({ product: line.product, qty: String(line.qty), ...(line.uom ? { uom: line.uom } : {}) })),
        },
      });
      setQuoteDraft(null);
      await load(true);
      setNotice(t('Đã cập nhật báo giá. Đơn giá được lấy lại từ danh mục; khách cần duyệt trước khi sửa chữa.'));
    } catch (reason) {
      setError(reason.message || t('Không cập nhật được báo giá. Kiểm tra phụ tùng, giá và kho.'));
    } finally { setBusy(''); }
  }

  async function updateOdometer(event) {
    event.preventDefault();
    if (!currentVehicle || odometerReading === '') return;
    setBusy('odometer'); setError(''); setNotice('');
    try {
      await api(dataPath('auto-service.vehicle', currentVehicle.id), { method: 'PATCH', body: { odometer: Number(odometerReading) } });
      await load(true); setNotice(`${t('Đã cập nhật công-tơ-mét xe')} ${currentVehicle.plate}.`);
    } catch (reason) { setError(t(reason.message || 'Không thể cập nhật số công-tơ-mét.')); }
    finally { setBusy(''); }
  }

  return {
    party, setParty, plate, setPlate, make, setMake, model, setModel, vin, setVin, odometer, setOdometer,
    odometerReading, setOdometerReading, intakeOdometer, setIntakeOdometer, declineReasons, setDeclineReasons,
    warehouseId, setWarehouseId, complaint, setComplaint, draftLines, setDraftLines, quoteDraft, setQuoteDraft,
    busy, createVehicle, addLine, updateLine, createOrder, transition, startQuoteEdit, updateQuoteDraft,
    updateQuoteLine, addQuoteLine, removeQuoteLine, saveQuoteEdit, updateOdometer,
  };
}
