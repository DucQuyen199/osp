import React, { useEffect, useMemo, useState } from 'react';
import { useDocumentTitle } from '../../lib/useDocumentTitle.js';
import { localDate } from '../../lib/dates.js';
import { api, dataPath, tenantPath } from '../../lib/api.js';
import { fmtDate, fmtMoney, fmtNumber, statusLabel, uiTextWith } from '../../lib/i18n.js';
import { addDecimals, multiplyDecimals } from '../../lib/decimal.js';
import { can, recordLabel } from '../../lib/state.js';
import { recordHref } from '../../lib/routes.js';
import agricultureEnglish from './agriculture.en.js';
import { AgricultureHarvestForm, AgricultureInputForm } from './components/AgricultureFieldworkForms.jsx';
import { useAgricultureData } from './hooks/useAgricultureData.js';
const t = (text) => uiTextWith(text, agricultureEnglish);
const today = localDate;
export default function AgricultureOperationsPage() {
  useDocumentTitle(`${t('Điều hành mùa vụ')} · OSP Suite`);
  const { farms, cycles, harvests, applications, products, units, warehouses, parties, lots, loading, error: dataError, load: loadData } = useAgricultureData();
  const [inputCostReport, setInputCostReport] = useState(null);
  const [inputCostError, setInputCostError] = useState('');
  const [cycleId, setCycleId] = useState('');
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
  const [harvestDate, setHarvestDate] = useState(today());
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const load = async (preserveNotice = false) => {
    setError('');
    if (!preserveNotice) setNotice('');
    await loadData();
  };
  useEffect(() => {
    setCycleId((current) => cycles.some((item) => item.id === current) ? current : cycles.find((item) => item.status === 'growing')?.id || cycles[0]?.id || '');
  }, [cycles]);
  useEffect(() => {
    setNewCycleFarm((current) => farms.some((item) => item.id === current) ? current : farms[0]?.id || '');
  }, [farms]);
  const selectedCycle = cycles.find((item) => item.id === cycleId) || null;
  const selectedFarm = selectedCycle && farms.find((farm) => farm.id === selectedCycle.farm);
  const unitsFor = (productId) => {
    const baseUnit = products.get(productId)?.uom;
    return baseUnit ? [...units.values()].filter((unit) => unit.id === baseUnit || unit.base_uom === baseUnit) : [];
  };
  const unitLabel = (item) => item.uom_name || units.get(item.uom)?.name || '';
  const cycleHarvests = useMemo(() => harvests.filter((item) => item.cycle === cycleId).sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))), [harvests, cycleId]);
  const cycleInputs = useMemo(() => applications.filter((item) => item.cycle === cycleId).sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))), [applications, cycleId]);
  const harvestTotals = useMemo(() => {
    const totals = new Map();
    for (const harvest of cycleHarvests) {
      const product = products.get(harvest.product);
      const ratio = Number(harvest.uom_ratio);
      const hasRatio = Number.isFinite(ratio) && ratio > 0;
      const hasBaseQuantity = harvest.base_qty != null;
      const baseUnit = harvest.base_uom || (hasBaseQuantity || hasRatio ? product?.uom : harvest.uom || product?.uom) || '';
      const unitName = units.get(baseUnit)?.name
        || (hasBaseQuantity || hasRatio ? units.get(product?.uom)?.name : harvest.uom_name || units.get(harvest.uom)?.name)
        || '';
      const quantity = hasBaseQuantity
        ? String(harvest.base_qty)
        : hasRatio
          ? multiplyDecimals([harvest.qty || 0, harvest.uom_ratio])
          : String(harvest.qty || 0);
      const key = `${harvest.product || ''}:${baseUnit}`;
      const current = totals.get(key) || { key, productName: product?.name || t('Nông sản'), quantity: '0', unitName };
      current.quantity = addDecimals([current.quantity, quantity]);
      totals.set(key, current);
    }
    return [...totals.values()];
  }, [cycleHarvests, products, units]);
  const canViewInputCost = can('agriculture.input_application.read') && can('inventory.stock_move.read');
  useEffect(() => {
    let active = true;
    if (!selectedCycle || !canViewInputCost) {
      setInputCostReport(null); setInputCostError('');
      return () => { active = false; };
    }
    setInputCostReport(null); setInputCostError('');
    api(tenantPath(`/reports/agriculture/crop-cycles/${encodeURIComponent(selectedCycle.id)}/input-costs`))
      .then((report) => { if (active) setInputCostReport(report); })
      .catch((reason) => { if (active) setInputCostError(reason.message || t('Không tải được chi phí vật tư.')); });
    return () => { active = false; };
  }, [selectedCycle?.id, cycleInputs, canViewInputCost]);
  const harvestSafety = useMemo(() => {
    const unknownProducts = new Set();
    const latestDate = cycleInputs.reduce((latest, application) => {
      if (application.kind !== 'pesticide') return latest;
      const product = products.get(application.product);
      const configuredSnapshot = application.preharvest_interval_configured === true;
      const intervalValue = configuredSnapshot
        ? application.preharvest_interval_days
        : product?.preharvest_interval_days;
      const intervalDays = Number(intervalValue);
      if (intervalValue == null || !Number.isInteger(intervalDays) || intervalDays < 0) {
        unknownProducts.add(product?.name || t('thuốc bảo vệ thực vật'));
        return latest;
      }
      if (!application.date) return latest;
      const applicationDate = new Date(`${application.date}T00:00:00Z`);
      if (!Number.isFinite(applicationDate.getTime())) return latest;
      applicationDate.setUTCDate(applicationDate.getUTCDate() + intervalDays);
      const allowedDate = applicationDate.toISOString().slice(0, 10);
      return allowedDate > latest ? allowedDate : latest;
    }, '');
    return { latestDate, unknownProducts: [...unknownProducts] };
  }, [cycleInputs, products]);
  const harvestRestriction = harvestSafety.latestDate;
  const legacyPesticideApplications = cycleInputs.filter((application) => application.kind === 'pesticide' && application.preharvest_interval_configured !== true);
  const area = Number(selectedFarm?.area);
  const hasArea = Number.isFinite(area) && area > 0;
  const activeCycles = cycles.filter((item) => item.status === 'growing').length;
  const upcomingCycles = cycles.filter((item) => item.status === 'growing' && item.expected_harvest && item.expected_harvest >= today()).length;
  const createFarm = async (event) => {
    event.preventDefault(); setBusy('farm'); setError(''); setNotice('');
    try {
      const created = await api(dataPath('agriculture.farm'), { method: 'POST', body: { name: farmName.trim(), location: farmLocation.trim() || undefined, area: farmArea ? Number(farmArea) : undefined, owner: farmOwner || undefined } });
      setFarmName(''); setFarmLocation(''); setFarmArea(''); setFarmOwner('');
      await load(true); setNewCycleFarm(created.id); setNotice(t('Đã tạo trang trại.'));
    } catch (reason) { setError(reason.message || t('Không tạo được trang trại.')); }
    finally { setBusy(''); }
  };
  const createCycle = async (event) => {
    event.preventDefault(); setBusy('cycle'); setError(''); setNotice('');
    try {
      const created = await api(dataPath('agriculture.crop_cycle'), { method: 'POST', body: { farm: newCycleFarm, crop: crop.trim(), planted_on: plantedOn, expected_harvest: expectedHarvest || undefined } });
      setCrop(''); setExpectedHarvest(''); await load(true); setCycleId(created.id); setNotice(t('Đã mở vụ mùa mới.'));
    } catch (reason) { setError(reason.message || t('Không tạo được vụ mùa.')); }
    finally { setBusy(''); }
  };
  const createInput = async (event) => {
    event.preventDefault(); if (!selectedCycle) return;
    setBusy('input'); setError(''); setNotice('');
    try {
      await api(dataPath('agriculture.input_application'), { method: 'POST', body: { cycle: selectedCycle.id, kind: inputKind, qty: Number(inputQty), date: inputDate, ...(inputProduct ? { product: inputProduct, warehouse: inputWarehouse, ...(unitsFor(inputProduct).length ? { uom: inputUom || products.get(inputProduct)?.uom } : {}) } : {}) } });
      setInputQty(''); await load(true); setNotice(t('Đã ghi nhật ký sử dụng vật tư và cập nhật tồn kho nếu có sản phẩm.'));
    } catch (reason) { setError(reason.message || t('Không ghi được nhật ký vật tư. Kiểm tra kho và tồn khả dụng.')); }
    finally { setBusy(''); }
  };
  const createHarvest = async (event) => {
    event.preventDefault(); if (!selectedCycle) return;
    setBusy('harvest'); setError(''); setNotice('');
    try {
      await api(dataPath('agriculture.harvest'), { method: 'POST', body: { cycle: selectedCycle.id, product: harvestProduct, warehouse: harvestWarehouse, qty: Number(harvestQty), ...(unitsFor(harvestProduct).length ? { uom: harvestUom || products.get(harvestProduct)?.uom } : {}), date: harvestDate, grade: harvestGrade.trim() || undefined, lot_code: harvestLotCode.trim() || undefined } });
      setHarvestQty(''); setHarvestGrade(''); setHarvestLotCode(''); await load(true); setNotice(t('Đã nhập sản lượng thu hoạch vào kho; mã lô được gắn cho truy xuất khi sản phẩm yêu cầu.'));
    } catch (reason) { setError(reason.message || t('Không ghi nhận được thu hoạch. Kiểm tra ngày vụ mùa và kho nhận.')); }
    finally { setBusy(''); }
  };
  const closeCycle = async (action) => {
    if (!selectedCycle) return;
    setBusy(`cycle:${action}`); setError(''); setNotice('');
    try { await api(dataPath('agriculture.crop_cycle', selectedCycle.id, action), { method: 'POST' }); await load(true); setNotice(t(action === 'harvested' ? 'Đã kết thúc vụ mùa sau khi xác nhận sản lượng.' : 'Đã đánh dấu vụ mùa thất bại.')); }
    catch (reason) { setError(reason.message || t('Không cập nhật được trạng thái vụ mùa.')); }
    finally { setBusy(''); }
  };
  const inputKinds = [['fertilizer', 'Phân bón'], ['pesticide', 'Thuốc bảo vệ thực vật'], ['seed', 'Giống'], ['water', 'Nước tưới']];
  const requiresProduct = ['fertilizer', 'pesticide', 'seed'].includes(inputKind);
  const pesticideIntervalMissing = inputKind === 'pesticide' && Boolean(inputProduct)
    && (products.get(inputProduct)?.preharvest_interval_days == null
      || !Number.isInteger(Number(products.get(inputProduct)?.preharvest_interval_days))
      || Number(products.get(inputProduct)?.preharvest_interval_days) < 0);
  return <div className="page agriculture-page">
    <div className="page-head"><div><h1>{t('Điều hành mùa vụ')}</h1><p className="sub">{t('Quản lý trang trại, theo dõi vụ đang canh tác, ghi vật tư và nhập sản lượng thu hoạch vào kho.')}</p></div><button className="btn btn-secondary" type="button" disabled={loading || Boolean(busy)} onClick={() => load()}>{loading ? t('Đang tải…') : t('Làm mới')}</button></div>
    <div className="row wrap agriculture-summary"><span className="badge success">{t('Vụ đang canh tác')}: {activeCycles}</span><span className="badge warning">{t('Có ngày thu dự kiến')}: {upcomingCycles}</span><span className="badge plain">{t('Trang trại')}: {farms.length}</span></div>
    {(error || dataError) && <div className="alert danger" role="alert">{t(error || dataError)}</div>}{notice && <div className="alert success" role="status">{t(notice)}</div>}
    {loading ? <div className="card-pad"><div className="skeleton" data-h="row" /></div> : <>
      <div className="agriculture-setup">
        <details className="card agriculture-panel"><summary>{t('Tạo trang trại')}</summary><form className="agriculture-form" onSubmit={createFarm}>
          <label className="field"><span className="label">{t('Tên trang trại *')}</span><input className="input" required value={farmName} onChange={(event) => setFarmName(event.target.value)} /></label>
          <label className="field"><span className="label">{t('Địa điểm')}</span><input className="input" value={farmLocation} onChange={(event) => setFarmLocation(event.target.value)} /></label>
          <label className="field"><span className="label">{t('Diện tích (ha)')}</span><input className="input num" type="number" min="0.001" step="any" value={farmArea} onChange={(event) => setFarmArea(event.target.value)} /></label>
          <label className="field"><span className="label">{t('Chủ trang trại')}</span><select className="select" value={farmOwner} onChange={(event) => setFarmOwner(event.target.value)}><option value="">{t('Chưa gán')}</option>{[...parties.values()].map((item) => <option key={item.id} value={item.id}>{recordLabel('master-data.party', item)}</option>)}</select></label>
          <button className="btn btn-secondary" type="submit" disabled={Boolean(busy) || !can('agriculture.farm.create')}>{busy === 'farm' ? t('Đang lưu…') : t('Tạo trang trại')}</button>
        </form></details>
        <details className="card agriculture-panel" open={!farms.length}><summary>{t('Mở vụ mùa mới')}</summary><form className="agriculture-form" onSubmit={createCycle}>
          <label className="field"><span className="label">{t('Trang trại *')}</span><select className="select" required value={newCycleFarm} onChange={(event) => setNewCycleFarm(event.target.value)}><option value="">{t('Chọn trang trại')}</option>{farms.map((farm) => <option key={farm.id} value={farm.id}>{farm.name}</option>)}</select></label>
          <label className="field"><span className="label">{t('Cây trồng / vụ *')}</span><input className="input" required value={crop} onChange={(event) => setCrop(event.target.value)} placeholder={t('Ví dụ: Lúa đông xuân')} /></label>
          <label className="field"><span className="label">{t('Ngày gieo trồng *')}</span><input className="input" required type="date" max={today()} value={plantedOn} onChange={(event) => setPlantedOn(event.target.value)} /></label>
          <label className="field"><span className="label">{t('Thu hoạch dự kiến')}</span><input className="input" type="date" min={plantedOn} value={expectedHarvest} onChange={(event) => setExpectedHarvest(event.target.value)} /></label>
          <button className="btn btn-primary" type="submit" disabled={Boolean(busy) || !newCycleFarm || !can('agriculture.crop_cycle.create')}>{busy === 'cycle' ? t('Đang lưu…') : t('Mở vụ mùa')}</button>
        </form></details>
      </div>
      <div className="agriculture-layout"><section className="agriculture-cycle-list"><header className="agriculture-section-head"><h2>{t('Vụ mùa')}</h2><span className="badge plain">{cycles.length}</span></header>
        {cycles.length ? cycles.map((cycle) => { const farm = farms.find((item) => item.id === cycle.farm); const harvestCount = harvests.filter((item) => item.cycle === cycle.id).length; const isDue = cycle.status === 'growing' && cycle.expected_harvest && cycle.expected_harvest < today(); return <button type="button" className={`card agriculture-cycle${cycleId === cycle.id ? ' selected' : ''}${isDue ? ' due' : ''}`} key={cycle.id} onClick={() => setCycleId(cycle.id)}><strong>{cycle.crop}</strong><span>{farm?.name || t('Trang trại')}</span><span className="small muted">{t('Gieo')} {fmtDate(cycle.planted_on)}{cycle.expected_harvest ? ` · ${t('Dự thu')} ${fmtDate(cycle.expected_harvest)}` : ''}</span><span className="row wrap"><span className={`badge ${cycle.status === 'growing' ? isDue ? 'danger' : 'warning' : cycle.status === 'harvested' ? 'success' : 'plain'}`}>{isDue ? t('Quá ngày dự kiến') : statusLabel(cycle.status)}</span><span className="small num">{t('Lần thu')}: {harvestCount}</span></span></button>; }) : <div className="empty">{t('Tạo trang trại và mở vụ mùa để bắt đầu.')}</div>}
      </section>
      <section className="agriculture-cycle-detail">{selectedCycle ? <>
        <article className="card agriculture-panel"><header className="agriculture-section-head"><div><h2>{selectedCycle.crop}</h2><p className="small muted">{selectedFarm?.name} · {t('Gieo')} {fmtDate(selectedCycle.planted_on)}{selectedCycle.expected_harvest ? ` · ${t('Dự kiến')} ${fmtDate(selectedCycle.expected_harvest)}` : ''}</p></div><span className={`badge ${selectedCycle.status === 'growing' ? 'warning' : selectedCycle.status === 'harvested' ? 'success' : 'plain'}`}>{statusLabel(selectedCycle.status)}</span></header>
          <div className="agriculture-kpis"><div><span>{t('Sản lượng đã thu theo sản phẩm')}</span>{harvestTotals.length ? harvestTotals.map((total) => <strong className="num" key={total.key}>{total.productName}: {fmtNumber(Number(total.quantity))}{total.unitName ? ` ${total.unitName}` : ''}</strong>) : <strong className="num">0</strong>}</div><div><span>{t('Diện tích')}</span><strong>{selectedFarm?.area ? `${fmtNumber(selectedFarm.area)} ${t('ha')}` : t('Chưa khai báo')}</strong></div><div><span>{t('Năng suất lũy kế theo sản phẩm')}</span>{hasArea && harvestTotals.length ? harvestTotals.map((total) => <strong className="num" key={total.key}>{total.productName}: {fmtNumber(Number(total.quantity) / area)}{total.unitName ? ` ${total.unitName}` : ''} / {t('ha')}</strong>) : <strong>{hasArea ? t('Chưa có thu hoạch') : t('Cần diện tích')}</strong>}</div><div><span>{t('Lần bón / dùng vật tư')}</span><strong>{cycleInputs.length}</strong></div>{canViewInputCost && <><div><span>{t('Chi phí vật tư đã xuất kho')}</span><strong>{inputCostReport ? fmtMoney(inputCostReport.materialCost || 0) : '—'}</strong></div><div><span>{t('Chi phí vật tư / ha')}</span><strong>{inputCostReport?.costPerHectare != null ? fmtMoney(inputCostReport.costPerHectare) : selectedFarm?.area ? '—' : t('Cần diện tích')}</strong></div></>}</div>
          {inputCostError && <p className="small muted" role="status">{inputCostError}</p>}
          {inputCostReport?.byKind && <p className="small muted">{t('Phân bón')} {fmtMoney(inputCostReport.byKind.fertilizer || 0)} · {t('Thuốc')} {fmtMoney(inputCostReport.byKind.pesticide || 0)} · {t('Giống')} {fmtMoney(inputCostReport.byKind.seed || 0)} · {t('Nước có xuất kho')} {fmtMoney(inputCostReport.byKind.water || 0)}. {t('Theo giá trị phiếu xuất tại thời điểm ghi nhận; chưa gồm nhân công, nước ghi ngoài kho hoặc khoản landed cost hạch toán sau.')}</p>}
          {selectedCycle.status === 'growing' && <footer className="row wrap agriculture-cycle-actions">{can('agriculture.crop_cycle.harvested') && <button className="btn btn-primary btn-sm" type="button" disabled={Boolean(busy) || !cycleHarvests.length} title={!cycleHarvests.length ? t('Ghi nhận ít nhất một lần thu hoạch trước') : ''} onClick={() => closeCycle('harvested')}>{t('Kết thúc vụ')}</button>}{can('agriculture.crop_cycle.failed') && <button className="btn btn-secondary btn-sm" type="button" disabled={Boolean(busy)} onClick={() => closeCycle('failed')}>{t('Đánh dấu thất bại')}</button>}</footer>}
        </article>
        {selectedCycle.status === 'growing' && <div className="agriculture-work-forms">
          <AgricultureInputForm
            cycle={selectedCycle} inputKinds={inputKinds} inputKind={inputKind} inputProduct={inputProduct}
            inputUom={inputUom} inputWarehouse={inputWarehouse} inputQty={inputQty} inputDate={inputDate}
            products={products} warehouses={warehouses} unitsFor={unitsFor} requiresProduct={requiresProduct}
            pesticideIntervalMissing={pesticideIntervalMissing} busy={busy}
            canCreate={can('agriculture.input_application.create')} today={today()}
            onSubmit={createInput}
            onKindChange={(value) => { setInputKind(value); setInputProduct(''); setInputUom(''); }}
            onProductChange={(value) => { setInputProduct(value); setInputUom(''); }}
            onUomChange={setInputUom} onWarehouseChange={setInputWarehouse}
            onQtyChange={setInputQty} onDateChange={setInputDate}
            recordLabel={recordLabel} t={t}
          />
          <AgricultureHarvestForm
            harvestSafety={harvestSafety} legacyPesticideApplications={legacyPesticideApplications}
            harvestRestriction={harvestRestriction} harvestDate={harvestDate} harvestProduct={harvestProduct}
            harvestUom={harvestUom} harvestWarehouse={harvestWarehouse} harvestQty={harvestQty}
            harvestGrade={harvestGrade} harvestLotCode={harvestLotCode} products={products}
            warehouses={warehouses} unitsFor={unitsFor} busy={busy}
            canCreate={can('agriculture.harvest.create')} today={today()} plantedOn={selectedCycle.planted_on}
            formatDate={fmtDate} onSubmit={createHarvest}
            onProductChange={(value) => { setHarvestProduct(value); setHarvestUom(''); }}
            onUomChange={setHarvestUom} onWarehouseChange={setHarvestWarehouse}
            onQtyChange={setHarvestQty} onDateChange={setHarvestDate}
            onGradeChange={setHarvestGrade} onLotCodeChange={setHarvestLotCode}
            recordLabel={recordLabel} t={t}
          />
        </div>}
        <div className="agriculture-history-grid"><article className="card agriculture-panel"><h3>{t('Lịch sử thu hoạch')}</h3>{cycleHarvests.length ? <div className="agriculture-history">{cycleHarvests.map((harvest) => { const lot = [...lots.values()].find((item) => item.product === harvest.product && item.code === harvest.lot_code); return <div className="agriculture-history-row" key={harvest.id}><div><strong>{products.get(harvest.product)?.name || t('Nông sản')} · {fmtNumber(harvest.qty)} {unitLabel(harvest)}{harvest.base_qty != null && harvest.uom_ratio > 1 ? ` (${fmtNumber(harvest.base_qty)} ${t('base')})` : ""}</strong><div className="small muted">{fmtDate(harvest.date)}{harvest.grade ? ` · ${harvest.grade}` : ''}{harvest.lot_code ? ` · ${t('Lô')} ${harvest.lot_code}` : ''}</div></div>{lot && can('inventory.stock_move.read') && <a className="small" href={recordHref('inventory.lot', lot.id)}>{t('Truy xuất lô')}</a>}</div>; })}</div> : <div className="empty">{t('Chưa ghi nhận thu hoạch.')}</div>}</article>
          <article className="card agriculture-panel"><h3>{t('Nhật ký vật tư')}</h3>{cycleInputs.length ? <div className="agriculture-history">{cycleInputs.map((record) => <div className="agriculture-history-row" key={record.id}><div><strong>{t(inputKinds.find(([value]) => value === record.kind)?.[1] || record.kind)}{record.product ? ` · ${products.get(record.product)?.name || t('Sản phẩm')}` : ''}</strong><div className="small muted">{fmtDate(record.date)} · {fmtNumber(record.qty)} {unitLabel(record)}{record.base_qty != null && record.uom_ratio > 1 ? ` (${fmtNumber(record.base_qty)} ${t('base')})` : ""}{record.kind === 'pesticide' && record.preharvest_interval_days != null ? ` · ${t('Cách ly trước thu hoạch')} ${fmtNumber(record.preharvest_interval_days)} ${t('ngày')}` : ''}{record.warehouse ? ` · ${warehouses.get(record.warehouse)?.name || t('Kho')}` : ''}</div></div></div>)}</div> : <div className="empty">{t('Chưa ghi nhận vật tư.')}</div>}</article></div>
      </> : <div className="empty card-pad">{t('Chọn vụ mùa để xem nhật ký, nhập vật tư và sản lượng.')}</div>}</section></div>
    </>}
  </div>;
}
