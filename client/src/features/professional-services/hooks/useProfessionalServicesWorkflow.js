import { useEffect, useRef, useState } from 'react';
import { api, dataPath } from '../../../lib/api.js';

const action = (entity, row, verb) => api(dataPath(entity, row.id, verb), { method: 'POST' });

export function useProfessionalServicesWorkflow({ cases, parties, load, setError, t, todayDate }) {
  const [caseId, setCaseId] = useState('');
  const [caseForm, setCaseForm] = useState({ title: '', party: '', kind: '', owner: '', opened_on: todayDate });
  const [noteBody, setNoteBody] = useState('');
  const [timeForm, setTimeForm] = useState({ who: '', date: todayDate, hours: '', rate: '' });
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    setCaseId((current) => current && cases.some((row) => row.id === current) ? current : cases[0]?.id || '');
  }, [cases]);
  useEffect(() => {
    setCaseForm((current) => ({ ...current, party: current.party || [...parties.keys()][0] || '' }));
  }, [parties]);

  async function run(key, operation, success) {
    setBusy(key); setError(''); setNotice('');
    try {
      await operation();
      if (!mounted.current) return false;
      setNotice(t(success));
      await load(true);
      return true;
    } catch (reason) {
      if (mounted.current) { setError(t(reason.message || 'Thao tác không thành công.')); await load(true); }
      return false;
    } finally { if (mounted.current) setBusy(''); }
  }

  async function createCase(event) {
    event.preventDefault();
    const success = await run('case', () => api(dataPath('case-management.case'), { method: 'POST', body: {
      ...caseForm, title: caseForm.title.trim(), kind: caseForm.kind.trim() || undefined,
      owner: caseForm.owner.trim() || undefined, status: 'open',
    } }), 'Đã mở hồ sơ vụ việc.');
    if (success && mounted.current) setCaseForm((current) => ({ ...current, title: '', kind: '', owner: '' }));
  }

  async function createNote(event) {
    event.preventDefault();
    const success = await run('note', () => api(dataPath('case-management.case_note'), {
      method: 'POST', body: { case: caseId, body: noteBody.trim() },
    }), 'Đã lưu ghi chú hồ sơ vào lịch sử bất biến.');
    if (success && mounted.current) setNoteBody('');
  }

  async function createTime(event) {
    event.preventDefault();
    const success = await run('time', () => api(dataPath('case-management.time_entry'), { method: 'POST', body: {
      case: caseId, who: timeForm.who.trim(), date: timeForm.date,
      hours: String(timeForm.hours), rate: String(timeForm.rate), status: 'recorded',
    } }), 'Đã ghi giờ công. Khách hàng và phí được chụp từ hồ sơ và đơn giá giờ.');
    if (success && mounted.current) setTimeForm((current) => ({ ...current, hours: '' }));
  }

  async function changeCase(row, verb) {
    const messages = {
      on_hold: 'Đã tạm dừng hồ sơ.',
      resumed: 'Đã tiếp tục xử lý hồ sơ.',
      closed: 'Đã đóng hồ sơ sau khi xuất hóa đơn toàn bộ giờ công.',
    };
    await run(`${row.id}:${verb}`, () => action('case-management.case', row, verb), messages[verb]);
  }

  async function billTime(row) {
    await run(`${row.id}:billed`, () => action('case-management.time_entry', row, 'billed'),
      'Đã xuất hóa đơn dịch vụ cho khoản giờ công. Giờ công đã khóa khỏi chỉnh sửa.');
  }

  return {
    caseId, setCaseId, caseForm, setCaseForm, noteBody, setNoteBody,
    timeForm, setTimeForm, busy, notice, createCase, createNote, createTime,
    changeCase, billTime,
  };
}
