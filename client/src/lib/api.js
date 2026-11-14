// Client API + quản lý phiên. Token lưu sessionStorage (mất khi đóng tab) hoặc localStorage nếu chọn "ghi nhớ".

const KEY = 'osp.session';

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const session = {
  get() {
    try {
      return JSON.parse(sessionStorage.getItem(KEY) || localStorage.getItem(KEY) || 'null');
    } catch {
      return null;
    }
  },
  set(data, remember) {
    this.clear();
    try {
      (remember ? localStorage : sessionStorage).setItem(KEY, JSON.stringify(data));
    } catch { /* trình duyệt chặn lưu trữ: phiên chỉ sống trong bộ nhớ */ }
    memory = data;
  },
  clear() {
    memory = null;
    try { sessionStorage.removeItem(KEY); localStorage.removeItem(KEY); } catch { /* bỏ qua */ }
  },
  current() {
    return memory || this.get();
  },
};
let memory = null;

const listeners = new Set();
export const onUnauthorized = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export async function api(path, { method = 'GET', body, token, raw = false, headers = {}, signal } = {}) {
  const s = session.current();
  const tok = token ?? s?.token;
  const h = { ...headers };
  if (tok) h.authorization = `Bearer ${tok}`;
  let payload = body;
  if (body !== undefined && typeof body !== 'string') {
    h['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(path, { method, headers: h, body: payload, signal });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Không kết nối được máy chủ. Kiểm tra mạng và thử lại.');
  }
  if (raw && res.ok) return res;
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* không phải JSON */ }
  if (!res.ok) {
    const e = data?.error || {};
    if (res.status === 401 && tok && !path.includes('/auth/login')) listeners.forEach((fn) => fn());
    throw new ApiError(res.status, e.code || 'ERROR', e.message || `Lỗi ${res.status}`, e.details ?? data);
  }
  return data;
}

/** Đường dẫn dữ liệu của tenant hiện tại */
export const dataPath = (qname, id = '', action = '') => {
  const s = session.current();
  const [m, e] = [qname.slice(0, qname.indexOf('.')), qname.slice(qname.indexOf('.') + 1)];
  return `/api/t/${s.tenantId}/data/${m}/${e}${id ? `/${id}` : ''}${action ? `/${action}` : ''}`;
};
export const tenantPath = (suffix = '') => `/api/t/${session.current().tenantId}${suffix}`;
