import { useEffect, useState } from 'react';
import { api, dataPath } from '../../../lib/api.js';
import { compareDecimals } from '../../../lib/decimal.js';
import { uiText } from '../../../lib/i18n.js';
import { can } from '../../../lib/state.js';

const blankLine = () => ({ rowId: crypto.randomUUID(), product: '', lot: '', location: '', counted_qty: '' });
const cleanLines = (lines) => lines.map(({ product, lot, location, counted_qty }) => ({
  product,
  counted_qty: String(counted_qty),
  ...(lot ? { lot } : {}),
  ...(location ? { location } : {}),
}));
const action = (row, verb) => api(dataPath('inventory.stock_count', row.id, verb), { method: 'POST' });

export function useStockCountWorkflow({ counts, products, load, setError }) {
  const [selectedId, setSelectedId] = useState('');
  const [warehouse, setWarehouse] = useState('');
  const [reason, setReason] = useState('cycle_count');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState([blankLine()]);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    setSelectedId((current) => counts.some((row) => row.id === current) ? current : '');
  }, [counts]);

  const selected = counts.find((row) => row.id === selectedId);
  const editable = !selected || ['draft', 'rejected'].includes(selected.status);

  function startNew() {
    setSelectedId(''); setWarehouse(''); setReason('cycle_count'); setNote(''); setLines([blankLine()]);
    setError(''); setNotice('');
  }

  function openCount(row) {
    setSelectedId(row.id); setWarehouse(row.warehouse || ''); setReason(row.reason || 'cycle_count'); setNote(row.note || '');
    setLines((row.adjustment_lines || []).map((line) => ({
      rowId: crypto.randomUUID(), product: line.product || '', lot: line.lot || '', location: line.location || '',
      counted_qty: line.counted_qty == null ? '' : String(line.counted_qty), expected_qty: line.expected_qty, variance_qty: line.variance_qty,
    })));
    setError(''); setNotice('');
  }

  function changeWarehouse(value) {
    setWarehouse(value);
    setLines((current) => current.map((line) => ({ ...line, location: '' })));
  }

  function updateLine(rowId, field, value) {
    setLines((current) => current.map((line) => line.rowId === rowId
      ? { ...line, [field]: value, ...(field === 'product' ? { lot: '' } : {}) }
      : line));
  }
  function addLine() { setLines((current) => [...current, blankLine()]); }
  function removeLine(rowId) { setLines((current) => current.filter((line) => line.rowId !== rowId)); }

  function validateForm() {
    if (!warehouse) return uiText('Chọn kho cần kiểm kê.');
    if (!lines.length) return uiText('Thêm ít nhất một dòng kiểm kê.');
    for (const [index, line] of lines.entries()) {
      if (!line.product) return `${uiText('Dòng')} ${index + 1}: ${uiText('chọn sản phẩm.')}`;
      let validCount = false;
      try { validCount = line.counted_qty !== '' && compareDecimals(line.counted_qty, 0) >= 0; } catch { validCount = false; }
      if (!validCount) return `${uiText('Dòng')} ${index + 1}: ${uiText('số lượng thực tế phải là số không âm.')}`;
      const product = products.get(line.product);
      if (product?.lot_tracked && !line.lot) return `${uiText('Dòng')} ${index + 1}: ${uiText('sản phẩm quản lý theo lô, cần chọn lô.')}`;
      const duplicate = lines.slice(0, index).some((other) => other.product === line.product
        && (other.lot || '') === (line.lot || '') && (other.location || '') === (line.location || ''));
      if (duplicate) return `${uiText('Dòng')} ${index + 1}: ${uiText('sản phẩm, lô và vị trí này đã được đếm.')}`;
    }
    return '';
  }

  async function run(key, operation, success) {
    setBusy(key); setError(''); setNotice('');
    try {
      const result = await operation();
      if (success) setNotice(success);
      await load();
      return result;
    } catch (error) {
      setError(error.message || uiText('Thao tác kiểm kê không thành công.'));
      await load();
      return null;
    } finally { setBusy(''); }
  }

  async function saveDraft() {
    const validation = validateForm();
    if (validation) { setError(validation); return null; }
    const body = { warehouse, reason, note: note.trim() || undefined, adjustment_lines: cleanLines(lines) };
    if (selected) return api(dataPath('inventory.stock_count', selected.id), { method: 'PATCH', body });
    return api(dataPath('inventory.stock_count'), { method: 'POST', body });
  }

  async function saveAndSubmit() {
    if (!can('inventory.stock_count.create') || (selected && !can('inventory.stock_count.update'))) return;
    await run('submit', async () => {
      const saved = await saveDraft();
      if (!saved) throw new Error(uiText('Không lưu được bản kiểm kê.'));
      setSelectedId(saved.id);
      await action(saved, 'submitted');
      return saved;
    }, uiText('Đã chốt số đếm và gửi duyệt. Số tồn sổ được chụp tại thời điểm gửi để tính chênh lệch.'));
  }

  async function saveOnly(event) {
    event.preventDefault();
    if (!can('inventory.stock_count.create') || (selected && !can('inventory.stock_count.update'))) return;
    await run('save', async () => {
      const saved = await saveDraft();
      if (!saved) throw new Error(uiText('Không lưu được bản kiểm kê.'));
      setSelectedId(saved.id);
      return saved;
    }, uiText('Đã lưu bản kiểm kê nháp.'));
  }

  async function decide(row, verb) {
    const messages = {
      approved: uiText('Đã duyệt; chênh lệch đã được ghi thành biến động tồn kho.'),
      rejected: uiText('Đã từ chối; có thể mở lại bản kiểm kê để chỉnh số đếm.'),
    };
    await run(`${row.id}:${verb}`, () => action(row, verb), messages[verb]);
  }

  async function cancel(row) {
    await run(`${row.id}:cancelled`, () => action(row, 'cancelled'), uiText('Đã hủy bản kiểm kê.'));
  }

  return {
    selectedId, setSelectedId, selected, editable,
    warehouse, setWarehouse, reason, setReason, note, setNote, lines,
    busy, notice, startNew, openCount, changeWarehouse, updateLine, addLine, removeLine,
    saveOnly, saveAndSubmit, decide, cancel,
  };
}