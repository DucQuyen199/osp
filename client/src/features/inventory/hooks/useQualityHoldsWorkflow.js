import { useCallback, useRef, useState } from 'react';
import { api, dataPath } from '../../../lib/api.js';
import { compareDecimals, normalizeDecimal } from '../../../lib/decimal.js';
import { clearPersistentIdempotencyRequest, getPersistentIdempotencyRequest } from '../../../lib/idempotency.js';
import { uiText } from '../../../lib/i18n.js';

export const validReleaseQuantity = (qty, maximum) => {
  try { return compareDecimals(qty || 0, 0) > 0 && compareDecimals(qty, maximum) <= 0; }
  catch { return false; }
};

export function useQualityHoldsWorkflow({ load, clearLoadError }) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notes, setNotes] = useState({});
  const [releaseDrafts, setReleaseDrafts] = useState({});
  const loadRef = useRef(load);
  loadRef.current = load;
  const loadCurrent = useCallback(() => loadRef.current(), []);

  async function decide(item, action) {
    clearLoadError();
    setBusy(`${item.inspectionId}:${action}`); setError('');
    try {
      if (action === 'failed') {
        const note = notes[item.inspectionId]?.trim() || '';
        if (note.length < 5 || note.length > 500) throw new Error(uiText('Nhập mô tả lỗi QC từ 5 đến 500 ký tự.'));
        await api(dataPath('quality.inspection', item.inspectionId), { method: 'PATCH', body: { note } });
      }
      await api(dataPath('quality.inspection', item.inspectionId, action), { method: 'POST' });
      await loadCurrent();
    } catch (reason) { setError(reason.message || uiText('Không cập nhật được phiếu QC.')); }
    finally { setBusy(''); }
  }

  async function releasePartial(item) {
    clearLoadError();
    const draft = releaseDrafts[item.inspectionId] || {};
    setBusy(`${item.inspectionId}:release`); setError('');
    try {
      const note = draft.note?.trim() || '';
      const enteredQty = String(draft.qty || '');
      if (note.length < 5 || note.length > 500 || !validReleaseQuantity(enteredQty, item.heldQty)) {
        throw new Error(uiText('Nhập số lượng và lý do giải phóng hợp lệ.'));
      }
      const releaseQty = normalizeDecimal(enteredQty);
      const signature = JSON.stringify([item.inspectionId, releaseQty, note]);
      const scope = `quality.inspection_disposition.posted:${item.inspectionId}`;
      const { key: requestKey, fingerprint } = getPersistentIdempotencyRequest(scope, signature);
      await api(dataPath('quality.inspection_disposition', 'create-and-act', 'posted'), {
        method: 'POST',
        body: { inspection: item.inspectionId, qty: releaseQty, note },
        headers: { 'idempotency-key': requestKey },
      });
      clearPersistentIdempotencyRequest(scope, fingerprint);
      setReleaseDrafts((current) => {
        const next = { ...current };
        delete next[item.inspectionId];
        return next;
      });
      await loadCurrent();
    } catch (reason) { setError(reason.message || uiText('Không giải phóng được một phần lô hàng.')); }
    finally { setBusy(''); }
  }

  return { busy, error, notes, setNotes, releaseDrafts, setReleaseDrafts, decide, releasePartial };
}
