import { addDecimals, compareDecimals, roundDecimal } from '../../../lib/decimal.js';

const DELIVERY_TOLERANCE = '0.000001';

export function isDeliveredShort(receivedQty, shippedQty) {
  try { return compareDecimals(addDecimals([receivedQty || 0, DELIVERY_TOLERANCE]), shippedQty || 0) < 0; } catch { return false; }
}

export function isDeliveredWithinLimit(receivedQty, shippedQty) {
  try { return compareDecimals(receivedQty || 0, shippedQty || 0) <= 0; } catch { return false; }
}

export function sameDeliveryLine(left, right) {
  try {
    const discountPct = (line) => line.effective_discount_pct ?? line.discount_pct ?? 0;
    return left.product === right.product
      && (left.uom || '') === (right.uom || '')
      && roundDecimal(left.price || 0, 2) === roundDecimal(right.price || 0, 2)
      && compareDecimals(discountPct(left), discountPct(right)) === 0
      && (left.tax || '') === (right.tax || '')
      && compareDecimals(left.tax_rate || 0, right.tax_rate || 0) === 0;
  } catch { return false; }
}
