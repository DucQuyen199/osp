import React, { useEffect, useMemo, useState } from 'react';
import { useDocumentTitle } from '../../lib/useDocumentTitle.js';
import { api, dataPath } from '../../lib/api.js';
import { fmtMoney, statusLabel, uiTextWith } from '../../lib/i18n.js';
import { addDecimals } from '../../lib/decimal.js';
import { can, recordLabel } from '../../lib/state.js';
import { useCharityWorkbenchData } from './hooks/useCharityWorkbenchData.js';
import charityEnglish from './charity.en.js';
import DonationLedgerTable from './components/DonationLedgerTable.jsx';
const t = (text) => uiTextWith(text, charityEnglish);
const action = (entity, row, verb) => api(dataPath(entity, row.id, verb), { method: 'POST' });
const methods = [['cash','Tiền mặt'],['bank','Ngân hàng'],['transfer','Chuyển khoản'],['card','Thẻ'],['ewallet','Ví điện tử']];
export default function CharityWorkbenchPage() {
  useDocumentTitle(`${t('Điều hành chương trình và quỹ')} · OSP Suite`);
  const { programs, beneficiaries, donations, disbursements, parties, accounts, loading, error, setError, load } = useCharityWorkbenchData();
  const [programId, setProgramId] = useState('');
  const [programForm, setProgramForm] = useState({ name: '', budget: '' });
  const [beneficiaryForm, setBeneficiaryForm] = useState({ party: '', program: '' });
  const [donationForm, setDonationForm] = useState({ donor: '', program: '', amount: '', method: 'bank', note: '' });
  const [disbursementForm, setDisbursementForm] = useState({ beneficiary: '', program: '', expense_account: '', amount: '', method: 'bank', purpose: '' });
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    setProgramId((current) => programs.some((row) => row.id === current) ? current : programs[0]?.id || '');
    const firstProgram = programs[0]?.id || '';
    const firstParty = [...parties.keys()][0] || '';
    setBeneficiaryForm((current) => ({ ...current, program: current.program || firstProgram, party: current.party || firstParty }));
    setDonationForm((current) => ({ ...current, program: current.program || firstProgram, donor: current.donor || firstParty }));
    setDisbursementForm((current) => ({ ...current, program: current.program || firstProgram, expense_account: current.expense_account || accounts[0]?.id || '', beneficiary: current.beneficiary || beneficiaries.find((row) => row.program === firstProgram)?.id || '' }));
  }, [programs, parties, accounts, beneficiaries]);
  const selectedProgram = programs.find((row) => row.id === programId);
  const programBeneficiaries = useMemo(() => beneficiaries.filter((row) => row.program === programId), [beneficiaries, programId]);
  const programDonations = useMemo(() => donations.filter((row) => row.program === programId), [donations, programId]);
  const programDisbursements = useMemo(() => disbursements.filter((row) => row.program === programId), [disbursements, programId]);
  const received = addDecimals(programDonations.filter((row) => row.status === 'received').map((row) => row.amount));
  const committed = addDecimals(programDisbursements.filter((row) => ['approved','paid'].includes(row.status)).map((row) => row.amount));
  const paid = addDecimals(programDisbursements.filter((row) => row.status === 'paid').map((row) => row.amount));
  const budget = selectedProgram?.budget || 0;
  async function run(key, operation, success) {
    setBusy(key); setError(''); setNotice('');
    try { await operation(); setNotice(t(success)); await load(true); }
    catch (reason) { setError(t(reason.message || 'Thao tác không thành công.')); await load(true); }
    finally { setBusy(''); }
  }
  async function createProgram(event) {
    event.preventDefault();
    await run('program', () => api(dataPath('charity.program'), { method: 'POST', body: { name: programForm.name.trim(), budget: programForm.budget.trim() || undefined } }), 'Đã tạo chương trình và ngân sách mục tiêu.');
    setProgramForm({ name: '', budget: '' });
  }
  async function createBeneficiary(event) {
    event.preventDefault();
    await run('beneficiary', () => api(dataPath('charity.beneficiary'), { method: 'POST', body: { ...beneficiaryForm, program: programId } }), 'Đã thêm người thụ hưởng vào chương trình.');
  }
  async function createDonation(event) {
    event.preventDefault();
    await run('donation', () => api(dataPath('charity.donation'), { method: 'POST', body: { ...donationForm, program: programId || undefined, amount: String(donationForm.amount), status: 'pledged' } }), 'Đã ghi nhận cam kết ủng hộ. Khi tiền về, xác nhận đã nhận để ghi thu kế toán.');
    setDonationForm((current) => ({ ...current, amount: '', note: '' }));
  }
  async function receiveDonation(row) {
    await run(`${row.id}:received`, () => action('charity.donation', row, 'received'), 'Đã xác nhận nhận tiền; hệ thống ghi nhận khoản thu vào kế toán.');
  }
  async function createDisbursement(event) {
    event.preventDefault();
    await run('disbursement', () => api(dataPath('charity.disbursement'), { method: 'POST', body: { ...disbursementForm, program: programId, amount: String(disbursementForm.amount), status: 'requested' } }), 'Đã gửi đề nghị chi để bộ phận tài chính xét duyệt.');
    setDisbursementForm((current) => ({ ...current, amount: '', purpose: '' }));
  }
  async function changeDisbursement(row, verb) {
    const messages = { approved: 'Đã duyệt đề nghị chi và giữ ngân sách chương trình.', rejected: 'Đã từ chối đề nghị chi.', paid: 'Đã ghi nhận giải ngân; hệ thống tạo chứng từ thanh toán kế toán.' };
    await run(`${row.id}:${verb}`, () => action('charity.disbursement', row, verb), messages[verb]);
  }
  return <div className="page">
    <div className="page-head"><div><h1>{t('Điều hành chương trình và quỹ')}</h1><p className="sub">{t('Theo dõi nhà tài trợ, người thụ hưởng, ngân sách đã cam kết và giải ngân.')}</p></div><button className="btn btn-secondary" type="button" disabled={loading || Boolean(busy)} onClick={() => load()}>{t('Làm mới')}</button></div>
    {error && <div className="alert danger" role="alert">{t(error)}</div>}{notice && <div className="alert success" role="status">{t(notice)}</div>}
    {can('charity.program.create') && <section className="card card-pad"><h2>{t('Tạo chương trình')}</h2><form className="form-grid" onSubmit={createProgram}><label className="field"><span className="label">{t('Tên chương trình *')}</span><input className="input" required value={programForm.name} onChange={(e) => setProgramForm({ ...programForm, name: e.target.value })}/></label><label className="field"><span className="label">{t('Ngân sách tối đa')}</span><input className="input" type="number" min="0" step="any" value={programForm.budget} onChange={(e) => setProgramForm({ ...programForm, budget: e.target.value })}/></label><div className="row full"><span className="grow"/><button className="btn btn-primary" disabled={Boolean(busy)}>{t('Tạo chương trình')}</button></div></form></section>}
    {loading ? <div className="skeleton" data-h="row"/> : !programs.length ? <div className="card card-pad empty">{t('Chưa có chương trình. Hãy tạo chương trình trước khi lập danh sách thụ hưởng hoặc đề nghị chi.')}</div> : <>
      <section className="card card-pad u-mt-16" ><div className="form-grid"><label className="field"><span className="label">{t('Chương trình đang xem')}</span><select className="select" value={programId} onChange={(e) => { const id = e.target.value; setProgramId(id); setBeneficiaryForm((current) => ({ ...current, program: id, party: '' })); setDonationForm((current) => ({ ...current, program: id })); setDisbursementForm((current) => ({ ...current, program: id, beneficiary: '' })); }}>
        {programs.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label><div className="field"><span className="label">{t('Ngân sách chương trình')}</span><strong>{selectedProgram?.budget == null ? t('Chưa đặt') : fmtMoney(budget)}</strong></div><div className="field"><span className="label">{t('Đã nhận ủng hộ')}</span><strong>{fmtMoney(received)}</strong></div><div className="field"><span className="label">{t('Đã duyệt / giải ngân')}</span><strong>{fmtMoney(committed)} <span className="small muted">({t("đã chi")} {fmtMoney(paid)})</span></strong></div></div></section>
      <div className="layout-split u-mt-16" >
        <section className="card card-pad"><h2>{t('Nhà tài trợ và khoản ủng hộ')}</h2>
          {can('charity.donation.create') && <form className="form-grid" onSubmit={createDonation}><label className="field"><span className="label">{t('Nhà tài trợ *')}</span><select className="select" required value={donationForm.donor} onChange={(e) => setDonationForm({ ...donationForm, donor: e.target.value })}><option value="">{t('Chọn nhà tài trợ')}</option>{[...parties.values()].map((row) => <option key={row.id} value={row.id}>{recordLabel('master-data.party', row)}</option>)}</select></label><label className="field"><span className="label">{t('Số tiền cam kết *')}</span><input className="input" type="number" min="0.01" step="any" required value={donationForm.amount} onChange={(e) => setDonationForm({ ...donationForm, amount: e.target.value })}/></label><label className="field"><span className="label">{t('Phương thức dự kiến')}</span><select className="select" value={donationForm.method} onChange={(e) => setDonationForm({ ...donationForm, method: e.target.value })}>{methods.map(([value,label]) => <option key={value} value={value}>{t(label)}</option>)}</select></label><label className="field"><span className="label">{t('Ghi chú')}</span><input className="input" value={donationForm.note} onChange={(e) => setDonationForm({ ...donationForm, note: e.target.value })}/></label><div className="row full"><span className="grow"/><button className="btn btn-secondary" disabled={Boolean(busy) || !parties.size}>{t('Ghi nhận cam kết')}</button></div></form>}
          <DonationLedgerTable rows={programDonations} partyName={(id) => parties.has(id) ? recordLabel('master-data.party', parties.get(id)) : '—'} methods={methods} fmtMoney={fmtMoney} statusLabel={statusLabel} canReceive={can('charity.donation.received')} busy={busy} onReceive={receiveDonation} t={t} />
        </section>
        <section className="card card-pad"><h2>{t('Người thụ hưởng')}</h2>
          {can('charity.beneficiary.create') && <form className="form-grid" onSubmit={createBeneficiary}><label className="field full"><span className="label">{t('Đối tượng thụ hưởng *')}</span><select className="select" required value={beneficiaryForm.party} onChange={(e) => setBeneficiaryForm({ ...beneficiaryForm, party: e.target.value })}><option value="">{t('Chọn hồ sơ đối tượng')}</option>{[...parties.values()].map((row) => <option key={row.id} value={row.id}>{recordLabel('master-data.party', row)}</option>)}</select></label><div className="row full"><span className="grow"/><button className="btn btn-secondary" disabled={Boolean(busy) || !parties.size}>{t('Thêm vào chương trình')}</button></div></form>}
          <div className="table-wrap u-mt-14" ><table className="table"><thead><tr><th>{t('Đối tượng')}</th><th>{t('Đề nghị chi')}</th></tr></thead><tbody>{programBeneficiaries.map((row) => <tr key={row.id}><td>{parties.has(row.party) ? recordLabel('master-data.party', parties.get(row.party)) : '—'}</td><td>{programDisbursements.filter((item) => item.beneficiary === row.id).length}</td></tr>)}</tbody></table></div>
        </section>
      </div>
      <section className="card card-pad u-mt-16" ><h2>{t('Đề nghị chi và giải ngân')}</h2>
        {can('charity.disbursement.create') && <form className="form-grid" onSubmit={createDisbursement}><label className="field"><span className="label">{t('Người thụ hưởng *')}</span><select className="select" required value={disbursementForm.beneficiary} onChange={(e) => setDisbursementForm({ ...disbursementForm, beneficiary: e.target.value })}><option value="">{t('Chọn đối tượng trong chương trình')}</option>{programBeneficiaries.map((row) => <option key={row.id} value={row.id}>{parties.has(row.party) ? recordLabel('master-data.party', parties.get(row.party)) : t('Đối tượng')}</option>)}</select></label><label className="field"><span className="label">{t('Tài khoản chi phí *')}</span><select className="select" required value={disbursementForm.expense_account} onChange={(e) => setDisbursementForm({ ...disbursementForm, expense_account: e.target.value })}><option value="">{t('Chọn tài khoản chi phí')}</option>{accounts.map((row) => <option key={row.id} value={row.id}>{row.code} · {row.name}</option>)}</select></label><label className="field"><span className="label">{t('Số tiền *')}</span><input className="input" required type="number" min="0.01" step="any" value={disbursementForm.amount} onChange={(e) => setDisbursementForm({ ...disbursementForm, amount: e.target.value })}/></label><label className="field"><span className="label">{t('Phương thức chi *')}</span><select className="select" required value={disbursementForm.method} onChange={(e) => setDisbursementForm({ ...disbursementForm, method: e.target.value })}>{methods.map(([value,label]) => <option key={value} value={value}>{t(label)}</option>)}</select></label><label className="field full"><span className="label">{t('Mục đích / căn cứ *')}</span><textarea className="input" required rows="2" value={disbursementForm.purpose} onChange={(e) => setDisbursementForm({ ...disbursementForm, purpose: e.target.value })}/></label><div className="row full"><span className="grow"/><button className="btn btn-primary" disabled={Boolean(busy) || !programBeneficiaries.length || !accounts.length}>{t('Gửi đề nghị chi')}</button></div></form>}
        <div className="table-wrap u-mt-14" ><table className="table"><thead><tr><th>{t('Đối tượng')}</th><th>{t('Mục đích')}</th><th>{t('Số tiền')}</th><th>{t('Trạng thái / thao tác')}</th></tr></thead><tbody>{programDisbursements.map((row) => <tr key={row.id}><td>{parties.has(beneficiaries.find((item) => item.id === row.beneficiary)?.party) ? recordLabel('master-data.party', parties.get(beneficiaries.find((item) => item.id === row.beneficiary)?.party)) : '—'}</td><td>{row.purpose}</td><td>{fmtMoney(row.amount)}</td><td><span className="badge warning">{statusLabel(row.status)}</span>{row.status === 'requested' && can('charity.disbursement.approved') && <button className="btn btn-primary btn-sm u-ml-8"  disabled={Boolean(busy)} onClick={() => changeDisbursement(row, 'approved')}>{t('Duyệt')}</button>}{row.status === 'requested' && can('charity.disbursement.rejected') && <button className="btn btn-ghost btn-sm u-ml-6"  disabled={Boolean(busy)} onClick={() => changeDisbursement(row, 'rejected')}>{t('Từ chối')}</button>}{row.status === 'approved' && can('charity.disbursement.paid') && <button className="btn btn-primary btn-sm u-ml-8"  disabled={Boolean(busy)} onClick={() => changeDisbursement(row, 'paid')}>{t('Xác nhận đã chi')}</button>}</td></tr>)}</tbody></table></div>
        <p className="small muted u-mt-12" >{t('Khi khoản chi được duyệt, ngân sách được giữ chỗ. Xác nhận đã chi sẽ tạo chứng từ thanh toán và hạch toán theo tài khoản chi phí đã chọn.')}</p>
      </section>
    </>}
  </div>;
}
