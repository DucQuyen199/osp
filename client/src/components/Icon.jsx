const ICONS = {
  menu: 'M4 6h16M4 12h16M4 18h16', home: 'M4 11l8-7 8 7M6 10v9h4v-6h4v6h4v-9',
  search: 'M11 4a7 7 0 100 14 7 7 0 000-14zM20 20l-4-4',
  moon: 'M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z', sun: 'M12 8a4 4 0 100 8 4 4 0 000-8zM12 2v2M12 20v2M2 12h2M20 12h2',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  bolt: 'M13 2L4 14h7l-1 8 10-12h-7l1-8z', settings: 'M12 8a4 4 0 100 8 4 4 0 000-8zM4 12l-2-1 2-4 2 1 2-2-.5-2h5l.5 2 2 1 2-1 2 4-2 1v2l2 1-2 4-2-1-2 1-.5 2h-5L8 19l-2-1-2 1-2-4 2-1z',
  logout: 'M10 4H6a2 2 0 00-2 2v12a2 2 0 002 2h4M16 8l4 4-4 4M20 12H9',
};

export default function Icon({ name }) {
  return <svg className="icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ICONS[name] || ICONS.grid} /></svg>;
}

