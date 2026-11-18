import { useEffect, useState } from 'react';
import { api, session } from '../../../lib/api.js';

const modeForRoute = (name) => name === 'signup' ? 'signup'
  : name === 'forgot-password' ? 'forgot'
    : name === 'reset-password' ? 'reset'
      : name === 'verify-email' ? 'verify' : 'login';

export function useAuthWorkflow({ route, onSignedIn, t }) {
  const [loginTenantId, setLoginTenantId] = useState(() => new URLSearchParams(location.search).get('tenant') || '');
  const [mode, setMode] = useState(() => modeForRoute(route.name));
  const [vertical, setVertical] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [mfaChallenge, setMfaChallenge] = useState('');
  const [mfaTenant, setMfaTenant] = useState('');
  const [rememberLogin, setRememberLogin] = useState(false);

  useEffect(() => { setMode(modeForRoute(route.name)); }, [route.name]);

  useEffect(() => {
    if (route.name !== 'verify-email' || !route.token) return;
    let active = true;
    setBusy('verify'); setError(''); setNotice('');
    api('/api/auth/email-verification/complete', { method: 'POST', body: { token: route.token } })
      .then(() => { if (active) { setNotice('Email đã được xác minh. Bạn có thể đăng nhập.'); setMode('login'); location.hash = '#/login'; } })
      .catch((reason) => { if (active) setError(reason.message || 'Liên kết xác minh không hợp lệ hoặc đã hết hạn.'); })
      .finally(() => { if (active) setBusy(''); });
    return () => { active = false; };
  }, [route.name, route.token]);

  const finish = async (tenantId, token, remember) => {
    session.set({ tenantId, token }, remember);
    await onSignedIn();
  };

  const login = async (event) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setBusy('login'); setError('');
    const tenantId = String(values.get('tenantId') || '').trim();
    try {
      const result = await api('/api/auth/login', { method: 'POST', body: {
        tenantId, email: String(values.get('email') || '').trim(), password: values.get('password'),
      } });
      if (result.mfaRequired) {
        setMfaChallenge(result.challengeToken);
        setMfaTenant(tenantId);
        setRememberLogin(values.get('remember') === 'on');
        setMode('mfa');
        return;
      }
      await finish(tenantId, result.token, values.get('remember') === 'on');
    } catch (reason) { setError(reason.message || 'Không đăng nhập được.'); }
    finally { setBusy(''); }
  };

  const completeMfaLogin = async (event) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setBusy('mfa'); setError('');
    try {
      const result = await api('/api/auth/mfa/complete', { method: 'POST', body: {
        challengeToken: mfaChallenge, code: String(values.get('code') || '').trim(),
      } });
      await finish(result.tenantId || mfaTenant, result.token, rememberLogin);
    } catch (reason) { setError(reason.message || 'Mã xác thực không hợp lệ hoặc đã hết hạn.'); }
    finally { setBusy(''); }
  };

  const signup = async (event) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setBusy('signup'); setError('');
    try {
      const tenant = await api('/api/tenants', { method: 'POST', body: {
        name: String(values.get('company') || '').trim(), vertical: vertical || undefined,
        admin: {
          name: String(values.get('adminName') || '').trim(),
          email: String(values.get('email') || '').trim(),
          password: values.get('password'),
        },
      } });
      setNotice(`Doanh nghiệp đã được tạo. Hãy xác minh email để kích hoạt tài khoản. Mã doanh nghiệp: ${tenant.tenantId}`);
      setMode('login'); location.hash = '#/login';
    } catch (reason) { setError(reason.message || 'Không tạo được doanh nghiệp.'); }
    finally { setBusy(''); }
  };

  const demo = async () => {
    setBusy('demo'); setError('');
    try {
      const result = await api('/api/demo', { method: 'POST', body: { vertical: vertical || 'retail' } });
      await finish(result.tenantId, result.token, false);
    } catch (reason) { setError(reason.message || 'Không tạo được dữ liệu dùng thử.'); }
    finally { setBusy(''); }
  };

  const startOidc = async () => {
    const tenantId = loginTenantId.trim();
    if (!tenantId) { setError('Nhập mã doanh nghiệp trước khi đăng nhập bằng tài khoản doanh nghiệp.'); return; }
    setBusy('oidc'); setError('');
    try {
      const result = await api('/api/auth/oidc/start', { method: 'POST', body: { tenantId } });
      location.assign(result.authorizationUrl);
    } catch (reason) { setError(reason.message || 'Không bắt đầu được đăng nhập doanh nghiệp.'); setBusy(''); }
  };

  const chooseMode = (next) => {
    setError(''); setNotice(''); setMode(next);
    location.hash = next === 'signup' ? '#/signup' : next === 'forgot' ? '#/forgot-password' : '#/login';
  };

  const requestReset = async (event) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setBusy('forgot'); setError(''); setNotice('');
    try {
      await api('/api/auth/password-reset/request', { method: 'POST', body: {
        tenantId: String(values.get('tenantId') || '').trim(), email: String(values.get('email') || '').trim(),
      } });
      setNotice('Nếu tài khoản tồn tại, email hướng dẫn đặt lại mật khẩu sẽ được gửi trong ít phút.');
    } catch (reason) { setError(reason.message || 'Chưa gửi được yêu cầu. Vui lòng thử lại.'); }
    finally { setBusy(''); }
  };

  const requestVerification = async (event) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setBusy('verify-request'); setError(''); setNotice('');
    try {
      await api('/api/auth/email-verification/request', { method: 'POST', body: {
        tenantId: String(values.get('tenantId') || '').trim(), email: String(values.get('email') || '').trim(),
      } });
      setNotice('Nếu tài khoản cần xác minh tồn tại, email hướng dẫn sẽ được gửi trong ít phút.');
    } catch (reason) { setError(reason.message || 'Chưa gửi được yêu cầu. Vui lòng thử lại.'); }
    finally { setBusy(''); }
  };

  const completeReset = async (event) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const password = String(values.get('password') || '');
    if (password !== String(values.get('confirm') || '')) { setError('Hai mật khẩu chưa khớp.'); return; }
    setBusy('reset'); setError(''); setNotice('');
    try {
      await api('/api/auth/password-reset/complete', { method: 'POST', body: { token: route.token, password } });
      setNotice('Mật khẩu đã được cập nhật. Hãy đăng nhập bằng mật khẩu mới.');
      setMode('login'); location.hash = '#/login';
    } catch (reason) { setError(reason.message || 'Liên kết không hợp lệ hoặc đã hết hạn.'); }
    finally { setBusy(''); }
  };

  const returnFromMfa = () => { setMfaChallenge(''); setMode('login'); };
  const returnToLogin = () => { setMode('login'); location.hash = '#/login'; };

  return {
    mode, setMode, vertical, setVertical, busy, error, setError, notice, setNotice,
    loginTenantId, setLoginTenantId, login, completeMfaLogin, signup, demo, startOidc,
    chooseMode, requestReset, requestVerification, completeReset, returnFromMfa, returnToLogin,
  };
}
