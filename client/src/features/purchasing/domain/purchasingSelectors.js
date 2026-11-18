import { absDecimal, addDecimals, compareDecimals, minDecimal, multiplyDecimals, roundDecimal, roundDecimalHalfEven, subtractDecimals } from '../../../lib/decimal.js';

const ACTIVE_RETURN_STATUSES = new Set(['submitted', 'approved', 'dispatched']);
const RESERVED_INVOICE_STATUSES = new Set(['draft', 'submitted', 'disputed', 'approved']);

const samePrice = (left, right) => compareDecimals(absDecimal(subtractDecimals(left || 0, right || 0)), '0.005') <= 0;
const maxZero = (value) => compareDecimals(value, 0) > 0 ? value : '0';
const lineAmounts = (qty, price, rate) => {
  const net = roundDecimal(multiplyDecimals([qty || 0, price || 0]), 4);
  const tax = roundDecimal(multiplyDecimals([net, rate || 0, '0.01']), 4);
  return { net, tax, total: roundDecimal(addDecimals([net, tax]), 4) };
};

export const keyOf = (line) => `${line.product}|${addDecimals([line.price || 0])}|${line.tax || ''}|${addDecimals([line.tax_rate ?? 0])}|${line.uom || ''}`;

export const orderPriceKeyOf = (line) => `${line.product}|${addDecimals([line.price || 0])}|${line.uom || ''}|${line.po_tax ?? line.tax ?? ''}|${addDecimals([line.po_tax_rate ?? line.tax_rate ?? 0])}`;

export const lineValue = (line, taxes) => {
  const rate = taxes.get(line.tax)?.rate ?? line.tax_rate ?? 0;
  return lineAmounts(line.qty, line.price, rate).total;
};

export function returnSourceLineFor(inspection, receipts, order) {
  const receipt = receipts.find((row) => row.id === inspection?.source_id);
  const receiptLine = receipt?.lines?.find((line) => line.product === inspection.product && (line.lot || null) === (inspection.lot || null));
  const matchingOrderLine = order?.lines?.find((line) => line.product === inspection?.product
    && (!receiptLine || ((line.uom || null) === (receiptLine.uom || null)
      && samePrice(line.price, receiptLine.price)
      && (line.tax || '') === (receiptLine.tax || '')
      && compareDecimals(line.tax_rate || 0, receiptLine.tax_rate || 0) === 0)));
  return matchingOrderLine || (!receiptLine ? order?.lines?.find((line) => line.product === inspection?.product) : undefined);
}

export function returnUnitRatioFor(inspection, receipts, order, units) {
  const unitId = returnSourceLineFor(inspection, receipts, order)?.uom;
  const ratio = Number(units.get(unitId)?.ratio || 1);
  return Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
}

export function remainingInspectionBaseQuantity(inspection, returns) {
  if (!inspection) return '0';
  const reserved = returns.filter((row) => row.inspection === inspection.id && ACTIVE_RETURN_STATUSES.has(row.status))
    .reduce((sum, row) => addDecimals([sum, ...(row.lines || []).map((line) => line.base_qty ?? line.qty ?? 0)]), '0');
  return maxZero(subtractDecimals(inspection.qty || 0, reserved));
}

export function calculateUnreceivedPurchaseLines(order, receipts) {
  const ordered = new Map();
  for (const line of order?.lines || []) {
    const key = keyOf(line);
    const entry = ordered.get(key) || { product: line.product, uom: line.uom, price: Number(line.price), qty: '0' };
    entry.qty = addDecimals([entry.qty, line.qty || 0]);
    ordered.set(key, entry);
  }
  const received = new Map();
  for (const receipt of receipts.filter((row) => row.purchase_order === order?.id && row.status === 'received')) {
    for (const line of receipt.lines || []) {
      const key = keyOf(line);
      received.set(key, addDecimals([received.get(key) || '0', line.qty || 0]));
    }
  }
  return [...ordered.entries()].map(([key, line]) => ({
    ...line,
    qty: maxZero(subtractDecimals(line.qty, received.get(key) || '0')),
    key,
  })).filter((line) => compareDecimals(line.qty, '0.000001') > 0)
    .map((line) => ({ ...line, qty: String(line.qty) }));
}

export function invoiceLineForReturn(invoiceId, orderLine, invoices) {
  const invoice = invoices.find((row) => row.id === invoiceId);
  return invoice?.lines?.find((line) => line.product === orderLine.product
    && (line.uom || null) === (orderLine.uom || null)
    && samePrice(line.po_price ?? line.order_price ?? line.price, orderLine.price)
    && ((line.po_tax !== undefined && (line.po_tax || '') === (orderLine.tax || '')
      && compareDecimals(line.po_tax_rate || 0, orderLine.tax_rate || 0) === 0)
      || (line.po_tax === undefined && line.po_tax_rate === undefined))) || null;
}

export function calculateReturnableLines(receipts, returns) {
  const received = new Map();
  for (const receipt of receipts.filter((row) => row.status === 'received')) {
    for (const line of receipt.lines || []) {
      const key = `${orderPriceKeyOf(line)}|${line.lot || ''}`;
      const entry = received.get(key) || { ...line, qty: '0' };
      entry.qty = addDecimals([entry.qty, line.qty || 0]);
      received.set(key, entry);
    }
  }
  for (const purchaseReturn of returns.filter((row) => ACTIVE_RETURN_STATUSES.has(row.status))) {
    for (const line of purchaseReturn.lines || []) {
      const key = `${orderPriceKeyOf({ ...line, price: line.po_price ?? line.price })}|${line.lot || ''}`;
      const entry = received.get(key);
      if (entry) entry.qty = maxZero(subtractDecimals(entry.qty, line.qty || 0));
    }
  }
  return [...received.entries()]
    .map(([key, line]) => ({ ...line, key }))
    .filter((line) => compareDecimals(line.qty, '0.000001') > 0);
}

export function selectReturnableInspections(inspections, orderId, receipts, returns) {
  return inspections.filter((inspection) => {
    if (inspection.status !== 'failed' || !['purchase_order', 'purchase_receipt'].includes(inspection.source)) return false;
    const belongsToOrder = inspection.source === 'purchase_order'
      ? inspection.source_id === orderId
      : receipts.some((receipt) => receipt.id === inspection.source_id);
    if (!belongsToOrder) return false;
    return compareDecimals(remainingInspectionBaseQuantity(inspection, returns), '0.000001') > 0;
  });
}

export function calculateInvoiceableLines(receipts, invoices, returns) {
  const received = new Map();
  for (const receipt of receipts.filter((row) => row.status === 'received')) {
    for (const line of receipt.lines || []) {
      const key = orderPriceKeyOf(line);
      const entry = received.get(key) || { ...line, qty: '0' };
      entry.qty = addDecimals([entry.qty, line.qty || 0]);
      received.set(key, entry);
    }
  }
  for (const purchaseReturn of returns.filter((row) => row.status === 'dispatched')) {
    for (const line of purchaseReturn.lines || []) {
      const entry = received.get(orderPriceKeyOf({ ...line, price: line.po_price ?? line.price }));
      if (entry) entry.qty = maxZero(subtractDecimals(entry.qty, line.qty || 0));
    }
  }
  const reserved = new Map();
  for (const invoice of invoices.filter((row) => RESERVED_INVOICE_STATUSES.has(row.status))) {
    for (const line of invoice.lines || []) {
      const key = orderPriceKeyOf({ ...line, price: line.po_price ?? line.order_price ?? line.price });
      reserved.set(key, addDecimals([reserved.get(key) || '0', line.qty || 0]));
    }
  }
  return [...received.entries()]
    .map(([key, line]) => ({ ...line, qty: maxZero(subtractDecimals(line.qty, reserved.get(key) || '0')) }))
    .filter((line) => compareDecimals(line.qty, '0.000001') > 0)
    .map((line) => ({ ...line, qty: String(line.qty) }));
}

export function calculateSupplierInvoiceDraftTotals({
  lines,
  quantities,
  prices,
  taxesById,
  taxChoices,
  adjustments,
  isBaseCurrency,
  exchangeRate,
}) {
  const adjustmentTotals = adjustments.reduce((totals, line) => {
    const amount = line.amount || 0;
    const rate = taxesById.get(line.tax)?.rate || 0;
    const sign = line.kind === 'discount' ? '-1' : '1';
    const tax = lineAmounts(1, amount, rate).tax;
    return {
      net: addDecimals([totals.net, multiplyDecimals([amount, sign])]),
      tax: addDecimals([totals.tax, multiplyDecimals([tax, sign])]),
    };
  }, { net: '0', tax: '0' });

  const adjustmentsInvalid = adjustments.some((line) => {
    const hasAnyValue = line.description.trim() || line.amount !== '';
    return Boolean(hasAnyValue) && (!line.description.trim() || compareDecimals(line.amount || 0, 0) <= 0
      || (line.allocation === 'landed_cost' && (line.kind !== 'charge' || !(line.receipt_ids || []).length)));
  });

  const foreignPriceMissing = !isBaseCurrency && lines.some((line) => {
    const key = keyOf(line);
    return compareDecimals(quantities[key] ?? line.qty ?? 0, 0) > 0 && !String(prices[key] ?? '').trim();
  });

  const amounts = lines.map((line) => {
    const key = keyOf(line);
    const price = prices[key] ?? (isBaseCurrency ? line.price : 0);
    const taxId = taxChoices[key] ?? line.tax;
    const rate = taxId ? (taxesById.get(taxId)?.rate ?? line.tax_rate ?? 0) : 0;
    return lineAmounts(quantities[key] ?? line.qty, price, rate);
  });
  const lineTotal = addDecimals(amounts.map((amount) => amount.total));
  const lineTax = addDecimals(amounts.map((amount) => amount.tax));
  const total = addDecimals([lineTotal, adjustmentTotals.net, adjustmentTotals.tax]);
  const taxTotal = addDecimals([lineTax, adjustmentTotals.tax]);

  const matchedNet = lines.reduce((sum, line) => {
    const key = keyOf(line);
    return addDecimals([sum, multiplyDecimals([quantities[key] ?? line.qty, line.po_price ?? line.price ?? 0])]);
  }, '0');
  const baseTotal = roundDecimalHalfEven(multiplyDecimals([total, exchangeRate || 0]), 2);
  const baseTaxTotal = roundDecimalHalfEven(multiplyDecimals([taxTotal, exchangeRate || 0]), 2);
  const variance = subtractDecimals(subtractDecimals(baseTotal, baseTaxTotal), matchedNet);

  return {
    adjustmentTotals,
    adjustmentsInvalid,
    foreignPriceMissing,
    total,
    variance,
  };
}
