import { useCallback, useEffect, useRef, useState } from 'react';

const MOBILE_NAV_QUERY = '(max-width: 960px)';
const NAV_FOCUSABLE = '#nav a[href], #nav summary, #nav button:not([disabled])';

export default function useAppNavigation() {
  const [open, setOpen] = useState(false);
  const [mobile, setMobile] = useState(() => window.matchMedia(MOBILE_NAV_QUERY).matches);
  const toggleRef = useRef(null);

  const close = useCallback((restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus === true) toggleRef.current?.focus();
  }, []);
  const toggle = useCallback(() => setOpen((current) => !current), []);

  useEffect(() => {
    const media = window.matchMedia(MOBILE_NAV_QUERY);
    const update = () => {
      setMobile(media.matches);
      if (!media.matches) setOpen(false);
    };
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (!mobile || !open) return;
    [...document.querySelectorAll(NAV_FOCUSABLE)]
      .find((element) => element.getClientRects().length > 0)?.focus();
  }, [mobile, open]);

  useEffect(() => {
    if (!mobile || !open) return undefined;
    const keepFocusInNavigation = (event) => {
      if (event.key === 'Escape') {
        close(true);
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = [...document.querySelectorAll(NAV_FOCUSABLE)]
        .filter((element) => element.getClientRects().length > 0);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const nav = document.querySelector('#nav');
      if (event.shiftKey && (document.activeElement === first || !nav?.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !nav?.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', keepFocusInNavigation);
    return () => document.removeEventListener('keydown', keepFocusInNavigation);
  }, [mobile, open, close]);

  return { open, mobile, toggleRef, toggle, close };
}
