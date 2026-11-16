import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { selectableTableRowProps } from '../../lib/accessibility.js';
import { localDate } from '../../lib/dates.js';
import { api, dataPath } from '../../lib/api.js';
import { fmtDateTime, fmtNumber, uiTextWith } from '../../lib/i18n.js';
import { can, loadAllResponse, loadRefs, recordLabel } from '../../lib/state.js';
import loyaltyEnglish from './loyalty.en.js';

const t = (text) => uiTextWith(text, loyaltyEnglish);

const rows = (response) => Array.isArray(response?.items) ? response.items : [];
const tiers = ['bronze', 'silver', 'gold', 'platinum'];
const tierLabels = { bronze: 'Đồng', silver: 'Bạc', gold: 'Vàng', platinum: 'Bạch kim' };
const sourceLabels = { pos_order: 'Đơn POS', sales_order: 'Đơn bán hàng', pos_order_refund: 'Hoàn POS', sales_return: 'Trả hàng' };
const points = (value) => fmtNumber(Number(value || 0), { maximumFractionDigits: 2 });

export default function LoyaltyWorkbenchPage() {
  const [members, setMembers] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [vouchers, setVouchers] = useState([]);
  const [parties, setParties] = useState(new Map());
  const [selectedId, setSelectedId] = useState('');
  const [form, setForm] = useState({ party: '', tier: 'bronze' });
  const [voucherForm, setVoucherForm] = useState({ code: '', kind: 'percent', value: '', valid_until: '' });
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async (quiet = false) => {
    if (!quiet) { setLoading(true); setError(''); }
    try {
      const [memberRes, transactionRes, partyMap, voucherRes] = await Promise.all([
        can('loyalty.member.read') ? loadAllResponse('loyalty.member') : Promise.resolve({ items: [] }),
        can('loyalty.point_txn.read') ? loadAllResponse('loyalty.point_txn') : Promise.resolve({ items: [] }),
        can('master-data.party.read') ? loadRefs('master-data.party') : Promise.resolve(new Map()),
        can('loyalty.voucher.read') ? loadAllResponse('loyalty.voucher') : Promise.resolve({ items: [] }),
      ]);
      const memberRows = rows(memberRes).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
      setMembers(memberRows); setTransactions(rows(transactionRes).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))); setParties(partyMap);
      setVouchers(rows(voucherRes).sort((a, b) => String(a.valid_until || '').localeCompare(String(b.valid_until || ''))));
      setSelectedId((id) => memberRows.some((row) => row.id === id) ? id : memberRows[0]?.id || '');
      setForm((current) => ({ ...current, party: current.party || [...partyMap.keys()][0] || '' }));
    } catch (reason) { setError(t(reason.message || 'Không tải được chương trình thành viên.')); }
    finally { if (!quiet) setLoading(false); }
  }, []);

  useEffect(() => { document.title = `${t('Khách hàng thân thiết')} · OSP Suite`; load(); }, [load]);
  const selected = members.find((row) => row.id === selectedId);
  const ledger = useMemo(() => transactions.filter((row) => row.party === selected?.party), [transactions, selected]);
  const totalPoints = members.reduce((sum, member) => sum + Number(member.points || 0), 0);
  const partyName = (id) => parties.has(id) ? recordLabel('master-data.party', parties.get(id)) : t('Khách hàng');

  async function run(key, operation, message) {
    setBusy(key); setError(''); setNotice('');
    try { await operation(); await load(true); setNotice(t(message)); }
    catch (reason) { setError(t(reason.message || 'Thao tác không thành công.')); }
    finally { setBusy(''); }
  }

  async function enroll(event) {
    event.preventDefault();
    await run('member:create', async () => {
      const created = await api(dataPath('loyalty.member'), { method: 'POST', body: { party: form.party, tier: form.tier } });
      setSelectedId(created.id); setForm((current) => ({ ...current, party: '' }));
    }, 'Đã đăng ký thành viên. Điểm sẽ được cộng tự động từ đơn hàng đủ điều kiện.');
  }

  async function changeTier(tier) {
    if (!selected || tier === selected.tier) return;
    await run(`${selected.id}:tier`, () => api(dataPath('loyalty.member', selected.id), { method: 'PATCH', body: { tier } }), 'Đã cập nhật hạng thành viên.');
  }

  async function createVoucher(event) {
    event.preventDefault();
    const value = Number(voucherForm.value);
    if (!Number.isFinite(value) || value <= 0 || (voucherForm.kind === 'percent' && value >= 100)) { setError(t('Giá trị voucher không hợp lệ.')); return; }
    const body = { code: voucherForm.code.trim().toUpperCase(), ...(voucherForm.kind === 'percent' ? { percent: value } : { amount: value }), ...(voucherForm.valid_until ? { valid_until: voucherForm.valid_until } : {}) };
    await run('voucher:create', async () => {
      await api(dataPath('loyalty.voucher'), { method: 'POST', body });
      setVoucherForm({ code: '', kind: 'percent', value: '', valid_until: '' });
    }, 'Đã phát hành voucher đơn lẻ. Mã được đánh dấu đã dùng khi đơn bán hoặc POS hoàn tất.');
  }

  return <div className="page">
    <div className="page-head"><div><h1>{t('Khách hàng thân thiết')}</h1><p className="sub">{t('Đăng ký thành viên và tra cứu số dư, lịch sử điểm được ghi tự động từ bán hàng, POS và trả hàng.')}</p></div><button className="btn btn-secondary" type="button" disabled={loading || Boolean(busy)} onClick={() => load()}>{t('Làm mới')}</button></div>
    {error && <div className="alert danger" role="alert">{t(error)}</div>}{notice && <div className="alert success" role="status">{t(notice)}</div>}
    <div className="stats" style={{ marginBottom: 16 }}><div className="card stat"><span className="stat-label">{t('Thành viên')}</span><strong className="stat-value">{members.length}</strong></div><div className="card stat"><span className="stat-label">{t('Tổng điểm đang lưu hành')}</span><strong className="stat-value">{points(totalPoints)}</strong></div><div className="card stat"><span className="stat-label">{t('Giao dịch điểm')}</span><strong className="stat-value">{transactions.length}</strong></div></div>
    {can('loyalty.member.create') && <section className="card card-pad"><h2>{t('Đăng ký thành viên')}</h2><form className="form-grid" onSubmit={enroll}><label className="field"><span className="label">{t('Khách hàng *')}</span><select className="select" required value={form.party} onChange={(event) => setForm({ ...form, party: event.target.value })}><option value="">{t('Chọn khách hàng')}</option>{[...parties.values()].filter((party) => !members.some((member) => member.party === party.id)).map((party) => <option key={party.id} value={party.id}>{recordLabel('master-data.party', party)}</option>)}</select></label><label className="field"><span className="label">{t('Hạng khởi điểm')}</span><select className="select" value={form.tier} onChange={(event) => setForm({ ...form, tier: event.target.value })}>{tiers.map((tier) => <option key={tier} value={tier}>{t(tierLabels[tier])}</option>)}</select></label><div className="row full"><span className="grow"/><button className="btn btn-primary" disabled={Boolean(busy) || !form.party}>{t('Đăng ký')}</button></div></form>{!parties.size && <p className="small muted">{t('Cần tạo khách hàng trong Danh mục trước khi đăng ký.')}</p>}</section>}
    {can('loyalty.voucher.create') && <section className="card card-pad"><h2>{t('Phát hành voucher')}</h2><form className="form-grid" onSubmit={createVoucher}><label className="field"><span className="label">{t('Mã voucher *')}</span><input className="input" required maxLength="80" value={voucherForm.code} onChange={(event) => setVoucherForm({ ...voucherForm, code: event.target.value.toUpperCase() })}/></label><label className="field"><span className="label">{t('Hình thức giảm')}</span><select className="select" value={voucherForm.kind} onChange={(event) => setVoucherForm({ ...voucherForm, kind: event.target.value, value: '' })}><option value="percent">{t('Phần trăm')}</option><option value="amount">{t('Số tiền')}</option></select></label><label className="field"><span className="label">{t('Giá trị')} {voucherForm.kind === 'percent' ? '(%)' : '(VND)'} *</span><input className="input" type="number" required min="0.0001" max={voucherForm.kind === 'percent' ? 100 : undefined} step="any" value={voucherForm.value} onChange={(event) => setVoucherForm({ ...voucherForm, value: event.target.value })}/></label><label className="field"><span className="label">{t('Hạn dùng')}</span><input className="input" type="date" min={localDate()} value={voucherForm.valid_until} onChange={(event) => setVoucherForm({ ...voucherForm, valid_until: event.target.value })}/></label><div className="row full"><span className="grow"/><button className="btn btn-primary" disabled={Boolean(busy)}>{t('Phát hành')}</button></div></form></section>}
    {!can('loyalty.member.read') ? <div className="empty">{t('Bạn chưa có quyền xem thành viên.')}</div> : loading ? <div className="skeleton" data-h="row"/> : !members.length ? <div className="empty">{t('Chưa có thành viên nào.')}</div> : <div className="layout-split"><section className="card table-wrap"><table className="table"><thead><tr><th>{t('Khách hàng')}</th><th>{t('Hạng')}</th><th className="right">{t('Điểm')}</th></tr></thead><tbody>{members.map((member) => <tr {...selectableTableRowProps} key={member.id} aria-selected={selectedId === member.id} className={selectedId === member.id ? 'selected' : ''} onClick={() => setSelectedId(member.id)} style={{ cursor: 'pointer' }}><td>{partyName(member.party)}</td><td>{t(tierLabels[member.tier] || 'Đồng')}</td><td className="right"><strong>{points(member.points)}</strong></td></tr>)}</tbody></table></section>
      {selected && <section className="card card-pad"><div className="row wrap"><div><h2>{partyName(selected.party)}</h2><span className="small muted">{t('Đăng ký ')}{fmtDateTime(selected.createdAt)}</span></div><span className="grow"/><span className="badge success">{points(selected.points)} {t('điểm')}</span></div>{can('loyalty.member.update') && <label className="field" style={{ marginTop: 12 }}><span className="label">{t('Hạng thành viên')}</span><select className="select" value={selected.tier || 'bronze'} disabled={Boolean(busy)} onChange={(event) => changeTier(event.target.value)}>{tiers.map((tier) => <option key={tier} value={tier}>{t(tierLabels[tier])}</option>)}</select></label>}
        <h3 style={{ marginTop: 18 }}>{t('Sổ điểm')}</h3>{!can('loyalty.point_txn.read') ? <div className="empty">{t('Bạn chưa có quyền xem lịch sử điểm.')}</div> : !ledger.length ? <div className="empty">{t('Chưa có giao dịch điểm. Điểm được phát sinh khi đơn hàng hoàn tất.')}</div> : <div className="table-wrap"><table className="table"><thead><tr><th>{t('Thời gian')}</th><th>{t('Nguồn')}</th><th>{t('Mã chứng từ')}</th><th className="right">{t('Điểm')}</th></tr></thead><tbody>{ledger.map((row) => <tr key={row.id}><td>{fmtDateTime(row.createdAt)}</td><td>{t(sourceLabels[row.source] || row.source)}</td><td className="mono small">{String(row.source_id || '').slice(0, 8)}</td><td className="right"><strong className={Number(row.points) < 0 ? 'danger-text' : ''}>{Number(row.points) > 0 ? '+' : ''}{points(row.points)}</strong></td></tr>)}</tbody></table></div>}
        <p className="small muted" style={{ marginTop: 12 }}>{t('Số dư và giao dịch điểm chỉ cập nhật từ sự kiện bán hàng, hoàn tiền hoặc trả hàng; nhân viên không thể sửa sổ điểm thủ công.')}</p>
      </section>}</div>}
    {can('loyalty.voucher.read') && <section className="card card-pad"><h2>{t('Voucher đã phát hành')}</h2>{!vouchers.length ? <div className="empty">{t('Chưa có voucher.')}</div> : <div className="table-wrap"><table className="table"><thead><tr><th>{t('Mã')}</th><th>{t('Mức giảm')}</th><th>{t('Hạn dùng')}</th><th>{t('Trạng thái')}</th><th>{t('Đơn sử dụng')}</th></tr></thead><tbody>{vouchers.map((voucher) => <tr key={voucher.id}><td><strong className="mono">{voucher.code}</strong></td><td>{voucher.percent != null ? `${voucher.percent}%` : `−${fmtNumber(Number(voucher.amount || 0))} ₫`}</td><td>{voucher.valid_until || t('Không hết hạn')}</td><td><span className={`badge ${voucher.used ? 'plain' : 'success'}`}>{t(voucher.used ? 'Đã sử dụng' : 'Còn hiệu lực')}</span></td><td>{voucher.redeemed_source && voucher.redeemed_order ? <a href={`#/e/${voucher.redeemed_source === 'pos_order' ? 'pos' : 'sales'}/${voucher.redeemed_source}/${voucher.redeemed_order}`}>{String(voucher.redeemed_order).slice(0, 8)}</a> : '—'}</td></tr>)}</tbody></table></div>}<p className="small muted">{t('Mỗi mã dùng một lần cho một đơn POS hoặc đơn bán hàng; giảm giá được phân bổ trước thuế theo từng dòng.')}</p></section>}
  </div>;
}
