import { useMemo, useState } from 'react';
import Icon from './Icon.jsx';
import { entityLabel } from '../lib/state.js';
import { uiText } from '../lib/i18n.js';
import { listHref } from '../lib/routes.js';

export default function GlobalSearch({ meta, onNavigate }) {
  const [query, setQuery] = useState('');
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !meta) return [];
    const found = [];
    for (const mod of meta.modules) {
      if (uiText(mod.name).toLowerCase().includes(q) || mod.name.toLowerCase().includes(q) || mod.id.includes(q)) found.push({ href: `#/m/${mod.id}`, title: uiText(mod.name), sub: `${mod.entities.length} ${uiText('loại dữ liệu')}`, icon: 'grid' });
      for (const entity of mod.entities) {
        const qname = `${mod.id}.${entity.name}`;
        const label = entityLabel(qname);
        if (uiText(label).toLowerCase().includes(q) || label.toLowerCase().includes(q) || entity.name.includes(q)) found.push({ href: listHref(qname), title: uiText(label), sub: uiText(mod.name), icon: 'list' });
      }
    }
    return found.slice(0, 8);
  }, [query, meta]);
  return <div className="global-search">
    <Icon name="search" />
    <input className="input global-search-input" type="search" placeholder={uiText('Tìm module hoặc dữ liệu…')} aria-label={uiText('Tìm module hoặc dữ liệu')} aria-keyshortcuts="Control+K" value={query} onChange={(event) => setQuery(event.target.value)} />
    {query.trim() && <>
      <div className="sr-only" role="status" aria-live="polite">
        {matches.length ? uiText('Kết quả: {count}').replace('{count}', String(matches.length)) : uiText('Không tìm thấy module hoặc dữ liệu phù hợp.')}
      </div>
      <ul className="global-search-results" aria-label={uiText('Kết quả tìm kiếm')}>
        {matches.length ? matches.map((match) => <li key={match.href}>
          <a className="global-search-result" href={match.href} onClick={() => { setQuery(''); onNavigate(); }}><Icon name={match.icon} /><span><strong>{match.title}</strong><small>{match.sub}</small></span></a>
        </li>) : <li className="global-search-empty" aria-hidden="true">{uiText('Không tìm thấy module hoặc dữ liệu phù hợp.')}</li>}
      </ul>
    </>}
  </div>;
}


