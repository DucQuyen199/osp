import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, dataPath } from '../../../lib/api.js';
import { localDateTimeToIso } from '../../../lib/dates.js';

export function useCommunicationWorkbenchWorkflow({ parties, load, t }) {
  const [form, setForm] = useState({ party: '', channel: 'email', subject: '', body: '', send_at: '' });
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const partiesForChannel = useCallback((channel) => [...parties.values()].filter((party) => channel === 'email'
    ? Boolean(party.email?.trim()) : Boolean(party.phone?.trim())), [parties]);
  const eligibleParties = useMemo(() => partiesForChannel(form.channel), [form.channel, partiesForChannel]);

  useEffect(() => {
    setForm((current) => ({
      ...current,
      party: eligibleParties.some((party) => party.id === current.party)
        ? current.party : eligibleParties[0]?.id || '',
    }));
  }, [eligibleParties]);

  async function run(key, operation, message) {
    setBusy(key); setError(''); setNotice('');
    try { await operation(); await load(true); setNotice(t(message)); }
    catch (reason) { setError(t(reason.message || 'Thao tác không thành công.')); }
    finally { setBusy(''); }
  }

  async function create(event) {
    event.preventDefault();
    if (!eligibleParties.some((party) => party.id === form.party)) { setError(t('Người nhận cần có địa chỉ phù hợp với kênh gửi.')); return; }
    if (!form.send_at || !form.body.trim()) return;
    const sendAt = localDateTimeToIso(form.send_at);
    if (!sendAt) { setError(t('Thời điểm gửi không hợp lệ trong múi giờ kinh doanh.')); return; }
    const payload = { party: form.party, channel: form.channel, body: form.body.trim(), send_at: sendAt };
    if (form.subject.trim()) payload.subject = form.subject.trim();
    await run('create', async () => {
      await api(dataPath('communication.reminder'), { method: 'POST', body: payload });
      setForm((current) => ({ ...current, subject: '', body: '', send_at: '' }));
    }, 'Đã lên lịch nhắc. Hệ thống sẽ xếp hàng gửi khi đến giờ.');
  }

  const cancel = (reminder) => run(`${reminder.id}:cancelled`, () => api(dataPath('communication.reminder', reminder.id, 'cancelled'), { method: 'POST' }), 'Đã hủy lịch nhắc.');
  return { form, setForm, eligibleParties, partiesForChannel, busy, error, notice, create, cancel };
}
