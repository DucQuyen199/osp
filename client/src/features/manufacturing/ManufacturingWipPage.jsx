import React, { useCallback, useEffect, useState } from 'react';
import { useDocumentTitle } from '../../lib/useDocumentTitle.js';
import { localDate } from '../../lib/dates.js';
import { api, dataPath, tenantPath } from '../../lib/api.js';
import { fmtMoney, statusLabel, fmtNumber, uiTextWith } from '../../lib/i18n.js';
import { can, loadRefs, loadAllResponse } from '../../lib/state.js';
import manufacturingEnglish from './manufacturing.en.js';
import ProductionOrderCard from './components/ProductionOrderCard.jsx';
import ProductionOrderForm from './components/ProductionOrderForm.jsx';
import ProductionInspectionQueue from './components/ProductionInspectionQueue.jsx';
import ManufacturingWipReport from './components/ManufacturingWipReport.jsx';
import ConditionalAcceptancePanel from './components/ConditionalAcceptancePanel.jsx';
import ProductionDispositionPanel from './components/ProductionDispositionPanel.jsx';
import ReworkOrdersPanel from './components/ReworkOrdersPanel.jsx';
import BillOfMaterialsSection from './components/BillOfMaterialsSection.jsx';
const t = (text) => uiTextWith(text, manufacturingEnglish);
const today = localDate;
const qty = (value) => fmtNumber(Number(value || 0), { maximumFractionDigits: 3 });
export default function ManufacturingWipPage() {
  useDocumentTitle(t("WIP sản xuất · OSP Suite"));
  const [asOf, setAsOf] = useState(today());
  const [report, setReport] = useState(null);
  const [accounts, setAccounts] = useState(new Map());
  const [offsetAccountId, setOffsetAccountId] = useState('');
  const [memo, setMemo] = useState(t("Điều chỉnh đối chiếu WIP"));
  const [adjustment, setAdjustment] = useState(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [boms, setBoms] = useState([]);
  const [productionOrders, setProductionOrders] = useState([]);
  const [reworkOrders, setReworkOrders] = useState([]);
  const [productionDispositions, setProductionDispositions] = useState([]);
  const [conditionalAcceptances, setConditionalAcceptances] = useState([]);
  const [inspections, setInspections] = useState([]);
  const [workCenters, setWorkCenters] = useState(new Map());
  const [products, setProducts] = useState(new Map());
  const [warehouses, setWarehouses] = useState(new Map());
  const [units, setUnits] = useState(new Map());
  const [editingBom, setEditingBom] = useState('');
  const [bomProduct, setBomProduct] = useState('');
  const [bomOutputQty, setBomOutputQty] = useState('1');
  const [components, setComponents] = useState([{ product: '', qty: '1', uom: '' }]);
  const [orderBom, setOrderBom] = useState('');
  const [orderQty, setOrderQty] = useState('1');
  const [orderWarehouse, setOrderWarehouse] = useState('');
  const [orderCenter, setOrderCenter] = useState('');
  const [orderDate, setOrderDate] = useState(today());
  const [reworkInspection, setReworkInspection] = useState('');
  const [reworkQty, setReworkQty] = useState('');
  const [reworkReason, setReworkReason] = useState('');
  const [dispositionInspection, setDispositionInspection] = useState('');
  const [dispositionQty, setDispositionQty] = useState('');
  const [dispositionNote, setDispositionNote] = useState('');
  const [dispositionAccount, setDispositionAccount] = useState('');
  const [acceptanceInspection, setAcceptanceInspection] = useState('');
  const [acceptanceQty, setAcceptanceQty] = useState('');
  const [acceptanceCondition, setAcceptanceCondition] = useState('');
  const [acceptanceJustification, setAcceptanceJustification] = useState('');
  const [outputLot, setOutputLot] = useState('');
  const [outputExpiry, setOutputExpiry] = useState('');
  const [scrapMethod, setScrapMethod] = useState('absorb');
  const [scrapAccount, setScrapAccount] = useState('');
  const [outputs, setOutputs] = useState({});
  const [busy, setBusy] = useState('');
  const [qcNotes, setQcNotes] = useState({});
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (asOf) params.set('asOf', asOf);
      const [reportData, bomResponse, orderResponse, reworkResponse, inspectionResponse, dispositionResponse, acceptanceResponse, centerMap, productMap, warehouseMap, unitMap, accountMap] = await Promise.all([
        api(`${tenantPath('/reports/manufacturing/wip')}?${params}`),
        can('manufacturing.bom.read') ? loadAllResponse('manufacturing.bom') : Promise.resolve({ items: [] }),
        can('manufacturing.production_order.read') ? loadAllResponse('manufacturing.production_order') : Promise.resolve({ items: [] }),
        can('manufacturing.rework_order.read') ? loadAllResponse('manufacturing.rework_order') : Promise.resolve({ items: [] }),
        can('quality.inspection.read') ? loadAllResponse('quality.inspection') : Promise.resolve({ items: [] }),
        can('manufacturing.production_disposition.read') ? loadAllResponse('manufacturing.production_disposition') : Promise.resolve({ items: [] }),
        can('manufacturing.conditional_acceptance.read') ? loadAllResponse('manufacturing.conditional_acceptance') : Promise.resolve({ items: [] }),
        can('manufacturing.work_center.read') ? loadRefs('manufacturing.work_center') : Promise.resolve(new Map()),
        can('master-data.product.read') ? loadRefs('master-data.product') : Promise.resolve(new Map()),
        can('inventory.warehouse.read') ? loadRefs('inventory.warehouse') : Promise.resolve(new Map()),
        can('master-data.uom.read') ? loadRefs('master-data.uom') : Promise.resolve(new Map()),
        can('accounting.account.read') ? loadRefs('accounting.account') : Promise.resolve(new Map()),
      ]);
      setReport(reportData);
      setBoms(Array.isArray(bomResponse.items) ? bomResponse.items : []);
      setProductionOrders(Array.isArray(orderResponse.items) ? orderResponse.items : []);
      setReworkOrders(Array.isArray(reworkResponse.items) ? reworkResponse.items : []);
      setProductionDispositions(Array.isArray(dispositionResponse.items) ? dispositionResponse.items : []);
      setConditionalAcceptances(Array.isArray(acceptanceResponse.items) ? acceptanceResponse.items : []);
      setInspections(Array.isArray(inspectionResponse.items) ? inspectionResponse.items : []);
      setWorkCenters(centerMap); setProducts(productMap); setWarehouses(warehouseMap); setUnits(unitMap); setAccounts(accountMap);
    } catch (reason) {
      setReport(null);
      setError(reason.message || t("Không tải được báo cáo WIP."));
    } finally {
      setLoading(false);
    }
  }, [asOf]);
  const unitsFor = (productId) => {
    const baseUnit = products.get(productId)?.uom;
    return baseUnit ? [...units.values()].filter((unit) => unit.id === baseUnit || unit.base_uom === baseUnit) : [];
  };
  const baseUnitName = (productId) => {
    const baseUnit = products.get(productId)?.uom;
    return units.get(baseUnit)?.name || t(baseUnit ? 'đơn vị gốc' : 'chưa đặt đơn vị');
  };
  const alreadyAccountedReworkQty = (inspectionId) => (
    reworkOrders.filter((order) => order.inspection === inspectionId && order.status !== 'cancelled').reduce((total, order) => total + Number(order.qty || 0), 0)
    + productionDispositions.filter((row) => row.inspection === inspectionId && ['draft', 'posted'].includes(row.status)).reduce((total, row) => total + Number(row.qty || 0), 0)
    + conditionalAcceptances.filter((row) => row.inspection === inspectionId && ['draft', 'submitted', 'approved'].includes(row.status)).reduce((total, row) => total + Number(row.qty || 0), 0)
  );
  const remainingFailedQty = (inspection) => Math.max(0, Number(inspection?.qty || 0) - alreadyAccountedReworkQty(inspection?.id));
  const remainingFailedProductionInspections = inspections.filter((inspection) =>
    ['production_order', 'production_rework'].includes(inspection.source)
    && inspection.status === 'failed'
    && remainingFailedQty(inspection) > 0.000001
  );
  const resetBom = () => { setEditingBom(''); setBomProduct(''); setBomOutputQty('1'); setComponents([{ product: '', qty: '1', uom: '' }]); };
  const editBom = (bom) => {
    setEditingBom(bom.id); setBomProduct(bom.product); setBomOutputQty(String(bom.output_qty || 1));
    setComponents(Array.isArray(bom.components) && bom.components.length ? bom.components.map((row) => ({ product: row.product || '', qty: String(row.qty || ''), uom: row.uom || '' })) : [{ product: '', qty: '1', uom: '' }]);
  };
  const saveBom = async (event) => {
    event.preventDefault(); setBusy('bom'); setError('');
    try {
      const body = { product: bomProduct, output_qty: Number(bomOutputQty), components: components.map((row) => ({ product: row.product, qty: Number(row.qty), ...(row.uom ? { uom: row.uom } : {}) })) };
      await api(editingBom ? dataPath('manufacturing.bom', editingBom) : dataPath('manufacturing.bom'), { method: editingBom ? 'PATCH' : 'POST', body });
      resetBom(); await load();
    } catch (reason) { setError(reason.message || t("Không lưu được BOM.")); }
    finally { setBusy(''); }
  };
  const selectedBom = boms.find((bom) => bom.id === orderBom);
  const createProductionOrder = async (event) => {
    event.preventDefault(); if (!selectedBom) return;
    setBusy('order'); setError('');
    try {
      await api(dataPath('manufacturing.production_order'), { method: 'POST', body: {
        product: selectedBom.product, bom: selectedBom.id, qty: Number(orderQty), warehouse: orderWarehouse,
        ...(orderCenter ? { work_center: orderCenter, planned_start: orderDate } : {}),
        ...(outputLot ? { output_lot_code: outputLot } : {}), ...(outputExpiry ? { output_expiry: outputExpiry } : {}),
        scrap_cost_method: scrapMethod, ...(scrapMethod === 'expense' && scrapAccount ? { scrap_expense_account: scrapAccount } : {}),
      } });
      setOrderQty('1'); setOutputLot(''); setOutputExpiry(''); await load();
    } catch (reason) { setError(reason.message || t("Không tạo được lệnh sản xuất.")); }
    finally { setBusy(''); }
  };
  const operateOrder = async (order, action) => {
    setBusy(`${order.id}:${action}`); setError('');
    try {
      if (action === 'done') {
        const draft = outputs[order.id] || {};
        const goodQty = Number(draft.good_qty ?? order.qty);
        const scrapInput = draft.scrap_qty;
        const scrapQty = scrapInput != null && String(scrapInput).trim() !== '' ? Number(scrapInput) : Math.max(0, Number(order.qty) - goodQty);
        await api(dataPath('manufacturing.production_order', order.id), { method: 'PATCH', body: {
          good_qty: goodQty, scrap_qty: scrapQty, ...(draft.scrap_reason ? { scrap_reason: draft.scrap_reason } : {}),
        } });
      }
      await api(dataPath('manufacturing.production_order', order.id, action), { method: 'POST' });
      await load();
    } catch (reason) { setError(reason.message || t('Không thể thực hiện thao tác cho lệnh.')); }
    finally { setBusy(''); }
  };
  const decideInspection = async (inspection, action) => {
    setBusy(`${inspection.id}:${action}`); setError('');
    try {
      if (action === 'failed') {
        const note = qcNotes[inspection.id]?.trim() || '';
        if (note.length < 5) throw new Error('Nhập mô tả lỗi QC từ 5 ký tự trở lên.');
        await api(dataPath('quality.inspection', inspection.id), { method: 'PATCH', body: { note } });
      }
      await api(dataPath('quality.inspection', inspection.id, action), { method: 'POST' });
      await load();
    } catch (reason) { setError(reason.message || t("Không lưu được kết quả QC.")); }
    finally { setBusy(''); }
  };
  const createReworkOrder = async (event) => {
    event.preventDefault();
    const inspection = inspections.find((row) => row.id === reworkInspection);
    if (!inspection) return;
    setBusy('rework'); setError('');
    try {
      await api(dataPath('manufacturing.rework_order'), { method: 'POST', body: {
        production_order: inspection.source_id, inspection: inspection.id,
        qty: Number(reworkQty), reason: reworkReason.trim(),
      } });
      setReworkInspection(''); setReworkQty(''); setReworkReason(''); await load();
    } catch (reason) { setError(reason.message || t("Không tạo được lệnh sửa.")); }
    finally { setBusy(''); }
  };
  const operateRework = async (order, action) => {
    setBusy(`${order.id}:${action}`); setError('');
    try {
      await api(dataPath('manufacturing.rework_order', order.id, action), { method: 'POST' });
      await load();
    } catch (reason) { setError(reason.message || t("Không cập nhật được lệnh sửa.")); }
    finally { setBusy(''); }
  };
  const createProductionDisposition = async (event) => {
    event.preventDefault();
    if (!dispositionInspection) return;
    setBusy('production-disposition'); setError('');
    try {
      const created = await api(dataPath('manufacturing.production_disposition'), { method: 'POST', body: {
        inspection: dispositionInspection, qty: Number(dispositionQty), note: dispositionNote.trim(), expense_account: dispositionAccount,
      } });
      if (can('manufacturing.production_disposition.posted')) {
        await api(dataPath('manufacturing.production_disposition', created.id, 'posted'), { method: 'POST' });
        setNotice(t("Đã ghi sổ loại bỏ thành phẩm và hạch toán chi phí từ WIP."));
      } else {
        setNotice(t("Đã tạo phiếu loại bỏ; phiếu đang chờ người có quyền ghi sổ."));
      }
      setDispositionInspection(''); setDispositionQty(''); setDispositionNote(''); setDispositionAccount(''); await load();
    } catch (reason) { await load(); setError(reason.message || t("Không ghi nhận được lượng thành phẩm loại bỏ.")); }
    finally { setBusy(''); }
  };
  const submitConditionalAcceptance = async (event) => {
    event.preventDefault();
    const inspection = inspections.find((row) => row.id === acceptanceInspection);
    if (!inspection) return;
    setBusy('conditional-acceptance'); setError(''); setNotice('');
    try {
      const created = await api(dataPath('manufacturing.conditional_acceptance'), { method: 'POST', body: {
        inspection: inspection.id,
        qty: Number(acceptanceQty),
        condition: acceptanceCondition.trim(),
        justification: acceptanceJustification.trim(),
      } });
      await api(dataPath('manufacturing.conditional_acceptance', created.id, 'submitted'), { method: 'POST' });
      setAcceptanceInspection(''); setAcceptanceQty(''); setAcceptanceCondition(''); setAcceptanceJustification('');
      setNotice(t("Đã gửi đề nghị chấp nhận có điều kiện. Hàng vẫn bị giữ cho đến khi người có thẩm quyền phê duyệt."));
      await load();
    } catch (reason) { await load(); setError(reason.message || t("Không gửi được đề nghị chấp nhận có điều kiện.")); }
    finally { setBusy(''); }
  };
  const operateConditionalAcceptance = async (row, action) => {
    setBusy(`${row.id}:${action}`); setError(''); setNotice('');
    try {
      await api(dataPath('manufacturing.conditional_acceptance', row.id, action), { method: 'POST' });
      setNotice(action === 'submitted' ? t("Đã gửi lại đề nghị vào hàng chờ phê duyệt.") : t("Đã hủy đề nghị chấp nhận có điều kiện."));
      await load();
    } catch (reason) { setError(reason.message || t("Không cập nhật được đề nghị chấp nhận có điều kiện.")); }
    finally { setBusy(''); }
  };
  const operateProductionDisposition = async (row, action) => {
    setBusy(`${row.id}:${action}`); setError('');
    try {
      await api(dataPath('manufacturing.production_disposition', row.id, action), { method: 'POST' });
      await load();
    } catch (reason) { setError(reason.message || t("Không cập nhật được phiếu xử lý thành phẩm.")); }
    finally { setBusy(''); }
  };
  useEffect(() => { load(); }, [load]);
  const createDraft = async () => {
    setCreating(true);
    setError('');
    setAdjustment(null);
    try {
      const result = await api(tenantPath('/reports/manufacturing/wip/reconciliation-journals'), {
        method: 'POST', body: { asOf, offsetAccountId, memo },
      });
      const journal = result.journal || null;
      const id = journal?.id || result.journalId;
      setAdjustment({ id, status: journal?.status || result.status || 'draft', existing: result.existing });
      await load();
    } catch (reason) {
      setError(reason.message || t("Không tạo được bút toán nháp đối chiếu WIP."));
    } finally {
      setCreating(false);
    }
  };
  return <div className="page">
    <div className="page-head"><div><h1>{t("WIP sản xuất")}</h1><p className="sub">{t("Đối chiếu giá trị vật tư theo lệnh sản xuất với số dư tài khoản 154 trên sổ cái.")}</p></div></div>
    {error && <div className="alert danger" role="alert">{t(error)}</div>}
    {notice && <div className="alert success" role="status">{t(notice)}</div>}
    <section className="card card-pad manufacturing-workbench">
      <header className="card-head"><div><h2>{t("BOM và lệnh sản xuất")}</h2><p className="small muted">{t("Lập định mức, giữ lịch sử BOM đã dùng, xuất vật tư khi bắt đầu và chuyển thành phẩm sang QC khi hoàn tất.")}</p></div></header>
      {can('manufacturing.bom.read') && <BillOfMaterialsSection
        boms={boms}
        products={products}
        units={units}
        unitsFor={unitsFor}
        editingBom={editingBom}
        product={bomProduct}
        outputQty={bomOutputQty}
        components={components}
        busy={busy}
        canCreate={can('manufacturing.bom.create')}
        canUpdate={can('manufacturing.bom.update')}
        onSubmit={saveBom}
        onProductChange={setBomProduct}
        onOutputQtyChange={setBomOutputQty}
        onComponentChange={(index, field, value) => setComponents((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, [field]: value, ...(field === 'product' ? { uom: '' } : {}) } : row))}
        onAddComponent={() => setComponents((rows) => [...rows, { product: '', qty: '1', uom: '' }])}
        onRemoveComponent={(index) => setComponents((rows) => rows.filter((_, rowIndex) => rowIndex !== index))}
        onReset={resetBom}
        onEdit={editBom}
        t={t}
      />}
      {can('manufacturing.production_order.create') && <ProductionOrderForm
        boms={boms}
        products={products}
        warehouses={warehouses}
        workCenters={workCenters}
        accounts={accounts}
        values={{ bom: orderBom, qty: orderQty, warehouse: orderWarehouse, center: orderCenter, date: orderDate, outputLot, outputExpiry, scrapMethod, scrapAccount }}
        lotTracked={Boolean(products.get(selectedBom?.product)?.lot_tracked)}
        busy={busy}
        t={t}
        onChange={(field, value) => {
          const setters = { bom: setOrderBom, qty: setOrderQty, warehouse: setOrderWarehouse, center: setOrderCenter, date: setOrderDate, outputLot: setOutputLot, outputExpiry: setOutputExpiry, scrapMethod: setScrapMethod, scrapAccount: setScrapAccount };
          setters[field](value);
        }}
        onSubmit={createProductionOrder}
      />}
      <div className="manufacturing-orders"><h3>{t("L\u1ec7nh s\u1ea3n xu\u1ea5t")}</h3>{productionOrders.map((order) => <ProductionOrderCard key={order.id} order={order} productName={products.get(order.product)?.name} workCenterName={workCenters.get(order.work_center)?.name} draft={outputs[order.id] || {}} busy={busy} formatQty={qty} t={t} onOutputChange={(field, value) => setOutputs((rows) => ({ ...rows, [order.id]: { ...rows[order.id], [field]: value } }))} onAction={operateOrder} />)}{!productionOrders.length && <p className="small muted">{t("Ch\u01b0a c\u00f3 l\u1ec7nh s\u1ea3n xu\u1ea5t.")}</p>}</div>
      {can('quality.inspection.read') && <ProductionInspectionQueue inspections={inspections} products={products} qcNotes={qcNotes} busy={busy} canPass={can('quality.inspection.passed')} canRecordFailure={can('quality.inspection.failed') && can('quality.inspection.update')} formatQty={qty} baseUnitName={baseUnitName} t={t} onNoteChange={(id, value) => setQcNotes((rows) => ({ ...rows, [id]: value }))} onDecide={decideInspection} />}
    </section>
      {can('manufacturing.rework_order.read') && <ReworkOrdersPanel
        candidates={remainingFailedProductionInspections} inspections={inspections} orders={reworkOrders}
        inspectionId={reworkInspection} quantity={reworkQty} reason={reworkReason}
        busy={busy} canCreate={can('manufacturing.rework_order.create')}
        canStart={can('manufacturing.rework_order.started')} canComplete={can('manufacturing.rework_order.done')}
        canCancel={can('manufacturing.rework_order.cancelled')} remainingQuantity={remainingFailedQty}
        productName={(id) => products.get(id)?.name} baseUnitName={baseUnitName} formatQuantity={qty}
        statusLabel={statusLabel} onInspectionChange={(id) => {
          const inspection = inspections.find((row) => row.id === id);
          const alreadyAssigned = alreadyAccountedReworkQty(id);
          setReworkInspection(id);
          setReworkQty(inspection ? String(Math.max(0, Number(inspection.qty || 0) - alreadyAssigned)) : '');
        }} onQuantityChange={setReworkQty} onReasonChange={setReworkReason}
        onSubmit={createReworkOrder} onAction={operateRework} t={t}
      />}
    {can('manufacturing.conditional_acceptance.read') && <ConditionalAcceptancePanel
      inspections={inspections}
      candidates={remainingFailedProductionInspections}
      acceptances={conditionalAcceptances}
      products={products}
      busy={busy}
      inspectionId={acceptanceInspection}
      quantity={acceptanceQty}
      condition={acceptanceCondition}
      justification={acceptanceJustification}
      canCreate={can('manufacturing.conditional_acceptance.create') && can('manufacturing.conditional_acceptance.submitted')}
      canResubmit={can('manufacturing.conditional_acceptance.submitted')}
      canCancel={can('manufacturing.conditional_acceptance.cancelled')}
      remainingQuantity={remainingFailedQty}
      baseUnitName={baseUnitName}
      formatQuantity={qty}
      statusLabel={statusLabel}
      onSubmit={submitConditionalAcceptance}
      onInspectionChange={(id) => {
        const inspection = inspections.find((row) => row.id === id);
        setAcceptanceInspection(id);
        setAcceptanceQty(inspection ? String(remainingFailedQty(inspection)) : '');
      }}
      onQuantityChange={setAcceptanceQty}
      onConditionChange={setAcceptanceCondition}
      onJustificationChange={setAcceptanceJustification}
      onAction={operateConditionalAcceptance}
      t={t}
    />}
    {can('manufacturing.production_disposition.read') && <ProductionDispositionPanel
      inspections={inspections}
      candidates={remainingFailedProductionInspections}
      dispositions={productionDispositions}
      products={products}
      accounts={accounts}
      busy={busy}
      inspectionId={dispositionInspection}
      quantity={dispositionQty}
      accountId={dispositionAccount}
      note={dispositionNote}
      canCreate={can('manufacturing.production_disposition.create')}
      canPost={can('manufacturing.production_disposition.posted')}
      canCancel={can('manufacturing.production_disposition.cancelled')}
      remainingQuantity={remainingFailedQty}
      baseUnitName={baseUnitName}
      formatQuantity={qty}
      statusLabel={statusLabel}
      onSubmit={createProductionDisposition}
      onInspectionChange={(id) => {
        const inspection = inspections.find((row) => row.id === id);
        setDispositionInspection(id);
        setDispositionQty(inspection ? String(remainingFailedQty(inspection)) : '');
      }}
      onQuantityChange={setDispositionQty}
      onAccountChange={setDispositionAccount}
      onNoteChange={setDispositionNote}
      onAction={operateProductionDisposition}
      t={t}
    />}
    <section className="card">
      <form className="toolbar" onSubmit={(event) => { event.preventDefault(); load(); }}>
        <label className="field"><span className="label">{t("Chốt phát sinh đến ngày")}</span><input className="input" type="date" value={asOf} onChange={(event) => setAsOf(event.target.value)} /></label>
        <button className="btn btn-primary" type="submit" disabled={loading}>{loading ? t("Đang tải…") : t("Xem báo cáo")}</button>
      </form>
    </section>
    {report && <div className="stack">
      <div className="stats">
        <div className="card stat"><span className="stat-label">{t("Lệnh có số dư WIP")}</span><strong className="stat-value num">{fmtNumber(Number(report.orderCount || 0))}</strong></div>
        <div className="card stat"><span className="stat-label">{t("Tổng giá trị WIP")}</span><strong className="stat-value num">{fmtMoney(report.totalWipValue)}</strong></div>
        {report.ledgerComparisonAvailable && <div className="card stat"><span className="stat-label">{t("Số dư TK 154 trên sổ cái")}</span><strong className="stat-value num">{fmtMoney(report.ledgerWipBalance)}</strong></div>}
        {report.ledgerComparisonAvailable && <div className="card stat"><span className="stat-label">{t("Chênh lệch WIP - TK 154")}</span><strong className="stat-value num">{fmtMoney(report.wipVariance)}</strong><span className={`badge ${report.reconciled ? 'success' : 'danger'}`}>{report.reconciled ? t("Khớp") : t("Cần đối chiếu")}</span></div>}
      </div>
      {!report.ledgerComparisonAvailable && <div className="alert info" role="status">{t("Bật kế toán và quyền đọc sổ cái để đối chiếu chi tiết với tài khoản 154.")}</div>}
      {report.ledgerComparisonAvailable && !report.reconciled && can('accounting.journal_entry.create') && can('accounting.account.read') && <section className="card card-pad">
        <div className="card-head"><h2>{t("Tạo bút toán điều chỉnh nháp")}</h2><span className="faint">{t("Kế toán chọn tài khoản đối ứng và duyệt trước khi ghi sổ")}</span></div>
        <div className="toolbar">
          <label className="field"><span className="label">{t("Tài khoản đối ứng")}</span><select className="select" value={offsetAccountId} onChange={(event) => setOffsetAccountId(event.target.value)}>
            <option value="">{t("Chọn tài khoản")}</option>
            {[...accounts.values()].filter((account) => account.code !== '154').map((account) => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}
          </select></label>
          <label className="field"><span className="label">{t("Diễn giải")}</span><input className="input" maxLength={300} value={memo} onChange={(event) => setMemo(event.target.value)} /></label>
          <button className="btn btn-primary" type="button" disabled={creating || !offsetAccountId || !memo.trim()} onClick={createDraft}>{creating ? t("Đang tạo…") : t("Tạo bút toán nháp")}</button>
        </div>
      </section>}
      {adjustment && <div className="alert success" role="status">{adjustment.existing ? t("Đã có bút toán đối chiếu cho chênh lệch này.") : t('Đã tạo bút toán nháp.')} {adjustment.id && <a href={`#/e/accounting/journal_entry/${encodeURIComponent(adjustment.id)}`}>{t("Mở bút toán")}</a>} <span>{t('Trạng thái:')} {statusLabel(adjustment.status)}</span></div>}
      <ManufacturingWipReport report={report} qty={qty} fmtMoney={fmtMoney} statusLabel={statusLabel} t={t} />
    </div>}
  </div>;
}
