import { addDecimals, multiplyDecimals, roundDecimal } from '../../../lib/decimal.js';

export function fieldServiceLineTotal(line, products, units) {
  const product = products.get(line.product);
  const price = product?.price ?? line.price ?? 0;
  const ratio = units.get(line.uom || product?.uom)?.ratio ?? line.uom_ratio ?? 1;
  return roundDecimal(multiplyDecimals([line.qty || 0, price, ratio]), 4);
}

export function fieldServiceTotal(lines, products, units) {
  return addDecimals(lines.map((line) => fieldServiceLineTotal(line, products, units)));
}

export function fieldServiceStoredLineTotal(line) {
  return roundDecimal(multiplyDecimals([line.qty || 0, line.price || 0]), 4);
}
