import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { getFeedbackSnapshot, resolveFeedbackDialog, subscribeFeedback } from '../lib/feedback.js';
import { uiText } from '../lib/i18n.js';

function DialogView({ request }) {
  const dialogRef = useRef(null);
  const [value, setValue] = useState(request.initialValue || '');
  const titleId = `feedback-title-${request.id}`;
  const messageId = `feedback-message-${request.id}`;
  const respond = (answer) => resolveFeedbackDialog(request.id, answer);

  useEffect(() => {
    const element = dialogRef.current;
    const previous = document.activeElement;
    if (!element.open) element.showModal();
    if (request.type === 'text') element.querySelector('textarea')?.focus();
    else element.querySelector('[data-dialog-cancel]')?.focus();
    return () => {
      if (element.open) element.close();
      if (previous instanceof HTMLElement && document.contains(previous)) previous.focus();
    };
  }, [request.id, request.type]);

  return <dialog ref={dialogRef} className="modal" aria-labelledby={titleId} aria-describedby={messageId}
    onCancel={(event) => { event.preventDefault(); respond(null); }}>
    <form className="feedback-dialog" onSubmit={(event) => { event.preventDefault(); respond(request.type === 'text' ? value.trim() : true); }}>
      <div className="modal-body stack-sm">
        <h2 id={titleId}>{uiText(request.title)}</h2>
        <p className="muted" id={messageId}>{uiText(request.message)}</p>
        {request.type === 'text' && <label className="field">
          <span className="label">{uiText(request.label)}</span>
          <textarea className="textarea" rows="4" required={request.minLength > 0} minLength={request.minLength} maxLength={request.maxLength}
            value={value} onChange={(event) => setValue(event.target.value)} />
        </label>}
      </div>
      <div className="modal-foot">
        <button className="btn" type="button" data-dialog-cancel onClick={() => respond(null)}>{uiText('Hủy')}</button>
        <button className={`btn ${request.danger ? 'btn-danger' : 'btn-primary'}`} type="submit"
          disabled={request.type === 'text' && (value.trim().length < request.minLength || value.trim().length > request.maxLength)}>
          {uiText(request.confirmLabel)}
        </button>
      </div>
    </form>
  </dialog>;
}

export default function FeedbackHost() {
  const feedback = useSyncExternalStore(subscribeFeedback, getFeedbackSnapshot, getFeedbackSnapshot);
  const ordinaryToasts = feedback.toasts.filter((item) => item.kind !== 'danger' && item.kind !== 'error');
  const urgentToasts = feedback.toasts.filter((item) => item.kind === 'danger' || item.kind === 'error');
  return <>
    <div className="toasts" role="status" aria-label={uiText('Thông báo')} aria-live="polite">
      {ordinaryToasts.map((item) => <div className={`toast ${item.kind}`} key={item.id}>{item.message}</div>)}
    </div>
    <div className="toasts toasts-urgent" role="alert" aria-label={uiText('Lỗi cần chú ý')} aria-live="assertive">
      {urgentToasts.map((item) => <div className={`toast ${item.kind}`} key={item.id}>{item.message}</div>)}
    </div>
    {feedback.dialog && <DialogView key={feedback.dialog.id} request={feedback.dialog} />}
  </>;
}
