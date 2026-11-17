import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api, session } from './lib/api.js';
import { uiTextWith } from './lib/i18n.js';
import authEnglish from './features/auth/auth.en.js';

const t = (text) => uiTextWith(text, authEnglish);

function OidcCallback() {
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [challenge, setChallenge] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [code, setCode] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const authorizationCode = params.get('code') || '';
    const state = params.get('state') || '';
    const providerError = params.get('error_description') || params.get('error');
    history.replaceState(null, '', location.pathname);
    if (providerError || !authorizationCode || !state) {
      setError(providerError || t('Phản hồi đăng nhập không đầy đủ. Hãy thử đăng nhập lại.'));
      setBusy(false);
      return;
    }
    api('/api/auth/oidc/complete', { method: 'POST', body: { code: authorizationCode, state } })
      .then((result) => {
        if (result.mfaRequired) {
          setChallenge(result.challengeToken);
          setTenantId(result.tenantId || '');
          setBusy(false);
          return;
        }
        session.set({ tenantId: result.tenantId, token: result.token }, false);
        location.replace('/');
      })
      .catch((reason) => { setError(reason.message || t('Đăng nhập doanh nghiệp không thành công.')); setBusy(false); });
  }, []);

  const completeMfa = async (event) => {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      const result = await api('/api/auth/mfa/complete', { method: 'POST', body: { challengeToken: challenge, code } });
      session.set({ tenantId: result.tenantId || tenantId, token: result.token }, false);
      location.replace('/');
    } catch (reason) { setError(reason.message || t('Mã xác thực không hợp lệ hoặc đã hết hạn.')); setBusy(false); }
  };

  return <div className="landing"><main className="landing-panel" id="main">
    <a className="brand" href="/"><span className="brand-mark">O</span>OSP Suite</a>
    <h1>{challenge ? t('Xác thực hai lớp') : t('Đăng nhập doanh nghiệp')}</h1>
    <p className="muted">{challenge ? t('Nhập mã từ ứng dụng xác thực hoặc mã khôi phục.') : busy ? t('Đang xác minh tài khoản của bạn…') : t('Bạn có thể quay lại trang đăng nhập và thử lại.')}</p>
    {error && <div className="alert danger" role="alert">{error}</div>}
    {challenge && <form className="stack" onSubmit={completeMfa}>
      <div className="field"><label htmlFor="oidc-mfa-code">{t('Mã xác thực hoặc mã khôi phục')}</label><input className="input mono" id="oidc-mfa-code" autoComplete="one-time-code" inputMode="numeric" maxLength="40" required value={code} onChange={(event) => setCode(event.target.value)} /></div>
      <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? t('Đang xác minh…') : t('Xác minh và đăng nhập')}</button>
    </form>}
    {busy && !challenge && <div className="skeleton" data-h="row" />}
    {!busy && !challenge && <a className="btn btn-primary" href="/#/login">{t('Quay lại đăng nhập')}</a>}
  </main></div>;
}

createRoot(document.getElementById('app')).render(<OidcCallback />);
