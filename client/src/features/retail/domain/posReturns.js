import { addDecimals, compareDecimals, divideDecimals, multiplyDecimals, roundDecimal, subtractDecimals } from '../../../lib/decimal.js';

const isPositive = (value) => { try { return compareDecimals(value || 0, 0) > 0; } catch { return false; } };

export function remainingPosReturnQuantity(order, lineIndex, returns) {
  const sold = order?.lines?.[lineIndex]?.qty || '0';
  const alreadyReturned = addDecimals(returns
    .filter((record) => record.pos_order === order?.id && record.status === 'received')
    .flatMap((record) => record.lines || [])
    .filter((line) => Number(line.source_line_index) === lineIndex)
    .map((line) => line.qty || '0'));
  const remaining = subtractDecimals(sold, alreadyReturned);
  return compareDecimals(remaining, 0) > 0 ? remaining : '0';
}

export function estimatePosReturnLineTotal(orderLine, quantity) {
  const sold = orderLine?.qty || '0';
  if (compareDecimals(sold, 0) <= 0 || compareDecimals(quantity || 0, 0) <= 0) return '0';
  const ratio = divideDecimals(quantity, sold);
  return roundDecimal(multiplyDecimals([orderLine.line_total || 0, ratio]), 4);
}

export function buildPosReturnLines(quantities) {
  return Object.entries(quantities)
    .map(([lineIndex, qty]) => ({ line_index: Number(lineIndex), qty: String(qty) }))
    .filter((line) => Number.isInteger(line.line_index) && isPositive(line.qty));
}

export function estimatePosReturnTotal(order, lines) {
  return addDecimals(lines.map((line) => estimatePosReturnLineTotal(order?.lines?.[line.line_index], line.qty)));
}
