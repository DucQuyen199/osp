import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateAdjustmentRefundable } from '../client/src/features/accounting/domain/adjustmentRefunds.js';

test('refund allowance uses exact collected and adjusted totals', () => {
  const result = calculateAdjustmentRefundable({
    noteTotal: '1.00',
    paidAmounts: ['0.1', '0.2'],
    adjustmentTotals: ['1.20'],
    documentTotal: '1.30',
    refundAmounts: ['-0.10'],
  });
  assert.deepEqual(result, { alreadyRefunded: '0.1', refundable: '0.2' });
});

test('refund allowance cannot exceed note balance or collected credit', () => {
  const result = calculateAdjustmentRefundable({
    noteTotal: '100.00',
    paidAmounts: ['100.00'],
    adjustmentTotals: ['20.00'],
    documentTotal: '100.00',
    refundAmounts: ['-50.00'],
  });
  assert.deepEqual(result, { alreadyRefunded: '50', refundable: '20' });
});

test('refund allowance clamps exhausted and negative credit balances to zero', () => {
  const exhausted = calculateAdjustmentRefundable({
    noteTotal: '10', paidAmounts: ['10'], adjustmentTotals: [], documentTotal: '10', refundAmounts: ['-10'],
  });
  const noCredit = calculateAdjustmentRefundable({
    noteTotal: '10', paidAmounts: ['0.50'], adjustmentTotals: ['0.20'], documentTotal: '1', refundAmounts: [],
  });
  assert.deepEqual(exhausted, { alreadyRefunded: '10', refundable: '0' });
  assert.deepEqual(noCredit, { alreadyRefunded: '0', refundable: '0' });
});
