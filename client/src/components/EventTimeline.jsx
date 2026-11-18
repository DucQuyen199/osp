import React from 'react';
import { eventTitle, moduleName } from '../lib/events.js';
import { fmtAgo, fmtTime, uiText } from '../lib/i18n.js';
import { entity } from '../lib/state.js';
import { recordHref } from '../lib/routes.js';

/** Shared renderer for a business record's cross-module event history. */
export default function EventTimeline({ events, currentId }) {
  if (!events.length) return <div className="empty"><h3>{uiText('Chưa có sự kiện')}</h3><p>{uiText('Các bước liên mô-đun sẽ xuất hiện tại đây.')}</p></div>;
  return <ol className="timeline" aria-label={uiText('Chuỗi sự kiện')}>
    {events.map((event) => {
      const title = eventTitle(event.type);
      const failed = event.handled.some((effect) => effect.outcome === 'error');
      const effects = event.handled.filter((effect) => effect.outcome !== 'skipped');
      return <li key={event.id} className={`tl-item depth-${Math.min(event.depth, 3)}${failed ? ' err' : ''}`}>
        <span className="tl-dot" />
        <div className="tl-title">{uiText(title.entity)} · {uiText(title.verb)}</div>
        <div className="tl-meta">
          {fmtTime(event.at)} · {fmtAgo(event.at)}{event.depth > 0 ? ` · bước ${event.depth + 1} của chuỗi` : ''}
          {event.recordId && event.recordId !== currentId && entity(title.qname) && <>
            {' · '}<a href={recordHref(title.qname, event.recordId)}>{uiText('Mở bản ghi')}</a>
          </>}
        </div>
        {effects.length > 0 && <div className="tl-effects">{effects.map((effect, index) =>
          <span key={`${event.id}:${index}`} className={`effect ${effect.outcome === 'ok' ? 'ok' : 'error'}`} title={effect.detail || ''}>
            {effect.outcome === 'ok' ? '✓' : '×'} {uiText(moduleName(effect.module))}{effect.outcome === 'error' ? `: ${uiText(effect.detail)}` : ''}
          </span>)}
        </div>}
      </li>;
    })}
  </ol>;
}
