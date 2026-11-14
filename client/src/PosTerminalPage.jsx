import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api, dataPath } from './lib/api.js';
import { fmtMoney, fmtDateTime, statusLabel } from './lib/i18n.js';
import { app, can, loadRefs, recordLabel } from './lib/state.js';

const readItems = (response) => Array.isArray(response?.items) ? response.items : [];
const displayPrice = (product) => Number(product?.price) || 0;

export default function PosTerminalPage() {
  const [warehouses, setWarehouses] = useState(new Map());
  const [branches, setBranches] = useState(new Map());
  const [products, setProducts] = useState(new Map());
  const [taxes, setTaxes] = useState(new Map());
  const [parties, setParties] = useState(new Map());
  const [accounts, setAccounts] = useState(new Map());
  const [sessions, setSessions] = useState([]);
  const [orders, setOrders] = useState([]);
  const [cashMovements, setCashMovements] = useState([]);
  const [sessionId, setSessionId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [openingCash, setOpeningCash] = useState('0');
  const [closingCash, setClosingCash] = useState('');
  const [partyId, setPartyId] = useState('');
  const [method, setMethod] = useState('cash');
  const [cashDirection, setCashDirection] = useState('cash_out');
  const [cashAmount, setCashAmount] = useState('');
  const [cashAccount, setCashAccount] = useState('');
  const [cashReason, setCashReason] = useState('');
  const [query, setQuery] = useState('');
  const [quantities, setQuantities] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (keepNotice = false) => {
    setLoading(true);
    setError('');
    if (!keepNotice) setNotice('');
    try {
      const [warehouseMap, branchMap, productMap, partyMap, taxMap, accountMap, sessionResponse, orderResponse, movementResponse] = await Promise.all([
        loadRefs('inventory.warehouse'), loadRefs('master-data.branch'),
        loadRefs('master-data.product'), loadRefs('master-data.party'), loadRefs('master-data.tax'),
        loadRefs('accounting.account'), api(`${dataPath('pos.pos_session')}?limit=1000`),
        api(`${dataPath('pos.pos_order')}?limit=1000`), api(`${dataPath('pos.cash_movement')}?limit=1000`),
      ]);
      setWarehouses(warehouseMap);
      setBranches(branchMap);
      setProducts(productMap);
      setParties(partyMap);
      setTaxes(taxMap);
      setAccounts(accountMap);
      const nextSessions = readItems(sessionResponse).filter((item) => item.status === 'open').sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
      const nextOrders = readItems(orderResponse).filter((item) => item.status === 'open').sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
      setSessions(nextSessions);
      setOrders(nextOrders);
      setCashMovements(readItems(movementResponse).filter((item) => item.status === 'draft').sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))));
      setSessionId((current) => nextSessions.some((item) => item.id === current) ? current : nextSessions[0]?.id || '');
    } catch (reason) {
      setError(reason.message || 'Không tải được dữ liệu quầy POS.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    document.title = 'Quầy bán hàng POS · OSP Suite';
    load();
  }, [load]);

  const activeSession = sessions.find((item) => item.id === sessionId) || null;
  const activeWarehouse = activeSession ? warehouses.get(activeSession.warehouse) : null;
  const sessionOrders = useMemo(() => orders.filter((item) => item.session === sessionId), [orders, sessionId]);
  const cart = useMemo(() => Object.entries(quantities).map(([id, qty]) => ({ product: products.get(id), qty: Number(qty) })).filter((row) => row.product && row.qty > 0), [quantities, products]);
  const subtotal = cart.reduce((sum, row) => sum + displayPrice(row.product) * row.qty, 0);
  const estimatedTax = cart.reduce((sum, row) => sum + displayPrice(row.product) * row.qty * ((Number(taxes.get(row.product.tax)?.rate) || 0) / 100), 0);
  const total = Math.round((subtotal + estimatedTax + Number.EPSILON) * 100) / 100;
  const filteredProducts = [...products.values()].filter((product) => product.active !== false && (!query || `${product.name} ${product.sku || ''}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))).sort((a, b) => String(a.name).localeCompare(String(b.name), 'vi'));

  const startSession = async (event) => {
    event.preventDefault();
    setBusy(true); setError(''); setNotice('');
    try {
      const created = await api(dataPath('pos.pos_session'), { method: 'POST', body: {
        warehouse: warehouseId, branch: branchId || undefined,
        cashier: app.user?.name || app.user?.email || 'Thu ngân', opening_cash: Number(openingCash || 0),
      } });
      await load(true);
      setSessionId(created.id);
      setNotice('Đã mở ca bán hàng.');
    } catch (reason) {
      setError(reason.message || 'Không mở được ca bán hàng.');
    } finally { setBusy(false); }
  };

  const setQty = (productId, value) => setQuantities((current) => {
    const qty = Math.max(0, Number(value) || 0);
    const next = { ...current };
    if (qty === 0) delete next[productId]; else next[productId] = qty;
    return next;
  });

  const checkout = async (event) => {
    event.preventDefault();
    if (!activeSession || !cart.length) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const created = await api(dataPath('pos.pos_order'), { method: 'POST', body: {
        session: activeSession.id, warehouse: activeSession.warehouse,
        ...(activeSession.branch ? { branch: activeSession.branch } : {}),
        ...(partyId ? { party: partyId } : {}), method,
        lines: cart.map(({ product, qty }) => ({ product: product.id, qty, price: displayPrice(product) })),
      } });
      setQuantities({}); setPartyId('');
      let completionError = '';
      try {
        await api(dataPath('pos.pos_order', created.id, 'completed'), { method: 'POST' });
      } catch (reason) {
        completionError = reason.message || 'Chưa thể hoàn tất đơn hàng.';
      }
      await load(true);
      if (completionError) {
        setNotice(`Đã lưu đơn chờ thanh toán ${String(created.id).slice(0, 8)}. Mở mục đơn chờ bên dưới để hoàn tất hoặc xóa đơn.`);
        setError(completionError);
      } else {
        setNotice(`Đã thanh toán ${fmtMoney(Number(created.total) || total)}.`);
      }
    } catch (reason) {
      setError(reason.message || 'Không tạo được đơn POS.');
    } finally { setBusy(false); }
  };

  const completeOrder = async (order) => {
    setBusy(true); setError(''); setNotice('');
    try {
      await api(dataPath('pos.pos_order', order.id, 'completed'), { method: 'POST' });
      setNotice(`Đã hoàn tất đơn ${String(order.id).slice(0, 8)}.`);
      await load(true);
    } catch (reason) { setError(reason.message || 'Không hoàn tất được đơn. Kiểm tra lại tồn kho và thử lại.'); }
    finally { setBusy(false); }
  };

  const removeOrder = async (order) => {
    setBusy(true); setError(''); setNotice('');
    try {
      await api(dataPath('pos.pos_order', order.id), { method: 'DELETE' });
      setNotice('Đã hủy đơn chờ.');
      await load(true);
    } catch (reason) { setError(reason.message || 'Không hủy được đơn chờ.'); }
    finally { setBusy(false); }
  };

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
      setNotice(cashDirection === 'cash_in' ? 'Đã ghi nhận tiền nộp thêm vào quỹ.' : 'Đã ghi nhận khoản chi từ quỹ.');
      await load(true);
    } catch (reason) { await load(true); setError(reason.message || 'Không ghi nhận được giao dịch quỹ.'); }
    finally { setBusy(false); }
  };

  const postCashMovement = async (movement) => {
    setBusy(true); setError(''); setNotice('');
    try {
      await api(dataPath('pos.cash_movement', movement.id, 'posted'), { method: 'POST' });
      setNotice('Đã ghi sổ phiếu thu chi.'); await load(true);
    } catch (reason) { setError(reason.message || 'Không ghi sổ được phiếu thu chi.'); }
    finally { setBusy(false); }
  };

  const removeCashMovement = async (movement) => {
    setBusy(true); setError(''); setNotice('');
    try { await api(dataPath('pos.cash_movement', movement.id), { method: 'DELETE' }); setNotice('Đã xóa phiếu nháp.'); await load(true); }
    catch (reason) { setError(reason.message || 'Không xóa được phiếu nháp.'); }
    finally { setBusy(false); }
  };

  const closeSession = async (event) => {
    event.preventDefault();
    if (!activeSession) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await api(dataPath('pos.pos_session', activeSession.id), { method: 'PATCH', body: { closing_cash: Number(closingCash) } });
      const closed = await api(dataPath('pos.pos_session', activeSession.id, 'closed'), { method: 'POST' });
      setNotice(`Đã chốt ca. Tiền kỳ vọng ${fmtMoney(closed.expected_cash)}; chênh lệch ${fmtMoney(closed.cash_difference)}.`);
      setClosingCash(''); await load(true);
    } catch (reason) { setError(reason.message || 'Không chốt được ca. Hãy xử lý hết đơn chờ và phiếu thu chi nháp trước.'); }
    finally { setBusy(false); }
  };

  return <div className="page pos-page">
    <div className="page-head"><div><h1>Quầy bán hàng POS</h1><p className="sub">Mở ca theo kho, ghi nhận hàng bán và phương thức thanh toán; giá và thuế cuối cùng do máy chủ tính theo danh mục.</p></div><button className="btn btn-secondary" type="button" disabled={loading || busy} onClick={() => load()}>Làm mới</button></div>
    {error && <div className="alert danger" role="alert">{error}</div>}{notice && <div className="alert success" role="status">{notice}</div>}
    {loading ? <div className="card-pad"><div className="skeleton" data-h="row" /></div> : <>
      <section className="card pos-session-bar">
        <div className="pos-session-select"><label className="field"><span className="label">Ca đang mở</span><select className="select" value={sessionId} onChange={(event) => { setSessionId(event.target.value); setClosingCash(''); }}><option value="">Chưa chọn ca</option>{sessions.map((item) => <option key={item.id} value={item.id}>{branches.get(item.branch)?.name || 'Không gán chi nhánh'} · {warehouses.get(item.warehouse)?.name || 'Ca cũ chưa có kho'} · {item.cashier || 'Thu ngân'}</option>)}</select></label>
          {activeSession && <div className="small muted">Kho: {activeWarehouse?.name || 'Ca cũ chưa khai báo kho'} · Tiền đầu ca: {fmtMoney(activeSession.opening_cash || 0)}{activeSession.cashier ? ` · ${activeSession.cashier}` : ''}</div>}
        </div>
        {!sessions.length && <div className="small muted">Chưa có ca mở. Tạo ca mới để bắt đầu bán.</div>}
        <details className="pos-open-session"><summary>Mở ca mới</summary><form className="pos-session-form" onSubmit={startSession}>
          <label className="field"><span className="label">Kho bán hàng *</span><select className="select" required value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)}><option value="">Chọn kho</option>{[...warehouses.values()].filter((item) => item.active !== false).map((item) => <option key={item.id} value={item.id}>{recordLabel('inventory.warehouse', item)}</option>)}</select></label>
          <label className="field"><span className="label">Chi nhánh</span><select className="select" value={branchId} onChange={(event) => setBranchId(event.target.value)}><option value="">Không gán chi nhánh</option>{[...branches.values()].filter((item) => item.active !== false).map((item) => <option key={item.id} value={item.id}>{recordLabel('master-data.branch', item)}</option>)}</select></label>
          <label className="field"><span className="label">Tiền đầu ca</span><input className="input num" type="number" min="0" step="any" value={openingCash} onChange={(event) => setOpeningCash(event.target.value)} /></label>
          <button className="btn btn-primary" type="submit" disabled={busy || !can('pos.pos_session.create')}>{busy ? 'Đang mở…' : 'Mở ca'}</button>
        </form></details>
      </section>
      {!activeSession ? <div className="empty card-pad">Chọn một ca đang mở hoặc mở ca mới để sử dụng quầy.</div> : !activeSession.warehouse ? <div className="alert warning">Ca này được tạo trước khi bắt buộc chọn kho. Hãy chốt ca cũ và mở ca mới để tiếp tục bán.<form className="pos-close-form" onSubmit={closeSession}><label className="field"><span className="label">Tiền mặt thực đếm để chốt ca</span><input className="input num" type="number" min="0" step="any" required value={closingCash} onChange={(event) => setClosingCash(event.target.value)} /></label><button className="btn btn-secondary" type="submit" disabled={busy || !can('pos.pos_session.closed')}>Chốt ca cũ</button></form></div> : <div className="pos-layout">
        <section className="pos-products-panel"><div className="row wrap"><h2>Sản phẩm</h2><span className="grow" /><input className="input pos-search" type="search" placeholder="Tìm tên hoặc mã hàng" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
          <div className="pos-products">{filteredProducts.map((product) => <button className={`card pos-product${quantities[product.id] ? ' selected' : ''}`} key={product.id} type="button" disabled={!can('pos.pos_order.create')} onClick={() => setQty(product.id, (Number(quantities[product.id]) || 0) + 1)}><strong>{product.name}</strong><span className="small muted">{product.sku || 'Không mã'}</span><span className="num">{fmtMoney(displayPrice(product))}</span>{product.tracked !== false && <span className="small faint">Quản lý tồn kho</span>}</button>)}</div>
          {!filteredProducts.length && <div className="empty">Không có sản phẩm phù hợp.</div>}
        </section>
        <aside className="card pos-cart"><h2>Đơn hàng</h2>{cart.length ? <div className="pos-cart-lines">{cart.map(({ product, qty }) => <div className="pos-cart-line" key={product.id}><div><strong>{product.name}</strong><div className="small muted">{fmtMoney(displayPrice(product))} / sp</div></div><div className="pos-qty"><button className="btn btn-ghost btn-sm" type="button" aria-label={`Giảm ${product.name}`} onClick={() => setQty(product.id, qty - 1)}>−</button><input className="input num" type="number" min="0" step="any" aria-label={`Số lượng ${product.name}`} value={qty} onChange={(event) => setQty(product.id, event.target.value)} /><button className="btn btn-ghost btn-sm" type="button" aria-label={`Tăng ${product.name}`} onClick={() => setQty(product.id, qty + 1)}>+</button></div><strong className="num">{fmtMoney(displayPrice(product) * qty)}</strong></div>)}</div> : <div className="empty">Chọn sản phẩm để thêm vào đơn.</div>}
          <label className="field"><span className="label">Khách hàng (tùy chọn)</span><select className="select" value={partyId} onChange={(event) => setPartyId(event.target.value)}><option value="">Khách lẻ</option>{[...parties.values()].filter((item) => item.active !== false && item.is_customer !== false).map((item) => <option key={item.id} value={item.id}>{recordLabel('master-data.party', item)}</option>)}</select></label>
          <label className="field"><span className="label">Thanh toán</span><select className="select" value={method} onChange={(event) => setMethod(event.target.value)}><option value="cash">Tiền mặt</option><option value="card">Thẻ</option><option value="transfer">Chuyển khoản</option><option value="ewallet">Ví điện tử</option></select></label>
          <div className="pos-total"><span>Tạm tính</span><span>Tiền hàng <strong className="num">{fmtMoney(subtotal)}</strong></span><span>Thuế ước tính <strong className="num">{fmtMoney(estimatedTax)}</strong></span><strong className="num">{fmtMoney(total)}</strong><small>Thuế và số tiền chính thức do máy chủ tính theo danh mục khi tạo đơn.</small></div>
          <button className="btn btn-primary pos-checkout" type="button" disabled={busy || !cart.length || !can('pos.pos_order.create')} onClick={checkout}>{busy ? 'Đang xử lý…' : `Tạo đơn & thanh toán · ${fmtMoney(total)}`}</button>
          {sessionOrders.length > 0 && <section className="pos-pending"><h3>Đơn chờ xử lý ({sessionOrders.length})</h3>{sessionOrders.map((order) => <div className="pos-pending-item" key={order.id}><div><strong>{fmtMoney(order.total || 0)}</strong><div className="small muted">{fmtDateTime(order.created_at)} · {statusLabel(order.status)}</div></div><button className="btn btn-primary btn-sm" type="button" disabled={busy || !can('pos.pos_order.completed')} onClick={() => completeOrder(order)}>Hoàn tất</button><button className="btn btn-ghost btn-sm" type="button" disabled={busy || !can('pos.pos_order.delete')} onClick={() => removeOrder(order)}>Hủy</button></div>)}</section>}
          <details className="pos-cash-panel"><summary>Thu / chi quỹ tiền mặt</summary><form className="pos-cash-form" onSubmit={createCashMovement}>
            <label className="field"><span className="label">Loại giao dịch</span><select className="select" value={cashDirection} onChange={(event) => setCashDirection(event.target.value)}><option value="cash_out">Chi tiền</option><option value="cash_in">Nộp tiền vào quỹ</option></select></label>
            <label className="field"><span className="label">Số tiền</span><input className="input num" required type="number" min="0.01" step="any" value={cashAmount} onChange={(event) => setCashAmount(event.target.value)} /></label>
            <label className="field"><span className="label">Tài khoản đối ứng</span><select className="select" required value={cashAccount} onChange={(event) => setCashAccount(event.target.value)}><option value="">Chọn tài khoản</option>{[...accounts.values()].filter((item) => !['111', '112'].includes(String(item.code)) && item.active !== false).map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></label>
            <label className="field"><span className="label">Lý do</span><input className="input" required value={cashReason} onChange={(event) => setCashReason(event.target.value)} /></label>
            <button className="btn btn-secondary" type="submit" disabled={busy || !can('pos.cash_movement.create') || !can('pos.cash_movement.posted')}>Ghi nhận</button>
          </form>
            {cashMovements.filter((item) => item.session === sessionId).map((movement) => <div className="pos-pending-item" key={movement.id}><div><strong>{movement.direction === 'cash_in' ? 'Nộp quỹ' : 'Chi quỹ'} · {fmtMoney(movement.amount)}</strong><div className="small muted">{movement.reason}</div></div><button className="btn btn-primary btn-sm" type="button" disabled={busy || !can('pos.cash_movement.posted')} onClick={() => postCashMovement(movement)}>Ghi sổ</button><button className="btn btn-ghost btn-sm" type="button" disabled={busy || !can('pos.cash_movement.delete')} onClick={() => removeCashMovement(movement)}>Xóa</button></div>)}
          </details>
          <form className="pos-close-form" onSubmit={closeSession}><label className="field"><span className="label">Tiền mặt thực đếm khi chốt ca</span><input className="input num" type="number" min="0" step="any" required value={closingCash} onChange={(event) => setClosingCash(event.target.value)} /></label><button className="btn btn-secondary" type="submit" disabled={busy || cart.length > 0 || !can('pos.pos_session.closed')}>Chốt ca</button></form>{cart.length > 0 && <p className="small muted">Xóa các mặt hàng trong giỏ trước khi chốt ca.</p>}
        </aside>
      </div>}
    </>}
  </div>;
}
