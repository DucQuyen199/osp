import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { selectableTableRowProps } from '../../lib/accessibility.js';
import { api, dataPath } from '../../lib/api.js';
import { fmtDateTime, fmtMoney, statusLabel, uiText } from '../../lib/i18n.js';
import { app, can, loadAllResponse } from '../../lib/state.js';
import { recordHref } from '../../lib/routes.js';

const targets = [
  'purchasing.purchase_order', 'purchasing.supplier_invoice', 'purchasing.purchase_requisition',
  'payroll.payroll_run', 'inventory.stock_count', 'sales.sales_return', 'purchasing.purchase_return',
  'expense.expense_claim', 'hrm.leave_request', 'accounting.settlement_batch', 'contract.amendment',
];
const requestRows = (response) => Array.isArray(response?.items) ? response.items : [];
const blankRule = { name: '', entity: targets[0], min_amount: '', variance_tolerance: '', roles: [], users: [] };

function ruleApprovers(value) {
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

export default function ApprovalWorkbenchPage() {
  const [requests, setRequests] = useState([]);
  const [rules, setRules] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [requestFilter, setRequestFilter] = useState('pending');
  const [tab, setTab] = useState('inbox');
  const [ruleForm, setRuleForm] = useState(blankRule);
  const [editingRuleId, setEditingRuleId] = useState('');
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async (quiet = false) => {
    if (!quiet) { setLoading(true); setError(''); }
    try {
      const [requestRes, ruleRes] = await Promise.all([
        can('workflow-approval.approval_request.read') ? loadAllResponse('workflow-approval.approval_request') : Promise.resolve({ items: [] }),
        can('workflow-approval.approval_rule.read') ? loadAllResponse('workflow-approval.approval_rule') : Promise.resolve({ items: [] }),
      ]);
      const requestRowsSorted = requestRows(requestRes).sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));
      setRequests(requestRowsSorted); setRules(requestRows(ruleRes));
      setSelectedId((id) => requestRowsSorted.some((row) => row.id === id) ? id : requestRowsSorted.find((row) => row.status === 'pending')?.id || requestRowsSorted[0]?.id || '');
    } catch (reason) { setError(reason.message || uiText('Không tải được hàng chờ phê duyệt.')); }
    finally { if (!quiet) setLoading(false); }
  }, []);

  useEffect(() => { document.title = `${uiText('Phê duyệt tập trung')} · OSP Suite`; load(); }, [load]);

  const visibleRequests = useMemo(() => requests.filter((row) => requestFilter === 'all' || row.status === requestFilter), [requests, requestFilter]);
  const selected = visibleRequests.find((row) => row.id === selectedId) || requests.find((row) => row.id === selectedId);
  const pendingCount = requests.filter((row) => row.status === 'pending').length;
  const applicableRule = selected ? rules
    .filter((rule) => rule.entity === selected.entity && (rule.min_amount == null || Number(rule.min_amount) <= Math.abs(Number(selected.amount || 0))))
    .sort((a, b) => Number(b.min_amount ?? -1) - Number(a.min_amount ?? -1))[0] : null;
  const selectedApprovers = applicableRule ? ruleApprovers(applicableRule.approvers) : { roles: [], users: [] };
  const roleNames = Object.keys(app.meta?.roles || {}).sort((a, b) => a.localeCompare(b, 'vi'));
  const canManageRules = can('workflow-approval.approval_rule.create') || can('workflow-approval.approval_rule.update');

  useEffect(() => {
    if (!visibleRequests.some((row) => row.id === selectedId)) setSelectedId(visibleRequests[0]?.id || '');
  }, [visibleRequests, selectedId]);

  async function run(key, operation, success) {
    setBusy(key); setError(''); setNotice('');
    try { await operation(); await load(true); if (success) setNotice(success); }
    catch (reason) { setError(reason.message || uiText('Thao tác không thành công.')); await load(true); }
    finally { setBusy(''); }
  }

  async function decide(request, action) {
    const message = action === 'approved' ? uiText('Đã duyệt; hồ sơ nghiệp vụ được chuyển trạng thái tự động.') : uiText('Đã từ chối; hồ sơ nghiệp vụ được cập nhật theo luồng từ chối.');
    await run(`${request.id}:${action}`, () => api(dataPath('workflow-approval.approval_request', request.id, action), { method: 'POST' }), message);
  }

  function editRule(rule) {
    const approvers = ruleApprovers(rule.approvers);
    setEditingRuleId(rule.id);
    setRuleForm({ name: rule.name || '', entity: rule.entity || targets[0], min_amount: rule.min_amount ?? '', variance_tolerance: rule.variance_tolerance ?? '', roles: approvers.roles, users: approvers.users });
    setTab('rules');
  }

  function resetRule() { setEditingRuleId(''); setRuleForm(blankRule); }

  async function saveRule(event) {
    event.preventDefault();
    const payload = {
      name: ruleForm.name.trim(), entity: ruleForm.entity,
      min_amount: ruleForm.min_amount === '' ? null : Number(ruleForm.min_amount),
      ...(ruleForm.entity === 'purchasing.supplier_invoice' && ruleForm.variance_tolerance !== '' ? { variance_tolerance: Number(ruleForm.variance_tolerance) } : {}),
      approvers: { roles: ruleForm.roles, ...(ruleForm.users.length ? { users: ruleForm.users } : {}) },
    };
    const qname = 'workflow-approval.approval_rule';
    await run('rule:save', async () => {
      if (editingRuleId) await api(dataPath(qname, editingRuleId), { method: 'PATCH', body: payload });
      else await api(dataPath(qname), { method: 'POST', body: payload });
      resetRule();
    }, editingRuleId ? uiText('Đã cập nhật quy tắc phê duyệt.') : uiText('Đã tạo quy tắc phê duyệt.'));
  }

  const sourceLabel = (entity) => app.meta?.modules?.flatMap((module) => module.entities.map((record) => [`${module.id}.${record.name}`, record.label]))
    .find(([qname]) => qname === entity)?.[1] || entity;

  return <div className="page">
    <div className="page-head"><div><h1>{uiText("Phê duyệt tập trung")}</h1><p className="sub">{uiText("Xử lý yêu cầu từ mua hàng, tài chính, nhân sự, kho và hợp đồng; quy tắc vai trò được kiểm tra lại ở máy chủ.")}</p></div><button className="btn btn-secondary" type="button" disabled={loading || Boolean(busy)} onClick={() => load()}>{uiText("Làm mới")}</button></div>
    {error && <div className="alert danger" role="alert">{error}</div>}{notice && <div className="alert success" role="status">{notice}</div>}
    <div className="stats" style={{ marginBottom: 16 }}><div className="card stat"><span className="stat-label">{uiText("Đang chờ xử lý")}</span><strong className="stat-value">{pendingCount}</strong></div><div className="card stat"><span className="stat-label">{uiText("Đã duyệt")}</span><strong className="stat-value">{requests.filter((row) => row.status === 'approved').length}</strong></div><div className="card stat"><span className="stat-label">{uiText("Đã từ chối")}</span><strong className="stat-value">{requests.filter((row) => row.status === 'rejected').length}</strong></div><div className="card stat"><span className="stat-label">{uiText("Quy tắc đang áp dụng")}</span><strong className="stat-value">{rules.length}</strong></div></div>
    <section className="card card-pad">
      <div className="tabs" role="tablist" aria-label={uiText('Phê duyệt và quy tắc')}><button className="tab" type="button" role="tab" aria-selected={tab === 'inbox'} onClick={() => setTab('inbox')}>{uiText('Hàng chờ')} ({pendingCount})</button><button className="tab" type="button" role="tab" aria-selected={tab === 'rules'} onClick={() => setTab('rules')}>{uiText("Quy tắc phê duyệt")}</button></div>
      {tab === 'inbox' && <div style={{ marginTop: 12 }}>
        <div className="row wrap"><h2>{uiText("Yêu cầu phê duyệt")}</h2><span className="grow"/><label className="field"><span className="label">{uiText("Lọc trạng thái")}</span><select className="select" value={requestFilter} onChange={(event) => setRequestFilter(event.target.value)}><option value="pending">{uiText("Đang chờ")}</option><option value="approved">{uiText("Đã duyệt")}</option><option value="rejected">{uiText("Đã từ chối")}</option><option value="cancelled">{uiText("Đã hủy")}</option><option value="all">{uiText("Tất cả")}</option></select></label></div>
        {!can('workflow-approval.approval_request.read') ? <div className="empty">{uiText("Bạn chưa có quyền xem yêu cầu phê duyệt.")}</div> : loading ? <div className="skeleton" data-h="row"/> : !visibleRequests.length ? <div className="empty">{uiText("Không có yêu cầu ở trạng thái này.")}</div> : <div className="layout-split" style={{ marginTop: 10 }}>
          <section className="table-wrap"><table className="table"><thead><tr><th>{uiText("Hồ sơ")}</th><th>{uiText("Số tiền")}</th><th>{uiText("Trạng thái")}</th></tr></thead><tbody>{visibleRequests.map((request) => <tr {...selectableTableRowProps} key={request.id} aria-selected={selectedId === request.id} className={selectedId === request.id ? 'selected' : ''} onClick={() => setSelectedId(request.id)} style={{ cursor: 'pointer' }}><td><strong>{request.subject}</strong><div className="small muted">{uiText(sourceLabel(request.entity))} · {String(request.record_id || '').slice(0, 8)}</div></td><td>{request.amount != null ? fmtMoney(request.amount) : '—'}</td><td><span className={`badge ${request.status === 'pending' ? 'warning' : request.status === 'approved' ? 'success' : 'plain'}`}>{statusLabel(request.status)}</span></td></tr>)}</tbody></table></section>
          {selected && <section className="card card-pad"><div className="row wrap"><div><h3>{selected.subject}</h3><div className="small muted">{uiText(sourceLabel(selected.entity))} · {uiText('gửi lúc')} {fmtDateTime(selected.createdAt)}</div></div><span className="grow"/><span className="badge warning">{statusLabel(selected.status)}</span></div><dl style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(12rem, 1fr))', gap: 'var(--sp-4)', marginTop: 12 }}><div><dt className="label">{uiText("Hồ sơ nguồn")}</dt><dd style={{ margin: 0, overflowWrap: 'anywhere' }}><a href={recordHref(selected.entity, selected.record_id)}>{uiText('Mở hồ sơ')} {String(selected.record_id || '').slice(0, 8)}</a></dd></div><div><dt className="label">{uiText("Giá trị đề nghị")}</dt><dd style={{ margin: 0 }}>{selected.amount != null ? fmtMoney(selected.amount) : uiText('Không áp dụng')}</dd></div><div><dt className="label">{uiText("Người yêu cầu")}</dt><dd style={{ margin: 0, overflowWrap: 'anywhere' }}>{selected.requested_by || selected.requested_by_user || uiText('Hệ thống')}</dd></div><div><dt className="label">{uiText("Người/nhóm có quyền duyệt")}</dt><dd style={{ margin: 0, overflowWrap: 'anywhere' }}>{[...selectedApprovers.roles.map((role) => app.meta?.roles?.[role]?.name || role), ...selectedApprovers.users.map((user) => `${uiText('Tài khoản')} ${user.slice(0, 8)}`)].join(', ') || uiText('Theo quyền cơ bản của vai trò')}</dd></div></dl><div className="row wrap" style={{ marginTop: 16 }}>{selected.status === 'pending' && can('workflow-approval.approval_request.approved') && <button className="btn btn-primary" disabled={Boolean(busy)} onClick={() => decide(selected, 'approved')}>{uiText("Duyệt hồ sơ")}</button>}{selected.status === 'pending' && can('workflow-approval.approval_request.rejected') && <button className="btn btn-secondary" disabled={Boolean(busy)} onClick={() => decide(selected, 'rejected')}>{uiText("Từ chối")}</button>}</div><p className="small muted" style={{ marginTop: 12 }}>{uiText("Quyết định sẽ được ghi nhật ký; khi duyệt hoặc từ chối, trạng thái hồ sơ nguồn được chuyển trong cùng quy trình xử lý.")}</p></section>}
        </div>}
      </div>}
      {tab === 'rules' && <div style={{ marginTop: 12 }}><div className="row wrap"><div><h2>{uiText("Quy tắc theo giá trị và vai trò")}</h2><p className="small muted">{uiText("Quy tắc có ngưỡng cao nhất phù hợp sẽ xác định người được duyệt. Có thể khai báo nhiều ngưỡng cho cùng loại hồ sơ.")}</p></div><span className="grow"/></div>
        {(can('workflow-approval.approval_rule.read') || canManageRules) && <>{!rules.length ? <div className="empty">{uiText("Chưa có quy tắc; quyền duyệt sẽ theo các quyền cơ bản của vai trò.")}</div> : <div className="table-wrap" style={{ marginTop: 10 }}><table className="table"><thead><tr><th>{uiText("Tên quy tắc")}</th><th>{uiText("Loại hồ sơ")}</th><th>{uiText("Ngưỡng từ")}</th><th>{uiText("Vai trò duyệt")}</th><th/></tr></thead><tbody>{rules.map((rule) => { const approvers = ruleApprovers(rule.approvers); return <tr key={rule.id}><td><strong>{rule.name}</strong>{rule.variance_tolerance != null && <div className="small muted">{uiText('Dung sai hóa đơn')} {fmtMoney(rule.variance_tolerance)}</div>}</td><td>{uiText(sourceLabel(rule.entity))}</td><td>{rule.min_amount == null ? uiText('Mọi giá trị') : fmtMoney(rule.min_amount)}</td><td>{approvers.roles.map((role) => app.meta?.roles?.[role]?.name || role).join(', ') || `${approvers.users.length} ${uiText('tài khoản')}`}</td><td>{can('workflow-approval.approval_rule.update') && <button className="btn btn-secondary btn-sm" type="button" onClick={() => editRule(rule)}>{uiText("Sửa")}</button>}</td></tr>; })}</tbody></table></div>}</>}
        {!can('workflow-approval.approval_rule.read') && !canManageRules && <div className="empty">{uiText("Bạn chưa có quyền xem hoặc cấu hình quy tắc.")}</div>}
        {canManageRules && <form className="form-grid" style={{ marginTop: 16 }} onSubmit={saveRule}><h3 className="full">{editingRuleId ? uiText('Sửa quy tắc phê duyệt') : uiText('Tạo quy tắc phê duyệt')}</h3><label className="field"><span className="label">{uiText("Tên quy tắc *")}</span><input className="input" required maxLength="160" value={ruleForm.name} onChange={(event) => setRuleForm((form) => ({ ...form, name: event.target.value }))}/></label><label className="field"><span className="label">{uiText("Loại hồ sơ *")}</span><select className="select" value={ruleForm.entity} onChange={(event) => setRuleForm((form) => ({ ...form, entity: event.target.value, variance_tolerance: event.target.value === 'purchasing.supplier_invoice' ? form.variance_tolerance : '' }))}>{targets.map((entity) => <option key={entity} value={entity}>{sourceLabel(entity)}</option>)}</select></label><label className="field"><span className="label">{uiText("Ngưỡng tối thiểu")}</span><input className="input" type="number" min="0" step="any" value={ruleForm.min_amount} onChange={(event) => setRuleForm((form) => ({ ...form, min_amount: event.target.value }))}/><span className="small muted">{uiText("Để trống để áp dụng cho mọi giá trị.")}</span></label>{ruleForm.entity === 'purchasing.supplier_invoice' && <label className="field"><span className="label">{uiText("Dung sai chênh lệch giá")}</span><input className="input" type="number" min="0" step="any" value={ruleForm.variance_tolerance} onChange={(event) => setRuleForm((form) => ({ ...form, variance_tolerance: event.target.value }))}/></label>}<fieldset className="field full"><legend className="label">{uiText("Vai trò có thể duyệt *")}</legend>{!roleNames.length ? <span className="small muted">{uiText("Tenant chưa có vai trò để phân quyền.")}</span> : <div className="row wrap">{roleNames.map((role) => <label className="check" key={role}><input type="checkbox" checked={ruleForm.roles.includes(role)} onChange={(event) => setRuleForm((form) => ({ ...form, roles: event.target.checked ? [...form.roles, role] : form.roles.filter((item) => item !== role) }))}/><span>{app.meta?.roles?.[role]?.name || role}</span></label>)}</div>}</fieldset><div className="row full"><span className="grow"/>{editingRuleId && <button className="btn btn-ghost" type="button" onClick={resetRule}>{uiText("Hủy sửa")}</button>}<button className="btn btn-primary" disabled={Boolean(busy) || !ruleForm.roles.length || (editingRuleId ? !can('workflow-approval.approval_rule.update') : !can('workflow-approval.approval_rule.create'))}>{editingRuleId ? uiText('Lưu quy tắc') : uiText('Tạo quy tắc')}</button></div></form>}
      </div>}
    </section>
  </div>;
}
