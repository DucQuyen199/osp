import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import AuthPage from '../features/auth/AuthPage.jsx';
import PageRouter from './PageRouter.jsx';
import { parseRoute } from './parseRoute.js';
import GlobalSearch from '../components/GlobalSearch.jsx';
import Icon from '../components/Icon.jsx';
import Sidebar from '../components/Sidebar.jsx';
import AccountMenu from '../components/AccountMenu.jsx';
import useAppNavigation from './useAppNavigation.js';
import useAppPreferences from './useAppPreferences.js';
import { api, onUnauthorized, session } from '../lib/api.js';
import { setBusinessTimezone } from '../lib/dates.js';
import { enhanceScrollableRegions } from '../lib/scrollableRegions.js';
import { ensureUiTranslations, uiLocale, uiText } from '../lib/i18n.js';
import { app, getAppStateRevision, loadMeta, loadSummary, publishAppState, resetAppState, subscribeAppState } from '../lib/state.js';
export default function App() {
  useSyncExternalStore(subscribeAppState, getAppStateRevision, getAppStateRevision);
  const [route, setRoute] = useState(() => parseRoute());
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const { open: navOpen, mobile: mobileNav, toggleRef: navToggleRef, toggle: toggleNav, close: closeNav } = useAppNavigation();
  const { theme, numberLocale, interfaceLanguage, toggleTheme, changeNumberLocale, changeInterfaceLanguage } = useAppPreferences(setError);
  const meta = app.meta;
  const user = app.user;


  useEffect(() => {
    if (!ready || !meta || !user) return undefined;
    return enhanceScrollableRegions(document.getElementById('main'));
  }, [ready, meta, user]);

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
    const changed = () => { setRoute(parseRoute()); closeNav(); };
    const metaChanged = () => {
      setBusinessTimezone(app.meta?.settings?.businessTimezone || 'UTC');
      publishAppState();
    };
    window.addEventListener('hashchange', changed);
    window.addEventListener('osp:meta', metaChanged);
    const stop = onUnauthorized(() => { session.clear(); resetAppState(); setError('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'); location.hash = '#/login'; });
    return () => { window.removeEventListener('hashchange', changed); window.removeEventListener('osp:meta', metaChanged); stop?.(); };
  }, [closeNav]);

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
    };
    document.addEventListener('keydown', shortcut);
    return () => document.removeEventListener('keydown', shortcut);
  }, []);

  useEffect(() => {
    if (!ready || !session.current() || !meta || !user) return;
    const heading = document.querySelector('#main h1');
    const target = heading || document.getElementById('main');
    if (!target) return;
    if (heading && !heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
    target.focus();
  }, [route, ready, meta, user]);

  if (!ready) return <div className="landing-panel" role="status" aria-busy="true" aria-label={uiText('Đang tải…')}>
    <div className="skeleton" data-h="row" aria-hidden="true" />
  </div>;
  if (!session.current()) return <>
    {error && <div className="toast toast-danger" role="alert">{uiText(error)}</div>}
    <AuthPage route={route} onSignedIn={signedIn} />
  </>;
  if (!meta || !user) return <div className="page"><div className="alert danger">{uiText('Không tải được dữ liệu doanh nghiệp. Vui lòng tải lại trang.')}</div></div>;

  return <>
    <a className="skip-link" href="#main">{uiText('Bỏ qua điều hướng')}</a>
    <div className="app">
      <header className="topbar">
        <button ref={navToggleRef} className="btn btn-ghost btn-icon nav-toggle" type="button" aria-label={uiText(navOpen ? 'Đóng menu' : 'Mở menu')} aria-expanded={navOpen} aria-controls="nav" onClick={toggleNav}><Icon name="menu" /></button>
        <a className="brand" href="#/"><span className="brand-mark">O</span>OSP</a>
        <span className="tenant-chip">{meta.name}</span>
        <span className="grow" />
        <GlobalSearch meta={meta} onNavigate={closeNav} />
        <button className="btn btn-ghost btn-icon" type="button" aria-label={uiText(theme === 'dark' ? 'Chuyển sang giao diện sáng' : 'Chuyển sang giao diện tối')} title={uiText(theme === 'dark' ? 'Giao diện sáng' : 'Giao diện tối')} onClick={toggleTheme}><Icon name={theme === 'dark' ? 'sun' : 'moon'} /></button>
        <AccountMenu user={user} interfaceLanguage={interfaceLanguage} numberLocale={numberLocale} onInterfaceLanguageChange={changeInterfaceLanguage} onNumberLocaleChange={changeNumberLocale} onLogout={logout} />
      </header>
      <Sidebar meta={meta} route={route} open={navOpen} mobile={mobileNav} onNavigate={closeNav} />
      <main className="main" id="main" tabIndex="-1">
      <PageRouter route={route} meta={meta} summary={app.summary} />
      </main>
    </div>
    {navOpen && <button className="scrim" type="button" aria-label={uiText('Đóng menu')} onClick={() => closeNav(true)} />}
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

