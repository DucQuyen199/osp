import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useDocumentTitle } from '../../lib/useDocumentTitle.js';
import { useLatestRequest } from '../../lib/useLatestRequest.js';
import { addCalendarDays, localDate } from '../../lib/dates.js';
import { fmtDate, fmtDateTime, fmtMoney, statusLabel, uiTextWith } from '../../lib/i18n.js';
import { app, can, loadAllResponse, loadRefs, recordLabel } from '../../lib/state.js';
import { recordHref } from '../../lib/routes.js';
import contractEnglish from './contracts.en.js';
import ContractDraftForm from './components/ContractDraftForm.jsx';
import ContractRegisterTable from './components/ContractRegisterTable.jsx';
import { useContractWorkflow } from './hooks/useContractWorkflow.js';
const t = (text) => uiTextWith(text, contractEnglish);
const rows = (response) => Array.isArray(response?.items) ? response.items : [];
const endingSoon = (contract) => {
  const today = localDate();
  if (contract.status !== 'active' || !contract.end_date || contract.end_date < today) return false;
  return contract.end_date <= addCalendarDays(today, 90);
};
export default function ContractWorkbenchPage() {
  useDocumentTitle(`${t('Sổ hợp đồng')} · OSP Suite`);
  const [contracts, setContracts] = useState([]);
  const [clauses, setClauses] = useState([]);
  const [amendments, setAmendments] = useState([]);
  const [approvalRequests, setApprovalRequests] = useState([]);
  const [parties, setParties] = useState(new Map());
  const [selectedId, setSelectedId] = useState('');
  const [contractFilter, setContractFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const workflowEnabled = app.meta?.modules?.some((module) => module.id === 'workflow-approval') || false;
  const latestRequest = useLatestRequest();
  const load = useCallback(async (quiet = false) => {
    const isLatest = latestRequest();
    if (!quiet) { setLoading(true); setError(''); }
    try {
      const [contractRes, clauseRes, amendmentRes, partyMap, approvalRes] = await Promise.all([
        can('contract.contract.read') ? loadAllResponse('contract.contract') : Promise.resolve({ items: [] }),
        can('contract.clause.read') ? loadAllResponse('contract.clause') : Promise.resolve({ items: [] }),
        can('contract.amendment.read') ? loadAllResponse('contract.amendment') : Promise.resolve({ items: [] }),
        can('master-data.party.read') ? loadRefs('master-data.party') : Promise.resolve(new Map()),
        workflowEnabled && can('workflow-approval.approval_request.read') ? loadAllResponse('workflow-approval.approval_request') : Promise.resolve({ items: [] }),
      ]);
      const contractRows = rows(contractRes).sort((a, b) => String(a.end_date || '9999-12-31').localeCompare(String(b.end_date || '9999-12-31')) || String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
      if (isLatest()) {
        setContracts(contractRows); setClauses(rows(clauseRes)); setAmendments(rows(amendmentRes)); setParties(partyMap); setApprovalRequests(rows(approvalRes));
        setSelectedId((id) => contractRows.some((row) => row.id === id) ? id : contractRows[0]?.id || '');
      }
    } catch (reason) { if (isLatest()) setError(reason.message || t("Không tải được sổ hợp đồng.")); }
    finally { if (isLatest()) setLoading(false); }
  }, [workflowEnabled, latestRequest]);
  useEffect(() => { load(); }, [load]);
  const selected = contracts.find((row) => row.id === selectedId);
  const workflow = useContractWorkflow({ selected, selectedId, setSelectedId, parties, load, workflowEnabled, setError, t });
  const {
    contractForm, setContractForm, draftEdit, setDraftEdit, clauseForm, setClauseForm,
    amendmentForm, setAmendmentForm, busy, notice, createContract, updateDraft,
    addClause, createAmendment, amendmentAction, contractAction, confirmTermination,
  } = workflow;
  const selectedClauses = useMemo(() => clauses.filter((row) => row.contract === selectedId).sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'vi')), [clauses, selectedId]);
  const selectedAmendments = useMemo(() => amendments.filter((row) => row.contract === selectedId).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))), [amendments, selectedId]);
  const visibleContracts = contracts.filter((row) => contractFilter === 'all' || (contractFilter === 'ending' ? endingSoon(row) : row.status === contractFilter));
  const expiring = contracts.filter(endingSoon).length;
  const activeCount = contracts.filter((row) => row.status === 'active').length;
  const pendingCount = amendments.filter((row) => ['submitted', 'approved'].includes(row.status)).length;
  useEffect(() => {
    if (!visibleContracts.some((row) => row.id === selectedId)) setSelectedId(visibleContracts[0]?.id || '');
  }, [visibleContracts, selectedId]);
  function partyName(partyId) {
    const party = parties.get(partyId);
    return party ? recordLabel('master-data.party', party) : (partyId ? `#${String(partyId).slice(0, 8)}` : t("Chưa chọn đối tác"));
  }
  function approvalFor(row) { return approvalRequests.find((request) => request.entity === 'contract.amendment' && request.record_id === row.id); }
  function sourceLink(row) {
    if (row.source === 'real_estate_lease' && row.source_id) return <a href={recordHref('real-estate.lease', row.source_id)}>{t('Hồ sơ thuê')} {String(row.source_id).slice(0, 8)}</a>;
    return null;
  }
  return <div className="page">
    <div className="page-head"><div><h1>{t("Sổ hợp đồng")}</h1><p className="sub">{t("Quản lý đối tác, thời hạn và giá trị; lưu điều khoản bản nháp, kiểm soát phụ lục và theo dõi ngày hết hạn.")}</p></div><button className="btn btn-secondary" type="button" disabled={loading || Boolean(busy)} onClick={() => load()}>{t("Làm mới")}</button></div>
    {error && <div className="alert danger" role="alert">{t(error)}</div>}{notice && <div className="alert success" role="status">{t(notice)}</div>}
    <div className="stats u-mb-16" ><div className="card stat"><span className="stat-label">{t("Tổng hợp đồng")}</span><strong className="stat-value">{contracts.length}</strong></div><div className="card stat"><span className="stat-label">{t("Đang hiệu lực")}</span><strong className="stat-value">{activeCount}</strong></div><div className="card stat"><span className="stat-label">{t("Hết hạn trong 90 ngày")}</span><strong className="stat-value">{expiring}</strong></div><div className="card stat"><span className="stat-label">{t("Phụ lục chờ xử lý")}</span><strong className="stat-value">{pendingCount}</strong></div></div>
    {can('contract.contract.create') && <ContractDraftForm values={contractForm} parties={parties} busy={busy} partyLabel={(party) => recordLabel('master-data.party', party)} onChange={(field, value) => setContractForm((form) => ({ ...form, [field]: value }))} onSubmit={createContract} />}
    <section className="card card-pad"><div className="row wrap"><h2>{t("Danh sách hợp đồng")}</h2><span className="grow"/><label className="field"><span className="label">{t("Lọc")}</span><select className="select" value={contractFilter} onChange={(event) => setContractFilter(event.target.value)}><option value="all">{t("Tất cả")}</option><option value="draft">{t("Bản nháp")}</option><option value="active">{t("Đang hiệu lực")}</option><option value="ending">{t("Sắp hết hạn")}</option><option value="terminated">{t("Đã chấm dứt")}</option><option value="expired">{t("Đã hết hạn")}</option></select></label></div>
      {!can('contract.contract.read') || loading || !visibleContracts.length ? <ContractRegisterTable canRead={can('contract.contract.read')} loading={loading} contracts={visibleContracts} selectedId={selectedId} onSelect={setSelectedId} partyName={partyName} /> : <div className="layout-split u-mt-10"><ContractRegisterTable canRead={true} loading={false} contracts={visibleContracts} selectedId={selectedId} onSelect={setSelectedId} partyName={partyName} />
        {selected && <section className="card card-pad"><div className="row wrap"><div><h2>{selected.title}</h2><div className="small muted">{partyName(selected.party)} · {selected.source ? `${t('Nguồn:')} ${selected.source === 'real_estate_lease' ? t('Hợp đồng thuê bất động sản') : selected.source}` : t('Hợp đồng độc lập')} · {fmtDateTime(selected.createdAt)}</div>{sourceLink(selected)}</div><span className="grow"/><span className={`badge ${selected.status === 'active' ? 'success' : 'warning'}`}>{statusLabel(selected.status || 'draft')}</span></div>
          {selected.status === 'draft' && can('contract.contract.update') && <form className="form-grid u-mt-12"  onSubmit={updateDraft}><label className="field"><span className="label">{t("Tên hợp đồng *")}</span><input className="input" required maxLength="500" value={draftEdit.title} onChange={(event) => setDraftEdit((form) => ({ ...form, title: event.target.value }))}/></label><label className="field"><span className="label">{t("Đối tác *")}</span><select className="select" required value={draftEdit.party} onChange={(event) => setDraftEdit((form) => ({ ...form, party: event.target.value }))}>{[...parties.values()].map((party) => <option key={party.id} value={party.id}>{recordLabel('master-data.party', party)}</option>)}</select></label><label className="field"><span className="label">{t("Ngày bắt đầu")}</span><input className="input" type="date" value={draftEdit.start_date} onChange={(event) => setDraftEdit((form) => ({ ...form, start_date: event.target.value }))}/></label><label className="field"><span className="label">{t("Ngày kết thúc")}</span><input className="input" type="date" min={draftEdit.start_date || undefined} value={draftEdit.end_date} onChange={(event) => setDraftEdit((form) => ({ ...form, end_date: event.target.value }))}/></label><label className="field"><span className="label">{t("Giá trị")}</span><input className="input" type="number" min="0" step="any" value={draftEdit.value} onChange={(event) => setDraftEdit((form) => ({ ...form, value: event.target.value }))}/></label><label className="field full"><span className="label">{t("Điều khoản chính")}</span><textarea className="textarea" rows="3" maxLength="30000" value={draftEdit.terms} onChange={(event) => setDraftEdit((form) => ({ ...form, terms: event.target.value }))}/></label><div className="row full"><span className="grow"/><button className="btn btn-secondary" disabled={Boolean(busy)}>{t("Lưu hợp đồng nháp")}</button></div></form>}
          {selected.status === 'active' && <div className="row wrap small muted u-mt-10" ><span>{t('Thời hạn:')} {fmtDate(selected.start_date)} – {selected.end_date ? fmtDate(selected.end_date) : t('Không thời hạn')}</span><span>·</span><span>{t('Giá trị:')} {selected.value != null ? fmtMoney(selected.value) : t('Chưa khai báo')}</span></div>}
          {selected.terms && selected.status !== 'draft' && <div className="card card-pad u-mt-10" ><strong>{t("Điều khoản chính")}</strong><p className="pre-wrap">{selected.terms}</p></div>}
          <div className="row wrap u-mt-12" >{selected.status === 'draft' && can('contract.contract.activated') && <button className="btn btn-primary" disabled={Boolean(busy) || !selected.start_date} onClick={() => contractAction('activated')}>{t("Kích hoạt")}</button>}{selected.status === 'draft' && can('contract.contract.cancelled') && <button className="btn btn-ghost" disabled={Boolean(busy)} onClick={() => contractAction('cancelled')}>{t("Hủy bản nháp")}</button>}{selected.status === 'active' && can('contract.contract.terminated') && <button className="btn btn-secondary" disabled={Boolean(busy)} onClick={confirmTermination}>{t("Chấm dứt hợp đồng")}</button>}{selected.status === 'active' && selected.end_date && selected.end_date < localDate() && can('contract.contract.expired') && <button className="btn btn-ghost" disabled={Boolean(busy)} onClick={() => contractAction('expired')}>{t("Ghi nhận hết hạn")}</button>}</div>
          <div className="row wrap u-mt-18" ><h3>{t("Điều khoản chi tiết")}</h3><span className="grow"/><span className="badge plain">{selectedClauses.length}</span></div>{selectedClauses.length ? <div className="stack-sm u-mt-8" >{selectedClauses.map((clause) => <article className="card card-pad" key={clause.id}><strong>{clause.title}</strong>{clause.body && <p className="pre-wrap">{clause.body}</p>}</article>)}</div> : <div className="empty">{t("Chưa có điều khoản chi tiết.")}</div>}{selected.status === 'draft' && can('contract.clause.create') && <form className="form-grid u-mt-10"  onSubmit={addClause}><label className="field"><span className="label">{t("Tên điều khoản *")}</span><input className="input" required maxLength="500" value={clauseForm.title} onChange={(event) => setClauseForm((form) => ({ ...form, title: event.target.value }))}/></label><label className="field full"><span className="label">{t("Nội dung")}</span><textarea className="textarea" rows="3" maxLength="30000" value={clauseForm.body} onChange={(event) => setClauseForm((form) => ({ ...form, body: event.target.value }))}/></label><div className="row full"><span className="grow"/><button className="btn btn-secondary" disabled={Boolean(busy)}>{t("Thêm điều khoản")}</button></div></form>}
          <div className="row wrap u-mt-18" ><h3>{t("Phụ lục và thay đổi")}</h3><span className="grow"/><span className="badge plain">{selectedAmendments.length}</span></div>{selectedAmendments.length ? <div className="stack-sm u-mt-8" >{selectedAmendments.map((row) => { const request = approvalFor(row); const changes = row.changes && typeof row.changes === 'object' ? Object.entries(row.changes) : []; return <article className="card card-pad" key={row.id}><div className="row wrap"><div><strong>{row.reference || `${t('Phụ lục')} ${String(row.id).slice(0, 8)}`}</strong><div className="small muted">{t('Hiệu lực')} {fmtDate(row.effective_date)} · {statusLabel(row.status)}</div></div><span className="grow"/><a className="btn btn-ghost btn-sm" href={recordHref('contract.amendment', row.id)}>{t("Chi tiết")}</a></div><p className="small">{row.reason}</p>{changes.length > 0 && <ul className="small">{changes.map(([field, value]) => <li key={field}>{t(({ title: 'Tên hợp đồng', terms: 'Điều khoản', end_date: 'Ngày kết thúc', value: 'Giá trị' })[field] || field)}: {typeof value === 'object' ? JSON.stringify(value) : String(value)}</li>)}</ul>}{row.status === 'submitted' && workflowEnabled && <div className="small muted">{request ? <>{t("Yêu cầu:")} <a href={recordHref('workflow-approval.approval_request', request.id)}>{statusLabel(request.status)} · {t('mở phê duyệt')}</a></> : <a href="#/approvals">{t("Mở hàng chờ phê duyệt")}</a>}</div>}<div className="row wrap">{['draft','rejected'].includes(row.status) && can('contract.amendment.submitted') && <button className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => amendmentAction(row, 'submitted')}>{t("Gửi duyệt lại")}</button>}{row.status === 'submitted' && !workflowEnabled && can('contract.amendment.approved') && <button className="btn btn-primary btn-sm" disabled={Boolean(busy)} onClick={() => amendmentAction(row, 'approved')}>{t("Duyệt phụ lục")}</button>}{row.status === 'approved' && row.effective_date <= localDate() && can('contract.amendment.applied') && <button className="btn btn-primary btn-sm" disabled={Boolean(busy)} onClick={() => amendmentAction(row, 'applied')}>{t("Áp dụng ngay")}</button>}{['draft','rejected','submitted','approved'].includes(row.status) && can('contract.amendment.cancelled') && <button className="btn btn-ghost btn-sm" disabled={Boolean(busy)} onClick={() => amendmentAction(row, 'cancelled')}>{t("Hủy phụ lục")}</button>}</div></article>; })}</div> : <div className="empty">{t("Chưa có phụ lục.")}</div>}
          {selected.status === 'active' && can('contract.amendment.create') && <form className="form-grid u-mt-10"  onSubmit={createAmendment}><h3 className="full">{t("Lập phụ lục mới")}</h3><label className="field"><span className="label">{t("Số tham chiếu")}</span><input className="input" maxLength="120" value={amendmentForm.reference} onChange={(event) => setAmendmentForm((form) => ({ ...form, reference: event.target.value }))}/></label><label className="field"><span className="label">{t("Ngày hiệu lực *")}</span><input className="input" type="date" min={localDate()} required value={amendmentForm.effective_date} onChange={(event) => setAmendmentForm((form) => ({ ...form, effective_date: event.target.value }))}/></label><label className="field"><span className="label">{t("Tên hợp đồng mới")}</span><input className="input" maxLength="500" value={amendmentForm.title} onChange={(event) => setAmendmentForm((form) => ({ ...form, title: event.target.value }))}/></label><label className="field"><span className="label">{t("Ngày kết thúc mới")}</span><input className="input" type="date" min={amendmentForm.effective_date || selected.start_date || undefined} value={amendmentForm.end_date} onChange={(event) => setAmendmentForm((form) => ({ ...form, end_date: event.target.value }))}/></label><label className="field"><span className="label">{t("Giá trị mới")}</span><input className="input" type="number" min="0" step="any" value={amendmentForm.value} onChange={(event) => setAmendmentForm((form) => ({ ...form, value: event.target.value }))}/></label><label className="field full"><span className="label">{t("Điều khoản mới")}</span><textarea className="textarea" rows="3" maxLength="30000" value={amendmentForm.terms} onChange={(event) => setAmendmentForm((form) => ({ ...form, terms: event.target.value }))}/></label><label className="field full"><span className="label">{t("Lý do thay đổi *")}</span><textarea className="textarea" required minLength="3" maxLength="10000" rows="3" value={amendmentForm.reason} onChange={(event) => setAmendmentForm((form) => ({ ...form, reason: event.target.value }))}/></label><div className="row full"><span className="grow small muted">{t("Phụ lục phải được duyệt trước; thay đổi chỉ được áp dụng từ ngày hiệu lực.")}</span><button className="btn btn-primary" disabled={Boolean(busy) || !amendmentForm.effective_date || !amendmentForm.reason.trim()}>{t("Tạo và gửi duyệt")}</button></div></form>}
        </section>}
      </div>}
    </section>
  </div>;
}
