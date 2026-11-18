import React, { useCallback, useEffect, useState } from 'react';
import { useDocumentTitle } from '../../lib/useDocumentTitle.js';
import { api, dataPath, tenantPath } from '../../lib/api.js';
import { can, isAdmin } from '../../lib/state.js';
import { uiTextWith } from '../../lib/i18n.js';
import consolidationEnglish from './consolidation.en.js';

const t = (text) => uiTextWith(text, consolidationEnglish);
const itemsOf = (response) => Array.isArray(response?.items) ? response.items : [];
async function listAll(qname) {
  const response = await api(`${dataPath(qname)}?limit=1000&offset=0`);
  return itemsOf(response);
}

export default function ConsolidationWorkbenchPage() {
  useDocumentTitle(`${t('Quản lý tập đoàn')} · OSP Suite`);
  const [groups, setGroups] = useState([]);
  const [members, setMembers] = useState([]);
  const [shares, setShares] = useState([]);
  const [grants, setGrants] = useState([]);
  const [users, setUsers] = useState([]);
  const [grantUserId, setGrantUserId] = useState('');
  const [currencies, setCurrencies] = useState([]);
  const [groupForm, setGroupForm] = useState({ name: '', reporting_currency: '' });
  const [inviteForm, setInviteForm] = useState({ groupId: '', memberTenantId: '' });
  const [acceptForm, setAcceptForm] = useState({ ownerTenantId: '', memberId: '', inviteToken: '' });
  const [inviteResult, setInviteResult] = useState(null);
  const [reportGroup, setReportGroup] = useState('');
  const [reportFrom, setReportFrom] = useState('');
  const [reportTo, setReportTo] = useState('');
  const [report, setReport] = useState(null);
  const [reportSnapshots, setReportSnapshots] = useState([]);
  const [selectedSnapshotId, setSelectedSnapshotId] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async (quiet = false) => {
    if (!quiet) { setLoading(true); setError(''); }
    try {
      const [groupRows, memberRows, shareRows, grantRows, currencyRows, userRows] = await Promise.all([
        can('consolidation.company_group.read') ? listAll('consolidation.company_group') : Promise.resolve([]),
        can('consolidation.member.read') ? listAll('consolidation.member') : Promise.resolve([]),
        can('consolidation.shared_company.read') ? listAll('consolidation.shared_company') : Promise.resolve([]),
        can('consolidation.report_grant.read') ? listAll('consolidation.report_grant') : Promise.resolve([]),
        can('master-data.currency.read') ? listAll('master-data.currency') : Promise.resolve([]),
        isAdmin() ? api(tenantPath('/users')) : Promise.resolve([]),
      ]);
      setGroups(groupRows); setMembers(memberRows); setShares(shareRows); setGrants(grantRows); setCurrencies(currencyRows); setUsers(Array.isArray(userRows) ? userRows : []);
      setInviteForm((form) => ({ ...form, groupId: groupRows.some((row) => row.id === form.groupId) ? form.groupId : groupRows[0]?.id || '' }));
      setReportGroup((id) => groupRows.some((row) => row.id === id) ? id : groupRows[0]?.id || '');
      setGroupForm((form) => ({ ...form, reporting_currency: currencies.some((row) => row.id === form.reporting_currency) ? form.reporting_currency : currencyRows[0]?.id || '' }));
    } catch (reason) { setError(reason.message || t('Không tải được dữ liệu tập đoàn.')); }
    finally { if (!quiet) setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function run(key, action, success) {
    setBusy(key); setError(''); setNotice('');
    try { const result = await action(); setNotice(success); await load(true); return result; }
    catch (reason) { setError(reason.message || t('Không hoàn tất được thao tác.')); return null; }
    finally { setBusy(''); }
  }

  async function createGroup(event) {
    event.preventDefault();
    await run('group', () => api(dataPath('consolidation.company_group'), { method: 'POST', body: groupForm }), t('Đã tạo nhóm công ty.'));
    setGroupForm((form) => ({ ...form, name: '' }));
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
    if (!groupId) { setReportSnapshots([]); return; }
    const result = await api(tenantPath(`/consolidation/groups/${encodeURIComponent(groupId)}/trial-balance/snapshots`));
    setReportSnapshots(itemsOf(result));
  }, [reportGroup]);
  useEffect(() => {
    if (!reportGroup || !can('consolidation.company_group.read') || !can('accounting.journal_entry.read')) { setReportSnapshots([]); return undefined; }
    let current = true;
    api(tenantPath(`/consolidation/groups/${encodeURIComponent(reportGroup)}/trial-balance/snapshots`))
      .then((result) => { if (current) setReportSnapshots(itemsOf(result)); })
      .catch(() => { if (current) setReportSnapshots([]); });
    return () => { current = false; };
  }, [reportGroup]);
  async function loadReport(event) {
    event.preventDefault(); setBusy('report'); setError(''); setReport(null);
    try {
      const params = new URLSearchParams();
      if (reportFrom) params.set('from', reportFrom);
      if (reportTo) params.set('to', reportTo);
      setReport(await api(tenantPath(`/consolidation/groups/${encodeURIComponent(reportGroup)}/trial-balance?${params}`)));
      setSelectedSnapshotId('');
    } catch (reason) { setError(reason.message || t('Không tải được báo cáo hợp nhất.')); }
    finally { setBusy(''); }
  }
  async function saveReportSnapshot() {
    setBusy('snapshot'); setError(''); setNotice('');
    try {
      const result = await api(tenantPath(`/consolidation/groups/${encodeURIComponent(reportGroup)}/trial-balance/snapshots`), {
        method: 'POST', body: { ...(reportFrom ? { from: reportFrom } : {}), ...(reportTo ? { to: reportTo } : {}) },
      });
      setReport(result.report); setSelectedSnapshotId(result.snapshotId);
      await refreshReportSnapshots(reportGroup);
      setNotice(t('Đã lưu ảnh chụp báo cáo bất biến.'));
    } catch (reason) { setError(reason.message || t('Không lưu được ảnh chụp báo cáo.')); }
    finally { setBusy(''); }
  }
  async function openReportSnapshot(snapshot) {
    setBusy(`snapshot:${snapshot.id}`); setError(''); setNotice('');
    try {
      const result = await api(tenantPath(`/consolidation/trial-balance/snapshots/${encodeURIComponent(snapshot.id)}`));
      setReport(result.report); setSelectedSnapshotId(result.snapshotId);
      setReportFrom(result.from || ''); setReportTo(result.to || '');
      setNotice(`${t('Đang xem ảnh chụp ngày')} ${new Date(result.snapshotAt).toLocaleString()}`);
    } catch (reason) { setError(reason.message || t('Không mở được ảnh chụp báo cáo.')); }
    finally { setBusy(''); }
  }

  const canManage = isAdmin();
  return <div className="page">
    <div className="page-head"><div><h1>{t('Quản lý tập đoàn')}</h1><p className="sub">{t('Tạo nhóm pháp nhân, yêu cầu tenant thành viên đồng ý và quản lý quyền chia sẻ.')}</p></div><button className="btn btn-secondary" type="button" disabled={loading || Boolean(busy)} onClick={() => load()}>{t('Làm mới')}</button></div>
    {error && <div className="alert danger" role="alert">{t(error)}</div>}{notice && <div className="alert success" role="status">{t(notice)}</div>}
    {canManage && can('consolidation.company_group.create') && <section className="card card-pad"><h2>{t('Tạo nhóm công ty')}</h2><form className="form-grid" onSubmit={createGroup}>
      <label className="field"><span className="label">{t('Tên nhóm')} *</span><input className="input" required maxLength={160} value={groupForm.name} onChange={(event) => setGroupForm((form) => ({ ...form, name: event.target.value }))}/></label>
      <label className="field"><span className="label">{t('Tiền tệ báo cáo')} *</span><select className="input" required value={groupForm.reporting_currency} onChange={(event) => setGroupForm((form) => ({ ...form, reporting_currency: event.target.value }))}><option value="">{t('Chọn tiền tệ')}</option>{currencies.map((currency) => <option key={currency.id} value={currency.id}>{currency.code} · {currency.name}</option>)}</select></label>
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
      <label className="field"><span className="label">{t('Nhóm công ty')} *</span><select className="input" required value={reportGroup} onChange={(event) => setReportGroup(event.target.value)}><option value="">{t('Chọn nhóm')}</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
      <label className="field"><span className="label">{t('Người dùng')} *</span><select className="input" required value={grantUserId} onChange={(event) => setGrantUserId(event.target.value)}><option value="">{t('Chọn người dùng')}</option>{users.filter((user) => !user.disabled).map((user) => <option key={user.id} value={user.id}>{user.name} · {user.id}</option>)}</select></label>
      <div className="row full"><span className="grow"/><button className="btn btn-primary" disabled={Boolean(busy) || loading || !reportGroup}>{t('Cấp quyền bảng cân đối phát sinh')}</button></div>
    </form>{grants.length > 0 && <div className="table-wrap"><table className="table"><thead><tr><th>{t('ID người dùng')}</th><th>{t('Nhóm')}</th><th>{t('Báo cáo')}</th><th>{t('Trạng thái')}</th><th>{t('Thao tác')}</th></tr></thead><tbody>{grants.map((grant) => <tr key={grant.id}><td>{grant.user_id}</td><td>{groups.find((group) => group.id === grant.group)?.name || grant.group}</td><td>{t('Bảng cân đối phát sinh')}</td><td>{t(grant.status || 'active')}</td><td>{grant.status === 'active' && <button className="btn btn-secondary" type="button" disabled={Boolean(busy)} onClick={() => revokeReportGrant(grant)}>{t('Thu hồi quyền')}</button>}</td></tr>)}</tbody></table></div>}</section>}
    {can('consolidation.company_group.read') && can('accounting.journal_entry.read') && <section className="card card-pad"><h2>{t('Bảng cân đối phát sinh hợp nhất')}</h2><p className="sub">{t('Số dư từng tenant được đọc trong phạm vi RLS riêng, chỉ cộng sau khi xác minh consent hai chiều và quy đổi theo tỷ giá có hiệu lực cuối kỳ.')}</p><form className="form-grid" onSubmit={loadReport}>
      <label className="field"><span className="label">{t('Nhóm công ty')} *</span><select className="input" required value={reportGroup} onChange={(event) => setReportGroup(event.target.value)}><option value="">{t('Chọn nhóm')}</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
      <label className="field"><span className="label">{t('Từ ngày')}</span><input className="input" type="date" value={reportFrom} onChange={(event) => setReportFrom(event.target.value)}/></label>
      <label className="field"><span className="label">{t('Đến ngày')}</span><input className="input" type="date" value={reportTo} onChange={(event) => setReportTo(event.target.value)}/></label>
      <div className="row full"><span className="grow"/><button className="btn btn-primary" disabled={Boolean(busy) || loading || !reportGroup}>{t('Xem báo cáo')}</button></div>
        </form>
    {reportSnapshots.length > 0 && <section className="snapshot-list" aria-labelledby="report-snapshots-heading"><h3 id="report-snapshots-heading">{t('Lịch sử báo cáo đã lưu')}</h3><ul>{reportSnapshots.map((snapshot) => <li key={snapshot.id}><span>{new Date(snapshot.snapshotAt).toLocaleString()} · {snapshot.from || t('Từ đầu kỳ')} – {snapshot.to} · {snapshot.reportingCurrency}</span><button className="btn btn-secondary btn-sm" type="button" disabled={Boolean(busy)} onClick={() => openReportSnapshot(snapshot)}>{t('Mở báo cáo đã lưu')}</button></li>)}</ul></section>}
    {report && <div className="row"><span className="faint">{selectedSnapshotId ? t('Đang xem ảnh chụp đã lưu') : t('Báo cáo trực tiếp')}</span><span className="grow"/><button className="btn btn-secondary" type="button" disabled={Boolean(busy) || loading} onClick={saveReportSnapshot}>{busy === 'snapshot' ? t('Đang lưu') : t('Lưu ảnh chụp')}</button></div>}
    {report && <><div className="row"><strong>{t('Tiền tệ báo cáo')}: {report.reportingCurrency}</strong><span className="grow"/><span className="faint">{report.companies?.length || 0} {t('tenant')}</span></div><p className="faint">{t('Cơ sở quy đổi')}: {report.rateBasis} · {t('Phương pháp')}: {report.consolidationMethod}</p><div className="table-wrap"><table className="table"><thead><tr><th>{t('Mã tài khoản')}</th><th>{t('Tài khoản')}</th><th>{t('Dư nợ đầu kỳ')}</th><th>{t('Dư có đầu kỳ')}</th><th>{t('Phát sinh nợ')}</th><th>{t('Phát sinh có')}</th><th>{t('Dư nợ cuối kỳ')}</th><th>{t('Dư có cuối kỳ')}</th></tr></thead><tbody>{report.accounts?.map((account) => <tr key={`${account.code}:${account.kind}`}><td>{account.code}</td><td>{account.name}</td><td className="num">{Number(account.openingDebit || 0).toLocaleString()}</td><td className="num">{Number(account.openingCredit || 0).toLocaleString()}</td><td className="num">{Number(account.periodDebit || 0).toLocaleString()}</td><td className="num">{Number(account.periodCredit || 0).toLocaleString()}</td><td className="num">{Number(account.closingDebit || 0).toLocaleString()}</td><td className="num">{Number(account.closingCredit || 0).toLocaleString()}</td></tr>)}</tbody></table></div></>}</section>}
    <section className="card card-pad"><h2>{t('Thành viên nhóm công ty')}</h2>{loading ? <div className="skeleton" data-h="row"/> : !members.length ? <div className="empty">{t('Chưa có tenant thành viên.')}</div> : <div className="table-wrap"><table className="table"><thead><tr><th>{t('Tenant')}</th><th>{t('Nhóm')}</th><th>{t('Trạng thái')}</th>{canManage && <th>{t('Thao tác')}</th>}</tr></thead><tbody>{members.map((member) => <tr key={member.id}><td>{member.member_name}<div className="faint">{member.member_tenant_id}</div></td><td>{groups.find((group) => group.id === member.group)?.name || member.group}</td><td><span className={`badge ${member.status === 'active' ? 'success' : member.status === 'revoked' ? '' : 'warning'}`}>{t(member.status || 'invited')}</span></td>{canManage && <td>{member.status !== 'revoked' && <button className="btn btn-secondary" type="button" disabled={Boolean(busy)} onClick={() => revokeMember(member)}>{t('Thu hồi')}</button>}</td>}</tr>)}</tbody></table></div>}</section>
    <section className="card card-pad"><h2>{t('Tenant đã chấp thuận chia sẻ với đơn vị này')}</h2>{loading ? <div className="skeleton" data-h="row"/> : !shares.length ? <div className="empty">{t('Chưa có consent chia sẻ nào.')}</div> : <div className="table-wrap"><table className="table"><thead><tr><th>{t('Tenant chủ dữ liệu')}</th><th>{t('Trạng thái')}</th>{canManage && <th>{t('Thao tác')}</th>}</tr></thead><tbody>{shares.map((share) => <tr key={share.id}><td>{share.owner_name}<div className="faint">{share.owner_tenant_id}</div></td><td><span className={`badge ${share.status === 'active' ? 'success' : ''}`}>{t(share.status || 'active')}</span></td>{canManage && <td>{share.status === 'active' && <button className="btn btn-secondary" type="button" disabled={Boolean(busy)} onClick={() => revokeShare(share)}>{t('Thu hồi consent')}</button>}</td>}</tr>)}</tbody></table></div>}</section>
    {report?.companies?.map((company) => <details className="card card-pad" key={company.tenantId}><summary><strong>{company.name}</strong> · {t('Số gốc')} {company.localCurrency} · {t('Tỷ giá')} {Number(company.conversionRate).toLocaleString()} {t('ngày hiệu lực')} {company.rateEffectiveDate}</summary><div className="table-wrap"><table className="table"><thead><tr><th>{t('Mã tài khoản')}</th><th>{t('Tài khoản')}</th><th>{t('Dư nợ gốc')}</th><th>{t('Dư có gốc')}</th><th>{t('Dư nợ quy đổi')}</th><th>{t('Dư có quy đổi')}</th></tr></thead><tbody>{company.accounts?.map((account) => <tr key={`${account.code}:${account.kind}`}><td>{account.code}</td><td>{account.name}</td><td className="num">{Number(account.closingDebit || 0).toLocaleString()}</td><td className="num">{Number(account.closingCredit || 0).toLocaleString()}</td><td className="num">{Number(account.reportingClosingDebit || 0).toLocaleString()}</td><td className="num">{Number(account.reportingClosingCredit || 0).toLocaleString()}</td></tr>)}</tbody></table></div></details>)}
    {report?.reconciliation && <section className="card card-pad"><h2>{t('Đối chiếu số dư')}</h2><div className="row"><span>{t('Tổng dư nợ cuối kỳ')} · {report.reportingCurrency}: {Number(report.reconciliation.closingDebitTotal).toLocaleString()}</span><span>{t('Tổng dư có cuối kỳ')} · {report.reportingCurrency}: {Number(report.reconciliation.closingCreditTotal).toLocaleString()}</span><strong>{t('Chênh lệch')}: {Number(report.reconciliation.difference).toLocaleString()}</strong><span className={`badge ${report.reconciliation.withinCentTolerance ? 'success' : 'warning'}`}>{report.reconciliation.withinCentTolerance ? t('Cân trong ngưỡng một xu') : t('Cần rà soát chênh lệch')}</span></div></section>}
  </div>;
}
