import { useEffect, useState } from 'react';
import { api, dataPath } from '../../../lib/api.js';
import { compareDecimals } from '../../../lib/decimal.js';
import { app } from '../../../lib/state.js';

const action = (entity, row, verb) => api(dataPath(entity, row.id, verb), { method: 'POST' });

export function useMaintenanceWorkbenchWorkflow({ requests, assets, products, warehouses, load, setError, t }) {
  const [selectedId, setSelectedId] = useState('');
  const [assetId, setAssetId] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('normal');
  const [warehouse, setWarehouse] = useState('');
  const [technician, setTechnician] = useState('');
  const [assignedTechnician, setAssignedTechnician] = useState('');
  const [technicianForm, setTechnicianForm] = useState({ name: '', kind: 'internal', specialty: '', phone: '' });
  const [parts, setParts] = useState([]);
  const [resolution, setResolution] = useState('');
  const [laborHours, setLaborHours] = useState('');
  const [laborRate, setLaborRate] = useState('');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    setSelectedId((id) => id && requests.some((row) => row.id === id) ? id : requests[0]?.id || '');
  }, [requests]);
  useEffect(() => {
    setAssetId((id) => id && assets.get(id)?.status === 'active'
      ? id
      : [...assets.values()].find((asset) => asset.status === 'active')?.id || '');
  }, [assets]);
  useEffect(() => { setWarehouse((id) => id || [...warehouses.keys()][0] || ''); }, [warehouses]);
  const selected = requests.find((row) => row.id === selectedId);
  useEffect(() => { setAssignedTechnician(selected?.technician || ''); }, [selectedId, selected?.technician]);

  async function run(key, operation, success) {
    setBusy(key); setError(''); setNotice('');
    try { await operation(); setNotice(t(success)); await load(true); }
    catch (reason) { setError(t(reason.message || 'Thao tác không thành công.')); await load(true); }
    finally { setBusy(''); }
  }

  async function createRequest(event) {
    event.preventDefault();
    const materialLines = parts.filter((line) => line.product && compareDecimals(line.qty || 0, 0) > 0)
      .map((line) => ({ product: line.product, qty: String(line.qty), ...(line.uom ? { uom: line.uom } : {}) }));
    await run('create', async () => {
      const row = await api(dataPath('maintenance.maintenance_request'), { method: 'POST', body: {
        asset: assetId, description: description.trim() || undefined, priority,
        technician: technician || undefined,
        warehouse: materialLines.length ? warehouse : undefined, parts: materialLines.length ? materialLines : undefined,
        requested_by: app.user?.name || app.user?.email || undefined,
      } });
      setSelectedId(row.id); setDescription(''); setPriority('normal'); setParts([]);
    }, 'Đã ghi nhận yêu cầu bảo trì. Lệnh được đưa vào hàng đợi để kỹ thuật viên tiếp nhận.');
  }

  async function createTechnician(event) {
    event.preventDefault();
    await run('technician', async () => {
      await api(dataPath('maintenance.maintenance_technician'), { method: 'POST', body: {
        ...technicianForm, name: technicianForm.name.trim(), specialty: technicianForm.specialty.trim() || undefined,
        phone: technicianForm.phone.trim() || undefined, active: true,
      } });
      setTechnicianForm({ name: '', kind: 'internal', specialty: '', phone: '' });
    }, 'Đã thêm kỹ thuật viên vào danh mục phân công.');
  }

  async function saveAssignment(row) {
    await run(`${row.id}:assignment`, () => api(dataPath('maintenance.maintenance_request', row.id), {
      method: 'PATCH', body: { technician: assignedTechnician || null },
    }), 'Đã cập nhật người phụ trách lệnh bảo trì.');
  }

  async function runPlan(plan) {
    await run(`${plan.id}:due`, () => action('maintenance.maintenance_plan', plan, 'due'),
      'Đã đưa lệnh bảo trì định kỳ vào hàng đợi. Kỳ kế tiếp sẽ tính sau khi lệnh được hoàn tất.');
  }

  async function startRequest(row) {
    await run(`${row.id}:started`, () => action('maintenance.maintenance_request', row, 'started'),
      'Kỹ thuật viên đã bắt đầu xử lý lệnh.');
  }

  async function completeRequest(event, row) {
    event.preventDefault();
    if ((laborHours === '') !== (laborRate === '')) {
      setError(t('Nhập đồng thời giờ công và đơn giá, hoặc để trống cả hai.'));
      return;
    }
    await run(`${row.id}:done`, async () => {
      await api(dataPath('maintenance.maintenance_request', row.id, 'done'), { method: 'POST', body: {
        resolution: resolution.trim(), labor_hours: laborHours === '' ? undefined : String(laborHours).trim(),
        labor_rate: laborRate === '' ? undefined : String(laborRate).trim(),
      } });
      setResolution(''); setLaborHours(''); setLaborRate('');
    }, 'Đã hoàn tất lệnh. Vật tư được xuất khỏi kho đã chọn và kế hoạch định kỳ được cập nhật.');
  }

  function addPart() {
    setParts((current) => [...current, { rowId: crypto.randomUUID(), product: [...products.keys()][0] || '', qty: '1', uom: '' }]);
  }
  function updatePart(index, field, value) {
    setParts((current) => current.map((row, rowIndex) => rowIndex === index
      ? { ...row, [field]: value, ...(field === 'product' ? { uom: '' } : {}) }
      : row));
  }
  function removePart(index) { setParts((current) => current.filter((_, rowIndex) => rowIndex !== index)); }

  return {
    selectedId, setSelectedId, selected,
    assetId, setAssetId, description, setDescription, priority, setPriority, warehouse, setWarehouse,
    technician, setTechnician, assignedTechnician, setAssignedTechnician,
    technicianForm, setTechnicianForm, parts, resolution, setResolution, laborHours, setLaborHours,
    laborRate, setLaborRate, busy, notice,
    createRequest, createTechnician, saveAssignment, runPlan, startRequest, completeRequest,
    addPart, updatePart, removePart,
  };
}
