import { addDecimals, multiplyDecimals, roundDecimal } from '../../../lib/decimal.js';

function lineAmounts({ product, uom, qty }, units, taxes) {
  const unit = units.get(uom);
  const ratio = unit?.base_uom ? unit.ratio || 0 : 1;
  const unitPrice = multiplyDecimals([product.price || 0, ratio]);
  const net = roundDecimal(multiplyDecimals([qty, unitPrice]), 4);
  const taxRate = taxes.get(product.tax)?.rate || 0;
  const tax = roundDecimal(multiplyDecimals([net, taxRate, '0.01']), 4);
  return { net, tax, total: roundDecimal(addDecimals([net, tax]), 4) };
}

export function calculatePosTotals(cart, units, taxes) {
  const lines = cart.map((line) => lineAmounts(line, units, taxes));
  return {
    subtotal: Number(addDecimals(lines.map((line) => line.net))),
    tax: Number(addDecimals(lines.map((line) => line.tax))),
    total: Number(addDecimals(lines.map((line) => line.total))),
  };
}
