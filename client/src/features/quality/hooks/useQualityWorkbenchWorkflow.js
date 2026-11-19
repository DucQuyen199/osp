import { useState } from 'react';
import { api, dataPath } from '../../../lib/api.js';
import { uiText } from '../../../lib/i18n.js';

export function useQualityWorkbenchWorkflow({ load, clearLoadError }) {
  const [form, setForm] = useState({ title: '', severity: 'major', description: '', inspection: '' });
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function run(key, operation, message) {
    clearLoadError(); setBusy(key); setError(''); setNotice('');
    try { await operation(); await load(true); setNotice(message); }
    catch (reason) { setError(reason.message || uiText('Thao tác không thành công.')); }
    finally { setBusy(''); }
  }

  async function create(event) {
    event.preventDefault();
    const payload = { title: form.title.trim(), severity: form.severity };
    if (form.description.trim()) payload.description = form.description.trim();
    if (form.inspection) payload.inspection = form.inspection;
    await run('create', async () => {
      await api(dataPath('quality.nonconformance'), { method: 'POST', body: payload });
      setForm({ title: '', severity: 'major', description: '', inspection: '' });
    }, uiText('Đã ghi nhận sự không phù hợp.'));
  }

  const close = (record) => run(`${record.id}:closed`, () => api(dataPath('quality.nonconformance', record.id, 'closed'), { method: 'POST' }), uiText('Đã đóng hồ sơ NCR.'));
  return { form, setForm, busy, error, notice, create, close };
}
