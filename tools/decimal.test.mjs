import assert from 'node:assert/strict';
import test from 'node:test';
import { absDecimal, addDecimals, compareDecimals, minDecimal, subtractDecimals } from '../client/src/lib/decimal.js';

test('decimal addition and subtraction avoid binary floating point drift', () => {
  assert.equal(addDecimals(['0.1', 0.2]), '0.3');
  assert.equal(subtractDecimals('0.3', '0.1'), '0.2');
  assert.equal(addDecimals(['100000000000000.12', '0.88']), '100000000000001');
  assert.equal(addDecimals(['1e-7', '2e-7']), '0.0000003');
  assert.equal(addDecimals(['-1.25', '0.25']), '-1');
  assert.equal(compareDecimals('12.00', '12'), 0);
  assert.equal(compareDecimals('-0.01', 0), -1);
  assert.equal(minDecimal('1.2500', '1.24'), '1.24');
  assert.equal(minDecimal('1.25', '2'), '1.25');
  assert.equal(absDecimal('-100.05'), '100.05');
});

test('decimal arithmetic rejects invalid monetary input', () => {
  assert.throws(() => addDecimals(['12.00', 'not-money']), /Invalid decimal value/);
});
