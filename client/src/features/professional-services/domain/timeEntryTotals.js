import { multiplyDecimals, roundDecimal } from '../../../lib/decimal.js';

export function estimateTimeEntryAmount(hours, hourlyRate) {
  return roundDecimal(multiplyDecimals([hours || 0, hourlyRate || 0]), 2);
}
