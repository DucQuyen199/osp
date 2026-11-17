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
  const [currencies, setCurrencies] = useState([]);
  const [groupForm, setGroupForm] = useState({ name: '', reporting_currency: '' });
  const [inviteForm, setInviteForm] = useState({ groupId: '', memberTenantId: '' });
  const [acceptForm, setAcceptForm] = useState({ ownerTenantId: '', memberId: '', inviteToken: '' });
  const [inviteResult, setInviteResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async (quiet = false) => {
    if (!quiet) { setLoading(true); setError(''); }
    try {
      const [groupRows, memberRows, shareRows, currencyRows] = await Promise.all([
        can('consolidation.company_group.read') ? listAll('consolidation.company_group') : Promise.resolve([]),
        can('consolidation.member.read') ? listAll('consolidation.member') : Promise.resolve([]),
        can('consolidation.shared_company.read') ? listAll('consolidation.shared_company') : Promise.resolve([]),
        can('master-data.currency.read') ? listAll('master-data.currency') : Promise.resolve([]),
      ]);
      setGroups(groupRows); setMembers(memberRows); setShares(shareRows); setCurrencies(currencyRows);
      setInviteForm((form) => ({ ...form, groupId: groupRows.some((row) => row.id === form.groupId) ? form.groupId : groupRows[0]?.id || '' }));
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
    <section className="card card-pad"><h2>{t('Thành viên nhóm công ty')}</h2>{loading ? <div className="skeleton" data-h="row"/> : !members.length ? <div className="empty">{t('Chưa có tenant thành viên.')}</div> : <div className="table-wrap"><table className="table"><thead><tr><th>{t('Tenant')}</th><th>{t('Nhóm')}</th><th>{t('Trạng thái')}</th>{canManage && <th>{t('Thao tác')}</th>}</tr></thead><tbody>{members.map((member) => <tr key={member.id}><td>{member.member_name}<div className="faint">{member.member_tenant_id}</div></td><td>{groups.find((group) => group.id === member.group)?.name || member.group}</td><td><span className={`badge ${member.status === 'active' ? 'success' : member.status === 'revoked' ? '' : 'warning'}`}>{t(member.status || 'invited')}</span></td>{canManage && <td>{member.status !== 'revoked' && <button className="btn btn-secondary" type="button" disabled={Boolean(busy)} onClick={() => revokeMember(member)}>{t('Thu hồi')}</button>}</td>}</tr>)}</tbody></table></div>}</section>
    <section className="card card-pad"><h2>{t('Tenant đã chấp thuận chia sẻ với đơn vị này')}</h2>{loading ? <div className="skeleton" data-h="row"/> : !shares.length ? <div className="empty">{t('Chưa có consent chia sẻ nào.')}</div> : <div className="table-wrap"><table className="table"><thead><tr><th>{t('Tenant chủ dữ liệu')}</th><th>{t('Trạng thái')}</th>{canManage && <th>{t('Thao tác')}</th>}</tr></thead><tbody>{shares.map((share) => <tr key={share.id}><td>{share.owner_name}<div className="faint">{share.owner_tenant_id}</div></td><td><span className={`badge ${share.status === 'active' ? 'success' : ''}`}>{t(share.status || 'active')}</span></td>{canManage && <td>{share.status === 'active' && <button className="btn btn-secondary" type="button" disabled={Boolean(busy)} onClick={() => revokeShare(share)}>{t('Thu hồi consent')}</button>}</td>}</tr>)}</tbody></table></div>}</section>
  </div>;
}
