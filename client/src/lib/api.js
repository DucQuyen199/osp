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

const dataMutationListeners = new Set();
export const onDataMutation = (fn) => {
  dataMutationListeners.add(fn);
  return () => dataMutationListeners.delete(fn);
};

function notifyDataMutation(path) {
  const match = String(path).match(/^\/api\/t\/[^/?]+\/data\/([^/?]+)\/([^/?]+)/);
  if (!match) return;
  const qname = `${match[1]}.${match[2]}`;
  dataMutationListeners.forEach((fn) => {
    try { fn(qname); } catch { /* cache notifications must not mask a successful write */ }
  });
}

export async function api(path, { method = 'GET', body, token, raw = false, headers = {}, signal } = {}) {
  const requestMethod = method.toUpperCase();
  const isWrite = !['GET', 'HEAD', 'OPTIONS'].includes(requestMethod);
  if (isWrite && typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new ApiError(0, 'OFFLINE_WRITE', 'Thiết bị đang ngoại tuyến. Thay đổi chưa được gửi; hãy kết nối lại rồi kiểm tra dữ liệu trước khi thử lại.');
  }
  const s = session.current();
  const tok = token ?? s?.token;
  const h = { ...headers };
  if (tok) h.authorization = `Bearer ${tok}`;
  let payload = body;
  if (body !== undefined && typeof body !== 'string') {
    const isRawBody = (typeof Blob !== 'undefined' && body instanceof Blob)
      || (typeof ArrayBuffer !== 'undefined' && body instanceof ArrayBuffer)
      || (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(body));
    if (isRawBody) payload = body;
    else {
      h['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }
  }
  let res;
  try {
    res = await fetch(path, { method: requestMethod, headers: h, body: payload, signal });
  } catch {
    if (isWrite) {
      throw new ApiError(0, 'NETWORK_WRITE_UNKNOWN', 'Mất kết nối khi gửi thay đổi nên chưa thể xác nhận giao dịch đã được lưu. Hãy tải lại dữ liệu và kiểm tra trạng thái trước khi thử lại.');
    }
    throw new ApiError(0, 'NETWORK', 'Không kết nối được máy chủ. Kiểm tra mạng và thử lại.');
  }
  if (raw && res.ok) {
    if (isWrite) notifyDataMutation(path);
    return res;
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* không phải JSON */ }
  if (!res.ok) {
    const e = data?.error || {};
    if (res.status === 401 && tok && !path.includes('/auth/login')) listeners.forEach((fn) => fn());
    throw new ApiError(res.status, e.code || 'ERROR', e.message || `Lỗi ${res.status}`, e.details ?? data);
  }
  if (isWrite) notifyDataMutation(path);
  return data;
}

/** Đường dẫn dữ liệu của tenant hiện tại */
export const dataPath = (qname, id = '', action = '') => {
  const s = session.current();
  const [m, e] = [qname.slice(0, qname.indexOf('.')), qname.slice(qname.indexOf('.') + 1)];
  return `/api/t/${s.tenantId}/data/${m}/${e}${id ? `/${id}` : ''}${action ? `/${action}` : ''}`;
};
export const tenantPath = (suffix = '') => `/api/t/${session.current().tenantId}${suffix}`;
