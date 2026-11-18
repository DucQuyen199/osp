import { api, tenantPath } from './api.js';
import { actionLabel } from './i18n.js';
import { app, entity, entityLabel } from './state.js';

export const moduleName = (id) => app.meta?.allModules?.find((module) => module.id === id)?.name || id;

export function eventTitle(type) {
  const parts = type.split('.');
  const qname = `${parts[0]}.${parts[1]}`;
  const verb = parts.slice(2).join('.');
  return { entity: entity(qname) ? entityLabel(qname) : parts[1], verb: actionLabel(verb), qname };
}

export const fetchEvents = (limit = 1000) => api(tenantPath(`/events?limit=${limit}`));
export const fetchRecordEvents = (recordId) => api(tenantPath(`/events/record/${encodeURIComponent(recordId)}`));

export function descendants(events, rootIds) {
  const ids = new Set(rootIds);
  let grew = true;
  while (grew) {
    grew = false;
    for (const event of events) {
      if (event.causationId && ids.has(event.causationId) && !ids.has(event.id)) {
        ids.add(event.id);
        grew = true;
      }
    }
  }
  return events.filter((event) => ids.has(event.id))
    .sort((left, right) => left.at.localeCompare(right.at) || left.depth - right.depth);
}
