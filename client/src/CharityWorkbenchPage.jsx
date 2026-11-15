import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api, dataPath } from './lib/api.js';
import { fmtMoney, statusLabel } from './lib/i18n.js';
import { can, loadRefs, recordLabel, loadAllResponse } from './lib/state.js';

const itemsOf = (response) => Array.isArray(response?.items) ? response.items : [];
const action = (entity, row, verb) => api(dataPath(entity, row.id, verb), { method: 'POST' });
const methods = [['cash','Tiền mặt'],['bank','Ngân hàng'],['transfer','Chuyển khoản'],['card','Thẻ'],['ewallet','Ví điện tử']];

export default function CharityWorkbenchPage() {
  const [programs, setPrograms] = useState([]);
  const [beneficiaries, setBeneficiaries] = useState([]);
  const [donations, setDonations] = useState([]);
  const [disbursements, setDisbursements] = useState([]);
  const [parties, setParties] = useState(new Map());
  const [accounts, setAccounts] = useState([]);
  const [programId, setProgramId] = useState('');
  const [programForm, setProgramForm] = useState({ name: '', budget: '' });
  const [beneficiaryForm, setBeneficiaryForm] = useState({ party: '', program: '' });
  const [donationForm, setDonationForm] = useState({ donor: '', program: '', amount: '', method: 'bank', note: '' });
  const [disbursementForm, setDisbursementForm] = useState({ beneficiary: '', program: '', expense_account: '', amount: '', method: 'bank', purpose: '' });
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async (quiet = false) => {
    if (!quiet) { setLoading(true); setError(''); }
    try {
      const [programRes, beneficiaryRes, donationRes, disbursementRes, partyMap, accountRes] = await Promise.all([
        can('charity.program.read') ? loadAllResponse('charity.program') : Promise.resolve({ items: [] }),
        can('charity.beneficiary.read') ? loadAllResponse('charity.beneficiary') : Promise.resolve({ items: [] }),
        can('charity.donation.read') ? loadAllResponse('charity.donation') : Promise.resolve({ items: [] }),
        can('charity.disbursement.read') ? loadAllResponse('charity.disbursement') : Promise.resolve({ items: [] }),
        can('master-data.party.read') ? loadRefs('master-data.party') : Promise.resolve(new Map()),
        can('accounting.account.read') ? loadAllResponse('accounting.account') : Promise.resolve({ items: [] }),
      ]);
      const programRows = itemsOf(programRes);
      const beneficiaryRows = itemsOf(beneficiaryRes);
      const accountsRows = itemsOf(accountRes).filter((row) => row.kind === 'expense');
      setPrograms(programRows); setBeneficiaries(beneficiaryRows); setDonations(itemsOf(donationRes)); setDisbursements(itemsOf(disbursementRes));
      setParties(partyMap); setAccounts(accountsRows);
      setProgramId((current) => programRows.some((row) => row.id === current) ? current : programRows[0]?.id || '');
      setProgramForm((current) => ({ ...current }));
      const firstProgram = programRows[0]?.id || '';
      const firstParty = [...partyMap.keys()][0] || '';
      setBeneficiaryForm((current) => ({ ...current, program: current.program || firstProgram, party: current.party || firstParty }));
      setDonationForm((current) => ({ ...current, program: current.program || firstProgram, donor: current.donor || firstParty }));
      setDisbursementForm((current) => ({ ...current, program: current.program || firstProgram, expense_account: current.expense_account || accountsRows[0]?.id || '', beneficiary: current.beneficiary || beneficiaryRows.find((row) => row.program === firstProgram)?.id || '' }));
    } catch (reason) { setError(reason.message || 'Không tải được dữ liệu chương trình.'); }
    finally { if (!quiet) setLoading(false); }
  }, []);

  useEffect(() => { document.title = 'Điều hành chương trình và quỹ · OSP Suite'; load(); }, [load]);
  const selectedProgram = programs.find((row) => row.id === programId);
  const programBeneficiaries = useMemo(() => beneficiaries.filter((row) => row.program === programId), [beneficiaries, programId]);
  const programDonations = useMemo(() => donations.filter((row) => row.program === programId), [donations, programId]);
  const programDisbursements = useMemo(() => disbursements.filter((row) => row.program === programId), [disbursements, programId]);
  const received = programDonations.filter((row) => row.status === 'received').reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const committed = programDisbursements.filter((row) => ['approved','paid'].includes(row.status)).reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const paid = programDisbursements.filter((row) => row.status === 'paid').reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const budget = Number(selectedProgram?.budget || 0);

  async function run(key, operation, success) {
    setBusy(key); setError(''); setNotice('');
    try { await operation(); setNotice(success); await load(true); }
    catch (reason) { setError(reason.message || 'Thao tác không thành công.'); await load(true); }
    finally { setBusy(''); }
  }

  async function createProgram(event) {
    event.preventDefault();
    await run('program', () => api(dataPath('charity.program'), { method: 'POST', body: { name: programForm.name.trim(), budget: programForm.budget === '' ? undefined : Number(programForm.budget) } }), 'Đã tạo chương trình và ngân sách mục tiêu.');
    setProgramForm({ name: '', budget: '' });
  }

  async function createBeneficiary(event) {
    event.preventDefault();
    await run('beneficiary', () => api(dataPath('charity.beneficiary'), { method: 'POST', body: { ...beneficiaryForm, program: programId } }), 'Đã thêm người thụ hưởng vào chương trình.');
  }

  async function createDonation(event) {
    event.preventDefault();
    await run('donation', () => api(dataPath('charity.donation'), { method: 'POST', body: { ...donationForm, program: programId || undefined, amount: Number(donationForm.amount), status: 'pledged' } }), 'Đã ghi nhận cam kết ủng hộ. Khi tiền về, xác nhận đã nhận để ghi thu kế toán.');
    setDonationForm((current) => ({ ...current, amount: '', note: '' }));
  }

  async function receiveDonation(row) {
    await run(`${row.id}:received`, () => action('charity.donation', row, 'received'), 'Đã xác nhận nhận tiền; hệ thống ghi nhận khoản thu vào kế toán.');
  }

  async function createDisbursement(event) {
    event.preventDefault();
    await run('disbursement', () => api(dataPath('charity.disbursement'), { method: 'POST', body: { ...disbursementForm, program: programId, amount: Number(disbursementForm.amount), status: 'requested' } }), 'Đã gửi đề nghị chi để bộ phận tài chính xét duyệt.');
    setDisbursementForm((current) => ({ ...current, amount: '', purpose: '' }));
  }

  async function changeDisbursement(row, verb) {
    const messages = { approved: 'Đã duyệt đề nghị chi và giữ ngân sách chương trình.', rejected: 'Đã từ chối đề nghị chi.', paid: 'Đã ghi nhận giải ngân; hệ thống tạo chứng từ thanh toán kế toán.' };
    await run(`${row.id}:${verb}`, () => action('charity.disbursement', row, verb), messages[verb]);
  }

  return <div className="page">
    <div className="page-head"><div><h1>Điều hành chương trình và quỹ</h1><p className="sub">Theo dõi nhà tài trợ, người thụ hưởng, ngân sách đã cam kết và giải ngân.</p></div><button className="btn btn-secondary" type="button" disabled={loading || Boolean(busy)} onClick={() => load()}>Làm mới</button></div>
    {error && <div className="alert danger" role="alert">{error}</div>}{notice && <div className="alert success" role="status">{notice}</div>}
    {can('charity.program.create') && <section className="card card-pad"><h2>Tạo chương trình</h2><form className="form-grid" onSubmit={createProgram}><label className="field"><span className="label">Tên chương trình *</span><input className="input" required value={programForm.name} onChange={(e) => setProgramForm({ ...programForm, name: e.target.value })}/></label><label className="field"><span className="label">Ngân sách tối đa</span><input className="input" type="number" min="0" step="any" value={programForm.budget} onChange={(e) => setProgramForm({ ...programForm, budget: e.target.value })}/></label><div className="row full"><span className="grow"/><button className="btn btn-primary" disabled={Boolean(busy)}>Tạo chương trình</button></div></form></section>}
    {loading ? <div className="skeleton" data-h="row"/> : !programs.length ? <div className="card card-pad empty">Chưa có chương trình. Hãy tạo chương trình trước khi lập danh sách thụ hưởng hoặc đề nghị chi.</div> : <>
      <section className="card card-pad" style={{ marginTop: 16 }}><div className="form-grid"><label className="field"><span className="label">Chương trình đang xem</span><select className="select" value={programId} onChange={(e) => { const id = e.target.value; setProgramId(id); setBeneficiaryForm((current) => ({ ...current, program: id, party: '' })); setDonationForm((current) => ({ ...current, program: id })); setDisbursementForm((current) => ({ ...current, program: id, beneficiary: '' })); }}>
        {programs.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label><div className="field"><span className="label">Ngân sách chương trình</span><strong>{selectedProgram?.budget == null ? 'Chưa đặt' : fmtMoney(budget)}</strong></div><div className="field"><span className="label">Đã nhận ủng hộ</span><strong>{fmtMoney(received)}</strong></div><div className="field"><span className="label">Đã duyệt / giải ngân</span><strong>{fmtMoney(committed)} <span className="small muted">(đã chi {fmtMoney(paid)})</span></strong></div></div></section>

      <div className="layout-split" style={{ marginTop: 16 }}>
        <section className="card card-pad"><h2>Nhà tài trợ và khoản ủng hộ</h2>
          {can('charity.donation.create') && <form className="form-grid" onSubmit={createDonation}><label className="field"><span className="label">Nhà tài trợ *</span><select className="select" required value={donationForm.donor} onChange={(e) => setDonationForm({ ...donationForm, donor: e.target.value })}><option value="">Chọn nhà tài trợ</option>{[...parties.values()].map((row) => <option key={row.id} value={row.id}>{recordLabel('master-data.party', row)}</option>)}</select></label><label className="field"><span className="label">Số tiền cam kết *</span><input className="input" type="number" min="0.01" step="any" required value={donationForm.amount} onChange={(e) => setDonationForm({ ...donationForm, amount: e.target.value })}/></label><label className="field"><span className="label">Phương thức dự kiến</span><select className="select" value={donationForm.method} onChange={(e) => setDonationForm({ ...donationForm, method: e.target.value })}>{methods.map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="field"><span className="label">Ghi chú</span><input className="input" value={donationForm.note} onChange={(e) => setDonationForm({ ...donationForm, note: e.target.value })}/></label><div className="row full"><span className="grow"/><button className="btn btn-secondary" disabled={Boolean(busy) || !parties.size}>Ghi nhận cam kết</button></div></form>}
          <div className="table-wrap" style={{ marginTop: 14 }}><table className="table"><thead><tr><th>Nhà tài trợ</th><th>Số tiền</th><th>Phương thức</th><th>Trạng thái / thao tác</th></tr></thead><tbody>{programDonations.map((row) => <tr key={row.id}><td>{parties.has(row.donor) ? recordLabel('master-data.party', parties.get(row.donor)) : '—'}<div className="small muted">{row.note}</div></td><td>{fmtMoney(row.amount)}</td><td>{methods.find(([value]) => value === row.method)?.[1] || row.method || '—'}</td><td><span className="badge warning">{statusLabel(row.status)}</span>{row.status === 'pledged' && can('charity.donation.received') && <button className="btn btn-primary btn-sm" style={{ marginLeft: 8 }} disabled={Boolean(busy)} onClick={() => receiveDonation(row)}>Xác nhận đã nhận</button>}</td></tr>)}</tbody></table></div>
        </section>

        <section className="card card-pad"><h2>Người thụ hưởng</h2>
          {can('charity.beneficiary.create') && <form className="form-grid" onSubmit={createBeneficiary}><label className="field full"><span className="label">Đối tượng thụ hưởng *</span><select className="select" required value={beneficiaryForm.party} onChange={(e) => setBeneficiaryForm({ ...beneficiaryForm, party: e.target.value })}><option value="">Chọn hồ sơ đối tượng</option>{[...parties.values()].map((row) => <option key={row.id} value={row.id}>{recordLabel('master-data.party', row)}</option>)}</select></label><div className="row full"><span className="grow"/><button className="btn btn-secondary" disabled={Boolean(busy) || !parties.size}>Thêm vào chương trình</button></div></form>}
          <div className="table-wrap" style={{ marginTop: 14 }}><table className="table"><thead><tr><th>Đối tượng</th><th>Đề nghị chi</th></tr></thead><tbody>{programBeneficiaries.map((row) => <tr key={row.id}><td>{parties.has(row.party) ? recordLabel('master-data.party', parties.get(row.party)) : '—'}</td><td>{programDisbursements.filter((item) => item.beneficiary === row.id).length}</td></tr>)}</tbody></table></div>
        </section>
      </div>

      <section className="card card-pad" style={{ marginTop: 16 }}><h2>Đề nghị chi và giải ngân</h2>
        {can('charity.disbursement.create') && <form className="form-grid" onSubmit={createDisbursement}><label className="field"><span className="label">Người thụ hưởng *</span><select className="select" required value={disbursementForm.beneficiary} onChange={(e) => setDisbursementForm({ ...disbursementForm, beneficiary: e.target.value })}><option value="">Chọn đối tượng trong chương trình</option>{programBeneficiaries.map((row) => <option key={row.id} value={row.id}>{parties.has(row.party) ? recordLabel('master-data.party', parties.get(row.party)) : 'Đối tượng'}</option>)}</select></label><label className="field"><span className="label">Tài khoản chi phí *</span><select className="select" required value={disbursementForm.expense_account} onChange={(e) => setDisbursementForm({ ...disbursementForm, expense_account: e.target.value })}><option value="">Chọn tài khoản chi phí</option>{accounts.map((row) => <option key={row.id} value={row.id}>{row.code} · {row.name}</option>)}</select></label><label className="field"><span className="label">Số tiền *</span><input className="input" required type="number" min="0.01" step="any" value={disbursementForm.amount} onChange={(e) => setDisbursementForm({ ...disbursementForm, amount: e.target.value })}/></label><label className="field"><span className="label">Phương thức chi *</span><select className="select" required value={disbursementForm.method} onChange={(e) => setDisbursementForm({ ...disbursementForm, method: e.target.value })}>{methods.map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="field full"><span className="label">Mục đích / căn cứ *</span><textarea className="input" required rows="2" value={disbursementForm.purpose} onChange={(e) => setDisbursementForm({ ...disbursementForm, purpose: e.target.value })}/></label><div className="row full"><span className="grow"/><button className="btn btn-primary" disabled={Boolean(busy) || !programBeneficiaries.length || !accounts.length}>Gửi đề nghị chi</button></div></form>}
        <div className="table-wrap" style={{ marginTop: 14 }}><table className="table"><thead><tr><th>Đối tượng</th><th>Mục đích</th><th>Số tiền</th><th>Trạng thái / thao tác</th></tr></thead><tbody>{programDisbursements.map((row) => <tr key={row.id}><td>{parties.has(beneficiaries.find((item) => item.id === row.beneficiary)?.party) ? recordLabel('master-data.party', parties.get(beneficiaries.find((item) => item.id === row.beneficiary)?.party)) : '—'}</td><td>{row.purpose}</td><td>{fmtMoney(row.amount)}</td><td><span className="badge warning">{statusLabel(row.status)}</span>{row.status === 'requested' && can('charity.disbursement.approved') && <><button className="btn btn-primary btn-sm" style={{ marginLeft: 8 }} disabled={Boolean(busy)} onClick={() => changeDisbursement(row, 'approved')}>Duyệt</button><button className="btn btn-ghost btn-sm" style={{ marginLeft: 6 }} disabled={Boolean(busy)} onClick={() => changeDisbursement(row, 'rejected')}>Từ chối</button></>}{row.status === 'approved' && can('charity.disbursement.paid') && <button className="btn btn-primary btn-sm" style={{ marginLeft: 8 }} disabled={Boolean(busy)} onClick={() => changeDisbursement(row, 'paid')}>Xác nhận đã chi</button>}</td></tr>)}</tbody></table></div>
        <p className="small muted" style={{ marginTop: 12 }}>Khi khoản chi được duyệt, ngân sách được giữ chỗ. Xác nhận đã chi sẽ tạo chứng từ thanh toán và hạch toán theo tài khoản chi phí đã chọn.</p>
      </section>
    </>}
  </div>;
}
