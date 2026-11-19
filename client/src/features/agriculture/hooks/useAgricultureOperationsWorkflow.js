import { useEffect, useState } from 'react';
import { api, dataPath, session } from '../../../lib/api.js';
import { localDate } from '../../../lib/dates.js';
import { clearPersistentIdempotencyRequest, getPersistentIdempotencyRequest } from '../../../lib/idempotency.js';

const today = localDate;

export function useAgricultureOperationsWorkflow({ farms, selectedCycle, products, unitsFor, setCycleId, load, t }) {
  const [farmName, setFarmName] = useState('');
  const [farmLocation, setFarmLocation] = useState('');
  const [farmArea, setFarmArea] = useState('');
  const [farmOwner, setFarmOwner] = useState('');
  const [newCycleFarm, setNewCycleFarm] = useState('');
  const [crop, setCrop] = useState('');
  const [plantedOn, setPlantedOn] = useState(today());
  const [expectedHarvest, setExpectedHarvest] = useState('');
  const [inputKind, setInputKind] = useState('fertilizer');
  const [inputProduct, setInputProduct] = useState('');
  const [inputUom, setInputUom] = useState('');
  const [inputWarehouse, setInputWarehouse] = useState('');
  const [inputQty, setInputQty] = useState('');
  const [inputDate, setInputDate] = useState(today());
  const [harvestProduct, setHarvestProduct] = useState('');
  const [harvestUom, setHarvestUom] = useState('');
  const [harvestWarehouse, setHarvestWarehouse] = useState('');
  const [harvestQty, setHarvestQty] = useState('');
  const [harvestGrade, setHarvestGrade] = useState('');
  const [harvestLotCode, setHarvestLotCode] = useState('');
  const [harvestExpiry, setHarvestExpiry] = useState('');
  const [harvestDate, setHarvestDate] = useState(today());
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function createRecord(qname, payload) {
    const scope = `${session.current()?.tenantId || ''}:create:${qname}`;
    const { key, fingerprint } = getPersistentIdempotencyRequest(scope, JSON.stringify(payload));
    const created = await api(dataPath(qname), {
      method: 'POST', body: payload,
      headers: { 'idempotency-key': key },
    });
    clearPersistentIdempotencyRequest(scope, fingerprint);
    return created;
  }

  useEffect(() => {
    setNewCycleFarm((current) => farms.some((item) => item.id === current) ? current : farms[0]?.id || '');
  }, [farms]);

  async function createFarm(event) {
    event.preventDefault(); setBusy('farm'); setError(''); setNotice('');
    try {
      const created = await createRecord('agriculture.farm', { name: farmName.trim(), location: farmLocation.trim() || undefined, area: farmArea ? Number(farmArea) : undefined, owner: farmOwner || undefined });
      setFarmName(''); setFarmLocation(''); setFarmArea(''); setFarmOwner('');
      await load(true); setNewCycleFarm(created.id); setNotice(t('Đã tạo trang trại.'));
    } catch (reason) { setError(reason.message || t('Không tạo được trang trại.')); }
    finally { setBusy(''); }
  }

  async function createCycle(event) {
    event.preventDefault(); setBusy('cycle'); setError(''); setNotice('');
    try {
      const created = await createRecord('agriculture.crop_cycle', { farm: newCycleFarm, crop: crop.trim(), planted_on: plantedOn, expected_harvest: expectedHarvest || undefined });
      setCrop(''); setExpectedHarvest(''); await load(true); setCycleId(created.id); setNotice(t('Đã mở vụ mùa mới.'));
    } catch (reason) { setError(reason.message || t('Không tạo được vụ mùa.')); }
    finally { setBusy(''); }
  }

  async function createInput(event) {
    event.preventDefault(); if (!selectedCycle) return;
    setBusy('input'); setError(''); setNotice('');
    try {
      await createRecord('agriculture.input_application', { cycle: selectedCycle.id, kind: inputKind, qty: String(inputQty), date: inputDate, ...(inputProduct ? { product: inputProduct, warehouse: inputWarehouse, ...(unitsFor(inputProduct).length ? { uom: inputUom || products.get(inputProduct)?.uom } : {}) } : {}) });
      setInputQty(''); await load(true); setNotice(t('Đã ghi nhật ký sử dụng vật tư và cập nhật tồn kho nếu có sản phẩm.'));
    } catch (reason) { setError(reason.message || t('Không ghi được nhật ký vật tư. Kiểm tra kho và tồn khả dụng.')); }
    finally { setBusy(''); }
  }

  async function createHarvest(event) {
    event.preventDefault(); if (!selectedCycle) return;
    setBusy('harvest'); setError(''); setNotice('');
    try {
      await createRecord('agriculture.harvest', { cycle: selectedCycle.id, product: harvestProduct, warehouse: harvestWarehouse, qty: String(harvestQty), ...(unitsFor(harvestProduct).length ? { uom: harvestUom || products.get(harvestProduct)?.uom } : {}), date: harvestDate, expiry: harvestExpiry || undefined, grade: harvestGrade.trim() || undefined, lot_code: harvestLotCode.trim() || undefined });
      setHarvestQty(''); setHarvestGrade(''); setHarvestLotCode(''); setHarvestExpiry(''); await load(true); setNotice(t('Đã nhập sản lượng thu hoạch vào kho; mã lô được gắn cho truy xuất khi sản phẩm yêu cầu.'));
    } catch (reason) { setError(reason.message || t('Không ghi nhận được thu hoạch. Kiểm tra ngày vụ mùa và kho nhận.')); }
    finally { setBusy(''); }
  }

  async function closeCycle(action) {
    if (!selectedCycle) return;
    setBusy(`cycle:${action}`); setError(''); setNotice('');
    try {
      await api(dataPath('agriculture.crop_cycle', selectedCycle.id, action), { method: 'POST' });
      await load(true); setNotice(t(action === 'harvested' ? 'Đã kết thúc vụ mùa sau khi xác nhận sản lượng.' : 'Đã đánh dấu vụ mùa thất bại.'));
    } catch (reason) { setError(reason.message || t('Không cập nhật được trạng thái vụ mùa.')); }
    finally { setBusy(''); }
  }

  return {
    farmName, setFarmName, farmLocation, setFarmLocation, farmArea, setFarmArea, farmOwner, setFarmOwner,
    newCycleFarm, setNewCycleFarm, crop, setCrop, plantedOn, setPlantedOn, expectedHarvest, setExpectedHarvest,
    inputKind, setInputKind, inputProduct, setInputProduct, inputUom, setInputUom, inputWarehouse, setInputWarehouse,
    inputQty, setInputQty, inputDate, setInputDate, harvestProduct, setHarvestProduct, harvestUom, setHarvestUom,
    harvestWarehouse, setHarvestWarehouse, harvestQty, setHarvestQty, harvestGrade, setHarvestGrade,
    harvestLotCode, setHarvestLotCode, harvestExpiry, setHarvestExpiry, harvestDate, setHarvestDate,
    busy, error, notice, clearNotice: () => setNotice(''), createFarm, createCycle, createInput, createHarvest, closeCycle,
  };
}
