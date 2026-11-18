import { useState } from 'react';
import { api, tenantPath } from '../../../lib/api.js';
import { confirmDialog } from '../../../lib/feedback.js';
import { uiText } from '../../../lib/i18n.js';
import { app, publishAppState } from '../../../lib/state.js';

export function useMfaSettingsWorkflow({ reload, setStatus, setError }) {
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [setup, setSetup] = useState(null);
  const [recoveryCodes, setRecoveryCodes] = useState([]);

  async function startSetup(event) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      const result = await api(tenantPath('/auth/mfa/setup'), { method: 'POST', body: { password } });
      setSetup(result); setPassword(''); setCode('');
    } catch (reason) { setError(reason.message || uiText('Không bắt đầu được thiết lập xác thực hai lớp.')); }
    finally { setBusy(false); }
  }
  async function confirmSetup(event) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      const result = await api(tenantPath('/auth/mfa/confirm'), { method: 'POST', body: { code } });
      const nextRecoveryCodes = result.recoveryCodes || [];
      setRecoveryCodes(nextRecoveryCodes); setSetup(null); setCode('');
      setStatus({ enabled: true, recoveryCodesRemaining: nextRecoveryCodes.length });
      app.user.mfaEnabled = true;
      publishAppState();
      setNotice(uiText('Đã bật xác thực hai lớp. Hãy lưu các mã khôi phục ở nơi an toàn.'));
      await reload();
    } catch (reason) { setError(reason.message || uiText('Mã xác thực không đúng.')); }
    finally { setBusy(false); }
  }
  async function disableMfa(event) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      await api(tenantPath('/auth/mfa/disable'), { method: 'POST', body: { password, code } });
      setPassword(''); setCode(''); setRecoveryCodes([]); setStatus({ enabled: false, recoveryCodesRemaining: 0 });
      app.user.mfaEnabled = false;
      publishAppState();
      setNotice(uiText('Đã tắt xác thực hai lớp. Các phiên và API token khác đã bị thu hồi.'));
      await reload();
    } catch (reason) { setError(reason.message || uiText('Không tắt được xác thực hai lớp.')); }
    finally { setBusy(false); }
  }
  async function revokeOtherSessions() {
    if (!await confirmDialog({ title: uiText('Đăng xuất phiên khác'), message: uiText('Đăng xuất các phiên trình duyệt khác của tài khoản này?'), danger: true, confirmLabel: uiText('Đăng xuất') })) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await api(tenantPath('/auth/sessions/revoke-others'), { method: 'POST' });
      setNotice(`${uiText('Đã đăng xuất')} ${result.revokedCount || 0} ${uiText('phiên khác.')}`);
      await reload();
    } catch (reason) { setError(reason.message || uiText('Không thu hồi được các phiên khác.')); }
    finally { setBusy(false); }
  }
  async function copyRecoveryCodes() {
    try { await navigator.clipboard.writeText(recoveryCodes.join('\n')); setNotice(uiText('Đã sao chép mã khôi phục.')); }
    catch { setError(uiText('Trình duyệt không cho phép sao chép. Hãy lưu các mã hiển thị bên dưới.')); }
  }
  function cancelSetup() {
    setSetup(null); setCode('');
  }
  function hideRecoveryCodes() {
    setRecoveryCodes([]);
  }

  return {
    notice, busy, password, setPassword, code, setCode, setup, recoveryCodes,
    startSetup, confirmSetup, disableMfa, revokeOtherSessions,
    copyRecoveryCodes, cancelSetup, hideRecoveryCodes,
  };
}
