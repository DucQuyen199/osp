import { useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { uiText } from '../lib/i18n.js';

export default function AccountMenu({ user, interfaceLanguage, numberLocale, onInterfaceLanguageChange, onNumberLocaleChange, onLogout }) {
  const [open, setOpen] = useState(false);
  const toggleRef = useRef(null);
  const initials = (user.name || '?').split(' ').slice(-2).map((part) => part[0]).join('').toUpperCase();

  useEffect(() => {
    if (!open) return undefined;
    const closeOnEscape = (event) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      toggleRef.current?.focus();
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [open]);

  return <div className="menu">
    <button ref={toggleRef} className="btn btn-ghost" type="button" aria-haspopup="menu" aria-expanded={open} aria-label={`${uiText('Tài khoản')} ${user.name}`} onClick={() => setOpen((current) => !current)}><span className="avatar">{initials}</span></button>
    {open && <div className="menu-pop" role="menu">
      <div className="menu-item" role="none"><div><strong>{user.name}</strong><div className="faint">{user.email || uiText('Tài khoản máy')}</div></div></div>
      <div className="menu-item" role="none"><strong>{uiText('Ngôn ngữ giao diện')}</strong></div>
      <div role="group" aria-label={uiText('Ngôn ngữ giao diện')}>
        <button className="menu-item" role="menuitemradio" aria-checked={interfaceLanguage === 'vi-VN'} type="button" onClick={() => onInterfaceLanguageChange('vi-VN')}>{uiText('Tiếng Việt')}</button>
        <button className="menu-item" role="menuitemradio" aria-checked={interfaceLanguage === 'en-US'} type="button" onClick={() => onInterfaceLanguageChange('en-US')}>{uiText('Tiếng Anh')}</button>
      </div>
      <div className="menu-item" role="none"><strong>{uiText('Định dạng ngày và số')}</strong></div>
      <div role="group" aria-label={uiText('Định dạng ngày và số')}>
        <button className="menu-item" role="menuitemradio" aria-checked={numberLocale === 'vi-VN'} type="button" onClick={() => onNumberLocaleChange('vi-VN')}>{uiText('Việt Nam · ngày/tháng/năm')}</button>
        <button className="menu-item" role="menuitemradio" aria-checked={numberLocale === 'en-US'} type="button" onClick={() => onNumberLocaleChange('en-US')}>{uiText('Hoa Kỳ · tháng/ngày/năm')}</button>
      </div>
      <a className="menu-item" role="menuitem" href="#/account/security" onClick={() => setOpen(false)}>{uiText('Bảo mật tài khoản')}</a>
      <button className="menu-item" role="menuitem" type="button" onClick={onLogout}><Icon name="logout" />{uiText('Đăng xuất')}</button>
    </div>}
  </div>;
}
