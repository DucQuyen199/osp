import { addDecimals, multiplyDecimals, roundDecimal } from '../../../lib/decimal.js';

export function boqLineValue(line) {
  return multiplyDecimals([line.qty || 0, line.unit_price || 0]);
}

export function boqTotal(lines) {
  const unroundedTotal = addDecimals(lines.map((line) => multiplyDecimals([line.qty || 0, line.unit_price || 0])));
  return roundDecimal(unroundedTotal, 2);
}
