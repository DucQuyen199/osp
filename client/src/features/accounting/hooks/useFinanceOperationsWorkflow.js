import { useEffect, useState } from 'react';
import { addCalendarMonths, localDate } from '../../../lib/dates.js';
import { api, dataPath } from '../../../lib/api.js';
import { statusLabel, uiText } from '../../../lib/i18n.js';

const today = localDate;
const defaultFirstDueDate = () => addCalendarMonths(today(), 1);
const action = async (entity, row, next) => api(dataPath(entity, row.id, next), { method: 'POST' });

export function useFinanceOperationsWorkflow({ parties, load }) {
  const [repaymentMethods, setRepaymentMethods] = useState({});
  const [loanForm, setLoanForm] = useState({ party: '', principal: '', rate: '', term_months: '12', first_due_date: defaultFirstDueDate(), method: 'bank' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    setLoanForm((current) => ({ ...current, party: current.party || [...parties.keys()][0] || '' }));
  }, [parties]);

  async function run(operation, fallback) {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await operation();
      if (typeof result === 'string') setNotice(result);
      await load();
    } catch (reason) {
      setError(reason.message || fallback);
    } finally {
      setBusy(false);
    }
  }
  async function createLoan(event) {
    event.preventDefault();
    await run(async () => {
      await api(dataPath('lending.loan'), { method: 'POST', body: { ...loanForm, principal: String(loanForm.principal), rate: String(loanForm.rate), term_months: Number(loanForm.term_months), status: 'applied' } });
      setLoanForm((current) => ({ ...current, principal: '', rate: '' }));
      setNotice(uiText('Đã tiếp nhận hồ sơ vay ở trạng thái chờ thẩm định.'));
    }, uiText('Không thể tiếp nhận hồ sơ vay.'));
  }
  async function loanAction(loan, next) {
    await run(async () => {
      await action('lending.loan', loan, next);
      setNotice(next === 'disbursed' ? uiText('Đã giải ngân; hệ thống tạo lịch trả nợ và bút toán giải ngân.') : `${uiText('Đã cập nhật khoản vay')}: ${statusLabel(next)}.`);
    }, uiText('Không thể cập nhật khoản vay.'));
  }
  async function repaymentAction(row, next) {
    await run(async () => {
      const method = repaymentMethods[row.id] || row.method;
      if (next === 'paid' && !['cash', 'bank'].includes(method)) throw new Error(uiText('Chọn phương thức thu tiền trước khi ghi nhận thanh toán.'));
      if (next === 'paid' && row.method !== method) await api(dataPath('lending.repayment', row.id), { method: 'PATCH', body: { method } });
      await action('lending.repayment', row, next);
      setNotice(next === 'paid' ? uiText('Đã ghi nhận thu kỳ trả nợ và hạch toán.') : uiText('Đã chuyển kỳ trả nợ sang quá hạn.'));
    }, uiText('Không thể cập nhật kỳ trả nợ.'));
  }
  const refresh = () => { setError(''); load(); };

  return {
    today, busy, error, notice, refresh,
    repaymentMethods, setRepaymentMethods, loanForm, setLoanForm,
    createLoan, loanAction, repaymentAction, run,
  };
}
