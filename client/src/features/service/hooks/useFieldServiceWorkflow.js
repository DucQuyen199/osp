import { useEffect, useState } from 'react';
import { localDateTime as businessDateTime, localDateTimeToIso } from '../../../lib/dates.js';
import { api, dataPath } from '../../../lib/api.js';

const futureSlot = (hours) => businessDateTime(new Date(Date.now() + hours * 3600000));

export function useFieldServiceWorkflow({ orders, parties, productChoices, load, setError, t }) {
  const [selectedId, setSelectedId] = useState('');
  const [form, setForm] = useState(() => ({ party: '', title: '', address: '', technician: '', technician_employee: '', scheduled_at: futureSlot(2), scheduled_end: futureSlot(3), warehouse: '' }));
  const [editForm, setEditForm] = useState({ party: '', title: '', address: '', technician: '', technician_employee: '', scheduled_at: '', scheduled_end: '', warehouse: '' });
  const [newLines, setNewLines] = useState([]);
  const [editLines, setEditLines] = useState([]);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const selected = orders.find((order) => order.id === selectedId);

  useEffect(() => {
    setSelectedId((current) => orders.some((item) => item.id === current) ? current : orders[0]?.id || '');
  }, [orders]);
  useEffect(() => {
    setForm((current) => ({ ...current, party: current.party || [...parties.keys()][0] || '' }));
  }, [parties]);
  useEffect(() => {
    if (!selected) return;
    setEditLines((selected.lines || []).map((line) => ({ rowId: crypto.randomUUID(), product: line.product || '', uom: line.uom || '', qty: String(line.qty || 1), price: line.price })));
    setEditForm((current) => ({
      ...current,
      party: selected.party || '', title: selected.title || '', address: selected.address || '', technician: selected.technician || '', technician_employee: selected.technician_employee || '',
      scheduled_at: selected.scheduled_at ? businessDateTime(new Date(selected.scheduled_at)) : '',
      scheduled_end: selected.scheduled_end ? businessDateTime(new Date(selected.scheduled_end)) : '', warehouse: selected.warehouse || '',
    }));
  }, [selectedId]);

  function updateForm(field, value) { setForm((current) => ({ ...current, [field]: value })); }
  function updateEditForm(field, value) { setEditForm((current) => ({ ...current, [field]: value })); }
  function updateNewLine(index, field, value) { setNewLines((current) => current.map((line, i) => i === index ? { ...line, [field]: value, ...(field === 'product' ? { uom: '' } : {}) } : line)); }
  function updateEditLine(index, field, value) { setEditLines((current) => current.map((line, i) => i === index ? { ...line, [field]: value, ...(field === 'product' ? { uom: '' } : {}) } : line)); }
  function removeNewLine(index) { setNewLines((current) => current.filter((_, i) => i !== index)); }
  function removeEditLine(index) { setEditLines((current) => current.filter((_, i) => i !== index)); }
  function addNewLine() { setNewLines((current) => [...current, { rowId: crypto.randomUUID(), product: productChoices[0]?.id || '', qty: '1', uom: '' }]); }
  function addEditLine() { setEditLines((current) => [...current, { rowId: crypto.randomUUID(), product: productChoices[0]?.id || '', qty: '1', uom: '' }]); }

  async function createOrder(event) {
    event.preventDefault(); setBusy('create'); setError(''); setNotice('');
    try {
      const scheduledAt = form.scheduled_at ? localDateTimeToIso(form.scheduled_at) : undefined;
      const scheduledEnd = form.scheduled_end ? localDateTimeToIso(form.scheduled_end) : undefined;
      if ((form.scheduled_at && !scheduledAt) || (form.scheduled_end && !scheduledEnd)) throw new Error(t('Giá» háº¹n khÃ´ng há»£p lá»‡ trong mÃºi giá» kinh doanh.'));
      const created = await api(dataPath('field-service.work_order'), { method: 'POST', body: {
        party: form.party, title: form.title.trim(), address: form.address.trim() || undefined,
        technician: form.technician_employee ? undefined : form.technician.trim() || undefined,
        technician_employee: form.technician_employee || undefined,
        scheduled_at: scheduledAt, scheduled_end: scheduledEnd, warehouse: form.warehouse || undefined,
        lines: newLines.map((line) => ({ product: line.product, qty: String(line.qty), ...(line.uom ? { uom: line.uom } : {}) })),
      } });
      setNotice(`${t('ÄÃ£ táº¡o lá»‡nh')} ${String(created.id).slice(0, 8)}${t('. GiÃ¡ vÃ  tráº¡ng thÃ¡i tá»“n Ä‘Æ°á»£c chá»¥p tá»« danh má»¥c.')}`);
      setForm((current) => ({ ...current, title: '', address: '', technician: '', technician_employee: '', warehouse: '' }));
      setNewLines([]); await load(true); setSelectedId(created.id);
    } catch (reason) { setError(reason.message || t('KhÃ´ng thá»ƒ táº¡o lá»‡nh cÃ´ng viá»‡c.')); }
    finally { setBusy(''); }
  }

  async function saveOpenOrder(order) {
    setBusy(`${order.id}:save`); setError(''); setNotice('');
    try {
      const scheduledAt = editForm.scheduled_at ? localDateTimeToIso(editForm.scheduled_at) : null;
      const scheduledEnd = editForm.scheduled_end ? localDateTimeToIso(editForm.scheduled_end) : null;
      if ((editForm.scheduled_at && !scheduledAt) || (editForm.scheduled_end && !scheduledEnd)) throw new Error(t('Giá» háº¹n khÃ´ng há»£p lá»‡ trong mÃºi giá» kinh doanh.'));
      const body = {
        title: editForm.title.trim(), address: editForm.address.trim() || null,
        technician: editForm.technician_employee ? null : editForm.technician.trim() || null,
        technician_employee: editForm.technician_employee || null,
        scheduled_at: scheduledAt, scheduled_end: scheduledEnd, warehouse: editForm.warehouse || null,
        lines: editLines.map((line) => ({ product: line.product, qty: String(line.qty), ...(line.uom ? { uom: line.uom } : {}) })),
      };
      await api(dataPath('field-service.work_order', order.id), { method: 'PATCH', body });
      setNotice(t('ÄÃ£ lÆ°u phÃ¢n cÃ´ng, lá»‹ch háº¹n vÃ  bÃ¡o giÃ¡ theo danh má»¥c.')); await load(true);
    } catch (reason) { setError(reason.message || t('KhÃ´ng thá»ƒ cáº­p nháº­t lá»‡nh.')); }
    finally { setBusy(''); }
  }

  async function transition(order, action) {
    setBusy(`${order.id}:${action}`); setError(''); setNotice('');
    try {
      await api(dataPath('field-service.work_order', order.id, action), { method: 'POST' });
      await load(true);
      const messages = { dispatched: 'ÄÃ£ Ä‘iá»u phá»‘i lá»‡nh; lá»‹ch vÃ  ngÆ°á»i phá»¥ trÃ¡ch Ä‘Ã£ Ä‘Æ°á»£c khÃ³a.', done: 'ÄÃ£ hoÃ n táº¥t; há»‡ thá»‘ng xuáº¥t váº­t tÆ° vÃ  táº¡o hÃ³a Ä‘Æ¡n.', cancelled: 'ÄÃ£ há»§y lá»‡nh cÃ´ng viá»‡c.' };
      setNotice(t(messages[action]));
    } catch (reason) { setError(reason.message || t('KhÃ´ng thá»ƒ cáº­p nháº­t lá»‡nh. Kiá»ƒm tra lá»‹ch, kho vÃ  tá»“n váº­t tÆ°.')); await load(true); }
    finally { setBusy(''); }
  }

  return {
    selectedId, setSelectedId, selected, form, setForm, editForm, setEditForm, newLines, editLines,
    busy, notice, updateForm, updateEditForm, updateNewLine, updateEditLine, removeNewLine, removeEditLine,
    addNewLine, addEditLine, createOrder, saveOpenOrder, transition,
  };
}
