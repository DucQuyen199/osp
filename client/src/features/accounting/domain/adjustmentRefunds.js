import { absDecimal, addDecimals, compareDecimals, minDecimal, subtractDecimals } from '../../../lib/decimal.js';

export function calculateAdjustmentRefundable({ noteTotal, paidAmounts, adjustmentTotals, documentTotal, refundAmounts }) {
  const alreadyRefunded = addDecimals(refundAmounts.map((amount) => absDecimal(amount || 0)));
  const collected = addDecimals([
    addDecimals(paidAmounts),
    addDecimals(adjustmentTotals),
    subtractDecimals(0, documentTotal || 0),
  ]);
  const availableCredit = compareDecimals(collected, 0) > 0 ? collected : '0';
  const remainingOnNote = subtractDecimals(noteTotal || 0, alreadyRefunded);
  const refundable = compareDecimals(remainingOnNote, 0) > 0
    ? minDecimal(remainingOnNote, availableCredit)
    : '0';
  return { alreadyRefunded, refundable };
}
