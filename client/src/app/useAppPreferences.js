import { useEffect, useState } from 'react';
import { formatLocale, setFormatLocale, setUiLocale, uiLocale } from '../lib/i18n.js';

export default function useAppPreferences(onError) {
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('osp.theme') || ''; } catch { return ''; }
  });
  const [numberLocale, setNumberLocale] = useState(formatLocale);
  const [interfaceLanguage, setInterfaceLanguage] = useState(uiLocale);

  useEffect(() => {
    document.documentElement.dataset.theme = theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  }, [theme]);

  useEffect(() => {
    document.documentElement.lang = interfaceLanguage === 'en-US' ? 'en' : 'vi';
  }, [interfaceLanguage]);

  function toggleTheme() {
    const next = (document.documentElement.dataset.theme || 'light') === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('osp.theme', next); } catch { /* theme remains active in memory */ }
    setTheme(next);
  }

  function changeNumberLocale(next) {
    setFormatLocale(next);
    setNumberLocale(next);
    try { localStorage.setItem('osp.formatLocale', next); } catch { /* preference remains active in memory */ }
  }

  async function changeInterfaceLanguage(next) {
    try {
      if (!await setUiLocale(next)) return;
    } catch {
      onError('Không tải được dữ liệu ngôn ngữ.');
      return;
    }
    setInterfaceLanguage(next);
    try { localStorage.setItem('osp.uiLocale', next); } catch { /* preference remains active in memory */ }
  }

  return { theme, numberLocale, interfaceLanguage, toggleTheme, changeNumberLocale, changeInterfaceLanguage };
}
