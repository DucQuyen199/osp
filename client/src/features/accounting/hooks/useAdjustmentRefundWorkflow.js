import { useEffect, useRef, useState } from 'react';
import { api, session, tenantPath } from '../../../lib/api.js';
import { localDate } from '../../../lib/dates.js';
import { compareDecimals } from '../../../lib/decimal.js';
import { uiText } from '../../../lib/i18n.js';
import { can } from '../../../lib/state.js';

const today = localDate;
const storageKey = `osp.adjustment-refund-requests:${session.current()?.tenantId || 'tenant'}`;
const readRequests = () => {
  try { return JSON.parse(sessionStorage.getItem(storageKey) || '{}'); }
  catch { return {}; }
};

export function useAdjustmentRefundWorkflow({ rows, load, setError }) {
  const [selected, setSelected] = useState('');
  const [form, setForm] = useState({ amount: '', method: 'bank', paymentDate: today() });
  const [requestIds, setRequestIds] = useState(readRequests);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const mounted = useRef(false);
  const active = rows.find((row) => row.id === selected);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  function selectForRefund(row) {
    setSelected(row.id);
    setForm((current) => ({ ...current, amount: row.refundable }));
    setNotice('');
  }

  async function submit(event) {
    event.preventDefault();
    if (busy || !can('accounting.payment.create') || !active
      || compareDecimals(form.amount || 0, 0) <= 0
      || compareDecimals(form.amount, active.refundable) > 0) return;

    const row = active;
    setBusy(true);
    setError('');
    setNotice('');
    const requestId = requestIds[row.id] || crypto.randomUUID();
    const pendingRequests = { ...requestIds, [row.id]: requestId };
    setRequestIds(pendingRequests);
    try { sessionStorage.setItem(storageKey, JSON.stringify(pendingRequests)); }
    catch { /* still safe for retries within this session */ }

    try {
      const payment = await api(tenantPath('/accounting/adjustment-refunds'), {
        method: 'POST',
        body: {
          kind: row.kind,
          adjustmentId: row.id,
          amount: String(form.amount),
          method: form.method,
          paymentDate: form.paymentDate,
          requestId,
        },
      });
      if (!mounted.current) return;
      setNotice(uiText('ÄÃ£ ghi nháº­n payment hoÃ n tiá»n{payment} vÃ  táº¡o bÃºt toÃ¡n káº¿ toÃ¡n.')
        .replace('{payment}', payment?.id ? ` ${String(payment.id).slice(0, 8)}` : ''));
      setRequestIds((current) => {
        const next = { ...current };
        delete next[row.id];
        try { sessionStorage.setItem(storageKey, JSON.stringify(next)); }
        catch { /* optional retry storage */ }
        return next;
      });
      setForm((current) => ({ ...current, amount: '' }));
      await load();
    } catch (reason) {
      if (mounted.current) setError(reason.message || uiText('KhÃ´ng táº¡o Ä‘Æ°á»£c payment hoÃ n tiá»n. CÃ³ thá»ƒ gá»­i láº¡i an toÃ n.'));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  return {
    selected, setSelected, active, form, setForm, busy, notice,
    selectForRefund, submit,
  };
}
