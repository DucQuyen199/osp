import { multiplyDecimals, roundDecimal } from '../../../lib/decimal.js';

export function repairQuoteLineTotal(price, unitRatio, qty) {
  return roundDecimal(multiplyDecimals([price || 0, unitRatio || 1, qty || 0]), 4);
}

export function storedRepairLineTotal(line) {
  return line.line_total ?? repairQuoteLineTotal(line.price, 1, line.qty);
}
