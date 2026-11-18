import React from 'react';

export default function RestaurantOrderList({ loading, orders, openCount, selectedId, onSelect, t }) {
  return <section className="restaurant-order-list">
    <header><h2>{t('Orders')}</h2><span className="badge warning">{openCount} {t('đang mở')}</span></header>
    {loading ? <div className="card-pad"><div className="skeleton" data-h="row" /></div> : <div className="restaurant-orders">
      {orders.map((order) => <button className={`card restaurant-order-card${selectedId === order.id ? ' selected' : ''}`} key={order.id} onClick={() => onSelect(order.id)}>
        <span className="restaurant-order-card-head"><strong>{order.tableLabel || t('Mang đi')}</strong><span className={`badge ${order.statusTone}`}>{order.statusLabel}</span></span>
        <span className="small muted">{order.dateLabel}{order.guestLabel ? ` · ${order.guestLabel}` : ''}</span><strong className="num">{order.totalLabel}</strong>
      </button>)}
      {!orders.length && <div className="empty">{t('Chưa có order.')}</div>}
    </div>}
  </section>;
}
