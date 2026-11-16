import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { localDate } from '../../lib/dates.js';
import { api, dataPath } from '../../lib/api.js';
import { fmtDate, fmtMoney, statusLabel } from '../../lib/i18n.js';
import { can, loadRefs, recordLabel, loadAllResponse } from '../../lib/state.js';

const today = localDate;
const itemsOf = (response) => Array.isArray(response?.items) ? response.items : [];
const transition = (entity, row, action) => api(dataPath(entity, row.id, action), { method: 'POST' });
const normalizedMonthly = (plan) => {
  const price = Number(plan?.price || 0);
  if (plan?.interval === 'quarterly') return price / 3;
  if (plan?.interval === 'yearly') return price / 12;
  return price;
};

export default function SubscriptionWorkbenchPage() {
  const [plans, setPlans] = useState([]);
  const [subscriptions, setSubscriptions] = useState([]);
  const [cycles, setCycles] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [parties, setParties] = useState(new Map());
  const [form, setForm] = useState({ party: '', plan: '', start: today() });
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async (quiet = false) => {
    if (!quiet) { setLoading(true); setError(''); }
    try {
      const [planRes, subscriptionRes, cycleRes, invoiceRes, partyMap] = await Promise.all([
        can('subscription.plan.read') ? loadAllResponse('subscription.plan') : Promise.resolve({ items: [] }),
        can('subscription.subscription.read') ? loadAllResponse('subscription.subscription') : Promise.resolve({ items: [] }),
        can('subscription.billing_cycle.read') ? loadAllResponse('subscription.billing_cycle') : Promise.resolve({ items: [] }),
        can('accounting.invoice.read') ? loadAllResponse('accounting.invoice') : Promise.resolve({ items: [] }),
        can('master-data.party.read') ? loadRefs('master-data.party') : Promise.resolve(new Map()),
      ]);
      const planRows = itemsOf(planRes);
      setPlans(planRows); setSubscriptions(itemsOf(subscriptionRes)); setCycles(itemsOf(cycleRes)); setInvoices(itemsOf(invoiceRes)); setParties(partyMap);
      setForm((current) => ({ ...current, party: current.party || [...partyMap.keys()][0] || '', plan: current.plan || planRows[0]?.id || '' }));
    } catch (reason) { setError(reason.message || 'Không tải được hồ sơ thuê bao.'); }
    finally { if (!quiet) setLoading(false); }
  }, []);

  useEffect(() => { document.title = 'Quản lý thuê bao và gia hạn · OSP Suite'; load(); }, [load]);
  const planById = useMemo(() => new Map(plans.map((row) => [row.id, row])), [plans]);
  const invoiceByCycle = useMemo(() => new Map(invoices.filter((row) => row.source === 'subscription').map((row) => [row.source_id, row])), [invoices]);
  const cycleBySubscription = useMemo(() => {
    const map = new Map();
    for (const row of cycles) map.set(row.subscription, [...(map.get(row.subscription) || []), row]);
    for (const rows of map.values()) rows.sort((a, b) => String(b.due_date || '').localeCompare(String(a.due_date || '')));
    return map;
  }, [cycles]);
  const activeSubscriptions = subscriptions.filter((row) => row.status === 'active');
  const mrr = activeSubscriptions.reduce((sum, row) => sum + normalizedMonthly(planById.get(row.plan)), 0);
  const annualRecurring = mrr * 12;
  const overdue = cycles.filter((cycle) => cycle.status === 'due' && cycle.due_date < today()).length;

  async function run(key, operation, success) {
    setBusy(key); setError(''); setNotice('');
    try { await operation(); setNotice(success); await load(true); }
    catch (reason) { setError(reason.message || 'Thao tác không thành công.'); await load(true); }
    finally { setBusy(''); }
  }

  async function createSubscription(event) {
    event.preventDefault();
    await run('create', () => api(dataPath('subscription.subscription'), { method: 'POST', body: { ...form, status: 'active' } }), 'Đã kích hoạt thuê bao. Hệ thống tự tạo kỳ thu đầu tiên theo ngày bắt đầu và giá gói.');
  }

  async function changeStatus(row, action) {
    const messages = {
      paused: 'Đã tạm dừng; các kỳ chưa đến hạn được hủy.',
      resumed: 'Đã tiếp tục thuê bao; kỳ tiếp theo được lên lịch lại.',
      cancelled: 'Đã hủy thuê bao; các kỳ chưa đến hạn được hủy.',
    };
    await run(`${row.id}:${action}`, () => transition('subscription.subscription', row, action), messages[action]);
  }

  return <div className="page">
    <div className="page-head"><div><h1>Thuê bao và gia hạn</h1><p className="sub">Theo dõi gói dịch vụ, doanh thu định kỳ, hóa đơn đến hạn và trạng thái khách hàng.</p></div><button className="btn btn-secondary" type="button" disabled={loading || Boolean(busy)} onClick={() => load()}>Làm mới</button></div>
    {error && <div className="alert danger" role="alert">{error}</div>}{notice && <div className="alert success" role="status">{notice}</div>}
    <div className="stats" style={{ marginBottom: 16 }}><div className="card stat"><span className="stat-label">Thuê bao đang hoạt động</span><strong className="stat-value">{activeSubscriptions.length}</strong></div><div className="card stat"><span className="stat-label">MRR quy đổi</span><strong className="stat-value">{fmtMoney(mrr)}</strong></div><div className="card stat"><span className="stat-label">ARR quy đổi</span><strong className="stat-value">{fmtMoney(annualRecurring)}</strong></div><div className="card stat"><span className="stat-label">Hóa đơn quá hạn</span><strong className="stat-value">{overdue}</strong></div></div>
    {can('subscription.subscription.create') && <section className="card card-pad"><div className="row wrap"><h2>Kích hoạt thuê bao mới</h2><span className="grow"/>{can('subscription.plan.create') && <a className="btn btn-secondary btn-sm" href="#/e/subscription/plan">Quản lý gói dịch vụ</a>}</div><form className="form-grid" onSubmit={createSubscription}>
      <label className="field"><span className="label">Khách hàng *</span><select className="select" required value={form.party} onChange={(e) => setForm({ ...form, party: e.target.value })}><option value="">Chọn khách hàng</option>{[...parties.values()].map((party) => <option key={party.id} value={party.id}>{recordLabel('master-data.party', party)}</option>)}</select></label>
      <label className="field"><span className="label">Gói dịch vụ *</span><select className="select" required value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value })}><option value="">Chọn gói</option>{plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name} · {fmtMoney(plan.price || 0)} / {({ monthly: 'tháng', quarterly: 'quý', yearly: 'năm' })[plan.interval] || plan.interval}</option>)}</select></label>
      <label className="field"><span className="label">Bắt đầu tính cước *</span><input className="input" required type="date" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })}/></label>
      <div className="row full"><span className="grow"/><button className="btn btn-primary" disabled={Boolean(busy) || !plans.length || !parties.size}>Kích hoạt và lên lịch kỳ thu</button></div>
    </form>{!plans.length && <p className="small muted">Chưa có gói dịch vụ. Người có quyền quản lý gói cần tạo gói trước khi tiếp nhận khách hàng.</p>}</section>}

    {loading ? <div className="skeleton" data-h="row" /> : <div className="layout-split" style={{ marginTop: 16 }}>
      <section className="card card-pad"><h2>Danh sách thuê bao</h2>{!subscriptions.length ? <p className="empty">Chưa có thuê bao.</p> : <div className="table-wrap"><table className="table"><thead><tr><th>Khách hàng / gói</th><th>Bắt đầu</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>{subscriptions.map((row) => <tr key={row.id}><td><strong>{parties.has(row.party) ? recordLabel('master-data.party', parties.get(row.party)) : 'Khách hàng'}</strong><div className="small muted">{planById.get(row.plan)?.name || 'Gói dịch vụ'} · {fmtMoney(planById.get(row.plan)?.price || 0)} / {({ monthly: 'tháng', quarterly: 'quý', yearly: 'năm' })[planById.get(row.plan)?.interval] || ''}</div></td><td>{fmtDate(row.start)}</td><td><span className="badge warning">{statusLabel(row.status)}</span></td><td>{row.status === 'active' && can('subscription.subscription.paused') && <button className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => changeStatus(row, 'paused')}>Tạm dừng</button>}{row.status === 'paused' && can('subscription.subscription.resumed') && <button className="btn btn-primary btn-sm" disabled={Boolean(busy)} onClick={() => changeStatus(row, 'resumed')}>Tiếp tục</button>}{['active','paused'].includes(row.status) && can('subscription.subscription.cancelled') && <button className="btn btn-ghost btn-sm" style={{ marginLeft: 6 }} disabled={Boolean(busy)} onClick={() => changeStatus(row, 'cancelled')}>Hủy thuê bao</button>}</td></tr>)}</tbody></table></div>}</section>
      <section className="card card-pad"><h2>Kỳ thu và hóa đơn</h2>{!cycles.length ? <p className="empty">Kỳ thu đầu tiên được tạo khi kích hoạt thuê bao có giá gói lớn hơn 0.</p> : <div className="table-wrap"><table className="table"><thead><tr><th>Khách hàng</th><th>Đến hạn</th><th>Số tiền đã chụp</th><th>Trạng thái / hóa đơn</th></tr></thead><tbody>{[...cycles].sort((a,b) => String(a.due_date || '').localeCompare(String(b.due_date || ''))).map((row) => <tr key={row.id}><td>{parties.has(row.party) ? recordLabel('master-data.party', parties.get(row.party)) : 'Khách hàng'}<div className="small muted">{planById.get(subscriptions.find((item) => item.id === row.subscription)?.plan)?.name || 'Thuê bao'}</div></td><td>{fmtDate(row.due_date)}</td><td>{fmtMoney(row.amount)}</td><td><span className="badge warning">{statusLabel(row.status)}</span>{invoiceByCycle.has(row.id) && <a className="btn btn-ghost btn-sm" style={{ marginLeft: 6 }} href={`#/e/accounting/invoice/${invoiceByCycle.get(row.id).id}`}>{statusLabel(invoiceByCycle.get(row.id).status)} · mở hóa đơn</a>}{row.status === 'pending' && row.due_date <= today() && <span className="small muted" style={{ marginLeft: 6 }}>Hệ thống sẽ phát hành hóa đơn đến hạn.</span>}</td></tr>)}</tbody></table></div>}
        <p className="small muted" style={{ marginTop: 12 }}>Thanh toán được ghi nhận trên hóa đơn kế toán. Khi hóa đơn được thanh toán, hệ thống tự chốt kỳ thu và lên lịch kỳ tiếp theo; không ghi nhận thanh toán thủ công trên thuê bao.</p>
      </section>
    </div>}
  </div>;
}
