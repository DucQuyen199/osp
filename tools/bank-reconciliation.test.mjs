import assert from 'node:assert/strict';
import test from 'node:test';
import { amountsEqualWithin, calculateBankNet, calculateStatementTotals } from '../client/src/features/accounting/domain/bankReconciliation.js';

test('bank statement balances use exact credit and debit totals', () => {
  const result = calculateStatementTotals(
    { opening_balance: '0.1', closing_balance: '0.2' },
    [
      { direction: 'credit', amount: '0.2', status: 'matched' },
      { direction: 'credit', amount: '0.3', status: 'ignored' },
      { direction: 'debit', amount: '0.4', status: 'unmatched' },
    ],
  );
  assert.deepEqual(result, {
    credits: '0.5', debits: '0.4', matched: 1, ignored: 1, unmatched: 1,
    calculated: '0.2', difference: '0',
  });
});

test('journal net is exact and only includes the selected bank account', () => {
  assert.equal(calculateBankNet([
    { account: 'bank', debit: '0.3', credit: '0.1' },
    { account: 'bank', debit: '0.2', credit: '0' },
    { account: 'other', debit: '50', credit: '0' },
  ], 'bank'), '0.4');
});

test('bank matching respects its half-cent tolerance exactly', () => {
  assert.equal(amountsEqualWithin('1.004', '1'), true);
  assert.equal(amountsEqualWithin('1.006', '1'), false);
});
