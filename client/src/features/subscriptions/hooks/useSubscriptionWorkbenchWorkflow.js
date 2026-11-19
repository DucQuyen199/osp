import { useCallback, useEffect, useState } from 'react';
import { api, dataPath } from '../../../lib/api.js';
import { localDate } from '../../../lib/dates.js';
import { can, loadAllResponse, loadRefs } from '../../../lib/state.js';
import { useLatestRequest } from '../../../lib/useLatestRequest.js';

const today = localDate;
const itemsOf = (response) => Array.isArray(response?.items) ? response.items : [];
const transition = (entity, row, action) => api(dataPath(entity, row.id, action), { method: 'POST' });

export function useSubscriptionWorkbenchWorkflow({ t }) {
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
  const latestRequest = useLatestRequest();

  const load = useCallback(async (quiet = false) => {
    const isLatest = latestRequest();
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
      if (isLatest()) {
        setPlans(planRows);
        setSubscriptions(itemsOf(subscriptionRes));
        setCycles(itemsOf(cycleRes));
        setInvoices(itemsOf(invoiceRes));
        setParties(partyMap);
        setForm((current) => ({ ...current, party: current.party || [...partyMap.keys()][0] || '', plan: current.plan || planRows[0]?.id || '' }));
      }
    } catch (reason) {
      if (isLatest()) setError(t(reason.message || 'Không tải được hồ sơ thuê bao.'));
    } finally {
      if (isLatest()) setLoading(false);
    }
  }, [latestRequest, t]);

  useEffect(() => { void load(); }, [load]);

  async function run(key, operation, success) {
    setBusy(key); setError(''); setNotice('');
    try {
      await operation();
      setNotice(t(success));
      await load(true);
    } catch (reason) {
      setError(t(reason.message || 'Thao tác không thành công.'));
      await load(true);
    } finally { setBusy(''); }
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

  return { plans, subscriptions, cycles, invoices, parties, form, setForm, busy, loading, error, notice, load, createSubscription, changeStatus };
}
