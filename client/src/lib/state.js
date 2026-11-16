// Trạng thái ứng dụng: metadata tenant, tra cứu entity, quyền phía client (chỉ để ẩn/hiện nút; máy chủ luôn kiểm tra lại), cache tham chiếu.
import { api, dataPath, onDataMutation, session, tenantPath } from './api.js';
import { fieldLabel, setBaseCurrency } from './i18n.js';

export const app = {
  meta: null,
  user: null,
  summary: {},
  entities: new Map(), // qname -> {def, module}
};

let revision = 0;
const appListeners = new Set();

export function subscribeAppState(listener) {
  appListeners.add(listener);
  return () => appListeners.delete(listener);
}

export function getAppStateRevision() {
  return revision;
}

export function publishAppState() {
  revision += 1;
  for (const listener of appListeners) listener();
}

export function resetAppState() {
  app.meta = null;
  app.user = null;
  app.summary = {};
  app.entities.clear();
  resetCaches();
  publishAppState();
}

export async function loadMeta() {
  const s = session.current();
  const [meta, me] = await Promise.all([api(tenantPath('/meta')), api('/api/auth/me')]);
  app.meta = meta;
  setBaseCurrency(meta.settings?.baseCurrency || 'VND');
  app.user = me.user;
  app.entities.clear();
  for (const m of meta.modules) for (const e of m.entities) app.entities.set(`${m.id}.${e.name}`, { def: e, module: m });
  s.tenantName = meta.name;
  publishAppState();
  return meta;
}

export async function loadSummary() {
  try {
    app.summary = await api(tenantPath('/summary'));
  } catch {
    app.summary = {};
  }
  publishAppState();
  return app.summary;
}

export const entity = (qname) => app.entities.get(qname)?.def;
export const moduleOf = (qname) => app.entities.get(qname)?.module;

/** Tên hiển thị của entity theo thuật ngữ ngành (ví dụ "Bệnh nhân" thay cho "Đối tác"). */
export const entityLabel = (qname) => app.meta?.terminology?.[qname] || entity(qname)?.label || qname;

export function fieldLabelOf(qname, name) {
  // Thuật ngữ của ngành áp dụng cho trường tham chiếu tới entity có tên riêng ("party" -> "Bệnh nhân")
  const def = entity(qname);
  const f = def?.fields.find((x) => x.name === name);
  if (f?.type === 'ref' && app.meta?.terminology?.[f.ref] && (name === 'party' || name === f.ref.split('.')[1])) return app.meta.terminology[f.ref];
  return fieldLabel(name);
}

// ───── Quyền phía client ─────
function permMatch(pattern, perm) {
  if (pattern === '*') return true;
  const p = pattern.split('.');
  const q = perm.split('.');
  for (let i = 0; i < p.length; i++) {
    if (p[i] === '*') {
      if (i === p.length - 1) return q.length > i;
      if (q.length <= i) return false;
      continue;
    }
    if (p[i] !== q[i]) return false;
  }
  return p.length === q.length;
}
export function can(perm) {
  const roles = app.user?.roles || [];
  return roles.some((r) => (app.meta?.roles?.[r]?.permissions || []).some((p) => permMatch(p, perm)));
}
export const isAdmin = () => can('tenant.admin');

// ───── Hiển thị bản ghi tham chiếu ─────
const LABEL_FIELDS = ['name', 'title', 'subject', 'sku', 'code', 'number', 'plate', 'period', 'memo', 'reading'];
export function recordLabel(qname, rec) {
  if (!rec) return '—';
  const def = entity(qname);
  const f = LABEL_FIELDS.find((k) => rec[k] != null && rec[k] !== '' && def?.fields.some((x) => x.name === k));
  if (f) return String(rec[f]);
  const ref = def?.fields.find((x) => x.type === 'ref' && rec[x.name]);
  return ref ? `${entityLabel(qname)} · ${String(rec.id).slice(0, 6)}` : `#${String(rec.id).slice(0, 8)}`;
}

const REF_CACHE_TTL_MS = 30_000;
const refCache = new Map(); // qname -> { promise, value, loadedAt, settled }
const refVersions = new Map();
export async function loadAll(qname, filters = {}) {
  const rows = [];
  let offset = 0;
  for (;;) {
    const query = new URLSearchParams({ ...filters, limit: '1000', offset: String(offset) });
    const response = await api(`${dataPath(qname)}?${query}`);
    const items = Array.isArray(response?.items) ? response.items : [];
    rows.push(...items);
    offset += items.length;
    const total = Number(response?.total);
    if (!items.length || items.length < 1000 || (Number.isFinite(total) && offset >= total)) break;
  }
  return rows;
}

export async function loadAllResponse(qname, filters = {}) {
  const items = await loadAll(qname, filters);
  return { items, total: items.length };
}

export function loadRefs(qname) {
  const cached = refCache.get(qname);
  if (cached && (!cached.settled || Date.now() - cached.loadedAt < REF_CACHE_TTL_MS)) {
    return cached.promise;
  }

  const version = refVersions.get(qname) || 0;
  const entry = { promise: null, value: null, loadedAt: 0, settled: false };
  entry.promise = loadAll(qname)
    .then((rows) => {
      const records = new Map(rows.map((row) => [row.id, row]));
      entry.settled = true;
      entry.loadedAt = Date.now();
      entry.value = records;
      if (refVersions.get(qname) === version && refCache.get(qname) === entry) {
        refCache.set(qname, entry);
      }
      return records;
    })
    .catch((error) => {
      entry.settled = true;
      if (refVersions.get(qname) === version && refCache.get(qname) === entry) {
        refCache.delete(qname);
      }
      throw error;
    });
  refCache.set(qname, entry);
  return entry.promise;
}
export function invalidateRefs(qname) {
  if (qname) {
    refVersions.set(qname, (refVersions.get(qname) || 0) + 1);
    refCache.delete(qname);
    return;
  }
  for (const key of refCache.keys()) refVersions.set(key, (refVersions.get(key) || 0) + 1);
  refCache.clear();
}
onDataMutation(invalidateRefs);
export const resetCaches = () => invalidateRefs();

// ───── Chọn cột hiển thị cho danh sách ─────
export function listColumns(def, max = 6) {
  const visibleFields = def.fields.filter((f) => !f.system);
  const names = visibleFields.map((f) => f.name);
  const lead = ['name', 'title', 'subject', 'sku', 'code', 'number', 'plate'].find((k) => names.includes(k));
  const order = [];
  if (lead) order.push(lead);
  const skip = new Set(['text', 'json']);
  for (const f of visibleFields) {
    if (order.includes(f.name) || skip.has(f.type)) continue;
    if (f.required || f.type === 'ref' || f.type === 'money' || f.name === def.states?.field) order.push(f.name);
  }
  for (const f of visibleFields) {
    if (order.length >= max) break;
    if (!order.includes(f.name) && !skip.has(f.type)) order.push(f.name);
  }
  const cols = order.slice(0, max);
  // Luôn đưa trạng thái lên hiển thị
  if (def.states && !cols.includes(def.states.field)) cols[cols.length - 1] = def.states.field;
  return cols.map((n) => visibleFields.find((f) => f.name === n));
}
