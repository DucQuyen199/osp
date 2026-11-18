import React, { useEffect } from 'react';
import { useDocumentTitle } from '../../lib/useDocumentTitle.js';
import { fmtMoney, uiTextWith } from '../../lib/i18n.js';
import { app, can, recordLabel } from '../../lib/state.js';
import ecommerceEnglish from './ecommerce.en.js';
import WebOrderCard from './components/WebOrderCard.jsx';
import WebOrderCreateForm from './components/WebOrderCreateForm.jsx';
import WebOrderRegisters from './components/WebOrderRegisters.jsx';
import { useEcommerceOrderData } from './hooks/useEcommerceOrderData.js';
import { useEcommerceOrderWorkflow } from './hooks/useEcommerceOrderWorkflow.js';
const t = (text) => uiTextWith(text, ecommerceEnglish);
export default function EcommerceOrderDeskPage() {
  useDocumentTitle(`${t('Điều phối đơn online')} · OSP Suite`);
  const logisticsEnabled = app.meta?.modules?.some((module) => module.id === 'logistics') || false;
  const { storefronts, parties, products, currencies, orders, salesOrders, shipments, invoices, loading, error, setError, load } = useEcommerceOrderData(logisticsEnabled);
  useEffect(() => {
    const timer = window.setInterval(() => load(true), 20000);
    return () => window.clearInterval(timer);
  }, [load]);
  const workflow = useEcommerceOrderWorkflow({
    storefronts, products, orders, salesOrders, shipments, invoices, currencies, load, setError, t,
  });
  const {
    party, setParty, storefront, setStorefront, channel, setChannel, address, setAddress,
    query, setQuery, quantities, busy, notice, activeStorefronts, cartDrafts, cartLines,
    filteredProducts, setQty, createCart, transition, refreshCartPrice,
    relatedSalesOrder, relatedShipments, relatedInvoice,
  } = workflow;
  const renderOrder = (order) => {
    const currencyCode = currencies.get(order.currency)?.code;
    const sale = relatedSalesOrder(order.id);
    const orderShipments = sale ? relatedShipments(sale.id) : [];
    const invoice = sale && relatedInvoice(sale.id);
    return <WebOrderCard key={order.id}
      order={order}
      storefrontName={storefronts.get(order.storefront)?.name}
      partyName={recordLabel('master-data.party', parties.get(order.party))}
      products={products}
      currencyCode={currencyCode}
      sale={sale}
      shipments={orderShipments}
      invoice={invoice}
      busy={busy}
      permissions={{
        salesRead: can('sales.sales_order.read'),
        logisticsRead: can('logistics.shipment.read'),
        invoiceRead: can('accounting.invoice.read'),
        update: can('ecommerce.web_order.update'),
        place: can('ecommerce.web_order.placed'),
        cancel: can('ecommerce.web_order.cancelled'),
      }}
      onRefreshPrice={refreshCartPrice}
      onTransition={transition}
      t={t}
    />;
  };
  const draftCarts = orders.filter((order) => order.status === 'cart');
  const placedOrders = orders.filter((order) => order.status === 'placed');
  const cancelledOrders = orders.filter((order) => order.status === 'cancelled');
  return <div className="page ecommerce-page">
    <div className="page-head"><div><h1>{t('Điều phối đơn online')}</h1><p className="sub">{t('Giá đơn được lấy từ gian hàng và bảng giá. Đơn có vận đơn ghi nhận tồn kho theo từng lần giao và lập hóa đơn sau khi giao đủ; đơn bán trực tiếp tuân theo luồng bán hàng chuẩn.')}</p></div><button className="btn btn-secondary" type="button" disabled={loading || Boolean(busy)} onClick={() => load()}>{loading ? t('Đang tải…') : t('Làm mới')}</button></div>
    <div className="row wrap ecommerce-summary"><span className="badge warning">{t('Giỏ chờ đặt:')} {draftCarts.length}</span><span className="badge success">{t('Đã đặt:')} {placedOrders.length}</span><span className="badge plain">{t('Đã hủy:')} {cancelledOrders.length}</span></div>
    {error && <div className="alert danger" role="alert">{t(error)}</div>}{notice && <div className="alert success" role="status">{t(notice)}</div>}
    {loading && !orders.length ? <div className="card-pad"><div className="skeleton" data-h="row" /></div> : <>
      {can('ecommerce.web_order.create') && <WebOrderCreateForm
        storefronts={activeStorefronts}
        parties={parties}
        filteredProducts={filteredProducts}
        quantities={quantities}
        cartDrafts={cartDrafts}
        cartLines={cartLines}
        storefront={storefront}
        party={party}
        channel={channel}
        address={address}
        query={query}
        busy={busy}
        onStorefrontChange={setStorefront}
        onPartyChange={setParty}
        onChannelChange={setChannel}
        onAddressChange={setAddress}
        onQueryChange={setQuery}
        onSetQuantity={setQty}
        onSubmit={createCart}
        t={t}
      />}
      <WebOrderRegisters
        draftOrders={draftCarts}
        placedOrders={placedOrders}
        cancelledOrders={cancelledOrders}
        draftTitle={t('Giỏ chờ xác nhận')}
        draftEmptyMessage={t('Không có giỏ hàng chờ xử lý.')}
        placedTitle={t('Đơn đã đặt')}
        placedEmptyMessage={t('Chưa có đơn online được đặt.')}
        cancelledTitle={t('Đơn đã hủy')}
        cancelledEmptyMessage={t('Chưa có giỏ hoặc đơn online bị hủy.')}
        renderOrder={renderOrder}
      />
    </>}
  </div>;
}
