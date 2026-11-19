import { useCallback, useRef, useState } from 'react';
import { api, dataPath } from '../../../lib/api.js';
import { compareDecimals, normalizeDecimal } from '../../../lib/decimal.js';
import { uiText } from '../../../lib/i18n.js';

export const validReleaseQuantity = (qty, maximum) => {
  try { return compareDecimals(qty || 0, 0) > 0 && compareDecimals(qty, maximum) <= 0; }
  catch { return false; }
};

const releaseFingerprint = (signature) => {
  const mask = 0xffffffffffffffffn;
  const prime = 0x100000001b3n;
  const hash = (seed) => {
    let value = seed;
    for (const character of signature) {
      value = ((value ^ BigInt(character.codePointAt(0))) * prime) & mask;
    }
    return value.toString(16).padStart(16, '0');
  };
  return `${hash(0xcbf29ce484222325n)}${hash(0x84222325cbf29ce4n)}`;
};

const releaseRequestStorageKey = (inspectionId) => `osp.quality-release.pending.${inspectionId}`;
const ephemeralReleaseRequestKeys = new Map();

function getReleaseRequestKey(inspectionId, fingerprint) {
  const storageKey = releaseRequestStorageKey(inspectionId);
  const ephemeral = ephemeralReleaseRequestKeys.get(storageKey);
  if (ephemeral?.fingerprint === fingerprint && ephemeral.expiresAt > Date.now()) return ephemeral.key;
  try {
    const pending = JSON.parse(globalThis.localStorage?.getItem(storageKey) || 'null');
    if (pending?.fingerprint === fingerprint && pending.expiresAt > Date.now() && typeof pending.key === 'string') {
      return pending.key;
    }
  } catch { /* storage can be disabled; the current request still gets a unique key */ }

  const key = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const pending = { fingerprint, key, expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000 };
  ephemeralReleaseRequestKeys.set(storageKey, pending);
  try {
    globalThis.localStorage?.setItem(storageKey, JSON.stringify({
      ...pending,
    }));
  } catch { /* storage can be disabled; retry stays safe while this app session remains open */ }
  return key;
}

function clearReleaseRequestKey(inspectionId, fingerprint) {
  const storageKey = releaseRequestStorageKey(inspectionId);
  if (ephemeralReleaseRequestKeys.get(storageKey)?.fingerprint === fingerprint) {
    ephemeralReleaseRequestKeys.delete(storageKey);
  }
  try {
    const pending = JSON.parse(globalThis.localStorage?.getItem(storageKey) || 'null');
    if (pending?.fingerprint === fingerprint) globalThis.localStorage?.removeItem(storageKey);
  } catch { /* a successful server commit must not fail due to unavailable browser storage */ }
}

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
      const fingerprint = releaseFingerprint(signature);
      const requestKey = getReleaseRequestKey(item.inspectionId, fingerprint);
      await api(dataPath('quality.inspection_disposition', 'create-and-act', 'posted'), {
        method: 'POST',
        body: { inspection: item.inspectionId, qty: releaseQty, note },
        headers: { 'idempotency-key': requestKey },
      });
      clearReleaseRequestKey(item.inspectionId, fingerprint);
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
