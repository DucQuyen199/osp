let toastHost;

export function toast(message, kind = '') {
  if (!toastHost) {
    toastHost = document.createElement('div');
    toastHost.className = 'toasts';
    toastHost.setAttribute('role', 'status');
    toastHost.setAttribute('aria-live', 'polite');
    document.body.append(toastHost);
  }
  const item = document.createElement('div');
  item.className = `toast ${kind}`;
  item.textContent = message;
  toastHost.append(item);
  setTimeout(() => item.remove(), kind === 'danger' ? 7000 : 3800);
}

export function confirmDialog({ title, message, confirmLabel = 'Xác nhận', danger = false }) {
  return new Promise((resolve) => {
    let confirmed = false;
    const dialog = document.createElement('dialog');
    dialog.className = 'modal';
    dialog.setAttribute('aria-labelledby', 'osp-confirm-title');

    const body = document.createElement('div');
    body.className = 'modal-body stack-sm';
    const heading = document.createElement('h2');
    heading.id = 'osp-confirm-title';
    heading.textContent = title;
    const copy = document.createElement('p');
    copy.className = 'muted';
    copy.textContent = message;
    body.append(heading, copy);

    const footer = document.createElement('div');
    footer.className = 'modal-foot';
    const cancel = document.createElement('button');
    cancel.className = 'btn';
    cancel.type = 'button';
    cancel.textContent = 'Hủy';
    cancel.addEventListener('click', () => dialog.close());
    const accept = document.createElement('button');
    accept.className = `btn ${danger ? 'btn-danger' : 'btn-primary'}`;
    accept.type = 'button';
    accept.textContent = confirmLabel;
    accept.addEventListener('click', () => { confirmed = true; dialog.close(); });
    footer.append(cancel, accept);
    dialog.append(body, footer);

    const previous = document.activeElement;
    dialog.addEventListener('close', () => {
      dialog.remove();
      if (previous instanceof HTMLElement && document.contains(previous)) previous.focus();
      resolve(confirmed);
    }, { once: true });
    document.body.append(dialog);
    dialog.showModal();
    cancel.focus();
  });
}

export function textDialog({ title, message, label, minLength = 1, maxLength = 1000, confirmLabel = 'Lưu', danger = false }) {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'modal';
    dialog.setAttribute('aria-labelledby', 'osp-text-title');
    const body = document.createElement('div');
    body.className = 'modal-body stack-sm';
    const heading = document.createElement('h2');
    heading.id = 'osp-text-title';
    heading.textContent = title;
    const copy = document.createElement('p');
    copy.className = 'muted';
    copy.textContent = message;
    const field = document.createElement('label');
    field.className = 'field';
    const fieldLabel = document.createElement('span');
    fieldLabel.className = 'label';
    fieldLabel.textContent = label;
    const input = document.createElement('textarea');
    input.className = 'textarea';
    input.required = true;
    input.minLength = minLength;
    input.maxLength = maxLength;
    input.rows = 4;
    field.append(fieldLabel, input);
    body.append(heading, copy, field);
    const footer = document.createElement('div');
    footer.className = 'modal-foot';
    const cancel = document.createElement('button');
    cancel.className = 'btn';
    cancel.type = 'button';
    cancel.textContent = 'Hủy';
    cancel.addEventListener('click', () => dialog.close());
    const accept = document.createElement('button');
    accept.className = `btn ${danger ? 'btn-danger' : 'btn-primary'}`;
    accept.type = 'button';
    accept.textContent = confirmLabel;
    accept.disabled = true;
    input.addEventListener('input', () => { accept.disabled = input.value.trim().length < minLength; });
    accept.addEventListener('click', () => {
      const value = input.value.trim();
      if (value.length >= minLength && value.length <= maxLength) {
        dialog.dataset.value = value;
        dialog.close();
      }
    });
    footer.append(cancel, accept);
    dialog.append(body, footer);
    const previous = document.activeElement;
    dialog.addEventListener('close', () => {
      const value = dialog.dataset.value || null;
      dialog.remove();
      if (previous instanceof HTMLElement && document.contains(previous)) previous.focus();
      resolve(value);
    }, { once: true });
    document.body.append(dialog);
    dialog.showModal();
    input.focus();
  });
}
