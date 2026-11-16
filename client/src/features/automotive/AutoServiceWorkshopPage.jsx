import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api, dataPath } from '../../lib/api.js';
import { fmtDateTime, fmtMoney, fmtNumber, statusLabel, uiTextWith } from '../../lib/i18n.js';
import { app, can, loadRefs, recordLabel, loadAllResponse } from '../../lib/state.js';
import { recordHref } from '../../lib/routes.js';
import autoServiceEnglish from './auto-service.en.js';

const t = (text) => uiTextWith(text, autoServiceEnglish);

const itemsOf = (response) => Array.isArray(response?.items) ? response.items : [];

export default function AutoServiceWorkshopPage() {
  const [vehicles, setVehicles] = useState([]);
  const [orders, setOrders] = useState([]);
  const [parties, setParties] = useState(new Map());
  const [products, setProducts] = useState(new Map());
  const [units, setUnits] = useState(new Map());
  const [warehouses, setWarehouses] = useState(new Map());
  const [invoices, setInvoices] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [party, setParty] = useState('');
  const [plate, setPlate] = useState('');
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [vin, setVin] = useState('');
  const [odometer, setOdometer] = useState('');
  const [odometerReading, setOdometerReading] = useState('');
  const [intakeOdometer, setIntakeOdometer] = useState('');
  const [declineReasons, setDeclineReasons] = useState({});
  const [vehicleId, setVehicleId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [complaint, setComplaint] = useState('');
  const [draftLines, setDraftLines] = useState([]);
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async (quiet = false) => {
    if (!quiet) { setLoading(true); setError(''); }
    try {
      const showInvoices = app.meta?.modules?.some((module) => module.id === 'accounting') && can('accounting.invoice.read');
      const [vehicleResponse, orderResponse, partyMap, productMap, unitMap, warehouseMap, invoiceResponse] = await Promise.all([
        loadAllResponse('auto-service.vehicle'), loadAllResponse('auto-service.repair_order'),
        loadRefs('master-data.party'), loadRefs('master-data.product'), can('master-data.uom.read') ? loadRefs('master-data.uom') : Promise.resolve(new Map()), loadRefs('inventory.warehouse'),
        showInvoices ? loadAllResponse('accounting.invoice') : Promise.resolve({ items: [] }),
      ]);
      const nextVehicles = itemsOf(vehicleResponse).sort((a, b) => String(a.plate || '').localeCompare(String(b.plate || '')));
      const nextOrders = itemsOf(orderResponse).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
      setVehicles(nextVehicles); setOrders(nextOrders); setParties(partyMap); setProducts(productMap); setUnits(unitMap); setWarehouses(warehouseMap);
      setInvoices(itemsOf(invoiceResponse));
      setSelectedId((current) => nextOrders.some((item) => item.id === current) ? current : nextOrders[0]?.id || '');
      setVehicleId((current) => nextVehicles.some((item) => item.id === current) ? current : nextVehicles[0]?.id || '');
    } catch (reason) { setError(reason.message || t('Không tải được dữ liệu xưởng sửa chữa.')); }
    finally { if (!quiet) setLoading(false); }
  }, []);

  useEffect(() => { document.title = `${t('Xưởng sửa chữa')} · OSP Suite`; load(); }, [load]);

  const selected = orders.find((item) => item.id === selectedId) || null;
  const canCreateVehicle = can('auto-service.vehicle.create');
  const canCreateOrder = can('auto-service.repair_order.create');
  const vehicleById = useMemo(() => new Map(vehicles.map((item) => [item.id, item])), [vehicles]);
  const currentVehicle = selected ? vehicleById.get(selected.vehicle) : null;
  const lastOdometerByVehicle = useMemo(() => {
    const latest = new Map(vehicles.map((vehicle) => [vehicle.id, Number(vehicle.odometer || 0)]));
    for (const order of orders) {
      const reading = Number(order.odometer_reading);
      if (Number.isFinite(reading) && reading >= 0) latest.set(order.vehicle, Math.max(latest.get(order.vehicle) || 0, reading));
    }
    return latest;
  }, [orders, vehicles]);
  const currentOdometer = currentVehicle ? lastOdometerByVehicle.get(currentVehicle.id) ?? currentVehicle.odometer : null;
  useEffect(() => {
    const reading = currentVehicle ? lastOdometerByVehicle.get(currentVehicle.id) ?? currentVehicle.odometer : null;
    setOdometerReading(reading == null ? '' : String(reading));
  }, [currentVehicle?.id, lastOdometerByVehicle]);
  useEffect(() => {
    const reading = lastOdometerByVehicle.get(vehicleId);
    setIntakeOdometer(reading == null ? '' : String(reading));
  }, [vehicleId, lastOdometerByVehicle]);
  const openOrders = orders.filter((item) => !['completed', 'delivered', 'quote_declined'].includes(item.status));
  const productChoices = [...products.values()].filter((item) => item.active !== false && ['goods', 'service', undefined].includes(item.kind)).sort((a, b) => String(a.name).localeCompare(String(b.name), 'vi'));
  const unitsFor = (productId) => {
    const baseUnit = products.get(productId)?.uom;
    return baseUnit ? [...units.values()].filter((unit) => unit.id === baseUnit || unit.base_uom === baseUnit) : [];
  };
  const unitRatio = (line) => units.get(line.uom || products.get(line.product)?.uom)?.ratio || 1;
  const needsWarehouse = draftLines.some((line) => {
    const product = products.get(line.product);
    return product && (product.tracked ?? (product.kind === 'goods'));
  });
  const vehicleOrders = selected ? orders.filter((item) => item.vehicle === selected.vehicle) : [];
  const selectedInvoice = selected && invoices.find((item) => item.source === 'repair_order' && item.source_id === selected.id);

  const createVehicle = async (event) => {
    event.preventDefault(); setBusy('vehicle'); setError(''); setNotice('');
    try {
      const created = await api(dataPath('auto-service.vehicle'), { method: 'POST', body: {
        party, plate: plate.trim(), make: make.trim() || undefined, model: model.trim() || undefined,
        vin: vin.trim() || undefined, odometer: odometer === '' ? undefined : Number(odometer),
      } });
      setPlate(''); setMake(''); setModel(''); setVin(''); setOdometer('');
      await load(true); setVehicleId(created.id); setNotice(`${t('Đã tiếp nhận xe')} ${created.plate}.`);
    } catch (reason) { setError(reason.message || t('Không tiếp nhận được xe.')); }
    finally { setBusy(''); }
  };

  const addLine = () => setDraftLines((current) => [...current, { product: productChoices[0]?.id || '', qty: '1', uom: '' }]);
  const updateLine = (index, key, value) => setDraftLines((current) => current.map((line, i) => i === index ? { ...line, [key]: value, ...(key === 'product' ? { uom: '' } : {}) } : line));
  const createOrder = async (event) => {
    event.preventDefault(); if (!vehicleId || !draftLines.length || intakeOdometer === '') return;
    const vehicle = vehicleById.get(vehicleId);
    setBusy('order'); setError(''); setNotice('');
    try {
      const created = await api(dataPath('auto-service.repair_order'), { method: 'POST', body: {
        vehicle: vehicleId, party: vehicle.party, odometer_reading: Number(intakeOdometer), warehouse: warehouseId || undefined, complaint: complaint.trim() || undefined,
        lines: draftLines.map((line) => ({ product: line.product, qty: Number(line.qty), ...(line.uom ? { uom: line.uom } : {}) })),
      } });
      setDraftLines([]); setComplaint(''); await load(true); setSelectedId(created.id);
      setNotice(`${t('Đã lập lệnh')} ${String(created.id).slice(0, 8)}${t('. Đơn giá và tổng tiền do server lấy theo danh mục sản phẩm.')}`);
    } catch (reason) { setError(reason.message || t('Không lập được lệnh sửa chữa. Kiểm tra phụ tùng, giá và kho.')); }
    finally { setBusy(''); }
  };

  const transition = async (order, action) => {
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
    } catch (reason) { setError(reason.message || t('Không chuyển được trạng thái. Kiểm tra tồn kho phụ tùng và dữ liệu liên quan.')); await load(true); }
    finally { setBusy(''); }
  };

  const updateOdometer = async (event) => {
    event.preventDefault();
    if (!currentVehicle || odometerReading === '') return;
    setBusy('odometer'); setError(''); setNotice('');
    try {
      await api(dataPath('auto-service.vehicle', currentVehicle.id), { method: 'PATCH', body: { odometer: Number(odometerReading) } });
      await load(true); setNotice(`${t('Đã cập nhật công-tơ-mét xe')} ${currentVehicle.plate}.`);
    } catch (reason) { setError(reason.message || t('Không thể cập nhật số công-tơ-mét.')); }
    finally { setBusy(''); }
  };

  const orderVehicle = selected && vehicleById.get(selected.vehicle);
  return <div className="page-content workshop-page">
    <header className="page-header"><div><h1>{t('Xưởng sửa chữa')}</h1><p className="muted">{t('Tiếp nhận xe, báo giá theo danh mục, xác nhận khách hàng, sửa chữa và bàn giao.')}</p></div><button className="button" onClick={() => load()} disabled={loading}>{t('Làm mới')}</button></header>
    {error && <div className="alert error" role="alert">{t(error)}</div>}{notice && <div className="alert success" role="status">{t(notice)}</div>}
    {canCreateVehicle && <section className="workshop-intake card"><h2>{t('Tiếp nhận xe mới')}</h2><form className="workshop-form" onSubmit={createVehicle}>
      <label className="field"><span>{t('Chủ xe')}</span><select className="select" required value={party} onChange={(event) => setParty(event.target.value)}><option value="">{t('Chọn khách hàng')}</option>{[...parties.values()].map((item) => <option key={item.id} value={item.id}>{recordLabel('master-data.party', item)}</option>)}</select></label>
      <label className="field"><span>{t('Biển số')}</span><input className="input" required value={plate} onChange={(event) => setPlate(event.target.value)} /></label>
      <label className="field"><span>{t('Hãng xe')}</span><input className="input" value={make} onChange={(event) => setMake(event.target.value)} /></label>
      <label className="field"><span>{t('Dòng xe')}</span><input className="input" value={model} onChange={(event) => setModel(event.target.value)} /></label>
      <label className="field"><span>{t('VIN')}</span><input className="input" value={vin} onChange={(event) => setVin(event.target.value)} /></label>
      <label className="field"><span>{t('Số km hiện tại')}</span><input className="input" type="number" min="0" value={odometer} onChange={(event) => setOdometer(event.target.value)} /></label>
      <button className="button primary" disabled={busy === 'vehicle' || !party}>{busy === 'vehicle' ? t('Đang lưu…') : t('Lưu xe')}</button>
    </form></section>}

    {canCreateOrder && <section className="workshop-intake card"><h2>{t('Lập lệnh và báo giá')}</h2><form onSubmit={createOrder}>
      <div className="workshop-form">
        <label className="field"><span>{t('Xe')}</span><select className="select" required value={vehicleId} onChange={(event) => setVehicleId(event.target.value)}><option value="">{t('Chọn xe')}</option>{vehicles.map((item) => <option key={item.id} value={item.id}>{item.plate} · {[item.make, item.model].filter(Boolean).join(' ')}</option>)}</select></label>
        <label className="field"><span>{t('Số km lúc tiếp nhận *')}</span><input className="input num" type="number" min={vehicleId ? lastOdometerByVehicle.get(vehicleId) || 0 : 0} step="1" required value={intakeOdometer} onChange={(event) => setIntakeOdometer(event.target.value)} /><span className="hint">{t('Không thấp hơn lần ghi nhận gần nhất của xe.')}</span></label>
        <label className="field"><span>{t('Kho phụ tùng xuất')}</span><select className="select" value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)}><option value="">{t('Chọn khi có phụ tùng theo dõi tồn')}</option>{[...warehouses.values()].map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="field workshop-complaint"><span>{t('Khách mô tả / yêu cầu')}</span><textarea className="input textarea" value={complaint} onChange={(event) => setComplaint(event.target.value)} /></label>
      </div>
      <div className="workshop-lines"><div className="workshop-section-head"><h3>{t('Phụ tùng và công việc')}</h3><button type="button" className="button" onClick={addLine} disabled={!productChoices.length}>{t('Thêm dòng')}</button></div>
        {draftLines.map((line, index) => { const product = products.get(line.product); return <div className="workshop-line" key={index}>
          <select className="select" required value={line.product} onChange={(event) => updateLine(index, 'product', event.target.value)}><option value="">{t('Chọn phụ tùng / dịch vụ')}</option>{productChoices.map((item) => <option key={item.id} value={item.id}>{item.name} · {fmtMoney(item.price || 0)}</option>)}</select>{unitsFor(line.product).length > 0 && <select className="select" aria-label={t('Unit')} value={line.uom || products.get(line.product)?.uom || ''} onChange={(event) => updateLine(index, 'uom', event.target.value)}>{unitsFor(line.product).map((unit) => <option key={unit.id} value={unit.id}>{unit.name}{unit.base_uom ? ` (${unit.ratio} × ${t('base')})` : ` (${t('base')})`}</option>)}</select>}
          <input className="input" type="number" min="0.001" step="any" required aria-label={t('Số lượng')} value={line.qty} onChange={(event) => updateLine(index, 'qty', event.target.value)} />
          <strong className="num">{fmtMoney((Number(product?.price) || 0) * unitRatio(line) * (Number(line.qty) || 0))}</strong>
          <button type="button" className="button danger" aria-label={t('Xóa dòng')} onClick={() => setDraftLines((current) => current.filter((_, i) => i !== index))}>×</button>
        </div>; })}
      </div>
      {needsWarehouse && !warehouseId && <p className="small muted">{t('Lệnh có phụ tùng theo dõi tồn kho cần chọn kho trước khi lập.')}</p>}
      <button className="button primary" disabled={busy === 'order' || !vehicleId || intakeOdometer === '' || !draftLines.length || (needsWarehouse && !warehouseId)}>{busy === 'order' ? t('Đang lập…') : t('Lập báo giá chờ khách duyệt')}</button>
    </form></section>}

    <div className="workshop-layout">
      <section className="workshop-order-list"><header><h2>{t('Lệnh sửa chữa')}</h2><span className="badge warning">{openOrders.length} {t('đang xử lý')}</span></header>
        {loading ? <div className="card-pad"><div className="skeleton" data-h="row" /></div> : orders.length ? <div className="workshop-orders">{orders.map((order) => { const vehicle = vehicleById.get(order.vehicle); return <button key={order.id} className={`card workshop-order${selectedId === order.id ? ' selected' : ''}`} onClick={() => setSelectedId(order.id)}>
          <span className="workshop-order-title"><strong>{vehicle?.plate || t('Xe')} · {vehicle ? [vehicle.make, vehicle.model].filter(Boolean).join(' ') : ''}</strong><span className={`badge ${['completed', 'delivered'].includes(order.status) ? 'success' : order.status === 'quote_declined' ? 'plain' : 'warning'}`}>{statusLabel(order.status)}</span></span>
          <span>{recordLabel('master-data.party', parties.get(order.party))}</span><span className="small muted">{fmtDateTime(order.created_at)}</span><strong className="num">{fmtMoney(order.total || 0)}</strong>
        </button>; })}</div> : <div className="card-pad muted">{t('Chưa có lệnh sửa chữa.')}</div>}
      </section>

      <section className="workshop-detail card">{selected ? <>
        <header className="workshop-section-head"><div><h2>{orderVehicle?.plate || t('Lệnh sửa chữa')}</h2><div className="muted">{recordLabel('master-data.party', parties.get(selected.party))} · {warehouses.get(selected.warehouse)?.name || t('Chưa chọn kho')}</div></div><span className={`badge ${['completed', 'delivered'].includes(selected.status) ? 'success' : selected.status === 'quote_declined' ? 'plain' : 'warning'}`}>{statusLabel(selected.status)}</span></header>
        <dl className="workshop-summary"><div><dt>{t('Xe')}</dt><dd>{[orderVehicle?.make, orderVehicle?.model].filter(Boolean).join(' ') || t('Chưa khai báo')}</dd></div><div><dt>{t('Km lúc tiếp nhận')}</dt><dd>{selected.odometer_reading == null ? t('Chưa ghi') : `${fmtNumber(selected.odometer_reading)} km`}</dd></div><div><dt>{t('Km ghi nhận gần nhất')}</dt><dd>{orderVehicle && lastOdometerByVehicle.has(orderVehicle.id) ? `${fmtNumber(lastOdometerByVehicle.get(orderVehicle.id))} km` : '—'}</dd></div><div><dt>{t('VIN')}</dt><dd>{orderVehicle?.vin || '—'}</dd></div><div><dt>{t('Ngày nhận')}</dt><dd>{fmtDateTime(selected.created_at)}</dd></div></dl>
        {currentVehicle && can('auto-service.vehicle.update') && <form className="workshop-form" style={{ margin: '12px 0' }} onSubmit={updateOdometer}><label className="field"><span>{t('Số công-tơ-mét hiện tại (km)')}</span><input className="input" type="number" min={currentOdometer ?? 0} step="1" required value={odometerReading} onChange={(event) => setOdometerReading(event.target.value)} /></label><button className="button" disabled={busy === 'odometer' || odometerReading === '' || Number(odometerReading) === Number(currentOdometer || 0)}>{t('Cập nhật số km')}</button><span className="small muted">{t('Số km không được thấp hơn lần ghi nhận trước hoặc lịch sử xưởng.')}</span></form>}
        {selected.complaint && <p className="workshop-complaint"><strong>{t('Yêu cầu:')}</strong> {selected.complaint}</p>}
        {selected.status === 'quote_declined' && selected.declined_reason && <div className="alert">{t('Khách từ chối báo giá:')} {selected.declined_reason}</div>}
        <h3>{t('Báo giá')}</h3><ul className="workshop-estimate">{(selected.lines || []).map((line, index) => <li key={`${line.product}:${index}`}><span>{line.product_name || products.get(line.product)?.name || t('Sản phẩm')} × {line.qty} {line.uom_name || units.get(line.uom)?.name || ''}</span><strong className="num">{fmtMoney((Number(line.qty) || 0) * (Number(line.price) || 0))}</strong></li>)}</ul>
        <div className="workshop-total"><span>{t('Tổng cộng')}</span><strong className="num">{fmtMoney(selected.total || 0)}</strong></div>
        {selectedInvoice && <a className="button" href={recordHref('accounting.invoice', selectedInvoice.id)}>{t('Mở hóa đơn')} {String(selectedInvoice.id).slice(0, 8)}</a>}
        <div className="workshop-actions">
          {selected.status === 'intake' && can('auto-service.repair_order.approved') && <button className="button primary" onClick={() => transition(selected, 'approved')} disabled={!!busy}>{t('Khách duyệt báo giá')}</button>}
        {selected.status === 'intake' && can('auto-service.repair_order.quote_declined') && can('auto-service.repair_order.update') && <div className="workshop-decline"><label className="field"><span>{t('Lý do khách từ chối báo giá *')}</span><textarea className="input textarea" rows="2" minLength="5" maxLength="500" value={declineReasons[selected.id] || ''} onChange={(event) => setDeclineReasons((current) => ({ ...current, [selected.id]: event.target.value }))} placeholder={t('Ví dụ: khách chưa đồng ý chi phí sửa chữa')} /></label><button className="button" type="button" disabled={!!busy || (declineReasons[selected.id] || '').trim().length < 5} onClick={() => transition(selected, 'quote_declined')}>{t('Ghi nhận khách từ chối')}</button></div>}
          {selected.status === 'approved' && can('auto-service.repair_order.started') && <button className="button primary" onClick={() => transition(selected, 'started')} disabled={!!busy}>{t('Bắt đầu sửa chữa')}</button>}
          {selected.status === 'in_progress' && can('auto-service.repair_order.completed') && <button className="button primary" onClick={() => transition(selected, 'completed')} disabled={!!busy}>{t('Hoàn tất, xuất phụ tùng và lập hóa đơn')}</button>}
          {selected.status === 'completed' && can('auto-service.repair_order.delivered') && <button className="button primary" onClick={() => transition(selected, 'delivered')} disabled={!!busy}>{t('Bàn giao xe')}</button>}
        </div>
        <details className="workshop-history"><summary>{t('Lịch sử xe')} ({vehicleOrders.length} {t('lệnh')})</summary>{vehicleOrders.map((order) => <div className="workshop-history-row" key={order.id}><span>{fmtDateTime(order.created_at)} · {order.odometer_reading == null ? t('Chưa ghi số km') : `${fmtNumber(order.odometer_reading)} km`} · {order.complaint || t('Bảo dưỡng')}</span><strong>{statusLabel(order.status)} · {fmtMoney(order.total || 0)}</strong></div>)}</details>
      </> : <div className="card-pad muted">{t('Chọn lệnh để xem báo giá và tiến độ.')}</div>}</section>
    </div>
  </div>;
}
