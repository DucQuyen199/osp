function returnsForOrder(returns, orderId) {
  return returns.filter((item) => item.pos_order === orderId && item.status === 'received');
}

export default function PosRecentTransactions({
  orders,
  returns,
  parties,
  products,
  busy,
  canReadReturns,
  canCreateReturns,
  canReceiveReturns,
  canRefundOrders,
  canUpdateOrders,
  onPrint,
  onPartialReturn,
  onRefund,
  formatMoney,
  formatDateTime,
  statusLabel,
  t,
}) {
  return <section className="pos-pending">
    <h3>{t('Giao dịch gần đây')}</h3>
    {orders.length ? orders.map((order) => {
      const orderReturns = returnsForOrder(returns, order.id);
      const returnedTotal = orderReturns.reduce((sum, item) => sum + (Number(item.total) || 0), 0);
      const paymentMethod = order.method === 'cash' ? 'Tiền mặt'
        : order.method === 'card' ? 'Thẻ'
          : order.method === 'transfer' ? 'Chuyển khoản'
            : order.method === 'ewallet' ? 'Ví điện tử' : '—';

      return <div className="pos-pending-item" key={order.id}>
        <div className="grow">
          <strong>{formatMoney(order.total || 0)} · {parties.get(order.party)?.name || t('Khách lẻ')}</strong>
          <div className="small muted">{formatDateTime(order.created_at)} · {t(paymentMethod)} · {statusLabel(order.status)}</div>
          <div className="small muted">{(order.lines || []).map((line) => `${line.product_name || products.get(line.product)?.name || t('Mặt hàng')} × ${line.qty}${line.uom_name ? ` ${line.uom_name}` : ''}`).join(' · ')}</div>
          {orderReturns.length > 0 && <div className="small muted">{t('Đã trả một phần')}: {formatMoney(returnedTotal)}</div>}
          {order.refund_reason && <div className="small muted">{t('Lý do hoàn:')} {order.refund_reason}</div>}
          {order.status === 'completed' && order.prescription && <div className="small muted">{t('Thuốc trả từ đơn thuốc được cách ly và phải hủy; không được bán lại.')}</div>}
        </div>
        <button className="btn btn-ghost btn-sm" type="button" onClick={() => onPrint(order)}>{t('In biên nhận')}</button>
        {order.status === 'completed' && canReadReturns && canCreateReturns && canReceiveReturns && <button className="btn btn-secondary btn-sm" type="button" disabled={busy} onClick={() => onPartialReturn(order)}>{t('Trả một phần')}</button>}
        {order.status === 'completed' && orderReturns.length === 0 && canRefundOrders && canUpdateOrders && <button className="btn btn-ghost btn-sm" type="button" disabled={busy} onClick={() => onRefund(order)}>{t('Hoàn toàn bộ')}</button>}
      </div>;
    }) : <div className="empty">{t('Chưa có giao dịch hoàn tất trong danh sách gần đây.')}</div>}
  </section>;
}
