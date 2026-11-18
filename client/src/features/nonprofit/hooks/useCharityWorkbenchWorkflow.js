import { useEffect, useState } from 'react';
import { api, dataPath } from '../../../lib/api.js';

const action = (entity, row, verb) => api(dataPath(entity, row.id, verb), { method: 'POST' });

export function useCharityWorkbenchWorkflow({ programs, beneficiaries, parties, accounts, load, setError, t }) {
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

  async function run(key, operation, success) {
    setBusy(key); setError(''); setNotice('');
    try {
      await operation();
      setNotice(t(success));
      await load(true);
      return true;
    } catch (reason) {
      setError(t(reason.message || 'Thao tác không thành công.'));
      await load(true);
      return false;
    } finally { setBusy(''); }
  }

  async function createProgram(event) {
    event.preventDefault();
    const created = await run('program', () => api(dataPath('charity.program'), {
      method: 'POST', body: { name: programForm.name.trim(), budget: programForm.budget.trim() || undefined },
    }), 'Đã tạo chương trình và ngân sách mục tiêu.');
    if (created) setProgramForm({ name: '', budget: '' });
  }

  async function createBeneficiary(event) {
    event.preventDefault();
    await run('beneficiary', () => api(dataPath('charity.beneficiary'), {
      method: 'POST', body: { ...beneficiaryForm, program: programId },
    }), 'Đã thêm người thụ hưởng vào chương trình.');
  }

  async function createDonation(event) {
    event.preventDefault();
    const created = await run('donation', () => api(dataPath('charity.donation'), {
      method: 'POST', body: { ...donationForm, program: programId || undefined, amount: String(donationForm.amount), status: 'pledged' },
    }), 'Đã ghi nhận cam kết ủng hộ. Khi tiền về, xác nhận đã nhận để ghi thu kế toán.');
    if (created) setDonationForm((current) => ({ ...current, amount: '', note: '' }));
  }

  async function receiveDonation(row) {
    await run(`${row.id}:received`, () => action('charity.donation', row, 'received'), 'Đã xác nhận nhận tiền; hệ thống ghi nhận khoản thu vào kế toán.');
  }

  async function createDisbursement(event) {
    event.preventDefault();
    const created = await run('disbursement', () => api(dataPath('charity.disbursement'), {
      method: 'POST', body: { ...disbursementForm, program: programId, amount: String(disbursementForm.amount), status: 'requested' },
    }), 'Đã gửi đề nghị chi để bộ phận tài chính xét duyệt.');
    if (created) setDisbursementForm((current) => ({ ...current, amount: '', purpose: '' }));
  }

  async function changeDisbursement(row, verb) {
    const messages = {
      approved: 'Đã duyệt đề nghị chi và giữ ngân sách chương trình.',
      rejected: 'Đã từ chối đề nghị chi.',
      paid: 'Đã ghi nhận giải ngân; hệ thống tạo chứng từ thanh toán kế toán.',
    };
    await run(`${row.id}:${verb}`, () => action('charity.disbursement', row, verb), messages[verb]);
  }

  function changeProgram(id) {
    setProgramId(id);
    setBeneficiaryForm((current) => ({ ...current, program: id, party: '' }));
    setDonationForm((current) => ({ ...current, program: id }));
    setDisbursementForm((current) => ({ ...current, program: id, beneficiary: '' }));
  }

  return {
    programId, setProgramId, programForm, setProgramForm,
    beneficiaryForm, setBeneficiaryForm, donationForm, setDonationForm,
    disbursementForm, setDisbursementForm, busy, notice, changeProgram,
    createProgram, createBeneficiary, createDonation, receiveDonation,
    createDisbursement, changeDisbursement,
  };
}
