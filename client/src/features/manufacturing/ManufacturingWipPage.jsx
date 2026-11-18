import React, { useState } from 'react';
import { useDocumentTitle } from '../../lib/useDocumentTitle.js';
import { localDate } from '../../lib/dates.js';
import { api, dataPath, tenantPath } from '../../lib/api.js';
import { fmtMoney, statusLabel, fmtNumber, uiTextWith } from '../../lib/i18n.js';
import { can } from '../../lib/state.js';
import { compareDecimals } from '../../lib/decimal.js';
import { recordHref } from '../../lib/routes.js';
import manufacturingEnglish from './manufacturing.en.js';
import ProductionOrdersList from './components/ProductionOrdersList.jsx';
import ProductionOrderForm from './components/ProductionOrderForm.jsx';
import ProductionInspectionQueue from './components/ProductionInspectionQueue.jsx';
import ManufacturingWipReportSection from './components/ManufacturingWipReportSection.jsx';
import ConditionalAcceptancePanel from './components/ConditionalAcceptancePanel.jsx';
import ProductionDispositionPanel from './components/ProductionDispositionPanel.jsx';
import ReworkOrdersPanel from './components/ReworkOrdersPanel.jsx';
import BillOfMaterialsSection from './components/BillOfMaterialsSection.jsx';
import { isWithinFailedQty, productionOutputMatchesPlan, productionOutputQuantities, remainingFailedQty as getRemainingFailedQty } from './domain/inspectionQuantities.js';
import { useManufacturingWipData } from './hooks/useManufacturingWipData.js';
const t = (text) => uiTextWith(text, manufacturingEnglish);
const today = localDate;
const qty = (value) => fmtNumber(String(value || 0), { maximumFractionDigits: 3 });
export default function ManufacturingWipPage() {
  useDocumentTitle(t("WIP sản xuất · OSP Suite"));
  const [asOf, setAsOf] = useState(today());
  const { report, accounts, boms, productionOrders, reworkOrders, productionDispositions,
    conditionalAcceptances, inspections, workCenters, products, warehouses, units,
    loading, loadError, load } = useManufacturingWipData(asOf);
  const [offsetAccountId, setOffsetAccountId] = useState('');
  const [memo, setMemo] = useState(t("Điều chỉnh đối chiếu WIP"));
  const [adjustment, setAdjustment] = useState(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editingBom, setEditingBom] = useState('');
  const [bomProduct, setBomProduct] = useState('');
  const [bomOutputQty, setBomOutputQty] = useState('1');
  const [components, setComponents] = useState(() => [{ rowId: crypto.randomUUID(), product: '', qty: '1', uom: '' }]);
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
  const unitsFor = (productId) => {
    const baseUnit = products.get(productId)?.uom;
    return baseUnit ? [...units.values()].filter((unit) => unit.id === baseUnit || unit.base_uom === baseUnit) : [];
  };
  const baseUnitName = (productId) => {
    const baseUnit = products.get(productId)?.uom;
    return units.get(baseUnit)?.name || t(baseUnit ? 'đơn vị gốc' : 'chưa đặt đơn vị');
  };
  const remainingFailedQty = (inspection) => getRemainingFailedQty(inspection, reworkOrders, productionDispositions, conditionalAcceptances);
  const remainingFailedProductionInspections = inspections.filter((inspection) =>
    ['production_order', 'production_rework'].includes(inspection.source)
    && inspection.status === 'failed'
    && compareDecimals(remainingFailedQty(inspection), '0.000001') > 0
  );
  const resetBom = () => { setEditingBom(''); setBomProduct(''); setBomOutputQty('1'); setComponents([{ rowId: crypto.randomUUID(), product: '', qty: '1', uom: '' }]); };
  const editBom = (bom) => {
    setEditingBom(bom.id); setBomProduct(bom.product); setBomOutputQty(String(bom.output_qty || 1));
    setComponents(Array.isArray(bom.components) && bom.components.length ? bom.components.map((row) => ({ rowId: crypto.randomUUID(), product: row.product || '', qty: String(row.qty || ''), uom: row.uom || '' })) : [{ rowId: crypto.randomUUID(), product: '', qty: '1', uom: '' }]);
  };
  const saveBom = async (event) => {
    event.preventDefault(); setBusy('bom'); setError('');
    try {
      const body = { product: bomProduct, output_qty: String(bomOutputQty), components: components.map((row) => ({ product: row.product, qty: String(row.qty), ...(row.uom ? { uom: row.uom } : {}) })) };
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
        product: selectedBom.product, bom: selectedBom.id, qty: String(orderQty), warehouse: orderWarehouse,
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
        const { goodQty, scrapQty } = productionOutputQuantities(order.qty, draft.good_qty ?? order.qty, draft.scrap_qty);
        if (compareDecimals(goodQty, '0') < 0 || compareDecimals(scrapQty, '0') < 0) {
          throw new Error('Số lượng đạt và phế phẩm không được âm.');
        }
        if (!productionOutputMatchesPlan(order.qty, goodQty, scrapQty)) {
          throw new Error('Tổng số lượng đạt và phế phẩm phải bằng số lượng kế hoạch (sai số tối đa 0,0001).');
        }
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
      if (!isWithinFailedQty(reworkQty, remainingFailedQty(inspection))) throw new Error('Số lượng sửa vượt lượng QC lỗi còn lại.');
      await api(dataPath('manufacturing.rework_order'), { method: 'POST', body: {
        production_order: inspection.source_id, inspection: inspection.id,
        qty: String(reworkQty), reason: reworkReason.trim(),
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
      const inspection = inspections.find((row) => row.id === dispositionInspection);
      if (!isWithinFailedQty(dispositionQty, remainingFailedQty(inspection))) throw new Error('Số lượng loại bỏ vượt lượng QC lỗi còn lại.');
      const created = await api(dataPath('manufacturing.production_disposition'), { method: 'POST', body: {
        inspection: dispositionInspection, qty: String(dispositionQty), note: dispositionNote.trim(), expense_account: dispositionAccount,
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
      if (!isWithinFailedQty(acceptanceQty, remainingFailedQty(inspection))) throw new Error('Số lượng đề nghị vượt lượng QC lỗi còn lại.');
      const created = await api(dataPath('manufacturing.conditional_acceptance'), { method: 'POST', body: {
        inspection: inspection.id,
        qty: String(acceptanceQty),
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
    {(error || loadError) && <div className="alert danger" role="alert">{t(error || loadError)}</div>}
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
        onAddComponent={() => setComponents((rows) => [...rows, { rowId: crypto.randomUUID(), product: '', qty: '1', uom: '' }])}
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
      <ProductionOrdersList
        orders={productionOrders}
        products={products}
        workCenters={workCenters}
        outputDrafts={outputs}
        busy={busy}
        formatQuantity={qty}
        onOutputChange={(id, field, value) => setOutputs((rows) => ({ ...rows, [id]: { ...rows[id], [field]: value } }))}
        onAction={operateOrder}
        t={t}
      />
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
          setReworkInspection(id);
          setReworkQty(inspection ? String(remainingFailedQty(inspection)) : '');
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
    <ManufacturingWipReportSection
      report={report}
      accounts={accounts}
      offsetAccountId={offsetAccountId}
      memo={memo}
      adjustment={adjustment}
      creating={creating}
      canCreateAdjustment={can('accounting.journal_entry.create')}
      canReadAccounts={can('accounting.account.read')}
      formatNumber={fmtNumber}
      formatQuantity={qty}
      formatMoney={fmtMoney}
      statusLabel={statusLabel}
      orderHref={(id) => recordHref('manufacturing.production_order', id)}
      onOffsetAccountChange={setOffsetAccountId}
      onMemoChange={setMemo}
      onCreateDraft={createDraft}
      t={t}
    />
  </div>;
}
