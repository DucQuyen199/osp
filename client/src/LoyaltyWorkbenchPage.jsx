import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api, dataPath } from './lib/api.js';
import { fmtDateTime } from './lib/i18n.js';
import { can, loadAllResponse, loadRefs, recordLabel } from './lib/state.js';

const rows = (response) => Array.isArray(response?.items) ? response.items : [];
const tiers = ['bronze', 'silver', 'gold', 'platinum'];
const tierLabels = { bronze: 'Đồng', silver: 'Bạc', gold: 'Vàng', platinum: 'Bạch kim' };
const sourceLabels = { pos_order: 'Đơn POS', sales_order: 'Đơn bán hàng', pos_order_refund: 'Hoàn POS', sales_return: 'Trả hàng' };
const points = (value) => Number(value || 0).toLocaleString('vi-VN', { maximumFractionDigits: 2 });

export default function LoyaltyWorkbenchPage() {
  const [members, setMembers] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [parties, setParties] = useState(new Map());
  const [selectedId, setSelectedId] = useState('');
  const [form, setForm] = useState({ party: '', tier: 'bronze' });
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async (quiet = false) => {
    if (!quiet) { setLoading(true); setError(''); }
    try {
      const [memberRes, transactionRes, partyMap] = await Promise.all([
        can('loyalty.member.read') ? loadAllResponse('loyalty.member') : Promise.resolve({ items: [] }),
        can('loyalty.point_txn.read') ? loadAllResponse('loyalty.point_txn') : Promise.resolve({ items: [] }),
        can('master-data.party.read') ? loadRefs('master-data.party') : Promise.resolve(new Map()),
      ]);
      const memberRows = rows(memberRes).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
      setMembers(memberRows); setTransactions(rows(transactionRes).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))); setParties(partyMap);
      setSelectedId((id) => memberRows.some((row) => row.id === id) ? id : memberRows[0]?.id || '');
      setForm((current) => ({ ...current, party: current.party || [...partyMap.keys()][0] || '' }));
    } catch (reason) { setError(reason.message || 'Không tải được chương trình thành viên.'); }
    finally { if (!quiet) setLoading(false); }
  }, []);

  useEffect(() => { document.title = 'Khách hàng thân thiết · OSP Suite'; load(); }, [load]);
  const selected = members.find((row) => row.id === selectedId);
  const ledger = useMemo(() => transactions.filter((row) => row.party === selected?.party), [transactions, selected]);
  const totalPoints = members.reduce((sum, member) => sum + Number(member.points || 0), 0);
  const partyName = (id) => parties.has(id) ? recordLabel('master-data.party', parties.get(id)) : 'Khách hàng';

  async function run(key, operation, message) {
    setBusy(key); setError(''); setNotice('');
    try { await operation(); await load(true); setNotice(message); }
    catch (reason) { setError(reason.message || 'Thao tác không thành công.'); }
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

  return <div className="page">
    <div className="page-head"><div><h1>Khách hàng thân thiết</h1><p className="sub">Đăng ký thành viên và tra cứu số dư, lịch sử điểm được ghi tự động từ bán hàng, POS và trả hàng.</p></div><button className="btn btn-secondary" type="button" disabled={loading || Boolean(busy)} onClick={() => load()}>Làm mới</button></div>
    {error && <div className="alert danger" role="alert">{error}</div>}{notice && <div className="alert success" role="status">{notice}</div>}
    <div className="stats" style={{ marginBottom: 16 }}><div className="card stat"><span className="stat-label">Thành viên</span><strong className="stat-value">{members.length}</strong></div><div className="card stat"><span className="stat-label">Tổng điểm đang lưu hành</span><strong className="stat-value">{points(totalPoints)}</strong></div><div className="card stat"><span className="stat-label">Giao dịch điểm</span><strong className="stat-value">{transactions.length}</strong></div></div>
    {can('loyalty.member.create') && <section className="card card-pad"><h2>Đăng ký thành viên</h2><form className="form-grid" onSubmit={enroll}><label className="field"><span className="label">Khách hàng *</span><select className="select" required value={form.party} onChange={(event) => setForm({ ...form, party: event.target.value })}><option value="">Chọn khách hàng</option>{[...parties.values()].filter((party) => !members.some((member) => member.party === party.id)).map((party) => <option key={party.id} value={party.id}>{recordLabel('master-data.party', party)}</option>)}</select></label><label className="field"><span className="label">Hạng khởi điểm</span><select className="select" value={form.tier} onChange={(event) => setForm({ ...form, tier: event.target.value })}>{tiers.map((tier) => <option key={tier} value={tier}>{tierLabels[tier]}</option>)}</select></label><div className="row full"><span className="grow"/><button className="btn btn-primary" disabled={Boolean(busy) || !form.party}>Đăng ký</button></div></form>{!parties.size && <p className="small muted">Cần tạo khách hàng trong Danh mục trước khi đăng ký.</p>}</section>}
    {!can('loyalty.member.read') ? <div className="empty">Bạn chưa có quyền xem thành viên.</div> : loading ? <div className="skeleton" data-h="row"/> : !members.length ? <div className="empty">Chưa có thành viên nào.</div> : <div className="layout-split"><section className="card table-wrap"><table className="table"><thead><tr><th>Khách hàng</th><th>Hạng</th><th className="right">Điểm</th></tr></thead><tbody>{members.map((member) => <tr key={member.id} className={selectedId === member.id ? 'selected' : ''} onClick={() => setSelectedId(member.id)} style={{ cursor: 'pointer' }}><td>{partyName(member.party)}</td><td>{tierLabels[member.tier] || 'Đồng'}</td><td className="right"><strong>{points(member.points)}</strong></td></tr>)}</tbody></table></section>
      {selected && <section className="card card-pad"><div className="row wrap"><div><h2>{partyName(selected.party)}</h2><span className="small muted">Đăng ký {fmtDateTime(selected.createdAt)}</span></div><span className="grow"/><span className="badge success">{points(selected.points)} điểm</span></div>{can('loyalty.member.update') && <label className="field" style={{ marginTop: 12 }}><span className="label">Hạng thành viên</span><select className="select" value={selected.tier || 'bronze'} disabled={Boolean(busy)} onChange={(event) => changeTier(event.target.value)}>{tiers.map((tier) => <option key={tier} value={tier}>{tierLabels[tier]}</option>)}</select></label>}
        <h3 style={{ marginTop: 18 }}>Sổ điểm</h3>{!can('loyalty.point_txn.read') ? <div className="empty">Bạn chưa có quyền xem lịch sử điểm.</div> : !ledger.length ? <div className="empty">Chưa có giao dịch điểm. Điểm được phát sinh khi đơn hàng hoàn tất.</div> : <div className="table-wrap"><table className="table"><thead><tr><th>Thời gian</th><th>Nguồn</th><th>Mã chứng từ</th><th className="right">Điểm</th></tr></thead><tbody>{ledger.map((row) => <tr key={row.id}><td>{fmtDateTime(row.createdAt)}</td><td>{sourceLabels[row.source] || row.source}</td><td className="mono small">{String(row.source_id || '').slice(0, 8)}</td><td className="right"><strong className={Number(row.points) < 0 ? 'danger-text' : ''}>{Number(row.points) > 0 ? '+' : ''}{points(row.points)}</strong></td></tr>)}</tbody></table></div>}
        <p className="small muted" style={{ marginTop: 12 }}>Số dư và giao dịch điểm chỉ cập nhật từ sự kiện bán hàng, hoàn tiền hoặc trả hàng; nhân viên không thể sửa sổ điểm thủ công.</p>
      </section>}</div>}
  </div>;
}
