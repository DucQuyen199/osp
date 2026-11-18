import React from 'react';

/** Controlled presentation for quotation cards; business rules and actions belong to the page. */
export default function QuotationRegister({ quotations, t }) {
  return <section className="wholesale-section">
    <header><h2>{t('Báo giá')}</h2><span className="badge plain">{quotations.length}</span></header>
    <div className="wholesale-documents">
      {quotations.map((quote) => <article className="card wholesale-document" key={quote.id}>
        <header>
          <div>
            <strong>{quote.customerName}</strong>
            <div className="small muted">{quote.meta}</div>
          </div>
          <span className={`badge ${quote.badgeClass}`}>{quote.badgeText}</span>
        </header>
        <ul>{quote.lines.map((line) => <li key={line.key}><span>{line.description}</span><strong className="num">{line.total}</strong></li>)}</ul>
        <div className="wholesale-total"><span>{t('Tổng gồm thuế')}</span><strong className="num">{quote.total}</strong></div>
        <footer>
          {quote.actions.send && <button className="btn" disabled={quote.actions.busy || quote.expired} onClick={quote.actions.onSend}>{t('Gửi báo giá')}</button>}
          {quote.actions.accept && <button className="btn btn-primary" disabled={quote.actions.busy} onClick={quote.actions.onAccept}>{t('Khách duyệt')}</button>}
          {quote.actions.reject && <button className="btn" disabled={quote.actions.busy} onClick={quote.actions.onReject}>{t('Khách từ chối')}</button>}
          {quote.actions.expire && <button className="btn" disabled={quote.actions.busy} onClick={quote.actions.onExpire}>{t('Đóng báo giá quá hạn')}</button>}
          <a className="btn" href={quote.href}>{t('Chi tiết báo giá')}</a>
          {quote.order && <a className="btn" href={quote.order.href}>{t('Mở đơn bán')} {quote.order.idShort}</a>}
        </footer>
      </article>)}
      {!quotations.length && <div className="card-pad muted">{t('Chưa có báo giá.')}</div>}
    </div>
  </section>;
}
