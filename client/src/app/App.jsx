import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import AuthPage from '../features/auth/AuthPage.jsx';
import PageRouter from './PageRouter.jsx';
import { parseRoute } from './parseRoute.js';
import GlobalSearch from '../components/GlobalSearch.jsx';
import Icon from '../components/Icon.jsx';
import Sidebar from '../components/Sidebar.jsx';
import AccountMenu from '../components/AccountMenu.jsx';
import { api, onUnauthorized, session } from '../lib/api.js';
import { setBusinessTimezone } from '../lib/dates.js';
import { enhanceScrollableRegions } from '../lib/scrollableRegions.js';
import { ensureUiTranslations, formatLocale, setFormatLocale, setUiLocale, uiLocale, uiText } from '../lib/i18n.js';
import { app, getAppStateRevision, loadMeta, loadSummary, publishAppState, resetAppState, subscribeAppState } from '../lib/state.js';
export default function App() {
  useSyncExternalStore(subscribeAppState, getAppStateRevision, getAppStateRevision);
  const [route, setRoute] = useState(() => parseRoute());
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [navOpen, setNavOpen] = useState(false);
  const [mobileNav, setMobileNav] = useState(() => window.matchMedia('(max-width: 960px)').matches);
  const navToggleRef = useRef(null);
  const [theme, setTheme] = useState(() => { try { return localStorage.getItem('osp.theme') || ''; } catch { return ''; } });
  const [numberLocale, setNumberLocale] = useState(formatLocale);
  const [interfaceLanguage, setInterfaceLanguage] = useState(uiLocale);
  const meta = app.meta;
  const user = app.user;

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
    document.documentElement.lang = interfaceLanguage === 'en-US' ? 'en' : 'vi';
  }, [interfaceLanguage]);

  useEffect(() => {
    if (!ready || !meta || !user) return undefined;
    return enhanceScrollableRegions(document.getElementById('main'));
  }, [ready, meta, user]);

  useEffect(() => {
    if (!mobileNav || !navOpen) return;
    [...document.querySelectorAll('#nav a[href], #nav summary, #nav button:not([disabled])')]
      .find((element) => element.getClientRects().length > 0)?.focus();
  }, [mobileNav, navOpen]);
  const authenticated = Boolean(session.current());

  const signedIn = useCallback(async () => {
    try {
      const loaded = await loadMeta();
      await loadSummary();
      setBusinessTimezone(loaded.settings?.businessTimezone || 'UTC');
      setError('');
      setRoute(parseRoute());
    } catch (reason) {
      session.clear();
      resetAppState();
      setError(reason.message || 'Không tải được dữ liệu doanh nghiệp.');
      setRoute({ name: 'login' });
    }
  }, []);

  useEffect(() => {
    const changed = () => { setRoute(parseRoute()); setNavOpen(false); };
    const metaChanged = () => {
      setBusinessTimezone(app.meta?.settings?.businessTimezone || 'UTC');
      publishAppState();
    };
    window.addEventListener('hashchange', changed);
    window.addEventListener('osp:meta', metaChanged);
    document.documentElement.dataset.theme = theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const stop = onUnauthorized(() => { session.clear(); resetAppState(); setError('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'); location.hash = '#/login'; });
    return () => { window.removeEventListener('hashchange', changed); window.removeEventListener('osp:meta', metaChanged); stop?.(); };
  }, [theme]);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (uiLocale === 'en-US') await ensureUiTranslations().catch(() => {});
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
          if (alive) setBusinessTimezone(loaded.settings?.businessTimezone || 'UTC');
        } catch {
          session.clear();
          resetAppState();
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

  const changeInterfaceLanguage = async (next) => {
    try { if (!await setUiLocale(next)) return; }
    catch { setError('Không tải được dữ liệu ngôn ngữ.'); return; }
    setInterfaceLanguage(next);
    try { localStorage.setItem('osp.uiLocale', next); } catch { /* preference remains active in memory */ }
  };

  const logout = async () => {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* session may have expired */ }
    session.clear();
    resetAppState();
    location.hash = '#/login';
  };

  useEffect(() => {
    const shortcut = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        document.querySelector('.global-search-input')?.focus();
      }
      if (event.key === 'Escape') {
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
    {error && <div className="toast toast-danger" role="alert">{uiText(error)}</div>}
    <AuthPage route={route} onSignedIn={signedIn} />
  </>;
  if (!meta || !user) return <div className="page"><div className="alert danger">{uiText('Không tải được dữ liệu doanh nghiệp. Vui lòng tải lại trang.')}</div></div>;

  return <>
    <a className="skip-link" href="#main">{uiText('Bỏ qua điều hướng')}</a>
    <div className="app">
      <header className="topbar">
        <button ref={navToggleRef} className="btn btn-ghost btn-icon nav-toggle" type="button" aria-label={uiText(navOpen ? 'Đóng menu' : 'Mở menu')} aria-expanded={navOpen} aria-controls="nav" onClick={() => setNavOpen((open) => !open)}><Icon name="menu" /></button>
        <a className="brand" href="#/"><span className="brand-mark">O</span>OSP</a>
        <span className="tenant-chip">{meta.name}</span>
        <span className="grow" />
        <GlobalSearch meta={meta} onNavigate={() => setNavOpen(false)} />
        <button className="btn btn-ghost btn-icon" type="button" aria-label={uiText(theme === 'dark' ? 'Chuyển sang giao diện sáng' : 'Chuyển sang giao diện tối')} title={uiText(theme === 'dark' ? 'Giao diện sáng' : 'Giao diện tối')} onClick={toggleTheme}><Icon name={theme === 'dark' ? 'sun' : 'moon'} /></button>
        <AccountMenu user={user} interfaceLanguage={interfaceLanguage} numberLocale={numberLocale} onInterfaceLanguageChange={changeInterfaceLanguage} onNumberLocaleChange={changeNumberLocale} onLogout={logout} />
      </header>
      <Sidebar meta={meta} route={route} open={navOpen} mobile={mobileNav} onNavigate={() => setNavOpen(false)} />
      <main className="main" id="main" tabIndex="-1">
      <PageRouter route={route} meta={meta} summary={app.summary} />
      </main>
    </div>
    {navOpen && <button className="scrim" type="button" aria-label={uiText('Đóng menu')} onClick={() => { setNavOpen(false); navToggleRef.current?.focus(); }} />}
  </>;
}

export function OfflineNotice() {
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
    {uiText('Đang ngoại tuyến. Dữ liệu nghiệp vụ không được lưu trên thiết bị; không thể ghi giao dịch cho đến khi kết nối lại.')}
  </div>;
}

