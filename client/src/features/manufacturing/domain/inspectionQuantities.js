import { addDecimals, absDecimal, compareDecimals, subtractDecimals } from '../../../lib/decimal.js';

const maxZero = (value) => compareDecimals(value, '0') < 0 ? '0' : value;
const FAILED_QTY_TOLERANCE = '0.000001';
const OUTPUT_QTY_TOLERANCE = '0.0001';

export function alreadyAccountedFailedQty(inspectionId, reworkOrders, dispositions, acceptances) {
  return addDecimals([
    ...reworkOrders
      .filter((row) => row.inspection === inspectionId && row.status !== 'cancelled')
      .map((row) => row.qty || 0),
    ...dispositions
      .filter((row) => row.inspection === inspectionId && ['draft', 'posted'].includes(row.status))
      .map((row) => row.qty || 0),
    ...acceptances
      .filter((row) => row.inspection === inspectionId && ['draft', 'submitted', 'approved'].includes(row.status))
      .map((row) => row.qty || 0),
  ]);
}

export function remainingFailedQty(inspection, reworkOrders, dispositions, acceptances) {
  if (!inspection) return '0';
  return maxZero(subtractDecimals(
    inspection.qty || 0,
    alreadyAccountedFailedQty(inspection.id, reworkOrders, dispositions, acceptances),
  ));
}

export function isWithinFailedQty(askedQty, availableQty) {
  if (compareDecimals(askedQty || 0, '0') <= 0) return false;
  return compareDecimals(askedQty, addDecimals([availableQty || 0, FAILED_QTY_TOLERANCE])) <= 0;
}

export function productionOutputQuantities(orderQty, goodInput, scrapInput) {
  const planned = String(orderQty || 0);
  const goodQty = String(goodInput ?? orderQty ?? 0).trim();
  const scrapText = String(scrapInput ?? '').trim();
  const scrapQty = scrapText !== '' ? scrapText : maxZero(subtractDecimals(planned, goodQty));
  return { goodQty, scrapQty };
}

export function productionOutputMatchesPlan(orderQty, goodQty, scrapQty) {
  return compareDecimals(absDecimal(subtractDecimals(addDecimals([goodQty, scrapQty]), orderQty)), OUTPUT_QTY_TOLERANCE) <= 0;
}
