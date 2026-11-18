import { addDecimals, compareDecimals } from '../../../lib/decimal.js';

const DELIVERY_TOLERANCE = '0.000001';

export function isDeliveredShort(receivedQty, shippedQty) {
  return compareDecimals(addDecimals([receivedQty || 0, DELIVERY_TOLERANCE]), shippedQty || 0) < 0;
}

export function isDeliveredWithinLimit(receivedQty, shippedQty) {
  return compareDecimals(receivedQty || 0, shippedQty || 0) <= 0;
}
