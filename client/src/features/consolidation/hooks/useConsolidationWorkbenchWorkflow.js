import { useCallback, useEffect, useRef, useState } from 'react';
import { api, dataPath, tenantPath } from '../../../lib/api.js';
import { can } from '../../../lib/state.js';

const itemsOf = (response) => Array.isArray(response?.items) ? response.items : [];
const blankEliminationForm = () => ({ posting_date: '', memo: '', account_debit: '', debit: '', account_credit: '', credit: '', evidence: '' });

export function useConsolidationWorkbenchWorkflow({ groups, currencies, load, t }) {
  const [groupForm, setGroupForm] = useState({ name: '', reporting_currency: '', max_rate_age_days: '30' });
  const [inviteForm, setInviteForm] = useState({ groupId: '', memberTenantId: '' });
  const [acceptForm, setAcceptForm] = useState({ ownerTenantId: '', memberId: '', inviteToken: '' });
  const [inviteResult, setInviteResult] = useState(null);
  const [grantUserId, setGrantUserId] = useState('');
  const [grantReportType, setGrantReportType] = useState('trial_balance');
  const [reportGroup, setReportGroup] = useState('');
  const [reportFrom, setReportFrom] = useState('');
  const [reportTo, setReportTo] = useState('');
  const [report, setReport] = useState(null);
  const [ratePolicyDays, setRatePolicyDays] = useState('30');
  const [reportSnapshots, setReportSnapshots] = useState([]);
  const [eliminationForm, setEliminationForm] = useState(blankEliminationForm);
  const [selectedSnapshotId, setSelectedSnapshotId] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const reportRequestRef = useRef(0);
  const snapshotListRequestRef = useRef(0);

  useEffect(() => {
    setInviteForm((form) => ({ ...form, groupId: groups.some((row) => row.id === form.groupId) ? form.groupId : groups[0]?.id || '' }));
    setReportGroup((id) => groups.some((row) => row.id === id) ? id : groups[0]?.id || '');
  }, [groups]);
  useEffect(() => {
    const currentGroup = groups.find((row) => row.id === reportGroup);
    setRatePolicyDays(String(currentGroup?.max_rate_age_days ?? '30'));
  }, [groups, reportGroup]);
  useEffect(() => {
    setGroupForm((form) => ({ ...form, reporting_currency: currencies.some((row) => row.id === form.reporting_currency) ? form.reporting_currency : currencies[0]?.id || '' }));
  }, [currencies]);

  async function run(key, operation, success) {
    setBusy(key); setError(''); setNotice('');
    try { const result = await operation(); setNotice(success); await load(true); return result; }
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
    setBusy(''); setReportGroup(groupId);
    setRatePolicyDays(String(groups.find((group) => group.id === groupId)?.max_rate_age_days ?? '30'));
    setReport(null); setSelectedSnapshotId('');
  }
  function changeReportPeriod(field, value) {
    reportRequestRef.current += 1; setBusy(''); setReport(null); setSelectedSnapshotId('');
    if (field === 'from') setReportFrom(value); else setReportTo(value);
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
    const result = await run('grant', () => api(tenantPath(`/consolidation/groups/${encodeURIComponent(reportGroup)}/report-grants`), { method: 'POST', body: { userId: grantUserId.trim(), reportType: grantReportType } }), t('Đã cấp quyền xem báo cáo.'));
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
    const requestId = ++reportRequestRef.current; const groupId = reportGroup; const from = reportFrom; const to = reportTo;
    setBusy('report'); setError(''); setReport(null);
    try {
      const params = new URLSearchParams(); if (from) params.set('from', from); if (to) params.set('to', to);
      const result = await api(tenantPath(`/consolidation/groups/${encodeURIComponent(groupId)}/trial-balance?${params}`));
      if (requestId !== reportRequestRef.current || groupId !== reportGroup) return;
      setReport(result); setSelectedSnapshotId('');
    } catch (reason) { if (requestId === reportRequestRef.current && groupId === reportGroup) setError(reason.message || t('Không tải được báo cáo hợp nhất.')); }
    finally { if (requestId === reportRequestRef.current) setBusy(''); }
  }
  async function saveReportSnapshot() {
    const requestId = ++reportRequestRef.current; const groupId = reportGroup; const from = reportFrom; const to = reportTo;
    setBusy('snapshot'); setError(''); setNotice('');
    try {
      const result = await api(tenantPath(`/consolidation/groups/${encodeURIComponent(groupId)}/trial-balance/snapshots`), { method: 'POST', body: { ...(from ? { from } : {}), ...(to ? { to } : {}) } });
      if (requestId !== reportRequestRef.current || groupId !== reportGroup) return;
      setReport(result.report); setSelectedSnapshotId(result.snapshotId);
      await refreshReportSnapshots(groupId);
      if (requestId !== reportRequestRef.current || groupId !== reportGroup) return;
      setNotice(t('Đã lưu ảnh chụp báo cáo bất biến.'));
    } catch (reason) { if (requestId === reportRequestRef.current && groupId === reportGroup) setError(reason.message || t('Không lưu được ảnh chụp báo cáo.')); }
    finally { if (requestId === reportRequestRef.current) setBusy(''); }
  }
  async function openReportSnapshot(snapshot) {
    const requestId = ++reportRequestRef.current; const groupId = reportGroup;
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
        group: reportGroup, posting_date: eliminationForm.posting_date, memo: eliminationForm.memo.trim(),
        lines: [
          { accountCode: eliminationForm.account_debit, debit: String(eliminationForm.debit).trim(), credit: '0' },
          { accountCode: eliminationForm.account_credit, debit: '0', credit: String(eliminationForm.credit).trim() },
        ], matching_evidence: [eliminationForm.evidence.trim()],
      } });
      await api(dataPath('consolidation.elimination_journal', record.id, 'submitted'), { method: 'POST' });
      return record;
    }, t('Đã gửi bút toán loại trừ để duyệt độc lập.'));
    if (result) setEliminationForm(blankEliminationForm());
  }
  const updateEliminationField = (field, value) => setEliminationForm((form) => ({ ...form, [field]: value }));

  return {
    groupForm, setGroupForm, inviteForm, setInviteForm, acceptForm, setAcceptForm, inviteResult,
    grantUserId, setGrantUserId, grantReportType, setGrantReportType, reportGroup, reportFrom, reportTo, report, ratePolicyDays, setRatePolicyDays,
    reportSnapshots, eliminationForm, selectedSnapshotId, busy, error, notice,
    createGroup, selectReportGroup, changeReportPeriod, saveRatePolicy, invite, accept, revokeMember, revokeShare,
    createReportGrant, revokeReportGrant, loadReport, saveReportSnapshot, openReportSnapshot,
    createElimination, updateEliminationField,
  };
}
