import React, { useMemo } from 'react';
import { useDocumentTitle } from '../../lib/useDocumentTitle.js';
import { localDate } from '../../lib/dates.js';
import { fmtDate, fmtMoney, statusLabel, uiTextWith } from '../../lib/i18n.js';
import { can, recordLabel } from '../../lib/state.js';
import { addDecimals, divideDecimals, multiplyDecimals } from '../../lib/decimal.js';
import subscriptionEnglish from './subscription.en.js';
import SubscriptionBillingCyclesTable from './components/SubscriptionBillingCyclesTable.jsx';
import { useSubscriptionWorkbenchWorkflow } from './hooks/useSubscriptionWorkbenchWorkflow.js';
const t = (text) => uiTextWith(text, subscriptionEnglish);
const today = localDate;
const normalizedMonthly = (plan) => {
  const price = String(plan?.price || 0);
  if (plan?.interval === 'quarterly') return divideDecimals(price, '3', 28);
  if (plan?.interval === 'yearly') return divideDecimals(price, '12', 28);
  return price;
};
export default function SubscriptionWorkbenchPage() {
  useDocumentTitle(`${t('Quản lý thuê bao và gia hạn')} · OSP Suite`);
  const { plans, subscriptions, cycles, invoices, parties, form, setForm, busy, loading, error, notice,
    load, createSubscription, changeStatus } = useSubscriptionWorkbenchWorkflow({ t });
  const planById = useMemo(() => new Map(plans.map((row) => [row.id, row])), [plans]);
  const invoiceByCycle = useMemo(() => new Map(invoices.filter((row) => row.source === 'subscription').map((row) => [row.source_id, row])), [invoices]);
  const billingCycles = useMemo(() => [...cycles].sort((a, b) => String(a.due_date || '').localeCompare(String(b.due_date || ''))), [cycles]);
  const isInvoiceDue = (row) => row.status === 'pending' && row.due_date <= today();
  const cycleBySubscription = useMemo(() => {
    const map = new Map();
    for (const row of cycles) map.set(row.subscription, [...(map.get(row.subscription) || []), row]);
    for (const rows of map.values()) rows.sort((a, b) => String(b.due_date || '').localeCompare(String(a.due_date || '')));
    return map;
  }, [cycles]);
  const activeSubscriptions = subscriptions.filter((row) => row.status === 'active');
  const mrr = addDecimals(activeSubscriptions.map((row) => normalizedMonthly(planById.get(row.plan))));
  const annualRecurring = multiplyDecimals([mrr, '12']);
  const overdue = cycles.filter((cycle) => cycle.status === 'due' && cycle.due_date < today()).length;
  return <div className="page">
    <div className="page-head"><div><h1>{t('Thuê bao và gia hạn')}</h1><p className="sub">{t('Theo dõi gói dịch vụ, doanh thu định kỳ, hóa đơn đến hạn và trạng thái khách hàng.')}</p></div><button className="btn btn-secondary" type="button" disabled={loading || Boolean(busy)} onClick={() => load()}>{t('Làm mới')}</button></div>
    {error && <div className="alert danger" role="alert">{t(error)}</div>}{notice && <div className="alert success" role="status">{t(notice)}</div>}
    <div className="stats u-mb-16" ><div className="card stat"><span className="stat-label">{t('Thuê bao đang hoạt động')}</span><strong className="stat-value">{activeSubscriptions.length}</strong></div><div className="card stat"><span className="stat-label">{t('MRR quy đổi')}</span><strong className="stat-value">{fmtMoney(mrr)}</strong></div><div className="card stat"><span className="stat-label">{t('ARR quy đổi')}</span><strong className="stat-value">{fmtMoney(annualRecurring)}</strong></div><div className="card stat"><span className="stat-label">{t('Hóa đơn quá hạn')}</span><strong className="stat-value">{overdue}</strong></div></div>
    {can('subscription.subscription.create') && <section className="card card-pad"><div className="row wrap"><h2>{t('Kích hoạt thuê bao mới')}</h2><span className="grow"/>{can('subscription.plan.create') && <a className="btn btn-secondary btn-sm" href="#/e/subscription/plan">{t('Quản lý gói dịch vụ')}</a>}</div><form className="form-grid" onSubmit={createSubscription}>
      <label className="field"><span className="label">{t('Khách hàng *')}</span><select className="select" required value={form.party} onChange={(e) => setForm({ ...form, party: e.target.value })}><option value="">{t('Chọn khách hàng')}</option>{[...parties.values()].map((party) => <option key={party.id} value={party.id}>{recordLabel('master-data.party', party)}</option>)}</select></label>
      <label className="field"><span className="label">{t('Gói dịch vụ *')}</span><select className="select" required value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value })}><option value="">{t('Chọn gói')}</option>{plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name} · {fmtMoney(plan.price || 0)} / {({ monthly: t('tháng'), quarterly: t('quý'), yearly: t('năm') })[plan.interval] || plan.interval}</option>)}</select></label>
      <label className="field"><span className="label">{t('Bắt đầu tính cước *')}</span><input className="input" required type="date" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })}/></label>
      <div className="row full"><span className="grow"/><button className="btn btn-primary" disabled={Boolean(busy) || !plans.length || !parties.size}>{t('Kích hoạt và lên lịch kỳ thu')}</button></div>
    </form>{!plans.length && <p className="small muted">{t('Chưa có gói dịch vụ. Người có quyền quản lý gói cần tạo gói trước khi tiếp nhận khách hàng.')}</p>}</section>}
    {loading ? <div className="skeleton" data-h="row" /> : <div className="layout-split u-mt-16" >
      <section className="card card-pad"><h2>{t('Danh sách thuê bao')}</h2>{!subscriptions.length ? <p className="empty">{t('Chưa có thuê bao.')}</p> : <div className="table-wrap"><table className="table"><thead><tr><th>{t('Khách hàng / gói')}</th><th>{t('Bắt đầu')}</th><th>{t('Trạng thái')}</th><th>{t('Thao tác')}</th></tr></thead><tbody>{subscriptions.map((row) => <tr key={row.id}><td><strong>{parties.has(row.party) ? recordLabel('master-data.party', parties.get(row.party)) : t('Khách hàng')}</strong><div className="small muted">{planById.get(row.plan)?.name || t('Gói dịch vụ')} · {fmtMoney(planById.get(row.plan)?.price || 0)} / {({ monthly: t('tháng'), quarterly: t('quý'), yearly: t('năm') })[planById.get(row.plan)?.interval] || ''}</div></td><td>{fmtDate(row.start)}</td><td><span className="badge warning">{statusLabel(row.status)}</span></td><td>{row.status === 'active' && can('subscription.subscription.paused') && <button className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => changeStatus(row, 'paused')}>{t('Tạm dừng')}</button>}{row.status === 'paused' && can('subscription.subscription.resumed') && <button className="btn btn-primary btn-sm" disabled={Boolean(busy)} onClick={() => changeStatus(row, 'resumed')}>{t('Tiếp tục')}</button>}{['active','paused'].includes(row.status) && can('subscription.subscription.cancelled') && <button className="btn btn-ghost btn-sm u-ml-6"  disabled={Boolean(busy)} onClick={() => changeStatus(row, 'cancelled')}>{t('Hủy thuê bao')}</button>}</td></tr>)}</tbody></table></div>}</section>
      <SubscriptionBillingCyclesTable cycles={billingCycles} parties={parties} subscriptions={subscriptions} planById={planById} invoiceByCycle={invoiceByCycle} fmtDate={fmtDate} fmtMoney={fmtMoney} statusLabel={statusLabel} recordLabel={recordLabel} isInvoiceDue={isInvoiceDue} t={t} />
    </div>}
  </div>;
}
