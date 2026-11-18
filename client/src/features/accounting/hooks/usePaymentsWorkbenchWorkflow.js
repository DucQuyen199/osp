import { useEffect, useState } from 'react';
import { api, dataPath } from '../../../lib/api.js';
import { textDialog } from '../../../lib/feedback.js';
import { uiText } from '../../../lib/i18n.js';
import { compareDecimals } from '../../../lib/decimal.js';

const emptyRefundForm = () => ({ payment_txn: '', amount: '', reference: '' });

export function usePaymentsWorkbenchWorkflow({ parties, load, setError }) {
  const [form, setForm] = useState({ provider: 'bank', method: 'transfer', party: '', amount: '', invoice: '', bill: '', reference: '' });
  const [refundForm, setRefundForm] = useState(emptyRefundForm);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    setForm((current) => ({ ...current, party: current.party && parties.has(current.party) ? current.party : [...parties.keys()][0] || '' }));
  }, [parties]);

  async function run(key, operation, message) {
    setBusy(key); setError(''); setNotice('');
    try { await operation(); await load(true); setNotice(message); }
    catch (reason) { setError(reason.message || uiText('Thao tÃ¡c khÃ´ng thÃ nh cÃ´ng.')); }
    finally { setBusy(''); }
  }

  async function createTransaction(event) {
    event.preventDefault();
    if (compareDecimals(form.amount || 0, 0) <= 0 || !form.party || Boolean(form.invoice) === Boolean(form.bill)) {
      setError(uiText('Chá»n Ä‘Ãºng má»™t hÃ³a Ä‘Æ¡n bÃ¡n hoáº·c hÃ³a Ä‘Æ¡n mua vÃ  nháº­p sá»‘ tiá»n há»£p lá»‡.'));
      return;
    }
    const payload = {
      provider: form.provider, method: form.method, party: form.party, amount: String(form.amount),
      ...(form.invoice ? { invoice: form.invoice } : { bill: form.bill }),
      ...(form.reference.trim() ? { reference: form.reference.trim() } : {}),
    };
    await run('transaction:create', async () => {
      await api(dataPath('payments.payment_txn'), { method: 'POST', body: payload });
      setForm((current) => ({ ...current, amount: '', reference: '', invoice: '', bill: '' }));
    }, uiText('ÄÃ£ táº¡o giao dá»‹ch chá» káº¿t quáº£ nhÃ  cung cáº¥p.'));
  }

  async function recordOutcome(transaction, action) {
    const reference = await textDialog({
      title: uiText(action === 'succeeded' ? 'Ghi nháº­n thanh toÃ¡n thÃ nh cÃ´ng' : 'Ghi nháº­n giao dá»‹ch tháº¥t báº¡i'),
      message: '',
      label: uiText(action === 'succeeded' ? 'MÃ£ giao dá»‹ch nhÃ  cung cáº¥p tráº£ vá»' : 'MÃ£ tham chiáº¿u (náº¿u Ä‘Ã£ cÃ³)'),
      initialValue: transaction.reference || '', minLength: 0, maxLength: 500, confirmLabel: uiText('LÆ°u'),
    });
    if (reference === null) return;
    await run(`${transaction.id}:${action}`, async () => {
      const normalizedReference = reference.trim();
      const changed = normalizedReference !== (transaction.reference || '');
      await api(dataPath('payments.payment_txn', transaction.id, action), {
        method: 'POST', ...(changed ? { body: { reference: normalizedReference } } : {}),
      });
    }, uiText(action === 'succeeded' ? 'ÄÃ£ ghi nháº­n thanh toÃ¡n thÃ nh cÃ´ng vÃ  cáº­p nháº­t cÃ´ng ná»£.' : 'ÄÃ£ ghi nháº­n giao dá»‹ch tháº¥t báº¡i.'));
  }

  async function createRefund(event) {
    event.preventDefault();
    if (!refundForm.payment_txn || compareDecimals(refundForm.amount || 0, 0) <= 0) return;
    await run('refund:create', async () => {
      await api(dataPath('payments.payment_refund'), {
        method: 'POST',
        body: {
          payment_txn: refundForm.payment_txn,
          amount: String(refundForm.amount),
          ...(refundForm.reference.trim() ? { reference: refundForm.reference.trim() } : {}),
        },
      });
      setRefundForm(emptyRefundForm());
    }, uiText('ÄÃ£ táº¡o há»“ sÆ¡ hoÃ n tiá»n chá» xá»­ lÃ½.'));
  }

  async function recordRefund(refund, action) {
    const reference = await textDialog({
      title: uiText(action === 'succeeded' ? 'Ghi nháº­n hoÃ n tiá»n thÃ nh cÃ´ng' : 'Ghi nháº­n hoÃ n tiá»n tháº¥t báº¡i'),
      message: '',
      label: uiText(action === 'succeeded' ? 'MÃ£ hoÃ n tiá»n nhÃ  cung cáº¥p tráº£ vá»' : 'Ghi chÃº hoáº·c mÃ£ tham chiáº¿u (náº¿u cÃ³)'),
      initialValue: refund.reference || '', minLength: 0, maxLength: 500, confirmLabel: uiText('LÆ°u'),
    });
    if (reference === null) return;
    await run(`${refund.id}:${action}`, async () => {
      const normalizedReference = reference.trim();
      const changed = normalizedReference !== (refund.reference || '');
      await api(dataPath('payments.payment_refund', refund.id, action), {
        method: 'POST', ...(changed ? { body: { reference: normalizedReference } } : {}),
      });
    }, uiText(action === 'succeeded' ? 'ÄÃ£ ghi nháº­n hoÃ n tiá»n; sá»• káº¿ toÃ¡n Ä‘Æ°á»£c cáº­p nháº­t.' : 'ÄÃ£ ghi nháº­n hoÃ n tiá»n tháº¥t báº¡i.'));
  }

  return { form, setForm, refundForm, setRefundForm, busy, notice, createTransaction, recordOutcome, createRefund, recordRefund };
}
