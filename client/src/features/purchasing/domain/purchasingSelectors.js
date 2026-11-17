const ACTIVE_RETURN_STATUSES = new Set(['submitted', 'approved', 'dispatched']);
const RESERVED_INVOICE_STATUSES = new Set(['draft', 'submitted', 'disputed', 'approved']);

export const keyOf = (line) => `${line.product}|${Number(line.price || 0)}|${line.tax || ''}|${Number(line.tax_rate ?? 0)}|${line.uom || ''}`;

export const orderPriceKeyOf = (line) => `${line.product}|${Number(line.price || 0)}|${line.uom || ''}|${line.po_tax ?? line.tax ?? ''}|${Number(line.po_tax_rate ?? line.tax_rate ?? 0)}`;

export const lineValue = (line, taxes) => {
  const net = (Number(line.qty) || 0) * (Number(line.price) || 0);
  const rate = Number(taxes.get(line.tax)?.rate ?? line.tax_rate) || 0;
  return net * (1 + rate / 100);
};

export function returnSourceLineFor(inspection, receipts, order) {
  const receipt = receipts.find((row) => row.id === inspection?.source_id);
  const receiptLine = receipt?.lines?.find((line) => line.product === inspection.product && (line.lot || null) === (inspection.lot || null));
  const matchingOrderLine = order?.lines?.find((line) => line.product === inspection?.product
    && (!receiptLine || ((line.uom || null) === (receiptLine.uom || null)
      && Math.abs(Number(line.price || 0) - Number(receiptLine.price || 0)) <= 0.005
      && (line.tax || '') === (receiptLine.tax || '')
      && Number(line.tax_rate || 0) === Number(receiptLine.tax_rate || 0))));
  return matchingOrderLine || (!receiptLine ? order?.lines?.find((line) => line.product === inspection?.product) : undefined);
}

export function returnUnitRatioFor(inspection, receipts, order, units) {
  const unitId = returnSourceLineFor(inspection, receipts, order)?.uom;
  const ratio = Number(units.get(unitId)?.ratio || 1);
  return Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
}

export function invoiceLineForReturn(invoiceId, orderLine, invoices) {
  const invoice = invoices.find((row) => row.id === invoiceId);
  return invoice?.lines?.find((line) => line.product === orderLine.product
    && (line.uom || null) === (orderLine.uom || null)
    && Math.abs(Number(line.po_price ?? line.order_price ?? line.price) - Number(orderLine.price)) <= 0.005
    && ((line.po_tax !== undefined && (line.po_tax || '') === (orderLine.tax || '')
      && Number(line.po_tax_rate || 0) === Number(orderLine.tax_rate || 0))
      || (line.po_tax === undefined && line.po_tax_rate === undefined))) || null;
}

export function calculateReturnableLines(receipts, returns) {
  const received = new Map();
  for (const receipt of receipts.filter((row) => row.status === 'received')) {
    for (const line of receipt.lines || []) {
      const key = orderPriceKeyOf(line);
      const entry = received.get(key) || { ...line, qty: 0 };
      entry.qty += Number(line.qty || 0);
      received.set(key, entry);
    }
  }
  for (const purchaseReturn of returns.filter((row) => ACTIVE_RETURN_STATUSES.has(row.status))) {
    for (const line of purchaseReturn.lines || []) {
      const key = orderPriceKeyOf({ ...line, price: line.po_price ?? line.price });
      const entry = received.get(key);
      if (entry) entry.qty = Math.max(0, entry.qty - Number(line.qty || 0));
    }
  }
  return [...received.entries()]
    .map(([key, line]) => ({ ...line, key }))
    .filter((line) => line.qty > 0.000001);
}

export function selectReturnableInspections(inspections, orderId, receipts, returns) {
  return inspections.filter((inspection) => {
    if (inspection.status !== 'failed' || !['purchase_order', 'purchase_receipt'].includes(inspection.source)) return false;
    const belongsToOrder = inspection.source === 'purchase_order'
      ? inspection.source_id === orderId
      : receipts.some((receipt) => receipt.id === inspection.source_id);
    if (!belongsToOrder) return false;
    const alreadyReturned = returns.filter((row) => row.inspection === inspection.id && ACTIVE_RETURN_STATUSES.has(row.status))
      .reduce((sum, row) => sum + (row.lines || []).reduce((lineSum, line) => lineSum + Number(line.base_qty ?? line.qty ?? 0), 0), 0);
    return Number(inspection.qty || 0) - alreadyReturned > 0.000001;
  });
}

export function calculateInvoiceableLines(receipts, invoices, returns) {
  const received = new Map();
  for (const receipt of receipts.filter((row) => row.status === 'received')) {
    for (const line of receipt.lines || []) {
      const key = orderPriceKeyOf(line);
      const entry = received.get(key) || { ...line, qty: 0 };
      entry.qty += Number(line.qty || 0);
      received.set(key, entry);
    }
  }
  for (const purchaseReturn of returns.filter((row) => row.status === 'dispatched')) {
    for (const line of purchaseReturn.lines || []) {
      const entry = received.get(orderPriceKeyOf(line));
      if (entry) entry.qty = Math.max(0, entry.qty - Number(line.qty || 0));
    }
  }
  const reserved = new Map();
  for (const invoice of invoices.filter((row) => RESERVED_INVOICE_STATUSES.has(row.status))) {
    for (const line of invoice.lines || []) {
      const key = orderPriceKeyOf({ ...line, price: line.po_price ?? line.order_price ?? line.price });
      reserved.set(key, (reserved.get(key) || 0) + Number(line.qty || 0));
    }
  }
  return [...received.entries()]
    .map(([key, line]) => ({ ...line, qty: Math.max(0, line.qty - (reserved.get(key) || 0)) }))
    .filter((line) => line.qty > 0.000001);
}
