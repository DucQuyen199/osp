import { useMemo, useState } from 'react';
import Icon from './Icon.jsx';
import { entityLabel } from '../lib/state.js';
import { listHref } from '../lib/routes.js';

export default function GlobalSearch({ meta, onNavigate }) {
  const [query, setQuery] = useState('');
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !meta) return [];
    const found = [];
    for (const mod of meta.modules) {
      if (mod.name.toLowerCase().includes(q) || mod.id.includes(q)) found.push({ href: `#/m/${mod.id}`, title: mod.name, sub: `${mod.entities.length} loại dữ liệu`, icon: 'grid' });
      for (const entity of mod.entities) {
        const qname = `${mod.id}.${entity.name}`;
        const label = entityLabel(qname);
        if (label.toLowerCase().includes(q) || entity.name.includes(q)) found.push({ href: listHref(qname), title: label, sub: mod.name, icon: 'list' });
      }
    }
    return found.slice(0, 8);
  }, [query, meta]);
  return <div className="global-search">
    <Icon name="search" />
    <input className="input global-search-input" type="search" placeholder="Tìm module hoặc dữ liệu…" aria-label="Tìm module hoặc dữ liệu" aria-keyshortcuts="Control+K" value={query} onChange={(event) => setQuery(event.target.value)} />
    {query.trim() && <div className="global-search-results" role="listbox" aria-label="Kết quả tìm kiếm">
      {matches.length ? matches.map((match) => <a key={match.href} className="global-search-result" href={match.href} role="option" onClick={() => { setQuery(''); onNavigate(); }}><Icon name={match.icon} /><span><strong>{match.title}</strong><small>{match.sub}</small></span></a>) : <div className="global-search-empty">Không tìm thấy module hoặc dữ liệu phù hợp.</div>}
    </div>}
  </div>;
}


