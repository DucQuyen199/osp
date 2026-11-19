import { useCallback, useEffect, useState } from 'react';
import { api, dataPath, tenantPath } from '../../../lib/api.js';
import { absDecimal } from '../../../lib/decimal.js';
import { useLatestRequest } from '../../../lib/useLatestRequest.js';
import { app, can, loadAllResponse } from '../../../lib/state.js';

export const approvalTargets = [
  'purchasing.purchase_order', 'purchasing.supplier_invoice', 'purchasing.purchase_requisition',
  'payroll.payroll_run', 'inventory.stock_count', 'sales.sales_return', 'purchasing.purchase_return',
  'expense.expense_claim', 'hrm.leave_request', 'accounting.settlement_batch', 'accounting.journal_entry', 'contract.amendment',
  'consolidation.elimination_journal', 'manufacturing.conditional_acceptance',
];

export const blankApprovalRule = { name: '', entity: approvalTargets[0], min_amount: '', variance_tolerance: '', roles: [], users: [] };
const requestRows = (response) => Array.isArray(response?.items) ? response.items : [];
const decimalInput = (value) => String(value ?? '').trim().replace(/^([+-]?)\./, (_, sign) => `${sign}0.`);

export function ruleApprovers(value) {
  if (Array.isArray(value)) return {
    roles: value.filter((entry) => typeof entry === 'string' && app.meta?.roles?.[entry]),
    users: value.filter((entry) => typeof entry === 'string' && !app.meta?.roles?.[entry]),
  };
  if (!value || typeof value !== 'object') return { roles: [], users: [] };
  return {
    roles: Array.isArray(value.roles) ? value.roles.filter((entry) => typeof entry === 'string') : [],
    users: [...(Array.isArray(value.users) ? value.users : []), ...(Array.isArray(value.userIds) ? value.userIds : [])].filter((entry) => typeof entry === 'string'),
  };
}

export function useApprovalWorkbenchWorkflow({ t }) {
  const [requests, setRequests] = useState([]);
  const [rules, setRules] = useState([]);
  const [approverUsers, setApproverUsers] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [ruleForm, setRuleForm] = useState(blankApprovalRule);
  const [editingRuleId, setEditingRuleId] = useState('');
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const latestRequest = useLatestRequest();

  const load = useCallback(async (quiet = false) => {
    const isLatest = latestRequest();
    if (!quiet) { setLoading(true); setError(''); }
    try {
      const canListApprovers = [
        'workflow-approval.approval_rule.read',
        'workflow-approval.approval_rule.create',
        'workflow-approval.approval_rule.update',
      ].some((permission) => can(permission));
      const [requestRes, ruleRes, userRows] = await Promise.all([
        can('workflow-approval.approval_request.read') ? loadAllResponse('workflow-approval.approval_request') : Promise.resolve({ items: [] }),
        can('workflow-approval.approval_rule.read') ? loadAllResponse('workflow-approval.approval_rule') : Promise.resolve({ items: [] }),
        canListApprovers ? api(tenantPath('/approvals/approvers')) : Promise.resolve([]),
      ]);
      const nextRequests = requestRows(requestRes).sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));
      if (isLatest()) {
        setRequests(nextRequests);
        setRules(requestRows(ruleRes));
        setApproverUsers(Array.isArray(userRows) ? userRows : []);
        setSelectedId((id) => nextRequests.some((row) => row.id === id) ? id : nextRequests.find((row) => row.status === 'pending')?.id || nextRequests[0]?.id || '');
      }
    } catch (reason) {
      if (isLatest()) setError(reason.message || t('Không tải được hàng chờ phê duyệt.'));
    } finally { if (isLatest()) setLoading(false); }
  }, [latestRequest, t]);

  useEffect(() => { load(); }, [load]);

  async function run(key, operation, success) {
    setBusy(key); setError(''); setNotice('');
    try { await operation(); await load(true); if (success) setNotice(success); }
    catch (reason) { setError(reason.message || t('Thao tác không thành công.')); await load(true); }
    finally { setBusy(''); }
  }

  async function decide(request, action) {
    const message = action === 'approved'
      ? t('Đã duyệt; hồ sơ nghiệp vụ được chuyển trạng thái tự động.')
      : t('Đã từ chối; hồ sơ nghiệp vụ được cập nhật theo luồng từ chối.');
    await run(`${request.id}:${action}`, () => api(dataPath('workflow-approval.approval_request', request.id, action), { method: 'POST' }), message);
  }

  function editRule(rule) {
    const approvers = ruleApprovers(rule.approvers);
    setEditingRuleId(rule.id);
    setRuleForm({ name: rule.name || '', entity: rule.entity || approvalTargets[0], min_amount: rule.min_amount ?? '', variance_tolerance: rule.variance_tolerance ?? '', roles: approvers.roles, users: approvers.users });
  }
  function resetRule() { setEditingRuleId(''); setRuleForm(blankApprovalRule); }

  async function saveRule(event) {
    event.preventDefault();
    const payload = {
      name: ruleForm.name.trim(), entity: ruleForm.entity,
      min_amount: ruleForm.min_amount.trim() === '' ? null : decimalInput(ruleForm.min_amount),
      ...(ruleForm.entity === 'purchasing.supplier_invoice' && ruleForm.variance_tolerance.trim() !== '' ? { variance_tolerance: decimalInput(ruleForm.variance_tolerance) } : {}),
      approvers: { roles: ruleForm.roles, ...(ruleForm.users.length ? { users: ruleForm.users } : {}) },
    };
    const qname = 'workflow-approval.approval_rule';
    await run('rule:save', async () => {
      if (editingRuleId) await api(dataPath(qname, editingRuleId), { method: 'PATCH', body: payload });
      else await api(dataPath(qname), { method: 'POST', body: payload });
      resetRule();
    }, editingRuleId ? t('Đã cập nhật quy tắc phê duyệt.') : t('Đã tạo quy tắc phê duyệt.'));
  }

  return {
    requests, rules, approverUsers, selectedId, setSelectedId,
    ruleForm, setRuleForm, editingRuleId, busy, loading, error, notice,
    load, decide, editRule, resetRule, saveRule,
  };
}
