import React, { useEffect, useRef } from 'react';
import { fmtMoney } from '../../../lib/i18n.js';
import { buildPosReturnLines, estimatePosReturnTotal, remainingPosReturnQuantity } from '../domain/posReturns.js';

export default function PosReturnDialog({
  order,
  returns,
  products,
  quantities,
  reason,
  busy,
  locked,
  canSubmit,
  onReasonChange,
  onQuantityChange,
  onClose,
  onSubmit,
  t,
}) {
  const dialogRef = useRef(null);
  const interactionRef = useRef({ busy, locked, onClose });
  interactionRef.current = { busy, locked, onClose };

  useEffect(() => {
    if (!order || !dialogRef.current) return undefined;
    const dialog = dialogRef.current;
    const previouslyFocused = document.activeElement;
    const focusableElements = () => [...dialog.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]):not([readonly]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )].filter((element) => element.getAttribute('aria-hidden') !== 'true');
    const focusables = focusableElements();
    focusables[0]?.focus();

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        const current = interactionRef.current;
        if (!current.busy && !current.locked) {
          event.preventDefault();
          current.onClose();
        }
        return;
      }
      if (event.key !== 'Tab') return;
      const currentFocusables = focusableElements();
      if (!currentFocusables.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = currentFocusables[0];
      const last = currentFocusables.at(-1);
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected) previouslyFocused.focus();
    };
  }, [order?.id]);

  if (!order) return null;
  const estimate = estimatePosReturnTotal(order, buildPosReturnLines(quantities));

  return <div className="pos-return-overlay" role="presentation">
    <section ref={dialogRef} className="card card-pad pos-return-dialog" role="dialog" aria-modal="true" aria-labelledby="pos-return-title" tabIndex={-1}>
      <form onSubmit={onSubmit}>
        <div className="row wrap">
          <div>
            <h2 id="pos-return-title">{t('Trả một phần')} · {String(order.id).slice(0, 8)}</h2>
            <p className="small muted">{t('Chọn số lượng trả. Giá và thuế lấy từ giao dịch POS gốc.')}</p>
          </div>
          <span className="grow" />
          <button className="btn btn-ghost" type="button" disabled={busy || locked} onClick={onClose}>{t('Đóng')}</button>
        </div>
        <label className="field">
          <span className="label">{t('Lý do trả hàng')} *</span>
          <input className="input" required minLength="5" maxLength="500" readOnly={locked} value={reason} onChange={(event) => onReasonChange(event.target.value)} />
        </label>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>{t('Mặt hàng')}</th><th>{t('Đã bán')}</th><th>{t('Còn được trả')}</th><th>{t('Số lượng trả')}</th></tr></thead>
            <tbody>{(order.lines || []).map((line, index) => {
              const sold = String(line.qty || '0');
              const available = remainingPosReturnQuantity(order, index, returns);
              const name = line.product_name || products.get(line.product)?.name || t('Mặt hàng');
              return <tr key={`${line.product}-${index}`}>
                <td>{name}</td>
                <td>{sold}{line.uom_name ? ` ${line.uom_name}` : ''}</td>
                <td>{available}{line.uom_name ? ` ${line.uom_name}` : ''}</td>
                <td><input className="input num" aria-label={`${t('Số lượng trả')} ${name}`} type="number" min="0" max={available} step="any" disabled={available === '0' || locked} value={quantities[index] || ''} onChange={(event) => onQuantityChange(index, event.target.value)} /></td>
              </tr>;
            })}</tbody>
          </table>
        </div>
        <div className="row wrap">
          <span className="small muted">{t('Tiền hoàn dự kiến')}: {fmtMoney(estimate)}</span>
          <span className="grow" />
          <button className="btn btn-primary" type="submit" disabled={busy || !canSubmit}>
            {busy ? t('Đang ghi nhận…') : locked ? t('Thử nhận lại') : t('Ghi nhận trả hàng')}
          </button>
        </div>
      </form>
    </section>
  </div>;
}
