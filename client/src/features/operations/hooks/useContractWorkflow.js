import { useEffect, useState } from 'react';
import { api, dataPath } from '../../../lib/api.js';
import { confirmDialog } from '../../../lib/feedback.js';

const blankContract = { title: '', party: '', start_date: '', end_date: '', value: '', terms: '' };
const blankClause = { title: '', body: '' };
const blankAmendment = { reference: '', effective_date: '', reason: '', title: '', terms: '', end_date: '', value: '' };

export function useContractWorkflow({ selected, selectedId, setSelectedId, parties, load, workflowEnabled, setError, t }) {
  const [contractForm, setContractForm] = useState(blankContract);
  const [draftEdit, setDraftEdit] = useState(blankContract);
  const [clauseForm, setClauseForm] = useState(blankClause);
  const [amendmentForm, setAmendmentForm] = useState(blankAmendment);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    setContractForm((form) => ({ ...form, party: form.party || [...parties.keys()][0] || '' }));
  }, [parties]);

  useEffect(() => {
    if (!selected) { setDraftEdit(blankContract); return; }
    setDraftEdit({
      title: selected.title || '', party: selected.party || '',
      start_date: selected.start_date || '', end_date: selected.end_date || '',
      value: selected.value ?? '', terms: selected.terms || '',
    });
  // Keep the existing behavior: selecting another contract hydrates its draft form.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  async function run(key, operation, success) {
    setBusy(key); setError(''); setNotice('');
    try { await operation(); await load(true); if (success) setNotice(success); }
    catch (reason) { setError(reason.message || t('Thao tác không thành công.')); await load(true); }
    finally { setBusy(''); }
  }

  async function createContract(event) {
    event.preventDefault();
    await run('contract:create', async () => {
      const body = {
        title: contractForm.title.trim(), party: contractForm.party,
        ...(contractForm.start_date ? { start_date: contractForm.start_date } : {}),
        ...(contractForm.end_date ? { end_date: contractForm.end_date } : {}),
        ...(contractForm.value !== '' ? { value: String(contractForm.value) } : {}),
        ...(contractForm.terms.trim() ? { terms: contractForm.terms.trim() } : {}),
      };
      const created = await api(dataPath('contract.contract'), { method: 'POST', body });
      setContractForm((form) => ({ ...blankContract, party: form.party }));
      setSelectedId(created.id);
    }, t('Đã tạo hợp đồng nháp. Hãy kiểm tra điều khoản và ngày hiệu lực trước khi kích hoạt.'));
  }

  async function updateDraft(event) {
    event.preventDefault(); if (!selected) return;
    await run(`${selected.id}:save`, () => api(dataPath('contract.contract', selected.id), { method: 'PATCH', body: {
      title: draftEdit.title.trim(), party: draftEdit.party,
      start_date: draftEdit.start_date || null, end_date: draftEdit.end_date || null,
      value: draftEdit.value === '' ? null : String(draftEdit.value).trim(), terms: draftEdit.terms.trim() || null,
    } }), t('Đã lưu thông tin hợp đồng nháp.'));
  }

  async function addClause(event) {
    event.preventDefault(); if (!selected) return;
    await run(`${selected.id}:clause`, async () => {
      await api(dataPath('contract.clause'), { method: 'POST', body: { contract: selected.id, title: clauseForm.title.trim(), body: clauseForm.body.trim() } });
      setClauseForm(blankClause);
    }, t('Đã thêm điều khoản vào hợp đồng nháp.'));
  }

  async function createAmendment(event) {
    event.preventDefault(); if (!selected) return;
    const changes = {};
    if (amendmentForm.title.trim()) changes.title = amendmentForm.title.trim();
    if (amendmentForm.terms.trim()) changes.terms = amendmentForm.terms.trim();
    if (amendmentForm.end_date) changes.end_date = amendmentForm.end_date;
    if (amendmentForm.value !== '') changes.value = String(amendmentForm.value).trim();
    if (!Object.keys(changes).length) { setError(t('Hãy nhập ít nhất một nội dung thay đổi trong phụ lục.')); return; }
    await run(`${selected.id}:amendment`, async () => {
      const amendment = await api(dataPath('contract.amendment'), { method: 'POST', body: {
        contract: selected.id, reference: amendmentForm.reference.trim() || undefined,
        effective_date: amendmentForm.effective_date, reason: amendmentForm.reason.trim(), changes,
      } });
      await api(dataPath('contract.amendment', amendment.id, 'submitted'), { method: 'POST' });
      setAmendmentForm(blankAmendment);
    }, workflowEnabled ? t('Đã gửi phụ lục vào luồng phê duyệt.') : t('Đã gửi phụ lục chờ duyệt.'));
  }

  async function amendmentAction(row, action) {
    const messages = {
      approved: t('Đã duyệt phụ lục; nếu ngày hiệu lực đã đến, hệ thống áp dụng thay đổi tự động.'),
      applied: t('Đã áp dụng thay đổi phụ lục vào hợp đồng.'),
      cancelled: t('Đã hủy phụ lục.'),
      submitted: t('Đã gửi lại phụ lục để duyệt.'),
    };
    await run(`${row.id}:${action}`, () => api(dataPath('contract.amendment', row.id, action), { method: 'POST' }), messages[action]);
  }

  async function contractAction(action) {
    if (!selected) return;
    const message = {
      activated: t('Đã kích hoạt hợp đồng.'),
      terminated: t('Đã chấm dứt hợp đồng.'),
      cancelled: t('Đã hủy hợp đồng nháp.'),
      expired: t('Đã ghi nhận hợp đồng hết hạn.'),
    }[action];
    await run(`${selected.id}:${action}`, () => api(dataPath('contract.contract', selected.id, action), { method: 'POST' }), message);
  }

  async function confirmTermination() {
    if (await confirmDialog({ title: t('Chấm dứt hợp đồng'), message: t('Chấm dứt hợp đồng này? Các phụ lục chưa áp dụng sẽ bị hủy.'), danger: true, confirmLabel: t('Chấm dứt hợp đồng') })) {
      await contractAction('terminated');
    }
  }

  return {
    contractForm, setContractForm, draftEdit, setDraftEdit, clauseForm, setClauseForm,
    amendmentForm, setAmendmentForm, busy, notice, createContract, updateDraft,
    addClause, createAmendment, amendmentAction, contractAction, confirmTermination,
  };
}
