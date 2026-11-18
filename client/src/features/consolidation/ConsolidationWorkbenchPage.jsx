import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useDocumentTitle } from '../../lib/useDocumentTitle.js';
import { useLatestRequest } from '../../lib/useLatestRequest.js';
import { api, dataPath, tenantPath } from '../../lib/api.js';
import { can, isAdmin, loadAll } from '../../lib/state.js';
import { fmtNumber, uiTextWith } from '../../lib/i18n.js';
import consolidationEnglish from './consolidation.en.js';
import EliminationJournalForm from './components/EliminationJournalForm.jsx';
import EliminationJournalsTable from './components/EliminationJournalsTable.jsx';
import ConsolidatedTrialBalancePanel from './components/ConsolidatedTrialBalancePanel.jsx';

const t = (text) => uiTextWith(text, consolidationEnglish);
const itemsOf = (response) => Array.isArray(response?.items) ? response.items : [];

export default function ConsolidationWorkbenchPage() {
  useDocumentTitle(`${t('Quản lý tập đoàn')} · OSP Suite`);
  const [groups, setGroups] = useState([]);
  const [members, setMembers] = useState([]);
  const [shares, setShares] = useState([]);
  const [grants, setGrants] = useState([]);
  const [users, setUsers] = useState([]);
  const [grantUserId, setGrantUserId] = useState('');
  const [currencies, setCurrencies] = useState([]);
  const [groupForm, setGroupForm] = useState({ name: '', reporting_currency: '', max_rate_age_days: '30' });
  const [inviteForm, setInviteForm] = useState({ groupId: '', memberTenantId: '' });
  const [acceptForm, setAcceptForm] = useState({ ownerTenantId: '', memberId: '', inviteToken: '' });
  const [inviteResult, setInviteResult] = useState(null);
  const [reportGroup, setReportGroup] = useState('');
  const [reportFrom, setReportFrom] = useState('');
  const [reportTo, setReportTo] = useState('');
  const [report, setReport] = useState(null);
  const [ratePolicyDays, setRatePolicyDays] = useState('30');
  const [reportSnapshots, setReportSnapshots] = useState([]);
  const [eliminationJournals, setEliminationJournals] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [eliminationForm, setEliminationForm] = useState({ posting_date: '', memo: '', account_debit: '', debit: '', account_credit: '', credit: '', evidence: '' });
  const [selectedSnapshotId, setSelectedSnapshotId] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const latestRequest = useLatestRequest();
  const reportRequestRef = useRef(0);
  const snapshotListRequestRef = useRef(0);

  const load = useCallback(async (quiet = false) => {
    const isLatest = latestRequest();
    if (!quiet) { setLoading(true); setError(''); }
    try {
      const [groupRows, memberRows, shareRows, grantRows, currencyRows, userRows, eliminationRows, accountRows] = await Promise.all([
        can('consolidation.company_group.read') ? loadAll('consolidation.company_group') : Promise.resolve([]),
        can('consolidation.member.read') ? loadAll('consolidation.member') : Promise.resolve([]),
        can('consolidation.shared_company.read') ? loadAll('consolidation.shared_company') : Promise.resolve([]),
        can('consolidation.report_grant.read') ? loadAll('consolidation.report_grant') : Promise.resolve([]),
        can('master-data.currency.read') ? loadAll('master-data.currency') : Promise.resolve([]),
        isAdmin() ? api(tenantPath('/users')) : Promise.resolve([]),
        can('consolidation.elimination_journal.read') ? loadAll('consolidation.elimination_journal') : Promise.resolve([]),
        can('accounting.account.read') ? loadAll('accounting.account') : Promise.resolve([]),
      ]);
      if (isLatest()) {
        setGroups(groupRows); setMembers(memberRows); setShares(shareRows); setGrants(grantRows); setCurrencies(currencyRows); setUsers(Array.isArray(userRows) ? userRows : []); setEliminationJournals(eliminationRows); setAccounts(accountRows);
        setInviteForm((form) => ({ ...form, groupId: groupRows.some((row) => row.id === form.groupId) ? form.groupId : groupRows[0]?.id || '' }));
        setReportGroup((id) => groupRows.some((row) => row.id === id) ? id : groupRows[0]?.id || '');
        const currentGroup = groupRows.find((row) => row.id === reportGroup) || groupRows[0];
        setRatePolicyDays(String(currentGroup?.max_rate_age_days ?? '30'));
        setGroupForm((form) => ({ ...form, reporting_currency: currencies.some((row) => row.id === form.reporting_currency) ? form.reporting_currency : currencyRows[0]?.id || '' }));
      }
    } catch (reason) { if (isLatest()) setError(reason.message || t('Không tải được dữ liệu tập đoàn.')); }
    finally { if (isLatest()) setLoading(false); }
  }, [reportGroup, latestRequest]);
  useEffect(() => { load(); }, [load]);

  async function run(key, action, success) {
    setBusy(key); setError(''); setNotice('');
    try { const result = await action(); setNotice(success); await load(true); return result; }
    catch (reason) { setError(reason.message || t('Không hoàn tất được thao tác.')); return null; }
    finally { setBusy(''); }
  }

  async function createGroup(event) {
    event.preventDefault();
    await run('group', () => api(dataPath('consolidation.company_group'), { method: 'POST', body: { ...groupForm, max_rate_age_days: Number(groupForm.max_rate_age_days) } }), t('Đã tạo nhóm công ty.'));
    setGroupForm((form) => ({ ...form, name: '' }));
  }
  function selectReportGroup(groupId) {
    reportRequestRef.current += 1;
    snapshotListRequestRef.current += 1;
    setBusy('');
    setReportGroup(groupId);
    setRatePolicyDays(String(groups.find((group) => group.id === groupId)?.max_rate_age_days ?? '30'));
    setReport(null); setSelectedSnapshotId('');
  }
  function changeReportPeriod(field, value) {
    reportRequestRef.current += 1;
    setBusy('');
    setReport(null); setSelectedSnapshotId('');
    if (field === 'from') setReportFrom(value);
    else setReportTo(value);
  }
  async function saveRatePolicy(event) {
    event.preventDefault();
    await run('rate-policy', () => api(dataPath('consolidation.company_group', reportGroup), { method: 'PATCH', body: { max_rate_age_days: Number(ratePolicyDays) } }), t('Đã lưu chính sách tuổi tỷ giá.'));
  }
  async function invite(event) {
    event.preventDefault(); setInviteResult(null);
    const result = await run('invite', () => api(tenantPath(`/consolidation/groups/${encodeURIComponent(inviteForm.groupId)}/invites`), { method: 'POST', body: { memberTenantId: inviteForm.memberTenantId.trim() } }), t('Đã tạo lời mời. Sao chép token và gửi cho quản trị viên tenant được mời.'));
    if (result) { setInviteResult(result); setInviteForm((form) => ({ ...form, memberTenantId: '' })); }
  }
  async function accept(event) {
    event.preventDefault();
    await run('accept', () => api(tenantPath('/consolidation/invites/accept'), { method: 'POST', body: acceptForm }), t('Đã chấp thuận chia sẻ dữ liệu công ty.'));
    setAcceptForm({ ownerTenantId: '', memberId: '', inviteToken: '' });
  }
  async function revokeMember(member) {
    await run(`revoke:${member.id}`, () => api(tenantPath(`/consolidation/members/${encodeURIComponent(member.id)}/revoke`), { method: 'POST' }), t('Đã thu hồi thành viên khỏi nhóm.'));
  }
  async function revokeShare(share) {
    await run(`share:${share.id}`, () => api(tenantPath('/consolidation/shared/revoke'), { method: 'POST', body: { ownerTenantId: share.owner_tenant_id, memberId: share.owner_member_id } }), t('Đã thu hồi consent chia sẻ.'));
  }
  async function createReportGrant(event) {
    event.preventDefault();
    const result = await run('grant', () => api(tenantPath(`/consolidation/groups/${encodeURIComponent(reportGroup)}/report-grants`), { method: 'POST', body: { userId: grantUserId.trim(), reportType: 'trial_balance' } }), t('Đã cấp quyền xem bảng cân đối phát sinh.'));
    if (result) setGrantUserId('');
  }
  async function revokeReportGrant(grant) {
    await run(`grant:${grant.id}`, () => api(tenantPath(`/consolidation/report-grants/${encodeURIComponent(grant.id)}/revoke`), { method: 'POST' }), t('Đã thu hồi quyền xem báo cáo.'));
  }
  const refreshReportSnapshots = useCallback(async (groupId = reportGroup) => {
    const requestId = ++snapshotListRequestRef.current;
    if (!groupId) { setReportSnapshots([]); return; }
    const result = await api(tenantPath(`/consolidation/groups/${encodeURIComponent(groupId)}/trial-balance/snapshots`));
    if (requestId === snapshotListRequestRef.current && groupId === reportGroup) setReportSnapshots(itemsOf(result));
  }, [reportGroup]);
  useEffect(() => {
    const requestId = ++snapshotListRequestRef.current;
    if (!reportGroup || !can('consolidation.company_group.read') || !can('accounting.journal_entry.read')) { setReportSnapshots([]); return undefined; }
    let current = true;
    api(tenantPath(`/consolidation/groups/${encodeURIComponent(reportGroup)}/trial-balance/snapshots`))
      .then((result) => { if (current && requestId === snapshotListRequestRef.current) setReportSnapshots(itemsOf(result)); })
      .catch(() => { if (current && requestId === snapshotListRequestRef.current) setReportSnapshots([]); });
    return () => { current = false; };
  }, [reportGroup]);
  async function loadReport(event) {
    event.preventDefault();
    const requestId = ++reportRequestRef.current;
    const groupId = reportGroup;
    const from = reportFrom;
    const to = reportTo;
    setBusy('report'); setError(''); setReport(null);
    try {
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      const result = await api(tenantPath(`/consolidation/groups/${encodeURIComponent(groupId)}/trial-balance?${params}`));
      if (requestId !== reportRequestRef.current || groupId !== reportGroup) return;
      setReport(result);
      setSelectedSnapshotId('');
    } catch (reason) { if (requestId === reportRequestRef.current && groupId === reportGroup) setError(reason.message || t('Không tải được báo cáo hợp nhất.')); }
    finally { if (requestId === reportRequestRef.current) setBusy(''); }
  }
  async function saveReportSnapshot() {
    const requestId = ++reportRequestRef.current;
    const groupId = reportGroup;
    const from = reportFrom;
    const to = reportTo;
    setBusy('snapshot'); setError(''); setNotice('');
    try {
      const result = await api(tenantPath(`/consolidation/groups/${encodeURIComponent(groupId)}/trial-balance/snapshots`), {
        method: 'POST', body: { ...(from ? { from } : {}), ...(to ? { to } : {}) },
      });
      if (requestId !== reportRequestRef.current || groupId !== reportGroup) return;
      setReport(result.report); setSelectedSnapshotId(result.snapshotId);
      await refreshReportSnapshots(groupId);
      if (requestId !== reportRequestRef.current || groupId !== reportGroup) return;
      setNotice(t('Đã lưu ảnh chụp báo cáo bất biến.'));
    } catch (reason) { if (requestId === reportRequestRef.current && groupId === reportGroup) setError(reason.message || t('Không lưu được ảnh chụp báo cáo.')); }
    finally { if (requestId === reportRequestRef.current) setBusy(''); }
  }
  async function openReportSnapshot(snapshot) {
    const requestId = ++reportRequestRef.current;
    const groupId = reportGroup;
    setBusy(`snapshot:${snapshot.id}`); setError(''); setNotice('');
    try {
      const result = await api(tenantPath(`/consolidation/trial-balance/snapshots/${encodeURIComponent(snapshot.id)}`));
      if (requestId !== reportRequestRef.current || groupId !== reportGroup) return;
      setReport(result.report); setSelectedSnapshotId(result.snapshotId);
      setReportFrom(result.from || ''); setReportTo(result.to || '');
      setNotice(`${t('Đang xem ảnh chụp ngày')} ${new Date(result.snapshotAt).toLocaleString()}`);
    } catch (reason) { if (requestId === reportRequestRef.current && groupId === reportGroup) setError(reason.message || t('Không mở được ảnh chụp báo cáo.')); }
    finally { if (requestId === reportRequestRef.current) setBusy(''); }
  }

  async function createElimination(event) {
    event.preventDefault();
    const result = await run('elimination-create', async () => {
      const record = await api(dataPath('consolidation.elimination_journal'), { method: 'POST', body: {
        group: reportGroup,
        posting_date: eliminationForm.posting_date,
        memo: eliminationForm.memo.trim(),
        lines: [
          { accountCode: eliminationForm.account_debit, debit: String(eliminationForm.debit).trim(), credit: '0' },
          { accountCode: eliminationForm.account_credit, debit: '0', credit: String(eliminationForm.credit).trim() },
        ],
        matching_evidence: [eliminationForm.evidence.trim()],
      } });
      await api(dataPath('consolidation.elimination_journal', record.id, 'submitted'), { method: 'POST' });
      return record;
    }, t('Đã gửi bút toán loại trừ để duyệt độc lập.'));
    if (result) setEliminationForm({ posting_date: '', memo: '', account_debit: '', debit: '', account_credit: '', credit: '', evidence: '' });
  }

  const canManage = isAdmin();
  const updateEliminationField = (field, value) => setEliminationForm((form) => ({ ...form, [field]: value }));
  const eliminationSection = reportGroup && can('consolidation.elimination_journal.create') ? (
    <section className="card card-pad">
      <h2>{t('Đối chiếu và loại trừ nội bộ')}</h2>
      <p className="sub">{t('Nhập bút toán điều chỉnh bằng tiền tệ báo cáo, kèm chứng từ đối chiếu. Bút toán chỉ vào báo cáo sau khi người khác duyệt; sổ từng công ty không bị thay đổi.')}</p>
      <EliminationJournalForm form={eliminationForm} accounts={accounts} busy={busy} onFieldChange={updateEliminationField} onSubmit={createElimination} t={t}/>
      <EliminationJournalsTable rows={eliminationJournals} groupId={reportGroup} t={t}/>
    </section>
  ) : null;
  return <div className="page">
    <div className="page-head"><div><h1>{t('Quản lý tập đoàn')}</h1><p className="sub">{t('Tạo nhóm pháp nhân, yêu cầu tenant thành viên đồng ý và quản lý quyền chia sẻ.')}</p></div><button className="btn btn-secondary" type="button" disabled={loading || Boolean(busy)} onClick={() => load()}>{t('Làm mới')}</button></div>
    {error && <div className="alert danger" role="alert">{t(error)}</div>}{notice && <div className="alert success" role="status">{t(notice)}</div>}
    {eliminationSection}
    {canManage && can('consolidation.company_group.create') && <section className="card card-pad"><h2>{t('Tạo nhóm công ty')}</h2><form className="form-grid" onSubmit={createGroup}>
      <label className="field"><span className="label">{t('Tên nhóm')} *</span><input className="input" required maxLength={160} value={groupForm.name} onChange={(event) => setGroupForm((form) => ({ ...form, name: event.target.value }))}/></label>
      <label className="field"><span className="label">{t('Tiền tệ báo cáo')} *</span><select className="input" required value={groupForm.reporting_currency} onChange={(event) => setGroupForm((form) => ({ ...form, reporting_currency: event.target.value }))}><option value="">{t('Chọn tiền tệ')}</option>{currencies.map((currency) => <option key={currency.id} value={currency.id}>{currency.code} · {currency.name}</option>)}</select></label>
      <label className="field"><span className="label">{t('Tuổi tối đa của tỷ giá (ngày)')} *</span><input className="input" type="number" min="1" step="1" required value={groupForm.max_rate_age_days} onChange={(event) => setGroupForm((form) => ({ ...form, max_rate_age_days: event.target.value }))}/><span className="hint">{t('Báo cáo quy đổi sẽ dừng nếu tỷ giá gần nhất cũ hơn ngưỡng này.')}</span></label>
      <div className="row full"><span className="grow"/><button className="btn btn-primary" disabled={Boolean(busy) || loading || !currencies.length}>{t('Tạo nhóm')}</button></div>
    </form></section>}
    {canManage && <div className="layout-split">
      {can('consolidation.member.create') && <section className="card card-pad"><h2>{t('Mời tenant thành viên')}</h2><p className="sub">{t('Tenant được mời phải bật module đa công ty và chấp thuận bằng quản trị viên của họ.')}</p><form className="form-grid" onSubmit={invite}>
        <label className="field"><span className="label">{t('Nhóm công ty')} *</span><select className="input" required value={inviteForm.groupId} onChange={(event) => setInviteForm((form) => ({ ...form, groupId: event.target.value }))}><option value="">{t('Chọn nhóm')}</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
        <label className="field full"><span className="label">{t('Tenant ID được mời')} *</span><input className="input" required value={inviteForm.memberTenantId} onChange={(event) => setInviteForm((form) => ({ ...form, memberTenantId: event.target.value }))}/></label>
        <div className="row full"><span className="grow"/><button className="btn btn-primary" disabled={Boolean(busy) || loading || !groups.length}>{t('Tạo lời mời')}</button></div>
      </form>{inviteResult && <div className="alert success" role="status"><strong>{t('Mã lời mời dùng một lần')}</strong><p>{t('Gửi token riêng cho quản trị viên tenant được mời. Token hết hạn sau 48 giờ.')}</p><code className="selectable">{inviteResult.inviteToken}</code><p>{t('Mã thành viên')}: {inviteResult.memberId}</p></div>}</section>}
      <section className="card card-pad"><h2>{t('Chấp thuận lời mời')}</h2><p className="sub">{t('Chỉ quản trị viên của tenant này mới có thể chấp thuận hoặc thu hồi consent.')}</p><form className="form-grid" onSubmit={accept}>
        <label className="field"><span className="label">{t('Tenant ID chủ nhóm')} *</span><input className="input" required value={acceptForm.ownerTenantId} onChange={(event) => setAcceptForm((form) => ({ ...form, ownerTenantId: event.target.value }))}/></label>
        <label className="field"><span className="label">{t('Mã thành viên')} *</span><input className="input" required value={acceptForm.memberId} onChange={(event) => setAcceptForm((form) => ({ ...form, memberId: event.target.value }))}/></label>
        <label className="field full"><span className="label">{t('Token lời mời')} *</span><input className="input" required autoComplete="off" value={acceptForm.inviteToken} onChange={(event) => setAcceptForm((form) => ({ ...form, inviteToken: event.target.value }))}/></label>
        <div className="row full"><span className="grow"/><button className="btn btn-primary" disabled={Boolean(busy)}>{t('Chấp thuận chia sẻ')}</button></div>
      </form></section>
    </div>}
    {canManage && can('consolidation.report_grant.create') && <section className="card card-pad"><h2>{t('Cấp quyền xem báo cáo')}</h2><p className="sub">{t('Chỉ cấp cho người dùng đang hoạt động trong tenant này. Quyền áp dụng riêng cho bảng cân đối phát sinh của một nhóm.')}</p><form className="form-grid" onSubmit={createReportGrant}>
      <label className="field"><span className="label">{t('Nhóm công ty')} *</span><select className="input" required value={reportGroup} onChange={(event) => selectReportGroup(event.target.value)}><option value="">{t('Chọn nhóm')}</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
      <label className="field"><span className="label">{t('Người dùng')} *</span><select className="input" required value={grantUserId} onChange={(event) => setGrantUserId(event.target.value)}><option value="">{t('Chọn người dùng')}</option>{users.filter((user) => !user.disabled).map((user) => <option key={user.id} value={user.id}>{user.name} · {user.id}</option>)}</select></label>
      <div className="row full"><span className="grow"/><button className="btn btn-primary" disabled={Boolean(busy) || loading || !reportGroup}>{t('Cấp quyền bảng cân đối phát sinh')}</button></div>
    </form>{grants.length > 0 && <div className="table-wrap"><table className="table"><thead><tr><th>{t('ID người dùng')}</th><th>{t('Nhóm')}</th><th>{t('Báo cáo')}</th><th>{t('Trạng thái')}</th><th>{t('Thao tác')}</th></tr></thead><tbody>{grants.map((grant) => <tr key={grant.id}><td>{grant.user_id}</td><td>{groups.find((group) => group.id === grant.group)?.name || grant.group}</td><td>{t('Bảng cân đối phát sinh')}</td><td>{t(grant.status || 'active')}</td><td>{grant.status === 'active' && <button className="btn btn-secondary" type="button" disabled={Boolean(busy)} onClick={() => revokeReportGrant(grant)}>{t('Thu hồi quyền')}</button>}</td></tr>)}</tbody></table></div>}</section>}
    {can('consolidation.company_group.read') && can('accounting.journal_entry.read') && <ConsolidatedTrialBalancePanel
      groups={groups} reportGroup={reportGroup} reportFrom={reportFrom} reportTo={reportTo}
      ratePolicyDays={ratePolicyDays} reportSnapshots={reportSnapshots} selectedSnapshotId={selectedSnapshotId}
      report={report} busy={busy} loading={loading} canUpdateRatePolicy={can('consolidation.company_group.update')}
      fmtNumber={fmtNumber} onGroupChange={selectReportGroup}
      onFromChange={(value) => changeReportPeriod('from', value)} onToChange={(value) => changeReportPeriod('to', value)} onLoadReport={loadReport}
      onRatePolicyDaysChange={setRatePolicyDays} onSaveRatePolicy={saveRatePolicy}
      onOpenSnapshot={openReportSnapshot} onSaveSnapshot={saveReportSnapshot} t={t}
    />}
    <section className="card card-pad"><h2>{t('Thành viên nhóm công ty')}</h2>{loading ? <div className="skeleton" data-h="row"/> : !members.length ? <div className="empty">{t('Chưa có tenant thành viên.')}</div> : <div className="table-wrap"><table className="table"><thead><tr><th>{t('Tenant')}</th><th>{t('Nhóm')}</th><th>{t('Trạng thái')}</th>{canManage && <th>{t('Thao tác')}</th>}</tr></thead><tbody>{members.map((member) => <tr key={member.id}><td>{member.member_name}<div className="faint">{member.member_tenant_id}</div></td><td>{groups.find((group) => group.id === member.group)?.name || member.group}</td><td><span className={`badge ${member.status === 'active' ? 'success' : member.status === 'revoked' ? '' : 'warning'}`}>{t(member.status || 'invited')}</span></td>{canManage && <td>{member.status !== 'revoked' && <button className="btn btn-secondary" type="button" disabled={Boolean(busy)} onClick={() => revokeMember(member)}>{t('Thu hồi')}</button>}</td>}</tr>)}</tbody></table></div>}</section>
    <section className="card card-pad"><h2>{t('Tenant đã chấp thuận chia sẻ với đơn vị này')}</h2>{loading ? <div className="skeleton" data-h="row"/> : !shares.length ? <div className="empty">{t('Chưa có consent chia sẻ nào.')}</div> : <div className="table-wrap"><table className="table"><thead><tr><th>{t('Tenant chủ dữ liệu')}</th><th>{t('Trạng thái')}</th>{canManage && <th>{t('Thao tác')}</th>}</tr></thead><tbody>{shares.map((share) => <tr key={share.id}><td>{share.owner_name}<div className="faint">{share.owner_tenant_id}</div></td><td><span className={`badge ${share.status === 'active' ? 'success' : ''}`}>{t(share.status || 'active')}</span></td>{canManage && <td>{share.status === 'active' && <button className="btn btn-secondary" type="button" disabled={Boolean(busy)} onClick={() => revokeShare(share)}>{t('Thu hồi consent')}</button>}</td>}</tr>)}</tbody></table></div>}</section>
    {report?.companies?.map((company) => <details className="card card-pad" key={company.tenantId}><summary><strong>{company.name}</strong> · {t('Số gốc')} {company.localCurrency} · {t('Tỷ giá')} {fmtNumber(String(company.conversionRate ?? 0), { maximumFractionDigits: 8 })} {t('ngày hiệu lực')} {company.rateEffectiveDate} · {t('Tuổi tỷ giá')} {company.rateAgeDays}/{company.maxRateAgeDays ?? '—'} {t('ngày')}</summary><div className="table-wrap"><table className="table"><thead><tr><th>{t('Mã tài khoản')}</th><th>{t('Tài khoản')}</th><th>{t('Dư nợ gốc')}</th><th>{t('Dư có gốc')}</th><th>{t('Dư nợ quy đổi')}</th><th>{t('Dư có quy đổi')}</th></tr></thead><tbody>{company.accounts?.map((account) => <tr key={`${account.code}:${account.kind}`}><td>{account.code}</td><td>{account.name}</td><td className="num">{fmtNumber(String(account.closingDebit ?? 0))}</td><td className="num">{fmtNumber(String(account.closingCredit ?? 0))}</td><td className="num">{fmtNumber(String(account.reportingClosingDebit ?? 0))}</td><td className="num">{fmtNumber(String(account.reportingClosingCredit ?? 0))}</td></tr>)}</tbody></table></div></details>)}
    {report?.reconciliation && <section className="card card-pad"><h2>{t('Đối chiếu số dư')}</h2><div className="row"><span>{t('Tổng dư nợ cuối kỳ')} · {report.reportingCurrency}: {fmtNumber(String(report.reconciliation.closingDebitTotal ?? 0))}</span><span>{t('Tổng dư có cuối kỳ')} · {report.reportingCurrency}: {fmtNumber(String(report.reconciliation.closingCreditTotal ?? 0))}</span><strong>{t('Chênh lệch')}: {fmtNumber(String(report.reconciliation.difference ?? 0))}</strong><span className={`badge ${report.reconciliation.withinCentTolerance ? 'success' : 'warning'}`}>{report.reconciliation.withinCentTolerance ? t('Cân trong ngưỡng một xu') : t('Cần rà soát chênh lệch')}</span></div></section>}
  </div>;
}
