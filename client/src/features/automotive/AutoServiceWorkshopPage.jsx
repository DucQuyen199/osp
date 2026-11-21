import React, { useEffect, useMemo, useState } from 'react';
import { useDocumentTitle } from '../../lib/useDocumentTitle.js';
import { fmtDateTime, fmtMoney, fmtNumber, statusLabel, uiTextWith } from '../../lib/i18n.js';
import { app, can, recordLabel } from '../../lib/state.js';
import { recordHref } from '../../lib/routes.js';
import autoServiceEnglish from './auto-service.en.js';
import { repairQuoteLineTotal, storedRepairLineTotal } from './domain/repairQuoteTotals.js';
import RepairOrderVehicleSummary from './components/RepairOrderVehicleSummary.jsx';
import RepairOrderWorkflowPanel from './components/RepairOrderWorkflowPanel.jsx';
import { useAutoServiceWorkshopData } from './hooks/useAutoServiceWorkshopData.js';
import { useAutoServiceWorkshopWorkflow } from './hooks/useAutoServiceWorkshopWorkflow.js';
const t = (text) => uiTextWith(text, autoServiceEnglish);
export default function AutoServiceWorkshopPage() {
  useDocumentTitle(`${t('Xưởng sửa chữa')} · OSP Suite`);
  const [selectedId, setSelectedId] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [notice, setNotice] = useState('');
  const {
    vehicles, orders, parties, products, units, warehouses, invoices,
    loading, error, setError, load,
  } = useAutoServiceWorkshopData();
  useEffect(() => {
    setSelectedId((current) => orders.some((item) => item.id === current) ? current : orders[0]?.id || '');
    setVehicleId((current) => vehicles.some((item) => item.id === current) ? current : vehicles[0]?.id || '');
  }, [orders, vehicles]);
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
  const openOrders = orders.filter((item) => !['completed', 'delivered', 'quote_declined'].includes(item.status));
  const productChoices = [...products.values()].filter((item) => item.active !== false && ['goods', 'service', undefined].includes(item.kind)).sort((a, b) => String(a.name).localeCompare(String(b.name), 'vi'));
  const workflow = useAutoServiceWorkshopWorkflow({
    load, vehicleId, setVehicleId, vehicleById, productChoices, selected, currentVehicle, lastOdometerByVehicle,
    setSelectedId, setError, setNotice, t,
  });
  const {
    party, setParty, plate, setPlate, make, setMake, model, setModel, vin, setVin, odometer, setOdometer,
    odometerReading, setOdometerReading, intakeOdometer, setIntakeOdometer, declineReasons, setDeclineReasons,
    warehouseId, setWarehouseId, complaint, setComplaint, draftLines, setDraftLines, quoteDraft, setQuoteDraft,
    busy, createVehicle, addLine, updateLine, createOrder, transition, startQuoteEdit, updateQuoteDraft,
    updateQuoteLine, addQuoteLine, removeQuoteLine, saveQuoteEdit, updateOdometer,
  } = workflow;
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
  const selectedActions = selected ? {
    showEditQuote: selected.status === 'intake' && can('auto-service.repair_order.update') && quoteDraft?.repairOrderId !== selected.id,
    editQuote: selected.status === 'intake' && can('auto-service.repair_order.update') && quoteDraft?.repairOrderId === selected.id,
    approve: selected.status === 'intake' && can('auto-service.repair_order.approved') && quoteDraft?.repairOrderId !== selected.id,
    decline: selected.status === 'intake' && can('auto-service.repair_order.quote_declined') && can('auto-service.repair_order.update') && quoteDraft?.repairOrderId !== selected.id,
    start: selected.status === 'approved' && can('auto-service.repair_order.started'),
    complete: selected.status === 'in_progress' && can('auto-service.repair_order.completed'),
    deliver: selected.status === 'completed' && can('auto-service.repair_order.delivered'),
  } : {};
  const selectedEstimateLines = (selected?.lines || []).map((line, index) => ({
    key: `${line.product}:${index}`,
    productName: line.product_name || products.get(line.product)?.name || '',
    qty: line.qty,
    unitName: line.uom_name || units.get(line.uom)?.name || '',
    total: fmtMoney(storedRepairLineTotal(line)),
  }));
  const orderVehicle = selected && vehicleById.get(selected.vehicle);
  return <div className="page workshop-page">
    <header className="page-head"><div><h1>{t('Xưởng sửa chữa')}</h1><p className="muted">{t('Tiếp nhận xe, báo giá theo danh mục, xác nhận khách hàng, sửa chữa và bàn giao.')}</p></div><button className="btn" onClick={() => load()} disabled={loading}>{t('Làm mới')}</button></header>
    {error && <div className="alert error" role="alert">{t(error)}</div>}{notice && <div className="alert success" role="status">{t(notice)}</div>}
    {canCreateVehicle && <section className="workshop-intake card"><h2>{t('Tiếp nhận xe mới')}</h2><form className="workshop-form" onSubmit={createVehicle}>
      <label className="field"><span>{t('Chủ xe')}</span><select className="select" required value={party} onChange={(event) => setParty(event.target.value)}><option value="">{t('Chọn khách hàng')}</option>{[...parties.values()].map((item) => <option key={item.id} value={item.id}>{recordLabel('master-data.party', item)}</option>)}</select></label>
      <label className="field"><span>{t('Biển số')}</span><input className="input" required value={plate} onChange={(event) => setPlate(event.target.value)} /></label>
      <label className="field"><span>{t('Hãng xe')}</span><input className="input" value={make} onChange={(event) => setMake(event.target.value)} /></label>
      <label className="field"><span>{t('Dòng xe')}</span><input className="input" value={model} onChange={(event) => setModel(event.target.value)} /></label>
      <label className="field"><span>{t('VIN')}</span><input className="input" value={vin} onChange={(event) => setVin(event.target.value)} /></label>
      <label className="field"><span>{t('Số km hiện tại')}</span><input className="input" type="number" min="0" value={odometer} onChange={(event) => setOdometer(event.target.value)} /></label>
      <button className="btn btn-primary" disabled={busy === 'vehicle' || !party}>{busy === 'vehicle' ? t('Đang lưu…') : t('Lưu xe')}</button>
    </form></section>}
    {canCreateOrder && <section className="workshop-intake card"><h2>{t('Lập lệnh và báo giá')}</h2><form onSubmit={createOrder}>
      <div className="workshop-form">
        <label className="field"><span>{t('Xe')}</span><select className="select" required value={vehicleId} onChange={(event) => setVehicleId(event.target.value)}><option value="">{t('Chọn xe')}</option>{vehicles.map((item) => <option key={item.id} value={item.id}>{item.plate} · {[item.make, item.model].filter(Boolean).join(' ')}</option>)}</select></label>
        <label className="field"><span>{t('Số km lúc tiếp nhận *')}</span><input className="input num" type="number" min={vehicleId ? lastOdometerByVehicle.get(vehicleId) || 0 : 0} step="1" required value={intakeOdometer} onChange={(event) => setIntakeOdometer(event.target.value)} /><span className="hint">{t('Không thấp hơn lần ghi nhận gần nhất của xe.')}</span></label>
        <label className="field"><span>{t('Kho phụ tùng xuất')}</span><select className="select" value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)}><option value="">{t('Chọn khi có phụ tùng theo dõi tồn')}</option>{[...warehouses.values()].map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="field workshop-complaint"><span>{t('Khách mô tả / yêu cầu')}</span><textarea className="input textarea" value={complaint} onChange={(event) => setComplaint(event.target.value)} /></label>
      </div>
      <div className="workshop-lines"><div className="workshop-section-head"><h3>{t('Phụ tùng và công việc')}</h3><button type="button" className="btn" onClick={addLine} disabled={!productChoices.length}>{t('Thêm dòng')}</button></div>
        {draftLines.map((line, index) => { const product = products.get(line.product); return <div className="workshop-line" key={line.rowId}>
          <select className="select" required value={line.product} onChange={(event) => updateLine(index, 'product', event.target.value)}><option value="">{t('Chọn phụ tùng / dịch vụ')}</option>{productChoices.map((item) => <option key={item.id} value={item.id}>{item.name} · {fmtMoney(item.price || 0)}</option>)}</select>{unitsFor(line.product).length > 0 && <select className="select" aria-label={t('Unit')} value={line.uom || products.get(line.product)?.uom || ''} onChange={(event) => updateLine(index, 'uom', event.target.value)}>{unitsFor(line.product).map((unit) => <option key={unit.id} value={unit.id}>{unit.name}{unit.base_uom ? ` (${unit.ratio} × ${t('base')})` : ` (${t('base')})`}</option>)}</select>}
          <input className="input" type="number" min="0.001" step="any" required aria-label={t('Số lượng')} value={line.qty} onChange={(event) => updateLine(index, 'qty', event.target.value)} />
          <strong className="num">{fmtMoney(repairQuoteLineTotal(product?.price, unitRatio(line), line.qty))}</strong>
          <button type="button" className="btn btn-danger" aria-label={t('Xóa dòng')} onClick={() => setDraftLines((current) => current.filter((_, i) => i !== index))}>×</button>
        </div>; })}
      </div>
      {needsWarehouse && !warehouseId && <p className="small muted">{t('Lệnh có phụ tùng theo dõi tồn kho cần chọn kho trước khi lập.')}</p>}
      <button className="btn btn-primary" disabled={busy === 'order' || !vehicleId || intakeOdometer === '' || !draftLines.length || (needsWarehouse && !warehouseId)}>{busy === 'order' ? t('Đang lập…') : t('Lập báo giá chờ khách duyệt')}</button>
    </form></section>}
    <div className="workshop-layout">
      <section className="workshop-order-list"><header><h2>{t('Lệnh sửa chữa')}</h2><span className="badge warning">{openOrders.length} {t('đang xử lý')}</span></header>
        {loading ? <div className="card-pad"><div className="skeleton" data-h="row" /></div> : orders.length ? <div className="workshop-orders">{orders.map((order) => { const vehicle = vehicleById.get(order.vehicle); return <button key={order.id} className={`card workshop-order${selectedId === order.id ? ' selected' : ''}`} onClick={() => setSelectedId(order.id)}>
          <span className="workshop-order-title"><strong>{vehicle?.plate || t('Xe')} · {vehicle ? [vehicle.make, vehicle.model].filter(Boolean).join(' ') : ''}</strong><span className={`badge ${['completed', 'delivered'].includes(order.status) ? 'success' : order.status === 'quote_declined' ? 'plain' : 'warning'}`}>{statusLabel(order.status)}</span></span>
          <span>{recordLabel('master-data.party', parties.get(order.party))}</span><span className="small muted">{fmtDateTime(order.created_at)}</span><strong className="num">{fmtMoney(order.total || 0)}</strong>
        </button>; })}</div> : <div className="card-pad muted">{t('Chưa có lệnh sửa chữa.')}</div>}
      </section>
      <section className="workshop-detail card">{selected ? <>
        <RepairOrderVehicleSummary
          selected={selected}
          vehicle={orderVehicle}
          partyName={recordLabel('master-data.party', parties.get(selected.party))}
          warehouseName={warehouses.get(selected.warehouse)?.name}
          latestOdometer={orderVehicle && lastOdometerByVehicle.has(orderVehicle.id) ? lastOdometerByVehicle.get(orderVehicle.id) : null}
          currentOdometer={currentOdometer}
          odometerReading={odometerReading}
          canUpdateOdometer={can('auto-service.vehicle.update')}
          odometerBusy={busy === 'odometer'}
          onOdometerChange={setOdometerReading}
          onOdometerSubmit={updateOdometer}
          t={t}
        />
        <RepairOrderWorkflowPanel
          order={selected}
          quoteDraft={quoteDraft}
          products={products}
          productChoices={productChoices}
          warehouses={warehouses}
          unitsFor={unitsFor}
          unitRatio={unitRatio}
          fmtMoney={fmtMoney}
          fmtDateTime={fmtDateTime}
          fmtNumber={fmtNumber}
          statusLabel={statusLabel}
          estimateLines={selectedEstimateLines}
          totalLabel={fmtMoney(selected.total || 0)}
          invoiceHref={selectedInvoice ? recordHref('accounting.invoice', selectedInvoice.id) : ''}
          invoiceCode={selectedInvoice ? String(selectedInvoice.id).slice(0, 8) : ''}
          vehicleOrders={vehicleOrders}
          declineReason={declineReasons[selected.id] || ''}
          canSubmitDecline={(declineReasons[selected.id] || '').trim().length >= 5}
          actions={selectedActions}
          busy={busy}
          t={t}
          onStartQuoteEdit={() => startQuoteEdit(selected)}
          onDraftChange={updateQuoteDraft}
          onLineChange={updateQuoteLine}
          onAddLine={addQuoteLine}
          onRemoveLine={removeQuoteLine}
          onSaveQuoteEdit={saveQuoteEdit}
          onCancelQuoteEdit={() => setQuoteDraft(null)}
          onTransition={(action) => transition(selected, action)}
          onDeclineReasonChange={(value) => setDeclineReasons((current) => ({ ...current, [selected.id]: value }))}
        />
      </> : <div className="card-pad muted">{t('Chọn lệnh để xem báo giá và tiến độ.')}</div>}</section>
    </div>
  </div>;
}
