import React, { useEffect, useState } from 'react';
import { useDocumentTitle } from '../../lib/useDocumentTitle.js';
import { fmtMoney, fmtDateTime, statusLabel, uiTextWith } from '../../lib/i18n.js';
import { addDecimals } from '../../lib/decimal.js';
import { app, can, recordLabel } from '../../lib/state.js';
import PosReceipt from './components/PosReceipt.jsx';
import PosCheckoutPanel from './components/PosCheckoutPanel.jsx';
import PosProductCatalog from './components/PosProductCatalog.jsx';
import PosReturnDialog from './components/PosReturnDialog.jsx';
import PosSessionPanel from './components/PosSessionPanel.jsx';
import PosCashOperationsPanel from './components/PosCashOperationsPanel.jsx';
import PosRecentTransactions from './components/PosRecentTransactions.jsx';
import PosCartContents from './components/PosCartContents.jsx';
import retailEnglish from './retail.en.js';
import { usePosWorkbenchData } from './hooks/usePosWorkbenchData.js';
import { usePosTerminalWorkflow } from './hooks/usePosTerminalWorkflow.js';

const t = (text) => uiTextWith(text, retailEnglish);

export default function PosTerminalPage() {
  useDocumentTitle(`${t('Quầy bán hàng POS')} · OSP Suite`);
  const data = usePosWorkbenchData(t);
  const { warehouses, branches, products, units, parties, accounts, sessions, orders, returns, cashMovements, loading, error: dataError } = data;
  const [printingOrderId, setPrintingOrderId] = useState('');
  const {
    returningOrder, setReturningOrder, returnQuantities, setReturnQuantities, returnReason, setReturnReason, returnDraftId,
    prescriptionId, setPrescriptionId, sessionId, setSessionId, warehouseId, setWarehouseId, branchId, setBranchId,
    openingCash, setOpeningCash, closingCash, setClosingCash, partyId, setPartyId, voucherCode, setVoucherCode,
    method, setMethod, cashReceived, setCashReceived, pendingCashReceived, setPendingCashReceived,
    cashDirection, setCashDirection, cashAmount, setCashAmount, cashAccount, setCashAccount, cashReason, setCashReason,
    query, setQuery, quantities, setSelectedUnits, busy, error, notice, load,
    activeSession, activeWarehouse, pharmacyEnabled, loyaltyEnabled, sessionOrders, recentTransactions, cart,
    unitsFor, priceFor, rxRequired, subtotal, estimatedTax, total, estimatedLines, filteredProducts, partyOptions, eligiblePrescriptions,
    startSession, setQty, adjustQty, scanProduct, checkout, completeOrder, removeOrder, refundOrder,
    beginPartialReturn, submitPartialReturn, createCashMovement, postCashMovement, removeCashMovement, closeSession,
  } = usePosTerminalWorkflow({ data, t, setPrintingOrderId });

  useEffect(() => {
    if (!printingOrderId) return undefined;
    const finish = () => setPrintingOrderId('');
    window.addEventListener('afterprint', finish);
    const timer = window.setTimeout(() => window.print(), 80);
    return () => { window.clearTimeout(timer); window.removeEventListener('afterprint', finish); };
  }, [printingOrderId]);

  const printingReturn = returns.find((record) => record.id === printingOrderId && record.status === 'received');
  const returnSourceOrder = printingReturn ? orders.find((order) => order.id === printingReturn.pos_order) : null;
  const printingOrder = printingReturn
    ? { ...returnSourceOrder, id: printingReturn.id, created_at: printingReturn.created_at, status: 'partial_return', total: printingReturn.total, tax_total: printingReturn.tax_total, voucher_discount: addDecimals((printingReturn.lines || []).map((line) => line.voucher_discount_amount || 0)), lines: printingReturn.lines, refund_reason: printingReturn.reason, return_source_id: printingReturn.pos_order, method: 'refund', cash_received: undefined, change_due: undefined }
    : orders.find((order) => order.id === printingOrderId);
  return <div className="page pos-page">
    <div className="page-head"><div><h1>{t('Quầy bán hàng POS')}</h1><p className="sub">{t('Mở ca theo kho, ghi nhận hàng bán và phương thức thanh toán; giá và thuế cuối cùng do máy chủ tính theo danh mục.')}</p></div><button className="btn btn-secondary" type="button" disabled={loading || busy} onClick={() => load()}>{t('Làm mới')}</button></div>
    {(error || dataError) && <div className="alert danger" role="alert">{t(error || dataError)}</div>}{notice && <div className="alert success" role="status">{t(notice)}</div>}
    {loading ? <div className="card-pad"><div className="skeleton" data-h="row" /></div> : <>
      <PosSessionPanel
        sessions={sessions} sessionId={sessionId} activeSession={activeSession} activeWarehouse={activeWarehouse}
        branches={branches} warehouses={warehouses} warehouseId={warehouseId} branchId={branchId}
        openingCash={openingCash} busy={busy} canCreate={can('pos.pos_session.create')}
        onSessionChange={(id) => { setSessionId(id); setClosingCash(''); }} onWarehouseChange={setWarehouseId}
        onBranchChange={setBranchId} onOpeningCashChange={setOpeningCash} onSubmit={startSession}
        formatMoney={fmtMoney} recordLabel={recordLabel} t={t}
      />
      {!activeSession ? <div className="empty card-pad">{t('Chọn một ca đang mở hoặc mở ca mới để sử dụng quầy.')}</div> : !activeSession.warehouse ? <div className="alert warning">{t('Ca này được tạo trước khi bắt buộc chọn kho. Hãy chốt ca cũ và mở ca mới để tiếp tục bán.')}<form className="pos-close-form" onSubmit={closeSession}><label className="field"><span className="label">{t('Tiền mặt thực đếm để chốt ca')}</span><input className="input num" type="number" min="0" step="any" required value={closingCash} onChange={(event) => setClosingCash(event.target.value)} /></label><button className="btn btn-secondary" type="submit" disabled={busy || !can('pos.pos_session.update') || !can('pos.pos_session.closed')}>{t('Chốt ca cũ')}</button></form></div> : <div className="pos-layout">
        <PosProductCatalog
          products={filteredProducts}
          query={query}
          quantities={quantities}
          selectedUnits={selectedUnits}
          units={units}
          canCreate={can('pos.pos_order.create')}
          onQueryChange={setQuery}
          onScanKeyDown={scanProduct}
          onAddProduct={(productId) => adjustQty(productId, 1)}
          priceFor={priceFor}
          formatMoney={fmtMoney}
          t={t}
        />
        <aside className="card pos-cart"><PosCartContents
          cart={cart}
          units={units}
          unitsFor={unitsFor}
          priceFor={priceFor}
          estimatedLines={estimatedLines}
          partyOptions={partyOptions}
          partyId={partyId}
          rxRequired={rxRequired}
          loyaltyEnabled={loyaltyEnabled}
          voucherCode={voucherCode}
          pharmacyEnabled={pharmacyEnabled}
          prescriptionOptions={eligiblePrescriptions}
          prescriptionId={prescriptionId}
          onQuantityAdjust={adjustQty}
          onQuantityChange={setQty}
          onUnitChange={(productId, unitId) => setSelectedUnits((current) => ({ ...current, [productId]: unitId }))}
          onPartyChange={setPartyId}
          onVoucherCodeChange={(value) => setVoucherCode(value.toUpperCase())}
          onPrescriptionChange={(id) => { setPrescriptionId(id); const prescription = eligiblePrescriptions.find((item) => item.id === id); if (prescription?.party) setPartyId(prescription.party); }}
          formatMoney={fmtMoney}
          recordLabel={recordLabel}
          t={t}
        />
          <PosCheckoutPanel method={method} onMethodChange={setMethod} cashReceived={cashReceived} onCashReceived={setCashReceived} subtotal={subtotal} estimatedTax={estimatedTax} total={total} hasItems={cart.length > 0} busy={busy} canCreate={can('pos.pos_order.create')} onCheckout={checkout} formatMoney={fmtMoney} t={t} />
          {sessionOrders.length > 0 && <section className="pos-pending"><h3>{t('Đơn chờ xử lý')} ({sessionOrders.length})</h3>{sessionOrders.map((order) => <div className="pos-pending-item" key={order.id}><div><strong>{fmtMoney(order.total || 0)}</strong><div className="small muted">{fmtDateTime(order.created_at)} · {statusLabel(order.status)}</div>{order.method === 'cash' && <label className="field"><span className="label">{t('Khách đưa')}</span><input className="input num" type="number" min={order.total || 0} step="0.01" value={pendingCashReceived[order.id] ?? (order.cash_received ?? '')} onChange={(event) => setPendingCashReceived((current) => ({ ...current, [order.id]: event.target.value }))} aria-label={`${t('Tiền khách đưa cho đơn')} ${String(order.id).slice(0, 8)}`} /></label>}</div><button className="btn btn-primary btn-sm" type="button" disabled={busy || !can('pos.pos_order.completed')} onClick={() => completeOrder(order)}>{t('Hoàn tất')}</button><button className="btn btn-ghost btn-sm" type="button" disabled={busy || !can('pos.pos_order.delete')} onClick={() => removeOrder(order)}>{t('Hủy')}</button></div>)}</section>}
          <PosRecentTransactions
            orders={recentTransactions} returns={returns} parties={parties} products={products} busy={busy}
            canReadReturns={can('pos.pos_return.read')} canCreateReturns={can('pos.pos_return.create')}
            canReceiveReturns={can('pos.pos_return.received')} canRefundOrders={can('pos.pos_order.refunded')}
            canUpdateOrders={can('pos.pos_order.update')} onPrint={(order) => setPrintingOrderId(order.id)}
            onPartialReturn={beginPartialReturn} onRefund={refundOrder} formatMoney={fmtMoney}
            formatDateTime={fmtDateTime} statusLabel={statusLabel} t={t}
          />
          <PosCashOperationsPanel
            movements={cashMovements.filter((item) => item.session === sessionId)} direction={cashDirection}
            amount={cashAmount} accountId={cashAccount} reason={cashReason} accounts={accounts} busy={busy}
            canCreate={can('pos.cash_movement.create')} canPost={can('pos.cash_movement.posted')}
            canDelete={can('pos.cash_movement.delete')} onDirectionChange={setCashDirection}
            onAmountChange={setCashAmount} onAccountChange={setCashAccount} onReasonChange={setCashReason}
            onSubmit={createCashMovement} onPost={postCashMovement} onRemove={removeCashMovement}
            formatMoney={fmtMoney} t={t}
          />
          <form className="pos-close-form" onSubmit={closeSession}><label className="field"><span className="label">{t('Tiền mặt thực đếm khi chốt ca')}</span><input className="input num" type="number" min="0" step="any" required value={closingCash} onChange={(event) => setClosingCash(event.target.value)} /></label><button className="btn btn-secondary" type="submit" disabled={busy || cart.length > 0 || !can('pos.pos_session.update') || !can('pos.pos_session.closed')}>{t('Chốt ca')}</button></form>{cart.length > 0 && <p className="small muted">{t('Xóa các mặt hàng trong giỏ trước khi chốt ca.')}</p>}
        </aside>
      </div>}
    </>}
    <PosReturnDialog order={returningOrder} returns={returns} products={products} quantities={returnQuantities} reason={returnReason} busy={busy} locked={Boolean(returnDraftId)} canSubmit={can('pos.pos_return.create') && can('pos.pos_return.received')} onReasonChange={setReturnReason} onQuantityChange={(index, value) => setReturnQuantities((current) => ({ ...current, [index]: value }))} onClose={() => setReturningOrder(null)} onSubmit={submitPartialReturn} t={t} />
    <PosReceipt order={printingOrder} storeName={app.meta?.name} partyName={parties.get(printingOrder?.party)?.name} products={products} t={t} />
  </div>;
}
