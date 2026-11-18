import { useCallback, useEffect, useState } from 'react';
import { useLatestRequest } from '../../../lib/useLatestRequest.js';
import { api, tenantPath } from '../../../lib/api.js';
import { confirmDialog, toast } from '../../../lib/feedback.js';
import { fmtDateTime, uiText } from '../../../lib/i18n.js';

export function useTokensWorkflow({ enabled }) {
  const latestRequest = useLatestRequest();
  const [tokens, setTokens] = useState([]);
  const [users, setUsers] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [revealed, setRevealed] = useState(null);
  const [tokenMode, setTokenMode] = useState('scoped');

  const reload = useCallback(async () => {
    if (!enabled) return;
    const isLatest = latestRequest();
    setError('');
    try {
      const [tokenRows, userRows] = await Promise.all([api(tenantPath('/tokens')), api(tenantPath('/users'))]);
      if (!isLatest()) return;
      setTokens(tokenRows);
      setUsers(userRows);
    } catch (reason) { if (isLatest()) setError(reason.message || uiText('Không tải được token.')); }
  }, [enabled, latestRequest]);

  useEffect(() => { reload(); }, [reload]);

  async function create(event) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const scopes = tokenMode === 'scoped'
      ? String(values.get('scopes') || '').split(/[\n,;]/).map((scope) => scope.trim()).filter(Boolean)
      : null;
    if (tokenMode === 'scoped' && !scopes.length) { setError(uiText('Nhập ít nhất một quyền cho token giới hạn.')); return; }
    setBusy('create');
    setError('');
    try {
      const result = await api(tenantPath('/tokens'), { method: 'POST', body: {
        userId: values.get('userId'), label: String(values.get('label') || '').trim() || undefined,
        ttlDays: values.get('ttlDays') || undefined,
        ...(scopes ? { scopes } : {}),
      } });
      setRevealed({ token: result.token, expiresAt: result.expiresAt });
      setShowCreate(false);
      toast(uiText('Đã tạo token. Hãy sao chép ngay vì bí mật chỉ hiển thị một lần.'), 'success');
      await reload();
    } catch (reason) { setError(reason.message || uiText('Không tạo được token.')); }
    finally { setBusy(''); }
  }

  async function revoke(token) {
    if (!await confirmDialog({ title: uiText('Thu hồi token'), message: `${token.label || token.id}? ${uiText('Hệ thống đang dùng token này sẽ mất quyền truy cập ngay.')}`, danger: true, confirmLabel: uiText('Thu hồi token') })) return;
    setBusy(token.id);
    setError('');
    try {
      await api(tenantPath(`/tokens/${token.id}`), { method: 'DELETE' });
      toast(uiText('Đã thu hồi token.'), 'success');
      await reload();
    } catch (reason) { setError(reason.message || uiText('Không thu hồi được token.')); }
    finally { setBusy(''); }
  }

  async function copy() {
    if (!revealed?.token) return;
    try { await navigator.clipboard.writeText(revealed.token); toast(uiText('Đã sao chép token.'), 'success'); }
    catch { setError(uiText('Không sao chép được tự động. Hãy chọn token và sao chép thủ công.')); }
  }

  return {
    tokens, users, error, busy, showCreate, setShowCreate, revealed, setRevealed,
    tokenMode, setTokenMode, reload, create, revoke, copy, fmtDateTime,
  };
}
