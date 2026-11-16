import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useDocumentTitle } from '../../lib/useDocumentTitle.js';
import { localDate } from '../../lib/dates.js';
import { api, dataPath } from '../../lib/api.js';
import { confirmDialog, textDialog } from '../../lib/feedback.js';
import { fmtMoney, fmtDateTime, statusLabel, uiTextWith } from '../../lib/i18n.js';
import { app, can, loadRefs, recordLabel, loadAllResponse } from '../../lib/state.js';
import PosReceipt from './components/PosReceipt.jsx';
import PosCheckoutPanel from './components/PosCheckoutPanel.jsx';
import PosReturnDialog from './components/PosReturnDialog.jsx';

const readItems = (response) => Array.isArray(response?.items) ? response.items : [];
const displayPrice = (product) => Number(product?.price) || 0;
const supportsPartialReturn = (order) => {
  return Boolean(order);
};
const t = (text) => uiTextWith(text, {
  'Thuốc trả từ đơn thuốc được cách ly và phải hủy; không được bán lại.': 'Medicines returned from a prescription are quarantined for disposal and cannot be resold.',
  'Lý do hoàn đơn': 'Refund reason',
});

export default function PosTerminalPage() {
  useDocumentTitle(`${t('Quầy bán hàng POS')} · OSP Suite`);
  const [warehouses, setWarehouses] = useState(new Map());
  const [branches, setBranches] = useState(new Map());
  const [products, setProducts] = useState(new Map());
  const [units, setUnits] = useState(new Map());
  const [taxes, setTaxes] = useState(new Map());
  const [parties, setParties] = useState(new Map());
  const [accounts, setAccounts] = useState(new Map());
  const [sessions, setSessions] = useState([]);
  const [orders, setOrders] = useState([]);
  const [returns, setReturns] = useState([]);
  const [returningOrder, setReturningOrder] = useState(null);
  const [returnQuantities, setReturnQuantities] = useState({});
  const [returnReason, setReturnReason] = useState('');
  const [returnDraftId, setReturnDraftId] = useState('');
  const [prescriptions, setPrescriptions] = useState([]);
  const [prescriptionId, setPrescriptionId] = useState('');
  const [cashMovements, setCashMovements] = useState([]);
  const [sessionId, setSessionId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [openingCash, setOpeningCash] = useState('0');
  const [closingCash, setClosingCash] = useState('');
  const [partyId, setPartyId] = useState('');
  const [voucherCode, setVoucherCode] = useState('');
  const [method, setMethod] = useState('cash');
  const [cashReceived, setCashReceived] = useState('');
  const [pendingCashReceived, setPendingCashReceived] = useState({});
  const [cashDirection, setCashDirection] = useState('cash_out');
  const [cashAmount, setCashAmount] = useState('');
  const [cashAccount, setCashAccount] = useState('');
  const [cashReason, setCashReason] = useState('');
  const [query, setQuery] = useState('');
  const [quantities, setQuantities] = useState({});
  const [selectedUnits, setSelectedUnits] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [printingOrderId, setPrintingOrderId] = useState('');

  useEffect(() => {
    if (!printingOrderId) return undefined;
    const finish = () => setPrintingOrderId('');
    window.addEventListener('afterprint', finish);
    const timer = window.setTimeout(() => window.print(), 80);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('afterprint', finish);
    };
  }, [printingOrderId]);

  const load = useCallback(async (keepNotice = false) => {
    setLoading(true);
    setError('');
    if (!keepNotice) setNotice('');
    try {
      const pharmacyEnabled = app.meta?.modules?.some((module) => module.id === 'pharmacy');
      const [warehouseMap, branchMap, productMap, unitMap, partyMap, taxMap, accountMap, sessionResponse, orderResponse, movementResponse, prescriptionResponse, returnResponse] = await Promise.all([
        loadRefs('inventory.warehouse'), loadRefs('master-data.branch'),
        loadRefs('master-data.product'), can('master-data.uom.read') ? loadRefs('master-data.uom') : Promise.resolve(new Map()), loadRefs('master-data.party'), loadRefs('master-data.tax'),
        loadRefs('accounting.account'), loadAllResponse('pos.pos_session'),
        loadAllResponse('pos.pos_order'), loadAllResponse('pos.cash_movement'),
        pharmacyEnabled ? loadAllResponse('pharmacy.prescription') : Promise.resolve({ items: [] }),
        can('pos.pos_return.read') ? loadAllResponse('pos.pos_return') : Promise.resolve({ items: [] }),
      ]);
      setWarehouses(warehouseMap);
      setBranches(branchMap);
      setProducts(productMap);
      setUnits(unitMap);
      setParties(partyMap);
      setTaxes(taxMap);
      setAccounts(accountMap);
      const nextSessions = readItems(sessionResponse).filter((item) => item.status === 'open').sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
      const nextOrders = readItems(orderResponse).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
      setSessions(nextSessions);
      setOrders(nextOrders);
      setReturns(readItems(returnResponse));
      setCashMovements(readItems(movementResponse).filter((item) => item.status === 'draft').sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))));
      setPrescriptions(readItems(prescriptionResponse).filter((item) => ['verified', 'partially_dispensed'].includes(item.status)).sort((a, b) => String(a.valid_until || '').localeCompare(String(b.valid_until || ''))));
      setSessionId((current) => nextSessions.some((item) => item.id === current) ? current : nextSessions[0]?.id || '');
    } catch (reason) {
      setError(t(reason.message || 'Không tải được dữ liệu quầy POS.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load();
  }, [load]);

  const activeSession = sessions.find((item) => item.id === sessionId) || null;
  const pharmacyEnabled = app.meta?.modules?.some((module) => module.id === 'pharmacy');
  const loyaltyEnabled = app.meta?.modules?.some((module) => module.id === 'loyalty');
  const activeWarehouse = activeSession ? warehouses.get(activeSession.warehouse) : null;
  const sessionOrders = useMemo(() => orders.filter((item) => item.session === sessionId && item.status === 'open'), [orders, sessionId]);
  const recentTransactions = useMemo(() => orders.filter((item) => ['completed', 'refunded'].includes(item.status)).slice(0, 20), [orders]);
  const partialReturnsFor = (orderId) => returns.filter((item) => item.pos_order === orderId && item.status === 'received');
  const partialReturnTotal = (orderId) => partialReturnsFor(orderId).reduce((sum, item) => sum + (Number(item.total) || 0), 0);
  const cart = useMemo(() => Object.entries(quantities).map(([id, qty]) => ({ product: products.get(id), uom: selectedUnits[id] || products.get(id)?.uom || '', qty: Number(qty) })).filter((row) => row.product && row.qty > 0), [quantities, products, selectedUnits]);
  const unitsFor = (product) => product?.uom ? [...units.values()].filter((unit) => unit.id === product.uom || unit.base_uom === product.uom) : [];
  const priceFor = (product, uomId) => {
    const unit = units.get(uomId);
    return displayPrice(product) * (unit?.base_uom ? Number(unit.ratio || 0) : 1);
  };
  const rxRequired = cart.some(({ product }) => product.requires_prescription === true);
  useEffect(() => { if (!rxRequired && prescriptionId) setPrescriptionId(''); }, [rxRequired, prescriptionId]);
  const subtotal = cart.reduce((sum, row) => sum + priceFor(row.product, row.uom) * row.qty, 0);
  const estimatedTax = cart.reduce((sum, row) => sum + priceFor(row.product, row.uom) * row.qty * ((Number(taxes.get(row.product.tax)?.rate) || 0) / 100), 0);
  const total = Math.round((subtotal + estimatedTax + Number.EPSILON) * 100) / 100;
  const filteredProducts = [...products.values()].filter((product) => product.active !== false && (!query || `${product.name} ${product.sku || ''} ${product.barcode || ''}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))).sort((a, b) => String(a.name).localeCompare(String(b.name), 'vi'));

  const startSession = async (event) => {
    event.preventDefault();
    setBusy(true); setError(''); setNotice('');
    try {
      const created = await api(dataPath('pos.pos_session'), { method: 'POST', body: {
        warehouse: warehouseId, branch: branchId || undefined,
        cashier: app.user?.name || app.user?.email || t('Thu ngân'), opening_cash: Number(openingCash || 0),
      } });
      await load(true);
      setSessionId(created.id);
      setNotice(t('Đã mở ca bán hàng.'));
    } catch (reason) {
      setError(t(reason.message || 'Không mở được ca bán hàng.'));
    } finally { setBusy(false); }
  };

  const setQty = (productId, value) => setQuantities((current) => {
    const qty = Math.max(0, Number(value) || 0);
    const next = { ...current };
    if (qty === 0) delete next[productId]; else next[productId] = qty;
    return next;
  });

  const scanProduct = (event) => {
    if (event.key !== 'Enter') return;
    const scanned = event.currentTarget.value.trim().toLocaleUpperCase();
    if (!scanned) return;
    const availableProducts = [...products.values()].filter((product) => product.active !== false);
    const matches = availableProducts.filter((product) => String(product.barcode || '').trim().toLocaleUpperCase() === scanned);
    const exactMatches = matches.length ? matches : availableProducts.filter((product) => String(product.sku || '').trim().toLocaleUpperCase() === scanned);
    if (exactMatches.length === 1) {
      event.preventDefault();
      const product = exactMatches[0];
      setQty(product.id, (Number(quantities[product.id]) || 0) + 1);
      setQuery(''); setError(''); setNotice(`${t('Đã thêm')} ${product.name} ${t('vào giỏ.')}`);
    } else if (exactMatches.length > 1) {
      event.preventDefault();
      setError(`${t('Mã')} “${scanned}” ${t('khớp với nhiều sản phẩm. Hãy kiểm tra lại barcode và SKU trong danh mục.')}`);
    }
  };

  const checkout = async (event) => {
    event.preventDefault();
    if (!activeSession || !cart.length) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const created = await api(dataPath('pos.pos_order'), { method: 'POST', body: {
        session: activeSession.id, warehouse: activeSession.warehouse,
        ...(activeSession.branch ? { branch: activeSession.branch } : {}),
        ...(partyId ? { party: partyId } : {}), ...(rxRequired && prescriptionId ? { prescription: prescriptionId } : {}), ...(voucherCode.trim() ? { voucher_code: voucherCode.trim() } : {}), method,
        ...(method === 'cash' ? { cash_received: Number(cashReceived) } : {}),
        lines: cart.map(({ product, uom, qty }) => ({ product: product.id, uom: uom || undefined, qty, price: priceFor(product, uom) })),
      } });
      setQuantities({}); setSelectedUnits({}); setPartyId(''); setPrescriptionId(''); setVoucherCode(''); setCashReceived('');
      let completionError = '';
      try {
        await api(dataPath('pos.pos_order', created.id, 'completed'), { method: 'POST' });
      } catch (reason) {
        completionError = t(reason.message || 'Chưa thể hoàn tất đơn hàng.');
      }
      await load(true);
      if (completionError) {
        setNotice(`${t('Đã lưu đơn chờ thanh toán')} ${String(created.id).slice(0, 8)}. ${t('Mở mục đơn chờ bên dưới để hoàn tất hoặc xóa đơn.')}`);
        setError(completionError);
      } else {
        setNotice(`${t('Đã thanh toán')} ${fmtMoney(Number(created.total) || total)}.`);
      }
    } catch (reason) {
      setError(t(reason.message || 'Không tạo được đơn POS.'));
    } finally { setBusy(false); }
  };

  const completeOrder = async (order) => {
    setBusy(true); setError(''); setNotice('');
    try {
      if (order.method === 'cash') {
        const received = Number(pendingCashReceived[order.id] ?? order.cash_received);
        if (!Number.isFinite(received) || received < Number(order.total || 0)) {
          throw new Error(t('Nhập số tiền khách đưa bằng hoặc lớn hơn tổng đơn tiền mặt.'));
        }
        if (received !== Number(order.cash_received)) {
          await api(dataPath('pos.pos_order', order.id), { method: 'PATCH', body: { cash_received: received } });
        }
      }
      await api(dataPath('pos.pos_order', order.id, 'completed'), { method: 'POST' });
      setPendingCashReceived((current) => { const next = { ...current }; delete next[order.id]; return next; });
      setNotice(`${t('Đã hoàn tất đơn')} ${String(order.id).slice(0, 8)}.`);
      await load(true);
    } catch (reason) { setError(t(reason.message || 'Không hoàn tất được đơn. Kiểm tra lại tồn kho và thử lại.')); }
    finally { setBusy(false); }
  };

  const removeOrder = async (order) => {
    setBusy(true); setError(''); setNotice('');
    try {
      await api(dataPath('pos.pos_order', order.id), { method: 'DELETE' });
      setNotice(t('Đã hủy đơn chờ.'));
      await load(true);
    } catch (reason) { setError(t(reason.message || 'Không hủy được đơn chờ.')); }
    finally { setBusy(false); }
  };

  const refundOrder = async (order) => {
    const refundReason = await textDialog({ title: t('Hoàn toàn bộ giao dịch'), message: t('Nhập lý do để lưu cùng biên nhận và lịch sử hoàn tiền.'), label: t('Lý do hoàn đơn'), minLength: 5, maxLength: 500, confirmLabel: t('Tiếp tục') });
    if (!refundReason) return;
    if (refundReason.length < 5 || refundReason.length > 500) {
      setError(t('Lý do hoàn đơn cần từ 5 đến 500 ký tự.'));
      return;
    }
    if (!await confirmDialog({ title: t('Xác nhận hoàn giao dịch'), message: `${String(order.id).slice(0, 8)} · ${fmtMoney(order.total || 0)}. ${t('Hàng hóa theo dõi tồn kho sẽ được nhập lại và chứng từ kế toán sẽ được đảo.')}`, danger: true, confirmLabel: t('Hoàn giao dịch') })) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await api(dataPath('pos.pos_order', order.id, 'refunded'), { method: 'POST', body: { refund_reason: refundReason } });
      setNotice(`${t('Đã hoàn toàn bộ giao dịch')} ${String(order.id).slice(0, 8)}.`);
      await load(true);
    } catch (reason) { setError(t(reason.message || 'Không hoàn được giao dịch. Với tiền mặt, cần ca đang mở cùng thu ngân và chi nhánh với ca bán.')); }
    finally { setBusy(false); }
  };

  const beginPartialReturn = (order) => {
    setReturningOrder(order);
    setReturnQuantities({});
    setReturnReason('');
    setReturnDraftId('');
    setError('');
  };

  const submitPartialReturn = async (event) => {
    event.preventDefault();
    if (!returningOrder) return;
    const reason = returnReason.trim();
    const lines = Object.entries(returnQuantities)
      .map(([lineIndex, qty]) => ({ line_index: Number(lineIndex), qty: Number(qty) }))
      .filter((line) => Number.isFinite(line.qty) && line.qty > 0);
    if (reason.length < 5 || reason.length > 500) {
      setError(t('Lý do trả hàng cần từ 5 đến 500 ký tự.'));
      return;
    }
    if (!lines.length) {
      setError(t('Nhập số lượng lớn hơn 0 cho ít nhất một mặt hàng.'));
      return;
    }
    setBusy(true); setError(''); setNotice('');
    try {
      let returnId = returnDraftId;
      if (!returnId) {
        const created = await api(dataPath('pos.pos_return'), { method: 'POST', body: { pos_order: returningOrder.id, reason, lines } });
        returnId = created.id;
        setReturnDraftId(returnId);
      }
      await api(dataPath('pos.pos_return', returnId, 'received'), { method: 'POST' });
      setNotice(`${t('Đã ghi nhận phiếu trả hàng')} ${String(returnId).slice(0, 8)} · ${fmtMoney(lines.reduce((sum, line) => {
        const sold = Number(returningOrder.lines?.[line.line_index]?.qty) || 0;
        const value = Number(returningOrder.lines?.[line.line_index]?.line_total) || 0;
        return sum + (sold > 0 ? value * line.qty / sold : 0);
      }, 0))}.`);
      setReturningOrder(null); setReturnDraftId('');
      await load(true);
      setPrintingOrderId(returnId);
    } catch (reason) {
      setError(t(reason.message || 'Không ghi nhận được phiếu trả hàng. Phiếu nháp vẫn được giữ để thử lại.'));
    } finally { setBusy(false); }
  };

  const printingReturn = returns.find((record) => record.id === printingOrderId && record.status === 'received');
  const returnSourceOrder = printingReturn ? orders.find((order) => order.id === printingReturn.pos_order) : null;
  const printingOrder = printingReturn
    ? { ...returnSourceOrder, id: printingReturn.id, created_at: printingReturn.created_at, status: 'partial_return', total: printingReturn.total, tax_total: printingReturn.tax_total, voucher_discount: (printingReturn.lines || []).reduce((sum, line) => sum + (Number(line.voucher_discount_amount) || 0), 0), lines: printingReturn.lines, refund_reason: printingReturn.reason, return_source_id: printingReturn.pos_order, method: 'refund', cash_received: undefined, change_due: undefined }
    : orders.find((order) => order.id === printingOrderId);

  const createCashMovement = async (event) => {
    event.preventDefault();
    if (!activeSession) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const movement = await api(dataPath('pos.cash_movement'), { method: 'POST', body: {
        session: activeSession.id, direction: cashDirection, amount: Number(cashAmount),
        offset_account: cashAccount, reason: cashReason.trim(),
      } });
      await api(dataPath('pos.cash_movement', movement.id, 'posted'), { method: 'POST' });
      setCashAmount(''); setCashReason('');
      setNotice(t(cashDirection === 'cash_in' ? 'Đã ghi nhận tiền nộp thêm vào quỹ.' : 'Đã ghi nhận khoản chi từ quỹ.'));
      await load(true);
    } catch (reason) { await load(true); setError(t(reason.message || 'Không ghi nhận được giao dịch quỹ.')); }
    finally { setBusy(false); }
  };

  const postCashMovement = async (movement) => {
    setBusy(true); setError(''); setNotice('');
    try {
      await api(dataPath('pos.cash_movement', movement.id, 'posted'), { method: 'POST' });
      setNotice(t('Đã ghi sổ phiếu thu chi.')); await load(true);
    } catch (reason) { setError(t(reason.message || 'Không ghi sổ được phiếu thu chi.')); }
    finally { setBusy(false); }
  };

  const removeCashMovement = async (movement) => {
    setBusy(true); setError(''); setNotice('');
    try { await api(dataPath('pos.cash_movement', movement.id), { method: 'DELETE' }); setNotice(t('Đã xóa phiếu nháp.')); await load(true); }
    catch (reason) { setError(t(reason.message || 'Không xóa được phiếu nháp.')); }
    finally { setBusy(false); }
  };

  const closeSession = async (event) => {
    event.preventDefault();
    if (!activeSession) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const closed = await api(dataPath('pos.pos_session', activeSession.id, 'closed'), { method: 'POST', body: { closing_cash: Number(closingCash) } });
      setNotice(`${t('Đã chốt ca. Tiền kỳ vọng')} ${fmtMoney(closed.expected_cash)}; ${t('chênh lệch')} ${fmtMoney(closed.cash_difference)}.`);
      setClosingCash(''); await load(true);
    } catch (reason) { setError(t(reason.message || 'Không chốt được ca. Hãy xử lý hết đơn chờ và phiếu thu chi nháp trước.')); }
    finally { setBusy(false); }
  };

  return <div className="page pos-page">
    <div className="page-head"><div><h1>{t('Quầy bán hàng POS')}</h1><p className="sub">{t('Mở ca theo kho, ghi nhận hàng bán và phương thức thanh toán; giá và thuế cuối cùng do máy chủ tính theo danh mục.')}</p></div><button className="btn btn-secondary" type="button" disabled={loading || busy} onClick={() => load()}>{t('Làm mới')}</button></div>
    {error && <div className="alert danger" role="alert">{t(error)}</div>}{notice && <div className="alert success" role="status">{t(notice)}</div>}
    {loading ? <div className="card-pad"><div className="skeleton" data-h="row" /></div> : <>
      <section className="card pos-session-bar">
        <div className="pos-session-select"><label className="field"><span className="label">{t('Ca đang mở')}</span><select className="select" value={sessionId} onChange={(event) => { setSessionId(event.target.value); setClosingCash(''); }}><option value="">{t('Chưa chọn ca')}</option>{sessions.map((item) => <option key={item.id} value={item.id}>{branches.get(item.branch)?.name || t('Không gán chi nhánh')} · {warehouses.get(item.warehouse)?.name || t('Ca cũ chưa có kho')} · {item.cashier || t('Thu ngân')}</option>)}</select></label>
          {activeSession && <div className="small muted">{t('Kho:')} {activeWarehouse?.name || t('Ca cũ chưa khai báo kho')} · {t('Tiền đầu ca:')} {fmtMoney(activeSession.opening_cash || 0)}{activeSession.cashier ? ` · ${activeSession.cashier}` : ''}</div>}
        </div>
        {!sessions.length && <div className="small muted">{t('Chưa có ca mở. Tạo ca mới để bắt đầu bán.')}</div>}
        <details className="pos-open-session"><summary>{t('Mở ca mới')}</summary><form className="pos-session-form" onSubmit={startSession}>
          <label className="field"><span className="label">{t('Kho bán hàng *')}</span><select className="select" required value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)}><option value="">{t('Chọn kho')}</option>{[...warehouses.values()].filter((item) => item.active !== false).map((item) => <option key={item.id} value={item.id}>{recordLabel('inventory.warehouse', item)}</option>)}</select></label>
          <label className="field"><span className="label">{t('Chi nhánh')}</span><select className="select" value={branchId} onChange={(event) => setBranchId(event.target.value)}><option value="">{t('Không gán chi nhánh')}</option>{[...branches.values()].filter((item) => item.active !== false).map((item) => <option key={item.id} value={item.id}>{recordLabel('master-data.branch', item)}</option>)}</select></label>
          <label className="field"><span className="label">{t('Tiền đầu ca')}</span><input className="input num" type="number" min="0" step="any" value={openingCash} onChange={(event) => setOpeningCash(event.target.value)} /></label>
          <button className="btn btn-primary" type="submit" disabled={busy || !can('pos.pos_session.create')}>{busy ? t('Đang mở…') : t('Mở ca')}</button>
        </form></details>
      </section>
      {!activeSession ? <div className="empty card-pad">{t('Chọn một ca đang mở hoặc mở ca mới để sử dụng quầy.')}</div> : !activeSession.warehouse ? <div className="alert warning">{t('Ca này được tạo trước khi bắt buộc chọn kho. Hãy chốt ca cũ và mở ca mới để tiếp tục bán.')}<form className="pos-close-form" onSubmit={closeSession}><label className="field"><span className="label">{t('Tiền mặt thực đếm để chốt ca')}</span><input className="input num" type="number" min="0" step="any" required value={closingCash} onChange={(event) => setClosingCash(event.target.value)} /></label><button className="btn btn-secondary" type="submit" disabled={busy || !can('pos.pos_session.update') || !can('pos.pos_session.closed')}>{t('Chốt ca cũ')}</button></form></div> : <div className="pos-layout">
        <section className="pos-products-panel"><div className="row wrap"><h2>{t('Sản phẩm')}</h2><span className="grow" /><input className="input pos-search" type="search" placeholder={t('Quét/nhập tên, SKU hoặc mã vạch')} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={scanProduct} aria-label={t('Quét barcode hoặc tìm sản phẩm')} /></div><p className="small muted">{t('Đặt con trỏ trong ô tìm kiếm rồi quét mã; máy quét gửi Enter để thêm đúng một sản phẩm vào giỏ.')}</p>
          <div className="pos-products">{filteredProducts.map((product) => { const uom = selectedUnits[product.id] || product.uom || ''; return <button className={`card pos-product${quantities[product.id] ? ' selected' : ''}`} key={product.id} type="button" disabled={!can('pos.pos_order.create')} onClick={() => setQty(product.id, (Number(quantities[product.id]) || 0) + 1)}><strong>{product.name}</strong><span className="small muted">{product.sku || t('Không mã')}</span><span className="num">{fmtMoney(priceFor(product, uom))}{units.get(uom)?.name ? ` / ${units.get(uom).name}` : ''}</span>{product.tracked !== false && <span className="small faint">{t('Quản lý tồn kho')}</span>}</button>; })}</div>
          {!filteredProducts.length && <div className="empty">{t('Không có sản phẩm phù hợp.')}</div>}
        </section>
        <aside className="card pos-cart"><h2>{t('Đơn hàng')}</h2>{cart.length ? <div className="pos-cart-lines">{cart.map(({ product, uom, qty }) => <div className="pos-cart-line" key={product.id}><div><strong>{product.name}</strong>{unitsFor(product).length > 1 && <select className="select" aria-label={`${t('Đơn vị bán')} ${product.name}`} value={uom} onChange={(event) => setSelectedUnits((current) => ({ ...current, [product.id]: event.target.value }))}>{unitsFor(product).map((unit) => <option key={unit.id} value={unit.id}>{unit.name}{unit.base_uom ? ` · ${unit.ratio} × ${t('đơn vị gốc')}` : ` · ${t('đơn vị gốc')}`}</option>)}</select>}<div className="small muted">{fmtMoney(priceFor(product, uom))} / {units.get(uom)?.name || t('sp')}</div></div><div className="pos-qty"><button className="btn btn-ghost btn-sm" type="button" aria-label={`${t('Giảm')} ${product.name}`} onClick={() => setQty(product.id, qty - 1)}>−</button><input className="input num" type="number" min="0" step="any" aria-label={`${t('Số lượng')} ${product.name}`} value={qty} onChange={(event) => setQty(product.id, event.target.value)} /><button className="btn btn-ghost btn-sm" type="button" aria-label={`${t('Tăng')} ${product.name}`} onClick={() => setQty(product.id, qty + 1)}>+</button></div><strong className="num">{fmtMoney(priceFor(product, uom) * qty)}</strong></div>)}</div> : <div className="empty">{t('Chọn sản phẩm để thêm vào đơn.')}</div>}
          <label className="field"><span className="label">{t('Khách hàng')} {rxRequired ? '*' : t('(tùy chọn)')}</span><select className="select" required={rxRequired} value={partyId} onChange={(event) => setPartyId(event.target.value)}><option value="">{t('Khách lẻ')}</option>{[...parties.values()].filter((item) => item.active !== false && item.is_customer !== false).map((item) => <option key={item.id} value={item.id}>{recordLabel('master-data.party', item)}</option>)}</select></label>
          {loyaltyEnabled && <label className="field"><span className="label">{t('Mã voucher thành viên')}</span><input className="input" maxLength="80" autoCapitalize="characters" value={voucherCode} onChange={(event) => setVoucherCode(event.target.value.toUpperCase())}/><span className="small muted">{t('Cần chọn khách hàng đã đăng ký thành viên; mã chỉ được sử dụng một lần.')}</span></label>}
          {pharmacyEnabled && rxRequired && <label className="field"><span className="label">{t('Đơn thuốc *')}</span><select className="select" required={rxRequired} value={prescriptionId} onChange={(event) => { const id = event.target.value; setPrescriptionId(id); const rx = prescriptions.find((item) => item.id === id); if (rx?.party) setPartyId(rx.party); }}><option value="">{t('Chọn đơn còn thuốc được kê')}</option>{prescriptions.filter((item) => ['verified', 'partially_dispensed'].includes(item.status) && item.valid_until && item.valid_until >= localDate()).map((item) => <option key={item.id} value={item.id}>{item.prescription_no} · {t(item.status === 'partially_dispensed' ? 'cấp một phần' : 'đã xác minh')} · {t('hết hạn')} {item.valid_until}</option>)}</select>{rxRequired && <small className="muted">{t('Thuốc kê đơn chỉ được bán theo đơn còn hạn, đúng khách hàng; số lượng bán cộng dồn không vượt số lượng kê.')}</small>}</label>}
          <PosCheckoutPanel method={method} onMethodChange={setMethod} cashReceived={cashReceived} onCashReceived={setCashReceived} subtotal={subtotal} estimatedTax={estimatedTax} total={total} hasItems={cart.length > 0} busy={busy} canCreate={can('pos.pos_order.create')} onCheckout={checkout} formatMoney={fmtMoney} t={t} />
          {sessionOrders.length > 0 && <section className="pos-pending"><h3>{t('Đơn chờ xử lý')} ({sessionOrders.length})</h3>{sessionOrders.map((order) => <div className="pos-pending-item" key={order.id}><div><strong>{fmtMoney(order.total || 0)}</strong><div className="small muted">{fmtDateTime(order.created_at)} · {statusLabel(order.status)}</div>{order.method === 'cash' && <label className="field"><span className="label">{t('Khách đưa')}</span><input className="input num" type="number" min={Number(order.total || 0)} step="0.01" value={pendingCashReceived[order.id] ?? (order.cash_received ?? '')} onChange={(event) => setPendingCashReceived((current) => ({ ...current, [order.id]: event.target.value }))} aria-label={`${t('Tiền khách đưa cho đơn')} ${String(order.id).slice(0, 8)}`} /></label>}</div><button className="btn btn-primary btn-sm" type="button" disabled={busy || !can('pos.pos_order.completed')} onClick={() => completeOrder(order)}>{t('Hoàn tất')}</button><button className="btn btn-ghost btn-sm" type="button" disabled={busy || !can('pos.pos_order.delete')} onClick={() => removeOrder(order)}>{t('Hủy')}</button></div>)}</section>}
          <section className="pos-pending"><h3>{t('Giao dịch gần đây')}</h3>{recentTransactions.length ? recentTransactions.map((order) => { const partialEligible = supportsPartialReturn(order); return <div className="pos-pending-item" key={order.id}><div className="grow"><strong>{fmtMoney(order.total || 0)} · {parties.get(order.party)?.name || t('Khách lẻ')}</strong><div className="small muted">{fmtDateTime(order.created_at)} · {t(order.method === 'cash' ? 'Tiền mặt' : order.method === 'card' ? 'Thẻ' : order.method === 'transfer' ? 'Chuyển khoản' : order.method === 'ewallet' ? 'Ví điện tử' : '—')} · {statusLabel(order.status)}</div><div className="small muted">{(order.lines || []).map((line, index) => `${line.product_name || products.get(line.product)?.name || t('Mặt hàng')} × ${line.qty}${line.uom_name ? ` ${line.uom_name}` : ''}`).join(' · ')}</div>{partialReturnsFor(order.id).length > 0 && <div className="small muted">{t('Đã trả một phần')}: {fmtMoney(partialReturnTotal(order.id))}</div>}{order.refund_reason && <div className="small muted">{t('Lý do hoàn:')} {order.refund_reason}</div>}{order.status === 'completed' && order.prescription && <div className="small muted">{t('Thuốc trả từ đơn thuốc được cách ly và phải hủy; không được bán lại.')}</div>}</div><button className="btn btn-ghost btn-sm" type="button" onClick={() => setPrintingOrderId(order.id)}>{t('In biên nhận')}</button>{order.status === 'completed' && partialEligible && can('pos.pos_return.read') && can('pos.pos_return.create') && can('pos.pos_return.received') && <button className="btn btn-secondary btn-sm" type="button" disabled={busy} onClick={() => beginPartialReturn(order)}>{t('Trả một phần')}</button>}{order.status === 'completed' && partialReturnsFor(order.id).length === 0 && can('pos.pos_order.refunded') && can('pos.pos_order.update') && <button className="btn btn-ghost btn-sm" type="button" disabled={busy} onClick={() => refundOrder(order)}>{t('Hoàn toàn bộ')}</button>}</div>; }) : <div className="empty">{t('Chưa có giao dịch hoàn tất trong danh sách gần đây.')}</div>}</section>
          <details className="pos-cash-panel"><summary>{t('Thu / chi quỹ tiền mặt')}</summary><form className="pos-cash-form" onSubmit={createCashMovement}>
            <label className="field"><span className="label">{t('Loại giao dịch')}</span><select className="select" value={cashDirection} onChange={(event) => setCashDirection(event.target.value)}><option value="cash_out">{t('Chi tiền')}</option><option value="cash_in">{t('Nộp tiền vào quỹ')}</option></select></label>
            <label className="field"><span className="label">{t('Số tiền')}</span><input className="input num" required type="number" min="0.01" step="any" value={cashAmount} onChange={(event) => setCashAmount(event.target.value)} /></label>
            <label className="field"><span className="label">{t('Tài khoản đối ứng')}</span><select className="select" required value={cashAccount} onChange={(event) => setCashAccount(event.target.value)}><option value="">{t('Chọn tài khoản')}</option>{[...accounts.values()].filter((item) => !['111', '112'].includes(String(item.code)) && item.active !== false).map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></label>
            <label className="field"><span className="label">{t('Lý do')}</span><input className="input" required value={cashReason} onChange={(event) => setCashReason(event.target.value)} /></label>
            <button className="btn btn-secondary" type="submit" disabled={busy || !can('pos.cash_movement.create') || !can('pos.cash_movement.posted')}>{t('Ghi nhận')}</button>
          </form>
            {cashMovements.filter((item) => item.session === sessionId).map((movement) => <div className="pos-pending-item" key={movement.id}><div><strong>{t(movement.direction === 'cash_in' ? 'Nộp quỹ' : 'Chi quỹ')} · {fmtMoney(movement.amount)}</strong><div className="small muted">{movement.reason}</div></div><button className="btn btn-primary btn-sm" type="button" disabled={busy || !can('pos.cash_movement.posted')} onClick={() => postCashMovement(movement)}>{t('Ghi sổ')}</button><button className="btn btn-ghost btn-sm" type="button" disabled={busy || !can('pos.cash_movement.delete')} onClick={() => removeCashMovement(movement)}>{t('Xóa')}</button></div>)}
          </details>
          <form className="pos-close-form" onSubmit={closeSession}><label className="field"><span className="label">{t('Tiền mặt thực đếm khi chốt ca')}</span><input className="input num" type="number" min="0" step="any" required value={closingCash} onChange={(event) => setClosingCash(event.target.value)} /></label><button className="btn btn-secondary" type="submit" disabled={busy || cart.length > 0 || !can('pos.pos_session.update') || !can('pos.pos_session.closed')}>{t('Chốt ca')}</button></form>{cart.length > 0 && <p className="small muted">{t('Xóa các mặt hàng trong giỏ trước khi chốt ca.')}</p>}
        </aside>
      </div>}
    </>}
    <PosReturnDialog order={returningOrder} returns={returns} products={products} quantities={returnQuantities} reason={returnReason} busy={busy} locked={Boolean(returnDraftId)} canSubmit={can('pos.pos_return.create') && can('pos.pos_return.received')} onReasonChange={setReturnReason} onQuantityChange={(index, value) => setReturnQuantities((current) => ({ ...current, [index]: value }))} onClose={() => setReturningOrder(null)} onSubmit={submitPartialReturn} t={t} />
    <PosReceipt order={printingOrder} storeName={app.meta?.name} partyName={parties.get(printingOrder?.party)?.name} products={products} t={t} />
  </div>;
}
