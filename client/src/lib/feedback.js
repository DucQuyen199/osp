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
