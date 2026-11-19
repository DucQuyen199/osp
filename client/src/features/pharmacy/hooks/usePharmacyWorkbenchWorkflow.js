import { useState } from 'react';
import { localDate } from '../../../lib/dates.js';
import { api, dataPath, session } from '../../../lib/api.js';
import { textDialog } from '../../../lib/feedback.js';
import { addDecimals, compareDecimals, normalizeDecimal, subtractDecimals } from '../../../lib/decimal.js';
import { clearPersistentIdempotencyRequest, getPersistentIdempotencyRequest } from '../../../lib/idempotency.js';

const today = localDate;
const newLine = () => ({ rowId: crypto.randomUUID(), product: '', uom: '', qty: '1', dosage: '' });
const emptyForm = () => ({ prescription_no: '', party: '', prescriber: '', prescriber_license: '', issued_at: today(), valid_until: today(), notes: '' });

export function usePharmacyWorkbenchWorkflow({ products, returnDispositions, setReturnDispositions, load, setError, t }) {
  const [disposalDrafts, setDisposalDrafts] = useState({});
  const [editingId, setEditingId] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [lines, setLines] = useState([newLine()]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  const updateForm = (field, value) => setForm((current) => ({ ...current, [field]: value }));
  const updateLine = (index, field, value) => setLines((current) => current.map((line, i) => i === index ? { ...line, [field]: value, ...(field === 'product' ? { uom: products.find((product) => product.id === value)?.uom || '' } : {}) } : line));
  const addLine = () => setLines((current) => [...current, newLine()]);
  const removeLine = (index) => setLines((current) => current.filter((_, row) => row !== index));

  async function createPrescription(event) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      const items = lines.filter((line) => line.product).map((line) => ({ product: line.product, qty: String(line.qty), ...(line.uom ? { uom: line.uom } : {}), dosage: line.dosage.trim() }));
      const payload = { ...form, prescription_no: form.prescription_no.trim(), items };
      if (editingId) await api(dataPath('pharmacy.prescription', editingId), { method: 'PATCH', body: payload });
      else await api(dataPath('pharmacy.prescription'), { method: 'POST', body: { ...payload, status: 'draft' } });
      const wasEditing = Boolean(editingId);
      setEditingId(''); setForm(emptyForm()); setLines([newLine()]);
      setNotice(t(wasEditing ? 'Đã cập nhật đơn thuốc nháp. Hãy đối chiếu lại bản gốc trước khi xác minh.' : 'Đã lưu đơn thuốc ở trạng thái nháp. Hãy đối chiếu bản gốc rồi xác minh.'));
      await load();
    } catch (reason) { setError(t(reason.message || 'Không lưu được đơn thuốc.')); }
    finally { setBusy(false); }
  }

  function editPrescription(prescription) {
    setEditingId(prescription.id);
    setForm({
      prescription_no: prescription.prescription_no || '', party: prescription.party || '', prescriber: prescription.prescriber || '',
      prescriber_license: prescription.prescriber_license || '', issued_at: prescription.issued_at || today(),
      valid_until: prescription.valid_until || today(), notes: prescription.notes || '',
    });
    setLines((prescription.items || []).map((item) => ({ rowId: crypto.randomUUID(), product: item.product || '', uom: item.uom || '', qty: String(item.qty ?? ''), dosage: item.dosage || '' })));
    setError(''); setNotice('');
    document.getElementById('pharmacy-prescription-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    document.getElementById('pharmacy-prescription-number')?.focus({ preventScroll: true });
  }

  function cancelEdit() {
    setEditingId(''); setForm(emptyForm()); setLines([newLine()]); setError(''); setNotice('');
  }

  async function transition(prescription, action) {
    setBusy(true); setError(''); setNotice('');
    try {
      await api(dataPath('pharmacy.prescription', prescription.id, action), { method: 'POST' });
      setNotice(action === 'verified' ? `${t('Đã xác minh đơn')} ${prescription.prescription_no}${t('. Có thể chọn đơn này tại quầy POS.')}` : t('Đã hủy đơn thuốc.'));
      await load();
    } catch (reason) { setError(t(reason.message || 'Không cập nhật được trạng thái đơn thuốc.')); }
    finally { setBusy(false); }
  }

  async function failReturnedMedicine(inspection) {
    const note = await textDialog({ title: t('Xác nhận thuốc trả không đạt'), message: t('Ghi rõ đánh giá tình trạng thuốc. Thuốc khách trả không được giải phóng để bán lại.'), label: t('Lý do không đạt'), minLength: 5, maxLength: 500, confirmLabel: t('Cách ly') });
    if (!note) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await api(dataPath('quality.inspection', inspection.id), { method: 'PATCH', body: { note } });
      await api(dataPath('quality.inspection', inspection.id, 'failed'), { method: 'POST' });
      setNotice(t('Thuốc trả đã được ghi nhận không đạt và tiếp tục nằm trong khu cách ly.'));
      await load();
    } catch (reason) { setError(t(reason.message || 'Không thể ghi nhận kết quả kiểm tra thuốc trả.')); }
    finally { setBusy(false); }
  }

  async function disposeReturnedMedicine(event, inspection) {
    event.preventDefault();
    const draft = disposalDrafts[inspection.id] || {};
    const qtyText = String(draft.qty ?? '').trim();
    const note = String(draft.note || '').trim();
    const disposed = addDecimals(returnDispositions.filter((item) => item.inspection === inspection.id && item.status === 'posted').map((item) => item.qty || 0));
    const remaining = compareDecimals(subtractDecimals(inspection.qty || 0, disposed), '0') < 0 ? '0' : subtractDecimals(inspection.qty || 0, disposed);
    let quantityValid = false;
    try { quantityValid = compareDecimals(qtyText || 0, '0') > 0 && compareDecimals(qtyText, remaining) <= 0; } catch { quantityValid = false; }
    if (!quantityValid || note.length < 5 || note.length > 500) {
      setError(t('Nhập số lượng hủy hợp lệ trong giới hạn còn cách ly và ghi lý do từ 5 đến 500 ký tự.'));
      return;
    }
    setBusy(true); setError(''); setNotice('');
    try {
      const normalizedQty = normalizeDecimal(qtyText);
      let disposition = returnDispositions.find((item) => item.inspection === inspection.id && item.status === 'draft');
      if (!disposition) {
        const payload = { inspection: inspection.id, qty: normalizedQty, note };
        const scope = `${session.current()?.tenantId || ''}:pharmacy.return_disposition.posted:${inspection.id}`;
        const { key, fingerprint } = getPersistentIdempotencyRequest(scope, JSON.stringify(payload));
        disposition = await api(dataPath('pharmacy.return_disposition', 'create-and-act', 'posted'), {
          method: 'POST',
          body: payload,
          headers: { 'idempotency-key': key },
        });
        clearPersistentIdempotencyRequest(scope, fingerprint);
        setReturnDispositions((items) => items.some((item) => item.id === disposition.id)
          ? items.map((item) => item.id === disposition.id ? disposition : item)
          : [...items, disposition]);
      } else {
        if (compareDecimals(disposition.qty || 0, normalizedQty) !== 0 || disposition.note !== note) {
          disposition = await api(dataPath('pharmacy.return_disposition', disposition.id), { method: 'PATCH', body: { qty: normalizedQty, note } });
        }
        setReturnDispositions((items) => items.map((item) => item.id === disposition.id ? disposition : item));
        await api(dataPath('pharmacy.return_disposition', disposition.id, 'posted'), { method: 'POST' });
      }
      setDisposalDrafts((items) => ({ ...items, [inspection.id]: { qty: '', note: '' } }));
      setNotice(t('Đã ghi sổ hủy thuốc và xuất khỏi tồn kho cách ly.'));
      await load();
    } catch (reason) {
      try { await load(); } catch { /* preserve the mutation error if a refresh also fails */ }
      setError(t(reason.message || 'Không thể ghi sổ hủy thuốc. Phiếu nháp được giữ để thử lại.'));
    }
    finally { setBusy(false); }
  }

  function updateDisposalDraft(id, field, value) {
    setDisposalDrafts((items) => ({ ...items, [id]: { ...items[id], [field]: value } }));
  }

  return {
    disposalDrafts, updateDisposalDraft, editingId, form, lines, busy, notice,
    updateForm, updateLine, addLine, removeLine, createPrescription, editPrescription, cancelEdit,
    transition, failReturnedMedicine, disposeReturnedMedicine,
  };
}
