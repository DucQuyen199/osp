import { absDecimal, addDecimals, compareDecimals, minDecimal, multiplyDecimals, subtractDecimals, roundDecimal } from '../../../lib/decimal.js';

const linesOf = (document) => Array.isArray(document?.lines) ? document.lines : [];
const quantitySum = (lines) => lines.reduce((sum, line) => addDecimals([sum, line.qty || 0]), '0');
const priceKey = (price) => roundDecimal(price || 0, 2);
const samePrice = (left, right) => compareDecimals(absDecimal(subtractDecimals(left || 0, right || 0)), '0.005') <= 0;
const discountOf = (line) => line.effective_discount_pct ?? line.discount_pct ?? 0;
const taxRateOf = (line) => line.tax_rate ?? 0;
const sameReturnTerms = (line, reference) =>
  samePrice(line.price, reference.price)
  && compareDecimals(discountOf(line), reference.discount_pct) === 0
  && (line.tax || '') === (reference.tax || '')
  && compareDecimals(taxRateOf(line), reference.tax_rate) === 0;

export function wholesalePrice(product, uomId, selectedList, units) {
  const basePrice = selectedList?.items?.find((item) => item.product === product.id)?.price ?? product.price ?? 0;
  const unit = units.get(uomId);
  const ratio = unit?.base_uom ? unit.ratio || 0 : 1;
  return multiplyDecimals([basePrice, ratio]);
}

export function estimateWholesaleSubtotal(cart, selectedList, units) {
  const amounts = cart.map(({ product, qty, uom }) => {
    const basePrice = selectedList?.items?.find((item) => item.product === product.id)?.price ?? product.price ?? 0;
    const unit = units.get(uom);
    const ratio = unit?.base_uom ? unit.ratio || 0 : 1;
    return roundDecimal(multiplyDecimals([basePrice, ratio, qty]), 4);
  });
  return addDecimals(amounts);
}

export function eligibleWholesaleReturnLines(order, shipments, returns, products, requiresDelivery) {
  const groups = new Map();
  for (const line of linesOf(order)) {
    const product = line.product;
    const price = Number(line.price || 0);
    const uom = line.uom || products.get(product)?.uom || '';
    const discount_pct = Number(discountOf(line));
    const tax = line.tax ?? null;
    const tax_rate = Number(taxRateOf(line));
    const key = [product, priceKey(price), uom, discount_pct, tax || '', tax_rate].join(':');
    const current = groups.get(key) || { key, product, price, uom: uom || undefined, uom_name: line.uom_name, discount_pct, tax, tax_rate, ordered: '0', name: products.get(product)?.name || 'Mặt hàng' };
    current.ordered = addDecimals([current.ordered, line.qty || 0]);
    groups.set(key, current);
  }

  const orderShipments = shipments.filter((shipment) => shipment.source === 'sales_order' && shipment.source_id === order.id);
  return [...groups.values()].map((line) => {
    const delivered = requiresDelivery
      ? quantitySum(orderShipments.filter((shipment) => shipment.status === 'delivered').flatMap((shipment) => shipment.delivered_lines || shipment.lines || []).filter((item) => item.product === line.product && (item.uom || '') === (line.uom || '') && sameReturnTerms(item, line)))
      : line.ordered;
    const reserved = quantitySum(returns.filter((record) => record.sales_order === order.id && ['submitted', 'approved', 'received'].includes(record.status)).flatMap((record) => linesOf(record)).filter((item) => item.product === line.product && (item.uom || '') === (line.uom || '') && sameReturnTerms(item, line)));
    const eligible = minDecimal(line.ordered, delivered);
    const remaining = subtractDecimals(eligible, reserved);
    return { ...line, eligible: Number(eligible), remaining: compareDecimals(remaining, 0) > 0 ? Number(remaining) : 0 };
  }).filter((line) => line.remaining > 0);
}

export function remainingWholesaleShipmentLines(order, shipments, products) {
  const groups = new Map();
  for (const line of linesOf(order)) {
    if (['service', 'digital'].includes(line.kind)) continue;
    const product = line.product;
    const price = Number(line.price || 0);
    const uom = line.uom || products.get(product)?.uom || '';
    const key = `${product}:${priceKey(price)}:${uom}`;
    const current = groups.get(key) || { key, product, price, uom: uom || undefined, uom_name: line.uom_name, ordered: '0' };
    current.ordered = addDecimals([current.ordered, line.qty || 0]);
    groups.set(key, current);
  }

  const orderShipments = shipments.filter((shipment) => shipment.source === 'sales_order' && shipment.source_id === order.id);
  const reserved = new Map();
  for (const shipment of orderShipments.filter((row) => ['created', 'dispatched', 'delivered'].includes(row.status))) {
    const reservedLines = shipment.status === 'delivered' ? (shipment.delivered_lines || shipment.lines || []) : linesOf(shipment);
    for (const line of reservedLines) {
      const key = `${line.product}:${priceKey(line.price)}:${line.uom || products.get(line.product)?.uom || ''}`;
      reserved.set(key, addDecimals([reserved.get(key) || '0', line.qty || 0]));
    }
  }
  return [...groups.values()].map((line) => {
    const remaining = subtractDecimals(line.ordered, reserved.get(line.key) || '0');
    return { ...line, remaining: compareDecimals(remaining, 0) > 0 ? Number(remaining) : 0 };
  }).filter((line) => line.remaining > 0.000001);
}
