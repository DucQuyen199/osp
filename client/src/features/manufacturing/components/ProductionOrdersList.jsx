import React from 'react';
import ProductionOrderCard from './ProductionOrderCard.jsx';

export default function ProductionOrdersList({
  orders,
  products,
  workCenters,
  outputDrafts,
  busy,
  formatQuantity,
  onOutputChange,
  onAction,
  t,
}) {
  return <div className="manufacturing-orders">
    <h3>{t('Lệnh sản xuất')}</h3>
    {orders.map((order) => <ProductionOrderCard
      key={order.id}
      order={order}
      productName={products.get(order.product)?.name}
      workCenterName={workCenters.get(order.work_center)?.name}
      draft={outputDrafts[order.id] || {}}
      busy={busy}
      formatQty={formatQuantity}
      t={t}
      onOutputChange={(field, value) => onOutputChange(order.id, field, value)}
      onAction={onAction}
    />)}
    {!orders.length && <p className="small muted">{t('Chưa có lệnh sản xuất.')}</p>}
  </div>;
}
