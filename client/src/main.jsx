import { useCallback, useEffect, useRef, useState } from 'react';
import AuthPage from './AuthPage.jsx';
import PageRouter from './app/PageRouter.jsx';
import { parseRoute } from './app/parseRoute.js';
import GlobalSearch from './components/GlobalSearch.jsx';
import Icon from './components/Icon.jsx';
import Sidebar from './components/Sidebar.jsx';
import { createRoot } from 'react-dom/client';
import { api, onUnauthorized, session } from './lib/api.js';
import { setBusinessTimezone } from './lib/dates.js';
import { formatLocale, setFormatLocale } from './lib/i18n.js';
import { app, loadMeta, loadSummary, resetCaches } from './lib/state.js';




function App() {
  const [route, setRoute] = useState(() => parseRoute());
  const [ready, setReady] = useState(false);
  const [meta, setMeta] = useState(null);
  const [user, setUser] = useState(null);
  const [error, setError] = useState('');
  const [navOpen, setNavOpen] = useState(false);
  const [mobileNav, setMobileNav] = useState(() => window.matchMedia('(max-width: 960px)').matches);
  const navToggleRef = useRef(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [theme, setTheme] = useState(() => { try { return localStorage.getItem('osp.theme') || ''; } catch { return ''; } });
  const [numberLocale, setNumberLocale] = useState(formatLocale);
  const [, setEpoch] = useState(0);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 960px)');
    const update = () => {
      setMobileNav(media.matches);
      if (!media.matches) setNavOpen(false);
    };
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (!mobileNav || !navOpen) return;
    [...document.querySelectorAll('#nav a[href], #nav summary, #nav button:not([disabled])')]
      .find((element) => element.getClientRects().length > 0)?.focus();
  }, [mobileNav, navOpen]);
  const authenticated = Boolean(session.current());

  const refresh = useCallback(() => setEpoch((value) => value + 1), []);
  const signedIn = useCallback(async () => {
    try {
      const loaded = await loadMeta();
      await loadSummary();
      setBusinessTimezone(loaded.settings?.businessTimezone || 'UTC');
      setMeta(loaded);
      setUser(app.user);
      setError('');
      refresh();
      setRoute(parseRoute());
    } catch (reason) {
      session.clear();
      resetCaches();
      setError(reason.message || 'Không tải được dữ liệu doanh nghiệp.');
      setRoute({ name: 'login' });
      refresh();
    }
  }, [refresh]);

  useEffect(() => {
    const changed = () => { setRoute(parseRoute()); setNavOpen(false); };
    const metaChanged = () => {
      setBusinessTimezone(app.meta?.settings?.businessTimezone || 'UTC');
      setMeta(app.meta);
      setUser(app.user);
    };
    window.addEventListener('hashchange', changed);
    window.addEventListener('osp:meta', metaChanged);
    document.documentElement.dataset.theme = theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const stop = onUnauthorized(() => { session.clear(); setMeta(null); setUser(null); setError('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'); location.hash = '#/login'; refresh(); });
    return () => { window.removeEventListener('hashchange', changed); window.removeEventListener('osp:meta', metaChanged); stop?.(); };
  }, [theme, refresh]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const params = new URLSearchParams(location.search);
      if (params.get('demo') && !session.current()) {
        try {
          const response = await api('/api/demo', { method: 'POST', body: { vertical: params.get('demo') } });
          session.set({ tenantId: response.tenantId, token: response.token }, false);
          history.replaceState(null, '', `${location.pathname}#${params.get('go') || '/'}`);
          setRoute(parseRoute());
        } catch { /* show the login page */ }
      }
      if (session.current()) {
        try {
          const loaded = await loadMeta();
          await loadSummary();
          if (alive) { setBusinessTimezone(loaded.settings?.businessTimezone || 'UTC'); setMeta(loaded); setUser(app.user); }
        } catch {
          session.clear();
          resetCaches();
        }
      }
      if (alive) setReady(true);
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!ready) return;
    if (session.current() && ['login', 'signup', 'forgot-password', 'reset-password', 'verify-email'].includes(route.name)) {
      location.hash = '#/';
      return;
    }
    if (!session.current() && !['login', 'signup', 'forgot-password', 'reset-password', 'verify-email'].includes(route.name)) setRoute({ name: 'login' });
  }, [ready, route]);

  const toggleTheme = () => {
    const next = (document.documentElement.dataset.theme || 'light') === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('osp.theme', next); } catch { /* theme remains active in memory */ }
    setTheme(next);
  };

  const changeNumberLocale = (next) => {
    setFormatLocale(next);
    setNumberLocale(next);
    try { localStorage.setItem('osp.formatLocale', next); } catch { /* preference remains active in memory */ }
  };

  const logout = async () => {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* session may have expired */ }
    session.clear();
    resetCaches();
    app.meta = null;
    setMeta(null);
    setUser(null);
    setAccountOpen(false);
    location.hash = '#/login';
    refresh();
  };

  useEffect(() => {
    const shortcut = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        document.querySelector('.global-search-input')?.focus();
      }
      if (event.key === 'Escape') {
        setAccountOpen(false);
        if (mobileNav && navOpen) {
          setNavOpen(false);
          navToggleRef.current?.focus();
        }
      }
      if (mobileNav && navOpen && event.key === 'Tab') {
        const focusable = [...document.querySelectorAll('#nav a[href], #nav summary, #nav button:not([disabled])')].filter((element) => element.getClientRects().length > 0);
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && (document.activeElement === first || !document.querySelector('#nav')?.contains(document.activeElement))) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !document.querySelector('#nav')?.contains(document.activeElement))) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', shortcut);
    return () => document.removeEventListener('keydown', shortcut);
  }, [mobileNav, navOpen]);

  useEffect(() => {
    if (!ready || !session.current() || !meta || !user) return;
    const heading = document.querySelector('#main h1');
    const target = heading || document.getElementById('main');
    if (!target) return;
    if (heading && !heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
    target.focus();
  }, [route, ready, meta, user]);

  if (!ready) return <div className="landing-panel"><div className="skeleton" data-h="row" /></div>;
  if (!session.current()) return <>
    {error && <div className="toast toast-danger" role="alert">{error}</div>}
    <AuthPage route={route} onSignedIn={signedIn} />
  </>;
  if (!meta || !user) return <div className="page"><div className="alert danger">Không tải được dữ liệu doanh nghiệp. Vui lòng tải lại trang.</div></div>;

  const initials = (user.name || '?').split(' ').slice(-2).map((part) => part[0]).join('').toUpperCase();
  return <>
    <a className="skip-link" href="#main">Bỏ qua điều hướng</a>
    <div className="app">
      <header className="topbar">
        <button ref={navToggleRef} className="btn btn-ghost btn-icon nav-toggle" type="button" aria-label={navOpen ? 'Đóng menu' : 'Mở menu'} aria-expanded={navOpen} aria-controls="nav" onClick={() => setNavOpen((open) => !open)}><Icon name="menu" /></button>
        <a className="brand" href="#/"><span className="brand-mark">O</span>OSP</a>
        <span className="tenant-chip">{meta.name}</span>
        <span className="grow" />
        <GlobalSearch meta={meta} onNavigate={() => setNavOpen(false)} />
        <button className="btn btn-ghost btn-icon" type="button" aria-label={theme === 'dark' ? 'Chuyển sang giao diện sáng' : 'Chuyển sang giao diện tối'} title={theme === 'dark' ? 'Giao diện sáng' : 'Giao diện tối'} onClick={toggleTheme}><Icon name={theme === 'dark' ? 'sun' : 'moon'} /></button>
        <div className="menu">
          <button className="btn btn-ghost" type="button" aria-haspopup="menu" aria-expanded={accountOpen} aria-label={`Tài khoản ${user.name}`} onClick={() => setAccountOpen((open) => !open)}><span className="avatar">{initials}</span></button>
          {accountOpen && <div className="menu-pop" role="menu">
            <div className="menu-item" role="none"><div><strong>{user.name}</strong><div className="faint">{user.email || 'Tài khoản máy'}</div></div></div>
            <div className="menu-item" role="none"><strong>Định dạng ngày và số</strong></div>
            <div role="group" aria-label="Định dạng ngày và số">
              <button className="menu-item" role="menuitemradio" aria-checked={numberLocale === 'vi-VN'} type="button" onClick={() => changeNumberLocale('vi-VN')}>Việt Nam · ngày/tháng/năm</button>
              <button className="menu-item" role="menuitemradio" aria-checked={numberLocale === 'en-US'} type="button" onClick={() => changeNumberLocale('en-US')}>Hoa Kỳ · tháng/ngày/năm</button>
            </div>
            <a className="menu-item" role="menuitem" href="#/account/security" onClick={() => setAccountOpen(false)}>Bảo mật tài khoản</a>
            <button className="menu-item" role="menuitem" type="button" onClick={logout}><Icon name="logout" />Đăng xuất</button>
          </div>}
        </div>
      </header>
      <Sidebar meta={meta} route={route} open={navOpen} mobile={mobileNav} onNavigate={() => setNavOpen(false)} />
      <main className="main" id="main" tabIndex="-1">
      <PageRouter route={route} meta={meta} summary={app.summary} />
      </main>
    </div>
    {navOpen && <button className="scrim" type="button" aria-label="Đóng menu" onClick={() => { setNavOpen(false); navToggleRef.current?.focus(); }} />}
  </>;
}

function OfflineNotice() {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return online ? null : <div className="offline-notice" role="status" aria-live="polite">
    Đang ngoại tuyến. Dữ liệu nghiệp vụ không được lưu trên thiết bị; không thể ghi giao dịch cho đến khi kết nối lại.
  </div>;
}

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('/service-worker.js', { scope: '/' }).catch(() => {});
}

createRoot(document.getElementById('app')).render(<><OfflineNotice /><App /></>);
