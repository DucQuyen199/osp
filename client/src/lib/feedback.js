import { uiText } from './i18n.js';

let nextId = 1;
let state = Object.freeze({ toasts: [], dialog: null });
const listeners = new Set();
const queuedDialogs = [];
const toastTimers = new Map();

const publish = (next) => {
  state = Object.freeze(next);
  listeners.forEach((listener) => listener());
};

export const subscribeFeedback = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
export const getFeedbackSnapshot = () => state;

function dismissToast(id) {
  const timer = toastTimers.get(id);
  if (timer) clearTimeout(timer);
  toastTimers.delete(id);
  publish({ ...state, toasts: state.toasts.filter((item) => item.id !== id) });
}

export function toast(message, kind = '') {
  const item = { id: nextId++, message: uiText(message), kind };
  publish({ ...state, toasts: [...state.toasts, item] });
  toastTimers.set(item.id, setTimeout(() => dismissToast(item.id), kind === 'danger' || kind === 'error' ? 7000 : 3800));
}

function showNextDialog() {
  const dialog = queuedDialogs.shift() || null;
  publish({ ...state, dialog });
}

export function resolveFeedbackDialog(id, value) {
  if (!state.dialog || state.dialog.id !== id) return;
  const current = state.dialog;
  current.resolve(value);
  showNextDialog();
}

function requestDialog(options) {
  return new Promise((resolve) => {
    const dialog = { id: nextId++, ...options, resolve };
    if (state.dialog) queuedDialogs.push(dialog);
    else publish({ ...state, dialog });
  });
}

export function confirmDialog({ title, message, confirmLabel = 'Xác nhận', danger = false }) {
  return requestDialog({ type: 'confirm', title, message, confirmLabel, danger });
}

export function textDialog({ title, message, label, minLength = 1, maxLength = 1000, confirmLabel = 'Lưu', danger = false }) {
  return requestDialog({ type: 'text', title, message, label, minLength, maxLength, confirmLabel, danger });
}
