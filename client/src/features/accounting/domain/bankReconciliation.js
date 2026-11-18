import { absDecimal, addDecimals, compareDecimals, subtractDecimals } from '../../../lib/decimal.js';

export function amountsEqualWithin(left, right, tolerance = '0.005') {
  return compareDecimals(absDecimal(subtractDecimals(left || 0, right || 0)), tolerance) <= 0;
}

export function calculateBankNet(lines, accountId) {
  return addDecimals((lines || [])
    .filter((line) => line.account === accountId)
    .map((line) => subtractDecimals(line.debit || 0, line.credit || 0)));
}

export function calculateStatementTotals(statement, lines) {
  const credits = addDecimals(lines.filter((line) => line.direction === 'credit').map((line) => line.amount));
  const debits = addDecimals(lines.filter((line) => line.direction === 'debit').map((line) => line.amount));
  const matched = lines.filter((line) => line.status === 'matched').length;
  const ignored = lines.filter((line) => line.status === 'ignored').length;
  const calculated = addDecimals([statement?.opening_balance || 0, credits, subtractDecimals(0, debits)]);
  return {
    credits,
    debits,
    matched,
    ignored,
    unmatched: lines.length - matched - ignored,
    calculated,
    difference: subtractDecimals(statement?.closing_balance || 0, calculated),
  };
}
