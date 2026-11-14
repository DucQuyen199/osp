import React, { useEffect, useState } from 'react';
import { api, session } from './lib/api.js';

export default function AuthPage({ route, onSignedIn }) {
  const [catalog, setCatalog] = useState(null);
  const [catalogError, setCatalogError] = useState('');
  const [mode, setMode] = useState(route.name === 'signup' ? 'signup' : route.name === 'forgot-password' ? 'forgot' : route.name === 'reset-password' ? 'reset' : route.name === 'verify-email' ? 'verify' : 'login');
  const [vertical, setVertical] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let active = true;
    api('/api/catalog').then((data) => { if (active) setCatalog(data); })
      .catch((reason) => { if (active) setCatalogError(reason.message || 'Không tải được danh mục.'); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    setMode(route.name === 'signup' ? 'signup' : route.name === 'forgot-password' ? 'forgot' : route.name === 'reset-password' ? 'reset' : route.name === 'verify-email' ? 'verify' : 'login');
  }, [route.name]);

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

  useEffect(() => {
    if (catalog && !catalog.signup && mode === 'signup') {
      setMode('login');
      if (route.name === 'signup') location.hash = '#/login';
    }
  }, [catalog, mode, route.name]);

  const finish = async (tenantId, token, remember) => {
    session.set({ tenantId, token }, remember);
    await onSignedIn();
  };

  const login = async (event) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setBusy('login');
    setError('');
    const tenantId = String(values.get('tenantId') || '').trim();
    try {
      const result = await api('/api/auth/login', { method: 'POST', body: {
        tenantId, email: String(values.get('email') || '').trim(), password: values.get('password'),
      } });
      await finish(tenantId, result.token, values.get('remember') === 'on');
    } catch (reason) { setError(reason.message || 'Không đăng nhập được.'); }
    finally { setBusy(''); }
  };

  const signup = async (event) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setBusy('signup');
    setError('');
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
    setBusy('demo');
    setError('');
    try {
      const result = await api('/api/demo', { method: 'POST', body: { vertical: vertical || 'retail' } });
      await finish(result.tenantId, result.token, false);
    } catch (reason) { setError(reason.message || 'Không tạo được dữ liệu dùng thử.'); }
    finally { setBusy(''); }
  };

  const chooseMode = (next) => {
    setError('');
    setNotice('');
    setMode(next);
    location.hash = next === 'signup' ? '#/signup' : next === 'forgot' ? '#/forgot-password' : '#/login';
  };

  const requestReset = async (event) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setBusy('forgot'); setError(''); setNotice('');
    try {
      await api('/api/auth/password-reset/request', { method: 'POST', body: {
        tenantId: String(values.get('tenantId') || '').trim(),
        email: String(values.get('email') || '').trim(),
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

  if (!catalog) return <div className="landing"><main className="landing-panel">{catalogError ? <div className="alert danger" role="alert">{catalogError}</div> : <div className="skeleton" data-h="row" />}</main></div>;

  return <div className="landing">
    <section className="landing-hero" aria-label="Giới thiệu">
      <a className="brand" href="#/login"><span className="brand-mark">O</span>OSP Suite</a>
      <div><h1>Một hệ thống cho cả doanh nghiệp, đúng với ngành của bạn.</h1><p>CRM, bán hàng, kho, kế toán, nhân sự… dùng chung một nguồn dữ liệu. Làm ở đâu, các bước còn lại tự chạy theo.</p></div>
      <ul className="hero-points"><li>{catalog.modules.length} module, bật dần theo nhu cầu</li><li>{catalog.verticals.length} gói ngành với thuật ngữ và quy trình sẵn có</li><li>Dữ liệu của bạn: xuất toàn bộ bất cứ lúc nào</li></ul>
    </section>
    <main className="landing-panel" id="main">
      <div><h2>{mode === 'login' ? 'Chào mừng trở lại' : mode === 'signup' ? 'Bắt đầu trong vài phút' : mode === 'forgot' ? 'Khôi phục mật khẩu' : mode === 'verify-request' ? 'Gửi lại email xác minh' : mode === 'verify' ? 'Đang xác minh email' : 'Đặt mật khẩu mới'}</h2><p className="muted">{mode === 'login' ? 'Đăng nhập để tiếp tục.' : mode === 'signup' ? 'Chọn ngành, hệ thống bật sẵn các module và thuật ngữ phù hợp.' : mode === 'forgot' ? 'Nhập mã doanh nghiệp và email đăng nhập.' : mode === 'verify-request' ? 'Nhập mã doanh nghiệp và email đăng ký.' : mode === 'verify' ? 'Đang xác minh liên kết dùng một lần.' : 'Liên kết đặt lại chỉ dùng được một lần trong 30 phút.'}</p></div>
      {['login', 'signup'].includes(mode) && <div className="tabs" role="tablist" aria-label="Tài khoản">
        <button className="tab" role="tab" type="button" aria-selected={mode === 'login'} onClick={() => chooseMode('login')}>Đăng nhập</button>
        {catalog.signup && <button className="tab" role="tab" type="button" aria-selected={mode === 'signup'} onClick={() => chooseMode('signup')}>Tạo doanh nghiệp</button>}
      </div>}
      {notice && <div className="alert success" role="status">{notice}</div>}
      {error && <div className="alert danger" role="alert">{error}</div>}
      {mode === 'login' ? <form className="stack" onSubmit={login}>
        <div className="field"><label htmlFor="auth-tenant">Mã doanh nghiệp</label><input className="input mono" id="auth-tenant" name="tenantId" autoComplete="organization" required placeholder="t_xxxxxxxx" defaultValue={new URLSearchParams(location.search).get('tenant') || ''} /><p className="hint">Mã bắt đầu bằng t_, được cấp khi tạo doanh nghiệp.</p></div>
        <div className="field"><label htmlFor="auth-email">Email</label><input className="input" id="auth-email" name="email" type="email" autoComplete="username" required /></div>
        <div className="field"><label htmlFor="auth-password">Mật khẩu</label><input className="input" id="auth-password" name="password" type="password" autoComplete="current-password" required /></div>
        <label className="check"><input type="checkbox" name="remember" />Ghi nhớ đăng nhập trên máy này</label>
        <button className="btn btn-primary" type="submit" disabled={Boolean(busy)}>{busy === 'login' ? 'Đang đăng nhập…' : 'Đăng nhập'}</button>
        <button className="btn btn-ghost" type="button" onClick={() => chooseMode('forgot')}>Quên mật khẩu?</button>
        <button className="btn btn-ghost" type="button" onClick={() => { setError(''); setNotice(''); setMode('verify-request'); }}>Gửi lại email xác minh</button>
      </form> : mode === 'signup' ? <form className="stack" onSubmit={signup}>
        <fieldset className="field"><legend className="label">1. Chọn ngành của bạn</legend>
          <div className="vertical-grid" role="group" aria-label="Chọn ngành">
            <button className="vertical-card" type="button" aria-pressed={!vertical} onClick={() => setVertical('')}><strong>Tự chọn module</strong><span>Bắt đầu gọn, bật thêm sau</span></button>
            {catalog.verticals.map((item) => <button className="vertical-card" key={item.id} type="button" aria-pressed={vertical === item.id} title={item.description} onClick={() => setVertical(item.id)}><strong>{item.name}</strong><span>{item.modules.length} module</span></button>)}
          </div>
          <p className="hint" aria-live="polite">{catalog.verticals.find((item) => item.id === vertical)?.description || 'Chỉ có dữ liệu gốc. Bạn bật thêm module trong Cài đặt.'}</p>
        </fieldset>
        <fieldset className="field"><legend className="label">2. Thông tin doanh nghiệp</legend>
          <div className="form-grid">
            <div className="field full"><label htmlFor="signup-company">Tên doanh nghiệp</label><input className="input" id="signup-company" name="company" required autoComplete="organization" /></div>
            <div className="field"><label htmlFor="signup-admin">Tên người quản trị</label><input className="input" id="signup-admin" name="adminName" required autoComplete="name" /></div>
            <div className="field"><label htmlFor="signup-email">Email đăng nhập</label><input className="input" id="signup-email" name="email" type="email" required autoComplete="username" /></div>
            <div className="field full"><label htmlFor="signup-password">Mật khẩu</label><input className="input" id="signup-password" name="password" type="password" required minLength="8" autoComplete="new-password" /><p className="hint">Tối thiểu 8 ký tự.</p></div>
          </div>
        </fieldset>
        <button className="btn btn-primary" type="submit" disabled={Boolean(busy)}>{busy === 'signup' ? 'Đang tạo doanh nghiệp…' : 'Tạo doanh nghiệp'}</button>
      </form> : mode === 'forgot' ? <form className="stack" onSubmit={requestReset}>
        <div className="field"><label htmlFor="reset-tenant">Mã doanh nghiệp</label><input className="input mono" id="reset-tenant" name="tenantId" required defaultValue={new URLSearchParams(location.search).get('tenant') || ''} /></div>
        <div className="field"><label htmlFor="reset-email">Email đăng nhập</label><input className="input" id="reset-email" name="email" type="email" autoComplete="email" required /></div>
        <button className="btn btn-primary" type="submit" disabled={Boolean(busy)}>{busy === 'forgot' ? 'Đang gửi…' : 'Gửi hướng dẫn'}</button>
        <button className="btn btn-ghost" type="button" onClick={() => chooseMode('login')}>Quay lại đăng nhập</button>
      </form> : mode === 'verify-request' ? <form className="stack" onSubmit={requestVerification}>
        <div className="field"><label htmlFor="verify-tenant">Mã doanh nghiệp</label><input className="input mono" id="verify-tenant" name="tenantId" required defaultValue={new URLSearchParams(location.search).get('tenant') || ''} /></div>
        <div className="field"><label htmlFor="verify-email-address">Email đăng ký</label><input className="input" id="verify-email-address" name="email" type="email" autoComplete="email" required /></div>
        <button className="btn btn-primary" type="submit" disabled={Boolean(busy)}>{busy === 'verify-request' ? 'Đang gửi…' : 'Gửi liên kết xác minh'}</button>
        <button className="btn btn-ghost" type="button" onClick={() => setMode('login')}>Quay lại đăng nhập</button>
      </form> : mode === 'verify' ? <div className="stack"><p className="muted">{busy === 'verify' ? 'Đang xử lý liên kết xác minh…' : 'Bạn có thể quay lại đăng nhập sau khi xác minh.'}</p><button className="btn btn-ghost" type="button" onClick={() => { setMode('login'); location.hash = '#/login'; }}>Quay lại đăng nhập</button></div> : <form className="stack" onSubmit={completeReset}>
        <div className="field"><label htmlFor="new-password">Mật khẩu mới</label><input className="input" id="new-password" name="password" type="password" autoComplete="new-password" minLength="8" maxLength="200" required /></div>
        <div className="field"><label htmlFor="confirm-password">Nhập lại mật khẩu</label><input className="input" id="confirm-password" name="confirm" type="password" autoComplete="new-password" minLength="8" maxLength="200" required /></div>
        <button className="btn btn-primary" type="submit" disabled={Boolean(busy)}>{busy === 'reset' ? 'Đang cập nhật…' : 'Đặt lại mật khẩu'}</button>
      </form>}
      {catalog.demo && <div className="stack-sm"><hr /><p className="hint">Chỉ muốn xem thử? Không cần đăng ký — tạo sẵn doanh nghiệp mẫu có dữ liệu để bạn thao tác.</p><button className="btn" type="button" disabled={Boolean(busy)} onClick={demo}>{busy === 'demo' ? 'Đang tạo dữ liệu…' : 'Dùng thử ngay với dữ liệu mẫu'}</button></div>}
    </main>
  </div>;
}
