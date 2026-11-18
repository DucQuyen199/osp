import { useEffect, useState } from 'react';
import { api, dataPath } from '../../../lib/api.js';
import { confirmDialog } from '../../../lib/feedback.js';
import { localDate } from '../../../lib/dates.js';
import { uiText } from '../../../lib/i18n.js';

const today = localDate;
const monthStart = () => `${today().slice(0, 7)}-01`;
const monthEnd = () => new Date(Date.UTC(Number(today().slice(0, 4)), Number(today().slice(5, 7)), 0)).toISOString().slice(0, 10);

export function useAccountingPeriodCloseWorkflow({ periods, load, setError }) {
  const [periodId, setPeriodId] = useState('');
  const [form, setForm] = useState(() => ({ name: `${today().slice(0, 7)}`, start_date: monthStart(), end_date: monthEnd() }));
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    setPeriodId((id) => id && periods.some((row) => row.id === id) ? id : periods.find((row) => row.status === 'open')?.id || periods[0]?.id || '');
  }, [periods]);

  async function run(key, operation, success) {
    setBusy(key); setError(''); setNotice('');
    try { await operation(); setNotice(success); await load(true); }
    catch (reason) { setError(reason.message || uiText('KhÃ´ng cáº­p nháº­t Ä‘Æ°á»£c ká»³ káº¿ toÃ¡n.')); await load(true); }
    finally { setBusy(''); }
  }

  async function createPeriod(event) {
    event.preventDefault();
    await run('period:create', async () => {
      await api(dataPath('accounting.period'), { method: 'POST', body: form });
      setForm((current) => ({ ...current, name: `${today().slice(0, 7)}`, start_date: monthStart(), end_date: monthEnd() }));
    }, uiText('ÄÃ£ táº¡o ká»³ káº¿ toÃ¡n. Há»‡ thá»‘ng sáº½ cháº·n ká»³ bá»‹ chá»“ng vÃ  báº£o vá»‡ ngÃ y sau khi cÃ³ bÃºt toÃ¡n.'));
  }

  async function closePeriod(selected) {
    if (!selected) return;
    await run(`${selected.id}:closed`, () => api(dataPath('accounting.period', selected.id, 'closed'), { method: 'POST' }), uiText('ÄÃ£ khÃ³a ká»³. Há»‡ thá»‘ng khÃ´ng cho ghi sá»• hoáº·c sá»­a bÃºt toÃ¡n trong khoáº£ng ngÃ y nÃ y.'));
  }

  async function reopenPeriod(selected) {
    if (!selected || !await confirmDialog({ title: uiText('Má»Ÿ láº¡i ká»³'), message: `${selected.name}? ${uiText('Viá»‡c nÃ y cho phÃ©p ghi nháº­n láº¡i bÃºt toÃ¡n trong ká»³.')}`, danger: true, confirmLabel: uiText('Má»Ÿ láº¡i ká»³') })) return;
    await run(`${selected.id}:reopened`, () => api(dataPath('accounting.period', selected.id, 'reopened'), { method: 'POST' }), uiText('ÄÃ£ má»Ÿ láº¡i ká»³ káº¿ toÃ¡n.'));
  }

  return { periodId, setPeriodId, form, setForm, busy, notice, createPeriod, closePeriod, reopenPeriod };
}
