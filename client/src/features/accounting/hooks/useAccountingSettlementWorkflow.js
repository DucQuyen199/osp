import { useEffect, useRef, useState } from 'react';
import { api, dataPath } from '../../../lib/api.js';
import { roundDecimal, compareDecimals } from '../../../lib/decimal.js';
import { uiText } from '../../../lib/i18n.js';

export function useAccountingSettlementWorkflow({
  load, setError, suggestedParty, suggestedCurrency, suggestedDate, suggestedReference,
  suggestedInvoice, suggestedAmount, today,
}) {
  const [form, setForm] = useState(() => ({
    direction: 'receipt', party: suggestedParty, currency: suggestedCurrency, method: 'bank',
    payment_date: suggestedDate || today(), reference: suggestedReference,
  }));
  const [allocations, setAllocations] = useState(() => suggestedInvoice && suggestedAmount ? { [suggestedInvoice]: suggestedAmount } : {});
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const active = useRef(false);
  const operation = useRef(0);

  useEffect(() => {
    active.current = true;
    return () => { active.current = false; operation.current += 1; };
  }, []);

  function changeForm(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
    if (['direction', 'party', 'currency'].includes(key)) setAllocations({});
    if (key === 'direction' || key === 'party') setForm((current) => ({ ...current, [key]: value, currency: '' }));
  }

  async function run(key, action, success) {
    const currentOperation = ++operation.current;
    setBusy(key); setError(''); setNotice('');
    try {
      await action();
      if (!active.current || operation.current !== currentOperation) return false;
      setNotice(success); await load();
      return true;
    } catch (reason) {
      if (active.current && operation.current === currentOperation) setError(reason.message || uiText('Không cập nhật được phiếu thu/chi.'));
      return false;
    } finally {
      if (active.current && operation.current === currentOperation) setBusy('');
    }
  }

  async function createDraft(event, { selectedCurrency, selectedAllocations, total }) {
    event.preventDefault();
    if (!form.party || !selectedCurrency || !selectedAllocations.length || compareDecimals(total, 0) <= 0) return;
    const allocationRows = selectedAllocations.map((doc) => ({ [form.direction === 'receipt' ? 'invoice' : 'bill']: doc.id, amount: roundDecimal(allocations[doc.id], 2) }));
    await run('create', async () => {
      await api(dataPath('accounting.settlement_batch'), { method: 'POST', body: { ...form, currency: selectedCurrency, amount: roundDecimal(total, 2), allocations: allocationRows } });
      if (active.current) setAllocations({});
    }, uiText('Đã lưu phiếu nháp. Gửi duyệt khi thông tin và phân bổ đã chính xác.'));
  }

  async function action(row, verb) {
    await run(`${row.id}:${verb}`, () => api(dataPath('accounting.settlement_batch', row.id, verb), { method: 'POST' }), uiText(verb === 'approved' ? 'Đã duyệt và ghi nhận các payment cùng bút toán tổng hợp.' : verb === 'submitted' ? 'Đã gửi phiếu đi duyệt.' : verb === 'rejected' ? 'Đã từ chối phiếu.' : 'Đã hủy phiếu.'));
  }

  return { form, setForm, allocations, setAllocations, busy, notice, changeForm, createDraft, action };
}
