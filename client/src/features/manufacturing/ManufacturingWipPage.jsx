import React, { useState } from 'react';
import { useDocumentTitle } from '../../lib/useDocumentTitle.js';
import { localDate } from '../../lib/dates.js';
import { fmtMoney, statusLabel, fmtNumber, uiTextWith } from '../../lib/i18n.js';
import { can } from '../../lib/state.js';
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
import { useManufacturingWipData } from './hooks/useManufacturingWipData.js';
import { useManufacturingWipWorkflow } from './hooks/useManufacturingWipWorkflow.js';
const t = (text) => uiTextWith(text, manufacturingEnglish);
const today = localDate;
const qty = (value) => fmtNumber(String(value || 0), { maximumFractionDigits: 3 });
export default function ManufacturingWipPage() {
  useDocumentTitle(t("WIP sản xuất · OSP Suite"));
  const [asOf, setAsOf] = useState(today());
  const { report, accounts, boms, productionOrders, reworkOrders, productionDispositions,
    conditionalAcceptances, inspections, workCenters, products, warehouses, units,
    loading, loadError, load } = useManufacturingWipData(asOf);
  const {
    busy, error, setError, notice,
    offsetAccountId, setOffsetAccountId, memo, setMemo, adjustment, creatingAdjustment,
    createWipReconciliationDraft,
    editingBom, bomProduct, bomOutputQty, components, resetBom, editBom, saveBom,
    setBomProduct, setBomOutputQty, onComponentChange, onAddComponent, onRemoveComponent,
    selectedBom, orderValues, setOrderField, createProductionOrder, outputs, setOutputs, operateOrder,
    qcNotes, setQcNotes, decideInspection, remainingFailedQty, remainingFailedProductionInspections,
    reworkInspection, reworkQty, reworkReason, setReworkQty, setReworkReason, createReworkOrder, operateRework,
    dispositionInspection, dispositionQty, dispositionNote, dispositionAccount, setDispositionQty,
    setDispositionNote, setDispositionAccount, createProductionDisposition, operateProductionDisposition,
    acceptanceInspection, acceptanceQty, acceptanceCondition, acceptanceJustification,
    setAcceptanceQty, setAcceptanceCondition, setAcceptanceJustification, submitConditionalAcceptance,
    operateConditionalAcceptance, onReworkInspectionChange, onDispositionInspectionChange, onAcceptanceInspectionChange,
  } = useManufacturingWipWorkflow({
    boms, reworkOrders, productionDispositions, conditionalAcceptances, inspections, products, load,
    canPostDisposition: can('manufacturing.production_disposition.posted'), t,
  });
  const unitsFor = (productId) => {
    const baseUnit = products.get(productId)?.uom;
    return baseUnit ? [...units.values()].filter((unit) => unit.id === baseUnit || unit.base_uom === baseUnit) : [];
  };
  const baseUnitName = (productId) => {
    const baseUnit = products.get(productId)?.uom;
    return units.get(baseUnit)?.name || t(baseUnit ? 'đơn vị gốc' : 'chưa đặt đơn vị');
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
        onComponentChange={onComponentChange}
        onAddComponent={onAddComponent}
        onRemoveComponent={onRemoveComponent}
        onReset={resetBom}
        onEdit={editBom}
        t={t}
      />}
      {can('manufacturing.production_order.create') && <ProductionOrderForm
        boms={boms}
        products={products}
        warehouses={warehouses}
        workCenters={workCenters}
        units={units}
        accounts={accounts}
        values={orderValues}
        lotTracked={Boolean(products.get(selectedBom?.product)?.lot_tracked)}
        busy={busy}
        t={t}
        onChange={setOrderField}
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
        statusLabel={statusLabel} onInspectionChange={onReworkInspectionChange} onQuantityChange={setReworkQty} onReasonChange={setReworkReason}
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
      onInspectionChange={onAcceptanceInspectionChange}
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
      onInspectionChange={onDispositionInspectionChange}
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
      creating={creatingAdjustment}
      canCreateAdjustment={can('accounting.journal_entry.create')}
      canReadAccounts={can('accounting.account.read')}
      formatNumber={fmtNumber}
      formatQuantity={qty}
      formatMoney={fmtMoney}
      statusLabel={statusLabel}
      orderHref={(id) => recordHref('manufacturing.production_order', id)}
      onOffsetAccountChange={setOffsetAccountId}
      onMemoChange={setMemo}
      onCreateDraft={() => createWipReconciliationDraft(asOf)}
      t={t}
    />
  </div>;
}
