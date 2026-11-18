import React from 'react';

function WebOrderListSection({ title, orders, emptyMessage, renderOrder }) {
  return <section className="ecommerce-order-section">
    <header><h2>{title}</h2><span className="badge plain">{orders.length}</span></header>
    <div className="ecommerce-orders">{orders.map(renderOrder)}{!orders.length && <div className="empty">{emptyMessage}</div>}</div>
  </section>;
}

export default function WebOrderRegisters({ draftOrders, placedOrders, cancelledOrders = [], renderOrder, draftTitle, draftEmptyMessage, placedTitle, placedEmptyMessage, cancelledTitle, cancelledEmptyMessage }) {
  return <>
    <WebOrderListSection
      title={draftTitle}
      orders={draftOrders}
      emptyMessage={draftEmptyMessage}
      renderOrder={renderOrder}
    />
    <WebOrderListSection
      title={placedTitle}
      orders={placedOrders}
      emptyMessage={placedEmptyMessage}
      renderOrder={renderOrder}
    />
    {cancelledTitle && <WebOrderListSection
      title={cancelledTitle}
      orders={cancelledOrders}
      emptyMessage={cancelledEmptyMessage}
      renderOrder={renderOrder}
    />}
  </>;
}
