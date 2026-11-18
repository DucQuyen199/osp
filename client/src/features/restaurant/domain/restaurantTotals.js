import { addDecimals, multiplyDecimals, roundDecimal } from '../../../lib/decimal.js';

export function estimateRestaurantSubtotal(cart) {
  const lineTotals = cart.map(({ product, qty }) => roundDecimal(multiplyDecimals([product.price || 0, qty]), 4));
  return addDecimals(lineTotals);
}

export function restaurantLineTotal(line) {
  return line.line_total ?? multiplyDecimals([line.price || 0, line.qty || 0]);
}
