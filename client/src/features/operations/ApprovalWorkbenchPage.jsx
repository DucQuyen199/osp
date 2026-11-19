import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useDocumentTitle } from '../../lib/useDocumentTitle.js';
import { selectableTableRowProps } from '../../lib/accessibility.js';
import { fmtDateTime, fmtMoney, statusLabel, uiTextWith } from '../../lib/i18n.js';
import { absDecimal, compareDecimals } from '../../lib/decimal.js';
import { app, can } from '../../lib/state.js';
import { recordHref } from '../../lib/routes.js';
import approvalEnglish from './approvals.en.js';
import ApprovalApproverPicker from './components/ApprovalApproverPicker.jsx';
import { approvalTargets, ruleApprovers, useApprovalWorkbenchWorkflow } from './hooks/useApprovalWorkbenchWorkflow.js';
const t = (text) => uiTextWith(text, approvalEnglish);
export default function ApprovalWorkbenchPage() {
  useDocumentTitle(`${t('Phê duyệt tập trung')} · OSP Suite`);
  const workflow = useApprovalWorkbenchWorkflow({ t });
  const {
    requests, rules, approverUsers, selectedId, setSelectedId,
    ruleForm, setRuleForm, editingRuleId, busy, loading, error, notice,
    load, decide, editRule, resetRule, saveRule,
  } = workflow;
  const [requestFilter, setRequestFilter] = useState('pending');
  const [tab, setTab] = useState('inbox');
  const tabBaseId = useId();
  const tabRefs = useRef([]);
  const tabValues = ['inbox', 'rules'];
  const handleTabKeyDown = (event) => {
    const currentIndex = tabValues.indexOf(event.currentTarget.dataset.tab);
    let nextIndex;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabValues.length;
    else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabValues.length) % tabValues.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = tabValues.length - 1;
    else return;
    event.preventDefault();
    setTab(tabValues[nextIndex]);
    tabRefs.current[nextIndex]?.focus();
  };
  const visibleRequests = useMemo(() => requests.filter((row) => requestFilter === 'all' || row.status === requestFilter), [requests, requestFilter]);
  const selected = visibleRequests.find((row) => row.id === selectedId) || requests.find((row) => row.id === selectedId);
  const pendingCount = requests.filter((row) => row.status === 'pending').length;
  const applicableRule = selected ? rules
    .filter((rule) => rule.entity === selected.entity && (rule.min_amount == null || compareDecimals(rule.min_amount, absDecimal(selected.amount || 0)) <= 0))
    .sort((a, b) => compareDecimals(b.min_amount ?? '-1', a.min_amount ?? '-1'))[0] : null;
  const selectedApprovers = applicableRule ? ruleApprovers(applicableRule.approvers) : { roles: [], users: [] };
  const usersById = useMemo(() => new Map(approverUsers.map((user) => [user.id, user])), [approverUsers]);
  const approverName = (id) => usersById.get(id)?.name || `${t('Tài khoản')} ${String(id).slice(0, 8)}`;
  const roleNames = Object.keys(app.meta?.roles || {}).sort((a, b) => a.localeCompare(b, 'vi'));
  const canManageRules = can('workflow-approval.approval_rule.create') || can('workflow-approval.approval_rule.update');
  useEffect(() => {
    if (!visibleRequests.some((row) => row.id === selectedId)) setSelectedId(visibleRequests[0]?.id || '');
  }, [visibleRequests, selectedId]);
  const beginEditRule = (rule) => { editRule(rule); setTab('rules'); };
  const sourceLabel = (entity) => app.meta?.modules?.flatMap((module) => module.entities.map((record) => [`${module.id}.${record.name}`, record.label]))
    .find(([qname]) => qname === entity)?.[1] || entity;
  return <div className="page">
    <div className="page-head"><div><h1>{t("Phê duyệt tập trung")}</h1><p className="sub">{t("Xử lý yêu cầu từ mua hàng, tài chính, nhân sự, kho và hợp đồng; quy tắc vai trò được kiểm tra lại ở máy chủ.")}</p></div><button className="btn btn-secondary" type="button" disabled={loading || Boolean(busy)} onClick={() => load()}>{t("Làm mới")}</button></div>
    {error && <div className="alert danger" role="alert">{t(error)}</div>}{notice && <div className="alert success" role="status">{t(notice)}</div>}
    <div className="stats u-mb-16" ><div className="card stat"><span className="stat-label">{t("Đang chờ xử lý")}</span><strong className="stat-value">{pendingCount}</strong></div><div className="card stat"><span className="stat-label">{t("Đã duyệt")}</span><strong className="stat-value">{requests.filter((row) => row.status === 'approved').length}</strong></div><div className="card stat"><span className="stat-label">{t("Đã từ chối")}</span><strong className="stat-value">{requests.filter((row) => row.status === 'rejected').length}</strong></div><div className="card stat"><span className="stat-label">{t("Quy tắc đang áp dụng")}</span><strong className="stat-value">{rules.length}</strong></div></div>
    <section className="card card-pad">
      <div className="tabs" role="tablist" aria-label={t('Phê duyệt và quy tắc')}>
        <button ref={(node) => { tabRefs.current[0] = node; }} id={`${tabBaseId}-inbox-tab`} className="tab" type="button" role="tab" data-tab="inbox" aria-selected={tab === 'inbox'} aria-controls={`${tabBaseId}-inbox-panel`} tabIndex={tab === 'inbox' ? 0 : -1} onKeyDown={handleTabKeyDown} onClick={() => setTab('inbox')}>{t('Hàng chờ')} ({pendingCount})</button>
        <button ref={(node) => { tabRefs.current[1] = node; }} id={`${tabBaseId}-rules-tab`} className="tab" type="button" role="tab" data-tab="rules" aria-selected={tab === 'rules'} aria-controls={`${tabBaseId}-rules-panel`} tabIndex={tab === 'rules' ? 0 : -1} onKeyDown={handleTabKeyDown} onClick={() => setTab('rules')}>{t("Quy tắc phê duyệt")}</button>
      </div>
      <div id={`${tabBaseId}-${tab}-panel`} role="tabpanel" aria-labelledby={`${tabBaseId}-${tab}-tab`} tabIndex={0}>
      {tab === 'inbox' && <div className="u-mt-12">
        <div className="row wrap"><h2>{t("Yêu cầu phê duyệt")}</h2><span className="grow"/><label className="field"><span className="label">{t("Lọc trạng thái")}</span><select className="select" value={requestFilter} onChange={(event) => setRequestFilter(event.target.value)}><option value="pending">{t("Đang chờ")}</option><option value="approved">{t("Đã duyệt")}</option><option value="rejected">{t("Đã từ chối")}</option><option value="cancelled">{t("Đã hủy")}</option><option value="all">{t("Tất cả")}</option></select></label></div>
        {!can('workflow-approval.approval_request.read') ? <div className="empty">{t("Bạn chưa có quyền xem yêu cầu phê duyệt.")}</div> : loading ? <div className="skeleton" data-h="row"/> : !visibleRequests.length ? <div className="empty">{t("Không có yêu cầu ở trạng thái này.")}</div> : <div className="layout-split u-mt-10" >
          <section className="table-wrap"><table className="table"><thead><tr><th>{t("Hồ sơ")}</th><th>{t("Số tiền")}</th><th>{t("Trạng thái")}</th></tr></thead><tbody>{visibleRequests.map((request) => <tr {...selectableTableRowProps} key={request.id} aria-selected={selectedId === request.id} className={[selectedId === request.id ? 'selected' : '', 'u-pointer'].filter(Boolean).join(' ')} onClick={() => setSelectedId(request.id)} ><td><strong>{request.subject}</strong><div className="small muted">{t(sourceLabel(request.entity))} · {String(request.record_id || '').slice(0, 8)}</div></td><td>{request.amount != null ? fmtMoney(request.amount) : '—'}</td><td><span className={`badge ${request.status === 'pending' ? 'warning' : request.status === 'approved' ? 'success' : 'plain'}`}>{statusLabel(request.status)}</span></td></tr>)}</tbody></table></section>
          {selected && <section className="card card-pad"><div className="row wrap"><div><h3>{selected.subject}</h3><div className="small muted">{t(sourceLabel(selected.entity))} · {t('gửi lúc')} {fmtDateTime(selected.createdAt)}</div></div><span className="grow"/><span className={`badge ${selected.status === 'pending' ? 'warning' : selected.status === 'approved' ? 'success' : 'plain'}`}>{statusLabel(selected.status)}</span></div><dl className="u-auto-grid"><div><dt className="label">{t("Hồ sơ nguồn")}</dt><dd className="u-m-0-break-words"><a href={recordHref(selected.entity, selected.record_id)}>{t('Mở hồ sơ')} {String(selected.record_id || '').slice(0, 8)}</a></dd></div><div><dt className="label">{t("Giá trị đề nghị")}</dt><dd className="u-m-0">{selected.amount != null ? fmtMoney(selected.amount) : t('Không áp dụng')}</dd></div><div><dt className="label">{t("Người yêu cầu")}</dt><dd className="u-m-0-break-words">{selected.requested_by || selected.requested_by_user || t('Hệ thống')}</dd></div><div><dt className="label">{t("Người/nhóm có quyền duyệt")}</dt><dd className="u-m-0-break-words">{[...selectedApprovers.roles.map((role) => app.meta?.roles?.[role]?.name || role), ...selectedApprovers.users.map(approverName)].join(', ') || t('Theo quyền cơ bản của vai trò')}</dd></div></dl><div className="row wrap u-mt-16" >{selected.status === 'pending' && can('workflow-approval.approval_request.approved') && <button className="btn btn-primary" disabled={Boolean(busy)} onClick={() => decide(selected, 'approved')}>{t("Duyệt hồ sơ")}</button>}{selected.status === 'pending' && can('workflow-approval.approval_request.rejected') && <button className="btn btn-secondary" disabled={Boolean(busy)} onClick={() => decide(selected, 'rejected')}>{t("Từ chối")}</button>}</div><p className="small muted u-mt-12" >{t("Quyết định sẽ được ghi nhật ký; khi duyệt hoặc từ chối, trạng thái hồ sơ nguồn được chuyển trong cùng quy trình xử lý.")}</p></section>}
        </div>}
      </div>}
      </div>
      {tab === 'rules' && <div className="u-mt-12"><div className="row wrap"><div><h2>{t("Quy tắc theo giá trị và vai trò")}</h2><p className="small muted">{t("Quy tắc có ngưỡng cao nhất phù hợp sẽ xác định người được duyệt. Có thể khai báo nhiều ngưỡng cho cùng loại hồ sơ.")}</p></div><span className="grow"/></div>
        {(can('workflow-approval.approval_rule.read') || canManageRules) && <>{!rules.length ? <div className="empty">{t("Chưa có quy tắc; quyền duyệt sẽ theo các quyền cơ bản của vai trò.")}</div> : <div className="table-wrap u-mt-10" ><table className="table"><thead><tr><th>{t("Tên quy tắc")}</th><th>{t("Loại hồ sơ")}</th><th>{t("Ngưỡng từ")}</th><th>{t("Người phê duyệt")}</th><th/></tr></thead><tbody>{rules.map((rule) => { const approvers = ruleApprovers(rule.approvers); return <tr key={rule.id}><td><strong>{rule.name}</strong>{rule.variance_tolerance != null && <div className="small muted">{t('Dung sai hóa đơn')} {fmtMoney(rule.variance_tolerance)}</div>}</td><td>{t(sourceLabel(rule.entity))}</td><td>{rule.min_amount == null ? t('Mọi giá trị') : fmtMoney(rule.min_amount)}</td><td>{[...approvers.roles.map((role) => app.meta?.roles?.[role]?.name || role), ...approvers.users.map(approverName)].join(', ')}</td><td>{can('workflow-approval.approval_rule.update') && <button className="btn btn-secondary btn-sm" type="button" onClick={() => beginEditRule(rule)}>{t("Sửa")}</button>}</td></tr>; })}</tbody></table></div>}</>}
        {!can('workflow-approval.approval_rule.read') && !canManageRules && <div className="empty">{t("Bạn chưa có quyền xem hoặc cấu hình quy tắc.")}</div>}
        {canManageRules && <form className="form-grid u-mt-16"  onSubmit={saveRule}><h3 className="full">{editingRuleId ? t('Sửa quy tắc phê duyệt') : t('Tạo quy tắc phê duyệt')}</h3><label className="field"><span className="label">{t("Tên quy tắc *")}</span><input className="input" required maxLength="160" value={ruleForm.name} onChange={(event) => setRuleForm((form) => ({ ...form, name: event.target.value }))}/></label><label className="field"><span className="label">{t("Loại hồ sơ *")}</span><select className="select" value={ruleForm.entity} onChange={(event) => setRuleForm((form) => ({ ...form, entity: event.target.value, variance_tolerance: event.target.value === 'purchasing.supplier_invoice' ? form.variance_tolerance : '' }))}>{approvalTargets.map((entity) => <option key={entity} value={entity}>{sourceLabel(entity)}</option>)}</select></label><label className="field"><span className="label">{t("Ngưỡng tối thiểu")}</span><input className="input" type="number" min="0" step="any" value={ruleForm.min_amount} onChange={(event) => setRuleForm((form) => ({ ...form, min_amount: event.target.value }))}/><span className="small muted">{t("Để trống để áp dụng cho mọi giá trị.")}</span></label>{ruleForm.entity === 'purchasing.supplier_invoice' && <label className="field"><span className="label">{t("Dung sai chênh lệch giá")}</span><input className="input" type="number" min="0" step="any" value={ruleForm.variance_tolerance} onChange={(event) => setRuleForm((form) => ({ ...form, variance_tolerance: event.target.value }))}/></label>}<ApprovalApproverPicker roles={roleNames.map((role) => [role, app.meta?.roles?.[role]])} selectedRoles={ruleForm.roles} users={approverUsers} selectedUsers={ruleForm.users} onRolesChange={(roles) => setRuleForm((form) => ({ ...form, roles }))} onUsersChange={(users) => setRuleForm((form) => ({ ...form, users }))} /><div className="row full"><span className="grow"/>{editingRuleId && <button className="btn btn-ghost" type="button" onClick={resetRule}>{t("Hủy sửa")}</button>}<button className="btn btn-primary" disabled={Boolean(busy) || (!ruleForm.roles.length && !ruleForm.users.some((id) => usersById.get(id) && !usersById.get(id).disabled)) || (editingRuleId ? !can('workflow-approval.approval_rule.update') : !can('workflow-approval.approval_rule.create'))}>{editingRuleId ? t('Lưu quy tắc') : t('Tạo quy tắc')}</button></div></form>}
      </div>}
    </section>
  </div>;
}
