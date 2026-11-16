import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { selectableTableRowProps } from '../../lib/accessibility.js';
import { addCalendarDays, localDate } from '../../lib/dates.js';
import { api, dataPath } from '../../lib/api.js';
import { fmtDate, fmtDateTime, fmtMoney, statusLabel, uiText } from '../../lib/i18n.js';
import { app, can, loadAllResponse, loadRefs, recordLabel } from '../../lib/state.js';
import { recordHref } from '../../lib/routes.js';

const blankContract = { title: '', party: '', start_date: '', end_date: '', value: '', terms: '' };
const blankClause = { title: '', body: '' };
const blankAmendment = { reference: '', effective_date: '', reason: '', title: '', terms: '', end_date: '', value: '' };
const rows = (response) => Array.isArray(response?.items) ? response.items : [];
const endingSoon = (contract) => {
  const today = localDate();
  if (contract.status !== 'active' || !contract.end_date || contract.end_date < today) return false;
  return contract.end_date <= addCalendarDays(today, 90);
};

export default function ContractWorkbenchPage() {
  const [contracts, setContracts] = useState([]);
  const [clauses, setClauses] = useState([]);
  const [amendments, setAmendments] = useState([]);
  const [approvalRequests, setApprovalRequests] = useState([]);
  const [parties, setParties] = useState(new Map());
  const [selectedId, setSelectedId] = useState('');
  const [contractFilter, setContractFilter] = useState('all');
  const [contractForm, setContractForm] = useState(blankContract);
  const [draftEdit, setDraftEdit] = useState(blankContract);
  const [clauseForm, setClauseForm] = useState(blankClause);
  const [amendmentForm, setAmendmentForm] = useState(blankAmendment);
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const workflowEnabled = app.meta?.modules?.some((module) => module.id === 'workflow-approval') || false;
  const load = useCallback(async (quiet = false) => {
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
      setContracts(contractRows); setClauses(rows(clauseRes)); setAmendments(rows(amendmentRes)); setParties(partyMap); setApprovalRequests(rows(approvalRes));
      setSelectedId((id) => contractRows.some((row) => row.id === id) ? id : contractRows[0]?.id || '');
      setContractForm((form) => ({ ...form, party: form.party || [...partyMap.keys()][0] || '' }));
    } catch (reason) { setError(reason.message || uiText("Không tải được sổ hợp đồng.")); }
    finally { if (!quiet) setLoading(false); }
  }, [workflowEnabled]);

  useEffect(() => { document.title = `${uiText('Sổ hợp đồng')} · OSP Suite`; load(); }, [load]);

  const selected = contracts.find((row) => row.id === selectedId);
  const selectedClauses = useMemo(() => clauses.filter((row) => row.contract === selectedId).sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'vi')), [clauses, selectedId]);
  const selectedAmendments = useMemo(() => amendments.filter((row) => row.contract === selectedId).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))), [amendments, selectedId]);
  const visibleContracts = contracts.filter((row) => contractFilter === 'all' || (contractFilter === 'ending' ? endingSoon(row) : row.status === contractFilter));
  const expiring = contracts.filter(endingSoon).length;
  const activeCount = contracts.filter((row) => row.status === 'active').length;
  const pendingCount = amendments.filter((row) => ['submitted', 'approved'].includes(row.status)).length;

  useEffect(() => {
    if (!visibleContracts.some((row) => row.id === selectedId)) setSelectedId(visibleContracts[0]?.id || '');
  }, [visibleContracts, selectedId]);

  async function run(key, operation, success) {
    setBusy(key); setError(''); setNotice('');
    try { await operation(); await load(true); if (success) setNotice(success); }
    catch (reason) { setError(reason.message || uiText("Thao tác không thành công.")); await load(true); }
    finally { setBusy(''); }
  }

  async function createContract(event) {
    event.preventDefault();
    await run('contract:create', async () => {
      const body = {
        title: contractForm.title.trim(), party: contractForm.party,
        ...(contractForm.start_date ? { start_date: contractForm.start_date } : {}),
        ...(contractForm.end_date ? { end_date: contractForm.end_date } : {}),
        ...(contractForm.value !== '' ? { value: Number(contractForm.value) } : {}),
        ...(contractForm.terms.trim() ? { terms: contractForm.terms.trim() } : {}),
      };
      const created = await api(dataPath('contract.contract'), { method: 'POST', body });
      setContractForm((form) => ({ ...blankContract, party: form.party })); setSelectedId(created.id);
    }, uiText("Đã tạo hợp đồng nháp. Hãy kiểm tra điều khoản và ngày hiệu lực trước khi kích hoạt."));
  }

  async function updateDraft(event) {
    event.preventDefault(); if (!selected) return;
    await run(`${selected.id}:save`, () => api(dataPath('contract.contract', selected.id), { method: 'PATCH', body: {
      title: draftEdit.title.trim(), party: draftEdit.party,
      start_date: draftEdit.start_date || null, end_date: draftEdit.end_date || null,
      value: draftEdit.value === '' ? null : Number(draftEdit.value), terms: draftEdit.terms.trim() || null,
    } }), uiText("Đã lưu thông tin hợp đồng nháp."));
  }

  useEffect(() => {
    if (!selected) { setDraftEdit(blankContract); return; }
    setDraftEdit({ title: selected.title || '', party: selected.party || '', start_date: selected.start_date || '', end_date: selected.end_date || '', value: selected.value ?? '', terms: selected.terms || '' });
  }, [selectedId]);

  async function addClause(event) {
    event.preventDefault(); if (!selected) return;
    await run(`${selected.id}:clause`, async () => {
      await api(dataPath('contract.clause'), { method: 'POST', body: { contract: selected.id, title: clauseForm.title.trim(), body: clauseForm.body.trim() } });
      setClauseForm(blankClause);
    }, uiText("Đã thêm điều khoản vào hợp đồng nháp."));
  }

  async function createAmendment(event) {
    event.preventDefault(); if (!selected) return;
    const changes = {};
    if (amendmentForm.title.trim()) changes.title = amendmentForm.title.trim();
    if (amendmentForm.terms.trim()) changes.terms = amendmentForm.terms.trim();
    if (amendmentForm.end_date) changes.end_date = amendmentForm.end_date;
    if (amendmentForm.value !== '') changes.value = Number(amendmentForm.value);
    if (!Object.keys(changes).length) { setError(uiText("Hãy nhập ít nhất một nội dung thay đổi trong phụ lục.")); return; }
    await run(`${selected.id}:amendment`, async () => {
      const amendment = await api(dataPath('contract.amendment'), { method: 'POST', body: {
        contract: selected.id, reference: amendmentForm.reference.trim() || undefined,
        effective_date: amendmentForm.effective_date, reason: amendmentForm.reason.trim(), changes,
      } });
      await api(dataPath('contract.amendment', amendment.id, 'submitted'), { method: 'POST' });
      setAmendmentForm(blankAmendment);
    }, workflowEnabled ? uiText("Đã gửi phụ lục vào luồng phê duyệt.") : uiText("Đã gửi phụ lục chờ duyệt."));
  }

  async function amendmentAction(row, action) {
    const messages = {
      approved: uiText("Đã duyệt phụ lục; nếu ngày hiệu lực đã đến, hệ thống áp dụng thay đổi tự động."),
      applied: uiText("Đã áp dụng thay đổi phụ lục vào hợp đồng."),
      cancelled: uiText("Đã hủy phụ lục."),
      submitted: uiText("Đã gửi lại phụ lục để duyệt."),
    };
    await run(`${row.id}:${action}`, () => api(dataPath('contract.amendment', row.id, action), { method: 'POST' }), messages[action]);
  }

  async function contractAction(action) {
    if (!selected) return;
    const message = { activated: uiText("Đã kích hoạt hợp đồng."), terminated: uiText("Đã chấm dứt hợp đồng."), cancelled: uiText("Đã hủy hợp đồng nháp.") }[action];
    await run(`${selected.id}:${action}`, () => api(dataPath('contract.contract', selected.id, action), { method: 'POST' }), message);
  }

  function partyName(partyId) {
    const party = parties.get(partyId);
    return party ? recordLabel('master-data.party', party) : (partyId ? `#${String(partyId).slice(0, 8)}` : uiText("Chưa chọn đối tác"));
  }

  function approvalFor(row) { return approvalRequests.find((request) => request.entity === 'contract.amendment' && request.record_id === row.id); }
  function sourceLink(row) {
    if (row.source === 'real_estate_lease' && row.source_id) return <a href={recordHref('real-estate.lease', row.source_id)}>{uiText('Hồ sơ')} lease {String(row.source_id).slice(0, 8)}</a>;
    return null;
  }

  return <div className="page">
    <div className="page-head"><div><h1>{uiText("Sổ hợp đồng")}</h1><p className="sub">{uiText("Quản lý đối tác, thời hạn và giá trị; lưu điều khoản bản nháp, kiểm soát phụ lục và theo dõi ngày hết hạn.")}</p></div><button className="btn btn-secondary" type="button" disabled={loading || Boolean(busy)} onClick={() => load()}>{uiText("Làm mới")}</button></div>
    {error && <div className="alert danger" role="alert">{uiText(error)}</div>}{notice && <div className="alert success" role="status">{notice}</div>}
    <div className="stats" style={{ marginBottom: 16 }}><div className="card stat"><span className="stat-label">{uiText("Tổng hợp đồng")}</span><strong className="stat-value">{contracts.length}</strong></div><div className="card stat"><span className="stat-label">{uiText("Đang hiệu lực")}</span><strong className="stat-value">{activeCount}</strong></div><div className="card stat"><span className="stat-label">{uiText("Hết hạn trong 90 ngày")}</span><strong className="stat-value">{expiring}</strong></div><div className="card stat"><span className="stat-label">{uiText("Phụ lục chờ xử lý")}</span><strong className="stat-value">{pendingCount}</strong></div></div>

    {can('contract.contract.create') && <section className="card card-pad"><h2>{uiText("Lập hợp đồng nháp")}</h2><form className="form-grid" onSubmit={createContract}><label className="field"><span className="label">{uiText("Tên hợp đồng *")}</span><input className="input" required maxLength="500" value={contractForm.title} onChange={(event) => setContractForm((form) => ({ ...form, title: event.target.value }))}/></label><label className="field"><span className="label">{uiText("Đối tác *")}</span><select className="select" required value={contractForm.party} onChange={(event) => setContractForm((form) => ({ ...form, party: event.target.value }))}><option value="">{uiText("Chọn đối tác")}</option>{[...parties.values()].map((party) => <option key={party.id} value={party.id}>{recordLabel('master-data.party', party)}</option>)}</select></label><label className="field"><span className="label">{uiText("Ngày bắt đầu")}</span><input className="input" type="date" value={contractForm.start_date} onChange={(event) => setContractForm((form) => ({ ...form, start_date: event.target.value }))}/></label><label className="field"><span className="label">{uiText("Ngày kết thúc")}</span><input className="input" type="date" min={contractForm.start_date || undefined} value={contractForm.end_date} onChange={(event) => setContractForm((form) => ({ ...form, end_date: event.target.value }))}/></label><label className="field"><span className="label">{uiText("Giá trị hợp đồng")}</span><input className="input" type="number" min="0" step="any" value={contractForm.value} onChange={(event) => setContractForm((form) => ({ ...form, value: event.target.value }))}/></label><label className="field full"><span className="label">{uiText("Điều khoản chính")}</span><textarea className="textarea" rows="3" maxLength="30000" value={contractForm.terms} onChange={(event) => setContractForm((form) => ({ ...form, terms: event.target.value }))}/></label><div className="row full"><span className="grow"/><button className="btn btn-primary" disabled={Boolean(busy) || !parties.size}>{uiText("Tạo hợp đồng nháp")}</button></div></form></section>}

    <section className="card card-pad"><div className="row wrap"><h2>{uiText("Danh sách hợp đồng")}</h2><span className="grow"/><label className="field"><span className="label">{uiText("Lọc")}</span><select className="select" value={contractFilter} onChange={(event) => setContractFilter(event.target.value)}><option value="all">{uiText("Tất cả")}</option><option value="draft">{uiText("Bản nháp")}</option><option value="active">{uiText("Đang hiệu lực")}</option><option value="ending">{uiText("Sắp hết hạn")}</option><option value="terminated">{uiText("Đã chấm dứt")}</option><option value="expired">{uiText("Đã hết hạn")}</option></select></label></div>
      {!can('contract.contract.read') ? <div className="empty">{uiText("Bạn chưa có quyền xem hợp đồng.")}</div> : loading ? <div className="skeleton" data-h="row"/> : !visibleContracts.length ? <div className="empty">{uiText("Không có hợp đồng trong bộ lọc này.")}</div> : <div className="layout-split" style={{ marginTop: 10 }}><section className="table-wrap"><table className="table"><thead><tr><th>{uiText("Hợp đồng / đối tác")}</th><th>{uiText("Thời hạn")}</th><th>{uiText("Giá trị")}</th><th>{uiText("Trạng thái")}</th></tr></thead><tbody>{visibleContracts.map((row) => <tr {...selectableTableRowProps} key={row.id} aria-selected={selectedId === row.id} className={selectedId === row.id ? 'selected' : ''} onClick={() => setSelectedId(row.id)} style={{ cursor: 'pointer' }}><td><strong>{row.title}</strong><div className="small muted">{partyName(row.party)}</div></td><td>{fmtDate(row.start_date)} – {row.end_date ? fmtDate(row.end_date) : 'Không thời hạn'}</td><td>{row.value != null ? fmtMoney(row.value) : '—'}</td><td><span className={`badge ${row.status === 'active' ? 'success' : ['terminated','expired'].includes(row.status) ? 'plain' : 'warning'}`}>{statusLabel(row.status || 'draft')}</span></td></tr>)}</tbody></table></section>
        {selected && <section className="card card-pad"><div className="row wrap"><div><h2>{selected.title}</h2><div className="small muted">{partyName(selected.party)} · {selected.source ? `Nguồn: ${selected.source}` : 'Hợp đồng độc lập'} · {fmtDateTime(selected.createdAt)}</div>{sourceLink(selected)}</div><span className="grow"/><span className={`badge ${selected.status === 'active' ? 'success' : 'warning'}`}>{statusLabel(selected.status || 'draft')}</span></div>
          {selected.status === 'draft' && can('contract.contract.update') && <form className="form-grid" style={{ marginTop: 12 }} onSubmit={updateDraft}><label className="field"><span className="label">{uiText("Tên hợp đồng *")}</span><input className="input" required maxLength="500" value={draftEdit.title} onChange={(event) => setDraftEdit((form) => ({ ...form, title: event.target.value }))}/></label><label className="field"><span className="label">{uiText("Đối tác *")}</span><select className="select" required value={draftEdit.party} onChange={(event) => setDraftEdit((form) => ({ ...form, party: event.target.value }))}>{[...parties.values()].map((party) => <option key={party.id} value={party.id}>{recordLabel('master-data.party', party)}</option>)}</select></label><label className="field"><span className="label">{uiText("Ngày bắt đầu")}</span><input className="input" type="date" value={draftEdit.start_date} onChange={(event) => setDraftEdit((form) => ({ ...form, start_date: event.target.value }))}/></label><label className="field"><span className="label">{uiText("Ngày kết thúc")}</span><input className="input" type="date" min={draftEdit.start_date || undefined} value={draftEdit.end_date} onChange={(event) => setDraftEdit((form) => ({ ...form, end_date: event.target.value }))}/></label><label className="field"><span className="label">{uiText("Giá trị")}</span><input className="input" type="number" min="0" step="any" value={draftEdit.value} onChange={(event) => setDraftEdit((form) => ({ ...form, value: event.target.value }))}/></label><label className="field full"><span className="label">{uiText("Điều khoản chính")}</span><textarea className="textarea" rows="3" maxLength="30000" value={draftEdit.terms} onChange={(event) => setDraftEdit((form) => ({ ...form, terms: event.target.value }))}/></label><div className="row full"><span className="grow"/><button className="btn btn-secondary" disabled={Boolean(busy)}>{uiText("Lưu hợp đồng nháp")}</button></div></form>}
          {selected.status === 'active' && <div className="row wrap small muted" style={{ marginTop: 10 }}><span>{uiText('Thời hạn:')} {fmtDate(selected.start_date)} – {selected.end_date ? fmtDate(selected.end_date) : uiText('Không thời hạn')}</span><span>·</span><span>{uiText('Giá trị:')} {selected.value != null ? fmtMoney(selected.value) : uiText('Chưa khai báo')}</span></div>}
          {selected.terms && selected.status !== 'draft' && <div className="card card-pad" style={{ marginTop: 10 }}><strong>{uiText("Điều khoản chính")}</strong><p className="pre-wrap">{selected.terms}</p></div>}
          <div className="row wrap" style={{ marginTop: 12 }}>{selected.status === 'draft' && can('contract.contract.activated') && <button className="btn btn-primary" disabled={Boolean(busy) || !selected.start_date} onClick={() => contractAction('activated')}>{uiText("Kích hoạt")}</button>}{selected.status === 'draft' && can('contract.contract.cancelled') && <button className="btn btn-ghost" disabled={Boolean(busy)} onClick={() => contractAction('cancelled')}>{uiText("Hủy bản nháp")}</button>}{selected.status === 'active' && can('contract.contract.terminated') && <button className="btn btn-secondary" disabled={Boolean(busy)} onClick={() => window.confirm(uiText('Chấm dứt hợp đồng này? Các phụ lục chưa áp dụng sẽ bị hủy.')) && contractAction('terminated')}>{uiText("Chấm dứt hợp đồng")}</button>}{selected.status === 'active' && selected.end_date && selected.end_date < localDate() && can('contract.contract.expired') && <button className="btn btn-ghost" disabled={Boolean(busy)} onClick={() => contractAction('expired')}>{uiText("Ghi nhận hết hạn")}</button>}</div>

          <div className="row wrap" style={{ marginTop: 18 }}><h3>{uiText("Điều khoản chi tiết")}</h3><span className="grow"/><span className="badge plain">{selectedClauses.length}</span></div>{selectedClauses.length ? <div className="stack-sm" style={{ marginTop: 8 }}>{selectedClauses.map((clause) => <article className="card card-pad" key={clause.id}><strong>{clause.title}</strong>{clause.body && <p className="pre-wrap">{clause.body}</p>}</article>)}</div> : <div className="empty">{uiText("Chưa có điều khoản chi tiết.")}</div>}{selected.status === 'draft' && can('contract.clause.create') && <form className="form-grid" style={{ marginTop: 10 }} onSubmit={addClause}><label className="field"><span className="label">{uiText("Tên điều khoản *")}</span><input className="input" required maxLength="500" value={clauseForm.title} onChange={(event) => setClauseForm((form) => ({ ...form, title: event.target.value }))}/></label><label className="field full"><span className="label">{uiText("Nội dung")}</span><textarea className="textarea" rows="3" maxLength="30000" value={clauseForm.body} onChange={(event) => setClauseForm((form) => ({ ...form, body: event.target.value }))}/></label><div className="row full"><span className="grow"/><button className="btn btn-secondary" disabled={Boolean(busy)}>{uiText("Thêm điều khoản")}</button></div></form>}

          <div className="row wrap" style={{ marginTop: 18 }}><h3>{uiText("Phụ lục và thay đổi")}</h3><span className="grow"/><span className="badge plain">{selectedAmendments.length}</span></div>{selectedAmendments.length ? <div className="stack-sm" style={{ marginTop: 8 }}>{selectedAmendments.map((row) => { const request = approvalFor(row); const changes = row.changes && typeof row.changes === 'object' ? Object.entries(row.changes) : []; return <article className="card card-pad" key={row.id}><div className="row wrap"><div><strong>{row.reference || `${uiText('Phụ lục')} ${String(row.id).slice(0, 8)}`}</strong><div className="small muted">{uiText('Hiệu lực')} {fmtDate(row.effective_date)} · {statusLabel(row.status)}</div></div><span className="grow"/><a className="btn btn-ghost btn-sm" href={recordHref('contract.amendment', row.id)}>{uiText("Chi tiết")}</a></div><p className="small">{row.reason}</p>{changes.length > 0 && <ul className="small">{changes.map(([field, value]) => <li key={field}>{uiText(({ title: 'Tên hợp đồng', terms: 'Điều khoản', end_date: 'Ngày kết thúc', value: 'Giá trị' })[field] || field)}: {typeof value === 'object' ? JSON.stringify(value) : String(value)}</li>)}</ul>}{row.status === 'submitted' && workflowEnabled && <div className="small muted">{request ? <>{uiText("Yêu cầu:")} <a href={recordHref('workflow-approval.approval_request', request.id)}>{statusLabel(request.status)} · {uiText('mở phê duyệt')}</a></> : <a href="#/approvals">{uiText("Mở hàng chờ phê duyệt")}</a>}</div>}<div className="row wrap">{['draft','rejected'].includes(row.status) && can('contract.amendment.submitted') && <button className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => amendmentAction(row, 'submitted')}>{uiText("Gửi duyệt lại")}</button>}{row.status === 'submitted' && !workflowEnabled && can('contract.amendment.approved') && <button className="btn btn-primary btn-sm" disabled={Boolean(busy)} onClick={() => amendmentAction(row, 'approved')}>{uiText("Duyệt phụ lục")}</button>}{row.status === 'approved' && row.effective_date <= localDate() && can('contract.amendment.applied') && <button className="btn btn-primary btn-sm" disabled={Boolean(busy)} onClick={() => amendmentAction(row, 'applied')}>{uiText("Áp dụng ngay")}</button>}{['draft','rejected','submitted','approved'].includes(row.status) && can('contract.amendment.cancelled') && <button className="btn btn-ghost btn-sm" disabled={Boolean(busy)} onClick={() => amendmentAction(row, 'cancelled')}>{uiText("Hủy phụ lục")}</button>}</div></article>; })}</div> : <div className="empty">{uiText("Chưa có phụ lục.")}</div>}
          {selected.status === 'active' && can('contract.amendment.create') && <form className="form-grid" style={{ marginTop: 10 }} onSubmit={createAmendment}><h3 className="full">{uiText("Lập phụ lục mới")}</h3><label className="field"><span className="label">{uiText("Số tham chiếu")}</span><input className="input" maxLength="120" value={amendmentForm.reference} onChange={(event) => setAmendmentForm((form) => ({ ...form, reference: event.target.value }))}/></label><label className="field"><span className="label">{uiText("Ngày hiệu lực *")}</span><input className="input" type="date" min={localDate()} required value={amendmentForm.effective_date} onChange={(event) => setAmendmentForm((form) => ({ ...form, effective_date: event.target.value }))}/></label><label className="field"><span className="label">{uiText("Tên hợp đồng mới")}</span><input className="input" maxLength="500" value={amendmentForm.title} onChange={(event) => setAmendmentForm((form) => ({ ...form, title: event.target.value }))}/></label><label className="field"><span className="label">{uiText("Ngày kết thúc mới")}</span><input className="input" type="date" min={amendmentForm.effective_date || selected.start_date || undefined} value={amendmentForm.end_date} onChange={(event) => setAmendmentForm((form) => ({ ...form, end_date: event.target.value }))}/></label><label className="field"><span className="label">{uiText("Giá trị mới")}</span><input className="input" type="number" min="0" step="any" value={amendmentForm.value} onChange={(event) => setAmendmentForm((form) => ({ ...form, value: event.target.value }))}/></label><label className="field full"><span className="label">{uiText("Điều khoản mới")}</span><textarea className="textarea" rows="3" maxLength="30000" value={amendmentForm.terms} onChange={(event) => setAmendmentForm((form) => ({ ...form, terms: event.target.value }))}/></label><label className="field full"><span className="label">{uiText("Lý do thay đổi *")}</span><textarea className="textarea" required minLength="3" maxLength="10000" rows="3" value={amendmentForm.reason} onChange={(event) => setAmendmentForm((form) => ({ ...form, reason: event.target.value }))}/></label><div className="row full"><span className="grow small muted">{uiText("Phụ lục phải được duyệt trước; thay đổi chỉ được áp dụng từ ngày hiệu lực.")}</span><button className="btn btn-primary" disabled={Boolean(busy) || !amendmentForm.effective_date || !amendmentForm.reason.trim()}>{uiText("Tạo và gửi duyệt")}</button></div></form>}
        </section>}
      </div>}
    </section>
  </div>;
}
