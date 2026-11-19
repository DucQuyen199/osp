import React, { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { uiTextWith } from '../../lib/i18n.js';
import authEnglish from './auth.en.js';
import AuthVerticalPicker from './components/AuthVerticalPicker.jsx';
import AuthLandingHero from './components/AuthLandingHero.jsx';
import { useAuthWorkflow } from './hooks/useAuthWorkflow.js';

const t = (text) => uiTextWith(text, authEnglish);

export default function AuthPage({ route, onSignedIn }) {
  const [catalog, setCatalog] = useState(null);
  const [catalogError, setCatalogError] = useState('');

  useEffect(() => {
    let active = true;
    api('/api/catalog').then((data) => { if (active) setCatalog(data); })
      .catch((reason) => { if (active) setCatalogError(reason.message || 'Không tải được danh mục.'); });
    return () => { active = false; };
  }, []);



  const workflow = useAuthWorkflow({ route, onSignedIn, t });
  const {
    mode, setMode, vertical, setVertical, busy, error, setError, notice, setNotice,
    loginTenantId, setLoginTenantId, login, completeMfaLogin, signup, demo, startOidc,
    chooseMode, requestReset, requestVerification, completeReset, returnFromMfa, returnToLogin,
  } = workflow;

  useEffect(() => {
    if (catalog && !catalog.signup && mode === 'signup') {
      setMode('login');
      if (route.name === 'signup') location.hash = '#/login';
    }
  }, [catalog, mode, route.name]);


  if (!catalog) return <div className="landing"><main className="landing-panel">{catalogError ? <div className="alert danger" role="alert">{t(catalogError)}</div> : <div className="skeleton" data-h="row" />}</main></div>;

  return <div className="landing">
    <AuthLandingHero moduleCount={catalog.modules.length} verticalCount={catalog.verticals.length} t={t} />
    <main className="landing-panel" id="main">
      <div><h2>{t(mode === 'login' ? 'Chào mừng trở lại' : mode === 'mfa' ? 'Xác thực hai lớp' : mode === 'signup' ? 'Bắt đầu trong vài phút' : mode === 'forgot' ? 'Khôi phục mật khẩu' : mode === 'verify-request' ? 'Gửi lại email xác minh' : mode === 'verify' ? 'Đang xác minh email' : 'Đặt mật khẩu mới')}</h2><p className="muted">{t(mode === 'login' ? 'Đăng nhập để tiếp tục.' : mode === 'mfa' ? 'Nhập mã 6 chữ số từ ứng dụng xác thực hoặc một mã khôi phục chưa dùng.' : mode === 'signup' ? 'Chọn ngành, hệ thống bật sẵn các module và thuật ngữ phù hợp.' : mode === 'forgot' ? 'Nhập mã doanh nghiệp và email đăng nhập.' : mode === 'verify-request' ? 'Nhập mã doanh nghiệp và email đăng ký.' : mode === 'verify' ? 'Đang xác minh liên kết dùng một lần.' : 'Liên kết đặt lại chỉ dùng được một lần trong 30 phút.')}</p></div>
      {['login', 'signup'].includes(mode) && <nav className="tabs" aria-label={t('Tài khoản')}>
        <a className="tab" aria-current={mode === 'login' ? 'page' : undefined} href="#/login" onClick={() => { setError(''); setNotice(''); }}>{t('Đăng nhập')}</a>
        {catalog.signup && <a className="tab" aria-current={mode === 'signup' ? 'page' : undefined} href="#/signup" onClick={() => { setError(''); setNotice(''); }}>{t('Tạo doanh nghiệp')}</a>}
      </nav>}
      {notice && <div className="alert success" role="status">{notice.startsWith('Doanh nghiệp đã được tạo.') ? `${t('Doanh nghiệp đã được tạo. Hãy xác minh email để kích hoạt tài khoản. Mã doanh nghiệp:')} ${notice.split(': ').at(-1)}` : t(notice)}</div>}
      {error && <div className="alert danger" role="alert">{t(error)}</div>}
      {mode === 'mfa' ? <form className="stack" onSubmit={completeMfaLogin}>
        <div className="field"><label htmlFor="mfa-login-code">{t('Mã xác thực hoặc mã khôi phục')}</label><input className="input mono" id="mfa-login-code" name="code" autoComplete="one-time-code" inputMode="numeric" maxLength="40" required autoFocus /></div>
        <button className="btn btn-primary" type="submit" disabled={Boolean(busy)}>{t(busy === 'mfa' ? 'Đang xác minh…' : 'Xác minh và đăng nhập')}</button>
        <button className="btn btn-ghost" type="button" disabled={Boolean(busy)} onClick={() => { returnFromMfa(); }}>{t('Quay lại đăng nhập')}</button>
      </form> : mode === 'login' ? <form className="stack" onSubmit={login}>
        <div className="field"><label htmlFor="auth-tenant">{t('Mã doanh nghiệp')}</label><input className="input mono" id="auth-tenant" name="tenantId" autoComplete="organization" required placeholder="t_xxxxxxxx" value={loginTenantId} onChange={(event) => setLoginTenantId(event.target.value)} /><p className="hint">{t('Mã bắt đầu bằng t_, được cấp khi tạo doanh nghiệp.')}</p></div>
        <div className="field"><label htmlFor="auth-email">{t('Email')}</label><input className="input" id="auth-email" name="email" type="email" autoComplete="username" required /></div>
        <div className="field"><label htmlFor="auth-password">{t('Mật khẩu')}</label><input className="input" id="auth-password" name="password" type="password" autoComplete="current-password" required /></div>
        <label className="check"><input type="checkbox" name="remember" />{t('Ghi nhớ đăng nhập trên máy này')}</label>
        <button className="btn btn-primary" type="submit" disabled={Boolean(busy)}>{t(busy === 'login' ? 'Đang đăng nhập…' : 'Đăng nhập')}</button>
        <button className="btn btn-ghost" type="button" onClick={() => chooseMode('forgot')}>{t('Quên mật khẩu?')}</button>
        <button className="btn btn-ghost" type="button" onClick={() => { setError(''); setNotice(''); setMode('verify-request'); }}>{t('Gửi lại email xác minh')}</button>
      </form> : mode === 'signup' ? <form className="stack" onSubmit={signup}>
        <AuthVerticalPicker verticals={catalog.verticals} value={vertical} onChange={setVertical} t={t}/>
        <fieldset className="field"><legend className="label">{t('2. Thông tin doanh nghiệp')}</legend>
          <div className="form-grid">
            <div className="field full"><label htmlFor="signup-company">{t('Tên doanh nghiệp')}</label><input className="input" id="signup-company" name="company" required autoComplete="organization" /></div>
            <div className="field"><label htmlFor="signup-admin">{t('Tên người quản trị')}</label><input className="input" id="signup-admin" name="adminName" required autoComplete="name" /></div>
            <div className="field"><label htmlFor="signup-email">{t('Email đăng nhập')}</label><input className="input" id="signup-email" name="email" type="email" required autoComplete="username" /></div>
            <div className="field full"><label htmlFor="signup-password">{t('Mật khẩu')}</label><input className="input" id="signup-password" name="password" type="password" required minLength="15" maxLength="200" autoComplete="new-password" /><p className="hint">{t('Tối thiểu 15 ký tự.')}</p></div>
          </div>
        </fieldset>
        <button className="btn btn-primary" type="submit" disabled={Boolean(busy)}>{t(busy === 'signup' ? 'Đang tạo doanh nghiệp…' : 'Tạo doanh nghiệp')}</button>
      </form> : mode === 'forgot' ? <form className="stack" onSubmit={requestReset}>
        <div className="field"><label htmlFor="reset-tenant">{t('Mã doanh nghiệp')}</label><input className="input mono" id="reset-tenant" name="tenantId" required defaultValue={new URLSearchParams(location.search).get('tenant') || ''} /></div>
        <div className="field"><label htmlFor="reset-email">{t('Email đăng nhập')}</label><input className="input" id="reset-email" name="email" type="email" autoComplete="email" required /></div>
        <button className="btn btn-primary" type="submit" disabled={Boolean(busy)}>{t(busy === 'forgot' ? 'Đang gửi…' : 'Gửi hướng dẫn')}</button>
        <button className="btn btn-ghost" type="button" onClick={() => chooseMode('login')}>{t('Quay lại đăng nhập')}</button>
      </form> : mode === 'verify-request' ? <form className="stack" onSubmit={requestVerification}>
        <div className="field"><label htmlFor="verify-tenant">{t('Mã doanh nghiệp')}</label><input className="input mono" id="verify-tenant" name="tenantId" required defaultValue={new URLSearchParams(location.search).get('tenant') || ''} /></div>
        <div className="field"><label htmlFor="verify-email-address">{t('Email đăng ký')}</label><input className="input" id="verify-email-address" name="email" type="email" autoComplete="email" required /></div>
        <button className="btn btn-primary" type="submit" disabled={Boolean(busy)}>{t(busy === 'verify-request' ? 'Đang gửi…' : 'Gửi liên kết xác minh')}</button>
        <button className="btn btn-ghost" type="button" onClick={() => setMode('login')}>{t('Quay lại đăng nhập')}</button>
      </form> : mode === 'verify' ? <div className="stack"><p className="muted">{t(busy === 'verify' ? 'Đang xử lý liên kết xác minh…' : 'Bạn có thể quay lại đăng nhập sau khi xác minh.')}</p><button className="btn btn-ghost" type="button" onClick={() => { returnToLogin(); }}>{t('Quay lại đăng nhập')}</button></div> : <form className="stack" onSubmit={completeReset}>
        <div className="field"><label htmlFor="new-password">{t('Mật khẩu mới')}</label><input className="input" id="new-password" name="password" type="password" autoComplete="new-password" minLength="15" maxLength="200" required /><p className="hint">{t('Tối thiểu 15 ký tự.')}</p></div>
        <div className="field"><label htmlFor="confirm-password">{t('Nhập lại mật khẩu')}</label><input className="input" id="confirm-password" name="confirm" type="password" autoComplete="new-password" minLength="15" maxLength="200" required /></div>
        <button className="btn btn-primary" type="submit" disabled={Boolean(busy)}>{t(busy === 'reset' ? 'Đang cập nhật…' : 'Đặt lại mật khẩu')}</button>
      </form>}
      {mode === 'login' && catalog.oidc && <div className="stack-sm"><button className="btn" type="button" disabled={Boolean(busy)} onClick={startOidc}>{t(busy === 'oidc' ? 'Đang chuyển tới nhà cung cấp…' : 'Đăng nhập bằng tài khoản doanh nghiệp')}</button></div>}
      {catalog.demo && <div className="stack-sm"><hr /><p className="hint">{t('Chỉ muốn xem thử? Không cần đăng ký — tạo sẵn doanh nghiệp mẫu có dữ liệu để bạn thao tác.')}</p><button className="btn" type="button" disabled={Boolean(busy)} onClick={demo}>{t(busy === 'demo' ? 'Đang tạo dữ liệu…' : 'Dùng thử ngay với dữ liệu mẫu')}</button></div>}
    </main>
  </div>;
}
