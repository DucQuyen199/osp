import React from 'react';
import { fmtMoney } from '../../../lib/i18n.js';

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
  if (!order) return null;
  const returned = returns.filter((record) => record.pos_order === order.id && record.status === 'received');
  const estimate = Object.entries(quantities).reduce((sum, [index, rawQty]) => {
    const line = order.lines?.[Number(index)];
    const sold = Number(line?.qty) || 0;
    const amount = Number(line?.line_total) || 0;
    const qty = Number(rawQty) || 0;
    return sum + (sold > 0 ? amount * qty / sold : 0);
  }, 0);

  return <div className="pos-return-overlay" role="presentation">
    <section className="card card-pad pos-return-dialog" role="dialog" aria-modal="true" aria-labelledby="pos-return-title">
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
              const sold = Number(line.qty) || 0;
              const already = returned.flatMap((record) => record.lines || [])
                .filter((item) => Number(item.source_line_index) === index)
                .reduce((sum, item) => sum + (Number(item.qty) || 0), 0);
              const available = Math.max(0, sold - already);
              const name = line.product_name || products.get(line.product)?.name || t('Mặt hàng');
              return <tr key={`${line.product}-${index}`}>
                <td>{name}</td>
                <td>{sold}{line.uom_name ? ` ${line.uom_name}` : ''}</td>
                <td>{available}{line.uom_name ? ` ${line.uom_name}` : ''}</td>
                <td><input className="input num" aria-label={`${t('Số lượng trả')} ${name}`} type="number" min="0" max={available} step="any" disabled={available <= 0 || locked} value={quantities[index] || ''} onChange={(event) => onQuantityChange(index, event.target.value)} /></td>
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
