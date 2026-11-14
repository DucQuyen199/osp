import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api, dataPath } from './lib/api.js';
import { fmtDate, fmtMoney, fmtNumber, statusLabel } from './lib/i18n.js';
import { app, can, loadRefs, recordLabel } from './lib/state.js';
import { recordHref } from './lib/routes.js';

const listItems = (response) => Array.isArray(response?.items) ? response.items : [];
const today = () => new Date().toISOString().slice(0, 10);

export default function AgricultureOperationsPage() {
  const [farms, setFarms] = useState([]);
  const [cycles, setCycles] = useState([]);
  const [harvests, setHarvests] = useState([]);
  const [applications, setApplications] = useState([]);
  const [products, setProducts] = useState(new Map());
  const [warehouses, setWarehouses] = useState(new Map());
  const [parties, setParties] = useState(new Map());
  const [lots, setLots] = useState(new Map());
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
  const [inputWarehouse, setInputWarehouse] = useState('');
  const [inputQty, setInputQty] = useState('');
  const [inputDate, setInputDate] = useState(today());
  const [harvestProduct, setHarvestProduct] = useState('');
  const [harvestWarehouse, setHarvestWarehouse] = useState('');
  const [harvestQty, setHarvestQty] = useState('');
  const [harvestGrade, setHarvestGrade] = useState('');
  const [harvestLotCode, setHarvestLotCode] = useState('');
  const [harvestDate, setHarvestDate] = useState(today());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async (preserveNotice = false) => {
    setLoading(true); setError(''); if (!preserveNotice) setNotice('');
    try {
      const [farmResponse, cycleResponse, harvestResponse, inputResponse, productMap, warehouseMap, partyMap, lotMap] = await Promise.all([
        api(`${dataPath('agriculture.farm')}?limit=1000`), api(`${dataPath('agriculture.crop_cycle')}?limit=1000`),
        api(`${dataPath('agriculture.harvest')}?limit=1000`), api(`${dataPath('agriculture.input_application')}?limit=1000`),
        loadRefs('master-data.product'), loadRefs('inventory.warehouse'), loadRefs('master-data.party'), loadRefs('inventory.lot'),
      ]);
      const farmItems = listItems(farmResponse);
      const cycleItems = listItems(cycleResponse).sort((a, b) => String(a.expected_harvest || '9999').localeCompare(String(b.expected_harvest || '9999')));
      setFarms(farmItems); setCycles(cycleItems); setHarvests(listItems(harvestResponse)); setApplications(listItems(inputResponse));
      setProducts(productMap); setWarehouses(warehouseMap); setParties(partyMap); setLots(lotMap);
      setCycleId((current) => cycleItems.some((item) => item.id === current) ? current : cycleItems.find((item) => item.status === 'growing')?.id || cycleItems[0]?.id || '');
      setNewCycleFarm((current) => farmItems.some((item) => item.id === current) ? current : farmItems[0]?.id || '');
    } catch (reason) { setError(reason.message || 'Không tải được dữ liệu mùa vụ.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { document.title = 'Điều hành mùa vụ · OSP Suite'; load(); }, [load]);

  const selectedCycle = cycles.find((item) => item.id === cycleId) || null;
  const selectedFarm = selectedCycle && farms.find((farm) => farm.id === selectedCycle.farm);
  const cycleHarvests = useMemo(() => harvests.filter((item) => item.cycle === cycleId).sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))), [harvests, cycleId]);
  const cycleInputs = useMemo(() => applications.filter((item) => item.cycle === cycleId).sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))), [applications, cycleId]);
  const totalHarvest = cycleHarvests.reduce((sum, item) => sum + (Number(item.qty) || 0), 0);
  const yieldPerArea = selectedFarm?.area && Number(selectedFarm.area) > 0 ? totalHarvest / Number(selectedFarm.area) : null;
  const activeCycles = cycles.filter((item) => item.status === 'growing').length;
  const upcomingCycles = cycles.filter((item) => item.status === 'growing' && item.expected_harvest && item.expected_harvest >= today()).length;

  const createFarm = async (event) => {
    event.preventDefault(); setBusy('farm'); setError(''); setNotice('');
    try {
      const created = await api(dataPath('agriculture.farm'), { method: 'POST', body: { name: farmName.trim(), location: farmLocation.trim() || undefined, area: farmArea ? Number(farmArea) : undefined, owner: farmOwner || undefined } });
      setFarmName(''); setFarmLocation(''); setFarmArea(''); setFarmOwner('');
      await load(true); setNewCycleFarm(created.id); setNotice('Đã tạo trang trại.');
    } catch (reason) { setError(reason.message || 'Không tạo được trang trại.'); }
    finally { setBusy(''); }
  };

  const createCycle = async (event) => {
    event.preventDefault(); setBusy('cycle'); setError(''); setNotice('');
    try {
      const created = await api(dataPath('agriculture.crop_cycle'), { method: 'POST', body: { farm: newCycleFarm, crop: crop.trim(), planted_on: plantedOn, expected_harvest: expectedHarvest || undefined } });
      setCrop(''); setExpectedHarvest(''); await load(true); setCycleId(created.id); setNotice('Đã mở vụ mùa mới.');
    } catch (reason) { setError(reason.message || 'Không tạo được vụ mùa.'); }
    finally { setBusy(''); }
  };

  const createInput = async (event) => {
    event.preventDefault(); if (!selectedCycle) return;
    setBusy('input'); setError(''); setNotice('');
    try {
      await api(dataPath('agriculture.input_application'), { method: 'POST', body: { cycle: selectedCycle.id, kind: inputKind, qty: Number(inputQty), date: inputDate, ...(inputProduct ? { product: inputProduct, warehouse: inputWarehouse } : {}) } });
      setInputQty(''); await load(true); setNotice('Đã ghi nhật ký sử dụng vật tư và cập nhật tồn kho nếu có sản phẩm.');
    } catch (reason) { setError(reason.message || 'Không ghi được nhật ký vật tư. Kiểm tra kho và tồn khả dụng.'); }
    finally { setBusy(''); }
  };

  const createHarvest = async (event) => {
    event.preventDefault(); if (!selectedCycle) return;
    setBusy('harvest'); setError(''); setNotice('');
    try {
      await api(dataPath('agriculture.harvest'), { method: 'POST', body: { cycle: selectedCycle.id, product: harvestProduct, warehouse: harvestWarehouse, qty: Number(harvestQty), date: harvestDate, grade: harvestGrade.trim() || undefined, lot_code: harvestLotCode.trim() || undefined } });
      setHarvestQty(''); setHarvestGrade(''); setHarvestLotCode(''); await load(true); setNotice('Đã nhập sản lượng thu hoạch vào kho; mã lô được gắn cho truy xuất khi sản phẩm yêu cầu.');
    } catch (reason) { setError(reason.message || 'Không ghi nhận được thu hoạch. Kiểm tra ngày vụ mùa và kho nhận.'); }
    finally { setBusy(''); }
  };

  const closeCycle = async (action) => {
    if (!selectedCycle) return;
    setBusy(`cycle:${action}`); setError(''); setNotice('');
    try { await api(dataPath('agriculture.crop_cycle', selectedCycle.id, action), { method: 'POST' }); await load(true); setNotice(action === 'harvested' ? 'Đã kết thúc vụ mùa sau khi xác nhận sản lượng.' : 'Đã đánh dấu vụ mùa thất bại.'); }
    catch (reason) { setError(reason.message || 'Không cập nhật được trạng thái vụ mùa.'); }
    finally { setBusy(''); }
  };

  const inputKinds = [['fertilizer', 'Phân bón'], ['pesticide', 'Thuốc bảo vệ thực vật'], ['seed', 'Giống'], ['water', 'Nước tưới']];
  const requiresProduct = ['fertilizer', 'pesticide', 'seed'].includes(inputKind);

  return <div className="page agriculture-page">
    <div className="page-head"><div><h1>Điều hành mùa vụ</h1><p className="sub">Quản lý trang trại, theo dõi vụ đang canh tác, ghi vật tư và nhập sản lượng thu hoạch vào kho.</p></div><button className="btn btn-secondary" type="button" disabled={loading || Boolean(busy)} onClick={() => load()}>{loading ? 'Đang tải…' : 'Làm mới'}</button></div>
    <div className="row wrap agriculture-summary"><span className="badge success">Vụ đang canh tác: {activeCycles}</span><span className="badge warning">Có ngày thu dự kiến: {upcomingCycles}</span><span className="badge plain">Trang trại: {farms.length}</span></div>
    {error && <div className="alert danger" role="alert">{error}</div>}{notice && <div className="alert success" role="status">{notice}</div>}
    {loading ? <div className="card-pad"><div className="skeleton" data-h="row" /></div> : <>
      <div className="agriculture-setup">
        <details className="card agriculture-panel"><summary>Tạo trang trại</summary><form className="agriculture-form" onSubmit={createFarm}>
          <label className="field"><span className="label">Tên trang trại *</span><input className="input" required value={farmName} onChange={(event) => setFarmName(event.target.value)} /></label>
          <label className="field"><span className="label">Địa điểm</span><input className="input" value={farmLocation} onChange={(event) => setFarmLocation(event.target.value)} /></label>
          <label className="field"><span className="label">Diện tích (ha)</span><input className="input num" type="number" min="0.001" step="any" value={farmArea} onChange={(event) => setFarmArea(event.target.value)} /></label>
          <label className="field"><span className="label">Chủ trang trại</span><select className="select" value={farmOwner} onChange={(event) => setFarmOwner(event.target.value)}><option value="">Chưa gán</option>{[...parties.values()].map((item) => <option key={item.id} value={item.id}>{recordLabel('master-data.party', item)}</option>)}</select></label>
          <button className="btn btn-secondary" type="submit" disabled={Boolean(busy) || !can('agriculture.farm.create')}>{busy === 'farm' ? 'Đang lưu…' : 'Tạo trang trại'}</button>
        </form></details>
        <details className="card agriculture-panel" open={!farms.length}><summary>Mở vụ mùa mới</summary><form className="agriculture-form" onSubmit={createCycle}>
          <label className="field"><span className="label">Trang trại *</span><select className="select" required value={newCycleFarm} onChange={(event) => setNewCycleFarm(event.target.value)}><option value="">Chọn trang trại</option>{farms.map((farm) => <option key={farm.id} value={farm.id}>{farm.name}</option>)}</select></label>
          <label className="field"><span className="label">Cây trồng / vụ *</span><input className="input" required value={crop} onChange={(event) => setCrop(event.target.value)} placeholder="Ví dụ: Lúa đông xuân" /></label>
          <label className="field"><span className="label">Ngày gieo trồng *</span><input className="input" required type="date" value={plantedOn} onChange={(event) => setPlantedOn(event.target.value)} /></label>
          <label className="field"><span className="label">Thu hoạch dự kiến</span><input className="input" type="date" min={plantedOn} value={expectedHarvest} onChange={(event) => setExpectedHarvest(event.target.value)} /></label>
          <button className="btn btn-primary" type="submit" disabled={Boolean(busy) || !newCycleFarm || !can('agriculture.crop_cycle.create')}>{busy === 'cycle' ? 'Đang lưu…' : 'Mở vụ mùa'}</button>
        </form></details>
      </div>
      <div className="agriculture-layout"><section className="agriculture-cycle-list"><header className="agriculture-section-head"><h2>Vụ mùa</h2><span className="badge plain">{cycles.length}</span></header>
        {cycles.length ? cycles.map((cycle) => { const farm = farms.find((item) => item.id === cycle.farm); const cycleQty = harvests.filter((item) => item.cycle === cycle.id).reduce((sum, item) => sum + (Number(item.qty) || 0), 0); const isDue = cycle.status === 'growing' && cycle.expected_harvest && cycle.expected_harvest < today(); return <button type="button" className={`card agriculture-cycle${cycleId === cycle.id ? ' selected' : ''}${isDue ? ' due' : ''}`} key={cycle.id} onClick={() => setCycleId(cycle.id)}><strong>{cycle.crop}</strong><span>{farm?.name || 'Trang trại'}</span><span className="small muted">Gieo {fmtDate(cycle.planted_on)}{cycle.expected_harvest ? ` · Dự thu ${fmtDate(cycle.expected_harvest)}` : ''}</span><span className="row wrap"><span className={`badge ${cycle.status === 'growing' ? isDue ? 'danger' : 'warning' : cycle.status === 'harvested' ? 'success' : 'plain'}`}>{isDue ? 'Quá ngày dự kiến' : statusLabel(cycle.status)}</span><span className="small num">Đã thu: {fmtNumber(cycleQty)}</span></span></button>; }) : <div className="empty">Tạo trang trại và mở vụ mùa để bắt đầu.</div>}
      </section>
      <section className="agriculture-cycle-detail">{selectedCycle ? <>
        <article className="card agriculture-panel"><header className="agriculture-section-head"><div><h2>{selectedCycle.crop}</h2><p className="small muted">{selectedFarm?.name} · Gieo {fmtDate(selectedCycle.planted_on)}{selectedCycle.expected_harvest ? ` · Dự kiến ${fmtDate(selectedCycle.expected_harvest)}` : ''}</p></div><span className={`badge ${selectedCycle.status === 'growing' ? 'warning' : selectedCycle.status === 'harvested' ? 'success' : 'plain'}`}>{statusLabel(selectedCycle.status)}</span></header>
          <div className="agriculture-kpis"><div><span>Sản lượng đã thu</span><strong className="num">{fmtNumber(totalHarvest)}</strong></div><div><span>Diện tích</span><strong>{selectedFarm?.area ? `${fmtNumber(selectedFarm.area)} ha` : 'Chưa khai báo'}</strong></div><div><span>Năng suất lũy kế</span><strong>{yieldPerArea != null ? `${fmtNumber(yieldPerArea)} / ha` : 'Cần diện tích'}</strong></div><div><span>Lần bón / dùng vật tư</span><strong>{cycleInputs.length}</strong></div></div>
          {selectedCycle.status === 'growing' && <footer className="row wrap agriculture-cycle-actions">{can('agriculture.crop_cycle.harvested') && <button className="btn btn-primary btn-sm" type="button" disabled={Boolean(busy) || !cycleHarvests.length} title={!cycleHarvests.length ? 'Ghi nhận ít nhất một lần thu hoạch trước' : ''} onClick={() => closeCycle('harvested')}>Kết thúc vụ</button>}{can('agriculture.crop_cycle.failed') && <button className="btn btn-secondary btn-sm" type="button" disabled={Boolean(busy)} onClick={() => closeCycle('failed')}>Đánh dấu thất bại</button>}</footer>}
        </article>
        {selectedCycle.status === 'growing' && <div className="agriculture-work-forms">
          <form className="card agriculture-panel" onSubmit={createInput}><h3>Ghi vật tư canh tác</h3><p className="small muted">Vật tư có mã sản phẩm sẽ ghi xuất kho; nước tưới có thể ghi theo sản lượng vận hành mà không trừ tồn kho.</p><label className="field"><span className="label">Loại vật tư *</span><select className="select" value={inputKind} onChange={(event) => { setInputKind(event.target.value); setInputProduct(''); }} >{inputKinds.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className="field"><span className="label">Sản phẩm {requiresProduct ? '*' : '(nếu trừ kho)'}</span><select className="select" required={requiresProduct} value={inputProduct} onChange={(event) => setInputProduct(event.target.value)}><option value="">{requiresProduct ? 'Chọn vật tư' : 'Không trừ kho'}</option>{[...products.values()].filter((product) => product.active !== false).map((product) => <option key={product.id} value={product.id}>{product.name}{product.sku ? ` · ${product.sku}` : ''}</option>)}</select></label>
            {inputProduct && <label className="field"><span className="label">Kho xuất *</span><select className="select" required value={inputWarehouse} onChange={(event) => setInputWarehouse(event.target.value)}><option value="">Chọn kho</option>{[...warehouses.values()].map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{recordLabel('inventory.warehouse', warehouse)}</option>)}</select></label>}
            <div className="agriculture-form-row"><label className="field"><span className="label">Lượng sử dụng *</span><input className="input num" type="number" required min="0.001" step="any" value={inputQty} onChange={(event) => setInputQty(event.target.value)} /></label><label className="field"><span className="label">Ngày sử dụng *</span><input className="input" type="date" required value={inputDate} onChange={(event) => setInputDate(event.target.value)} /></label></div>
            <button className="btn btn-secondary" type="submit" disabled={Boolean(busy) || (inputProduct && !inputWarehouse) || !can('agriculture.input_application.create')}>{busy === 'input' ? 'Đang ghi…' : 'Ghi nhật ký vật tư'}</button>
          </form>
          <form className="card agriculture-panel" onSubmit={createHarvest}><h3>Nhập sản lượng thu hoạch</h3><p className="small muted">Ghi phiếu sẽ nhập hàng vào kho. Với sản phẩm quản lý lô, cần nhập mã lô để truy xuất nguồn gốc.</p>
            <label className="field"><span className="label">Nông sản *</span><select className="select" required value={harvestProduct} onChange={(event) => setHarvestProduct(event.target.value)}><option value="">Chọn nông sản</option>{[...products.values()].filter((product) => product.active !== false).map((product) => <option key={product.id} value={product.id}>{product.name}{product.sku ? ` · ${product.sku}` : ''}{product.lot_tracked ? ' · Quản lý lô' : ''}</option>)}</select></label>
            <label className="field"><span className="label">Kho nhận *</span><select className="select" required value={harvestWarehouse} onChange={(event) => setHarvestWarehouse(event.target.value)}><option value="">Chọn kho</option>{[...warehouses.values()].map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{recordLabel('inventory.warehouse', warehouse)}</option>)}</select></label>
            <div className="agriculture-form-row"><label className="field"><span className="label">Sản lượng *</span><input className="input num" type="number" required min="0.001" step="any" value={harvestQty} onChange={(event) => setHarvestQty(event.target.value)} /></label><label className="field"><span className="label">Ngày thu hoạch *</span><input className="input" type="date" required value={harvestDate} onChange={(event) => setHarvestDate(event.target.value)} /></label></div>
            <div className="agriculture-form-row"><label className="field"><span className="label">Phân hạng</span><input className="input" value={harvestGrade} onChange={(event) => setHarvestGrade(event.target.value)} placeholder="Ví dụ: Loại 1" /></label><label className="field"><span className="label">Mã lô</span><input className="input" required={Boolean(products.get(harvestProduct)?.lot_tracked)} value={harvestLotCode} onChange={(event) => setHarvestLotCode(event.target.value)} /></label></div>
            <button className="btn btn-primary" type="submit" disabled={Boolean(busy) || !can('agriculture.harvest.create')}>{busy === 'harvest' ? 'Đang nhập kho…' : 'Ghi nhận thu hoạch'}</button>
          </form>
        </div>}
        <div className="agriculture-history-grid"><article className="card agriculture-panel"><h3>Lịch sử thu hoạch</h3>{cycleHarvests.length ? <div className="agriculture-history">{cycleHarvests.map((harvest) => { const lot = [...lots.values()].find((item) => item.product === harvest.product && item.code === harvest.lot_code); return <div className="agriculture-history-row" key={harvest.id}><div><strong>{products.get(harvest.product)?.name || 'Nông sản'} · {fmtNumber(harvest.qty)}</strong><div className="small muted">{fmtDate(harvest.date)}{harvest.grade ? ` · ${harvest.grade}` : ''}{harvest.lot_code ? ` · Lô ${harvest.lot_code}` : ''}</div></div>{lot && can('inventory.stock_move.read') && <a className="small" href={recordHref('inventory.lot', lot.id)}>Truy xuất lô</a>}</div>; })}</div> : <div className="empty">Chưa ghi nhận thu hoạch.</div>}</article>
          <article className="card agriculture-panel"><h3>Nhật ký vật tư</h3>{cycleInputs.length ? <div className="agriculture-history">{cycleInputs.map((record) => <div className="agriculture-history-row" key={record.id}><div><strong>{inputKinds.find(([value]) => value === record.kind)?.[1] || record.kind}{record.product ? ` · ${products.get(record.product)?.name || 'Sản phẩm'}` : ''}</strong><div className="small muted">{fmtDate(record.date)} · {fmtNumber(record.qty)}{record.warehouse ? ` · ${warehouses.get(record.warehouse)?.name || 'Kho'}` : ''}</div></div></div>)}</div> : <div className="empty">Chưa ghi nhận vật tư.</div>}</article></div>
      </> : <div className="empty card-pad">Chọn vụ mùa để xem nhật ký, nhập vật tư và sản lượng.</div>}</section></div>
    </>}
  </div>;
}
