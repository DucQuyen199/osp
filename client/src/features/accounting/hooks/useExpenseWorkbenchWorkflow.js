import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, dataPath } from '../../../lib/api.js';
import { addDecimals, compareDecimals } from '../../../lib/decimal.js';
import { uiText } from '../../../lib/i18n.js';
import { can, loadAllResponse, loadRefs, app } from '../../../lib/state.js';
import { useLatestRequest } from '../../../lib/useLatestRequest.js';

const itemsOf = (response) => Array.isArray(response?.items) ? response.items : [];
const action = (entity, row, verb) => api(dataPath(entity, row.id, verb), { method: 'POST' });
const blankExpenseLine = (account_code = '') => ({ rowId: crypto.randomUUID(), description: '', amount: '', account_code });

export function useExpenseWorkbenchWorkflow() {
  const [claims, setClaims] = useState([]);
  const [employees, setEmployees] = useState(new Map());
  const [accounts, setAccounts] = useState([]);
  const [payments, setPayments] = useState([]);
  const [approvalRequests, setApprovalRequests] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [form, setForm] = useState({ employee: '', payment_date: '', payment_method: 'bank', note: '' });
  const [lines, setLines] = useState(() => [blankExpenseLine()]);
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const workflowApproval = app.meta?.modules?.some((module) => module.id === 'workflow-approval') || false;
  const latestRequest = useLatestRequest();

  const load = useCallback(async (quiet = false) => {
    const isLatest = latestRequest();
    if (!quiet) { setLoading(true); setError(''); }
    try {
      const [claimRes, employeeMap, accountMap, paymentRes, requestRes] = await Promise.all([
        can('expense.expense_claim.read') ? loadAllResponse('expense.expense_claim') : Promise.resolve({ items: [] }),
        can('hrm.employee.read') ? loadRefs('hrm.employee') : Promise.resolve(new Map()),
        can('accounting.account.read') ? loadRefs('accounting.account') : Promise.resolve(new Map()),
        can('accounting.payment.read') ? loadAllResponse('accounting.payment') : Promise.resolve({ items: [] }),
        workflowApproval && can('workflow-approval.approval_request.read') ? loadAllResponse('workflow-approval.approval_request') : Promise.resolve({ items: [] }),
      ]);
      const claimRows = itemsOf(claimRes).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
      const expenseAccounts = [...accountMap.values()].filter((row) => row.kind === 'expense').sort((a, b) => String(a.code || '').localeCompare(String(b.code || '')));
      if (isLatest()) {
        setClaims(claimRows); setEmployees(employeeMap); setAccounts(expenseAccounts); setPayments(itemsOf(paymentRes)); setApprovalRequests(itemsOf(requestRes));
        setSelectedId((id) => claimRows.some((row) => row.id === id) ? id : claimRows[0]?.id || '');
        setForm((current) => ({ ...current, employee: current.employee || [...employeeMap.values()].find((row) => row.status === 'active')?.id || '' }));
        setLines((current) => current.map((line) => ({ ...line, account_code: line.account_code || expenseAccounts[0]?.code || '' })));
      }
    } catch (reason) { if (isLatest()) setError(reason.message || uiText('Không tải được đề nghị chi phí.')); }
    finally { if (isLatest()) setLoading(false); }
  }, [workflowApproval, latestRequest]);

  useEffect(() => { void load(); }, [load]);

  const selected = claims.find((row) => row.id === selectedId);
  const stats = useMemo(() => ({
    draft: claims.filter((row) => ['draft', 'rejected'].includes(row.status)).length,
    pending: claims.filter((row) => row.status === 'submitted').length,
    approved: claims.filter((row) => row.status === 'approved').length,
    paid: claims.filter((row) => row.status === 'paid').length,
  }), [claims]);
  const total = addDecimals(lines.map((line) => line.amount || 0));

  async function run(key, operation, success) {
    setBusy(key); setError(''); setNotice('');
    try { await operation(); setNotice(success); await load(true); }
    catch (reason) { setError(reason.message || uiText('Thao tác không thành công.')); await load(true); }
    finally { setBusy(''); }
  }

  async function createClaim(event) {
    event.preventDefault();
    const claimItems = lines.filter((line) => line.account_code && compareDecimals(line.amount || 0, 0) > 0).map((line) => ({ description: line.description.trim() || undefined, amount: String(line.amount), account_code: line.account_code }));
    if (!claimItems.length) { setError(uiText('Thêm ít nhất một khoản chi hợp lệ.')); return; }
    await run('claim:create', async () => {
      const claim = await api(dataPath('expense.expense_claim'), { method: 'POST', body: { ...form, items: claimItems, note: form.note.trim() || undefined } });
      await action('expense.expense_claim', claim, 'submitted'); setSelectedId(claim.id);
      setForm((current) => ({ ...current, payment_date: '', note: '' })); setLines([blankExpenseLine(accounts[0]?.code || '')]);
    }, uiText('Đã gửi đề nghị chi. Tổng tiền được tính từ các khoản chi; tài khoản và nhân viên được kiểm tra trước khi phê duyệt.'));
  }

  async function claimAction(row, verb) {
        const messages = { submitted: 'Đã gửi lại đề nghị chi.', approved: 'Đã duyệt; kế toán đã ghi bút toán chi phí và công nợ nhân viên.', rejected: 'Đã từ chối đề nghị chi.', paid: 'Đã ghi nhận hoàn ứng/thanh toán và tạo payment kế toán.' };
    await run(`${row.id}:${verb}`, () => action('expense.expense_claim', row, verb), uiText(messages[verb]));
  }

  const requestFor = (row) => approvalRequests.find((request) => request.entity === 'expense.expense_claim' && request.record_id === row.id);
  const paymentFor = (row) => payments.find((payment) => payment.source === 'expense_claim' && payment.source_id === row.id);
  const updateLine = (index, field, value) => setLines((current) => current.map((line, i) => i === index ? { ...line, [field]: value } : line));
  const addLine = () => setLines((current) => [...current, blankExpenseLine(accounts[0]?.code || '')]);
  const removeLine = (index) => setLines((current) => current.filter((_, i) => i !== index));

  return {
    claims, employees, accounts, loading, error, notice, busy, selected, selectedId, setSelectedId,
    form, setForm, lines, addLine, removeLine, updateLine, total, stats, workflowApproval,
    load, createClaim, claimAction, requestFor, paymentFor,
  };
}
