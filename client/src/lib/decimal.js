function decimalParts(value) {
  const text = String(value ?? '0').trim();
  const match = text.match(/^([+-]?)(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i);
  if (!match) throw new TypeError(`Invalid decimal value: ${text}`);
  const sign = match[1] === '-' ? -1n : 1n;
  const fraction = match[3] || '';
  const exponent = Number(match[4] || 0);
  let coefficient = BigInt(`${match[2]}${fraction}`) * sign;
  let scale = fraction.length - exponent;
  if (scale < 0) {
    coefficient *= 10n ** BigInt(-scale);
    scale = 0;
  }
  return { coefficient, scale };
}

function decimalText(coefficient, scale) {
  if (coefficient === 0n) return '0';
  const negative = coefficient < 0n;
  let digits = (negative ? -coefficient : coefficient).toString();
  if (scale > 0) {
    digits = digits.padStart(scale + 1, '0');
    digits = `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
    digits = digits.replace(/0+$/, '').replace(/\.$/, '');
  }
  return `${negative ? '-' : ''}${digits}`;
}

export function normalizeDecimal(value) {
  const { coefficient, scale } = decimalParts(value);
  return decimalText(coefficient, scale);
}

function combine(left, right, subtract = false) {
  const a = decimalParts(left);
  const b = decimalParts(right);
  const scale = Math.max(a.scale, b.scale);
  const leftValue = a.coefficient * 10n ** BigInt(scale - a.scale);
  const rightValue = b.coefficient * 10n ** BigInt(scale - b.scale);
  return decimalText(leftValue + (subtract ? -rightValue : rightValue), scale);
}

export function multiplyDecimals(values) {
  return values.reduce((product, value) => {
    const left = decimalParts(product);
    const right = decimalParts(value);
    return decimalText(left.coefficient * right.coefficient, left.scale + right.scale);
  }, '1');
}

export function divideDecimals(dividend, divisor, places = 28) {
  if (!Number.isInteger(places) || places < 0 || places > 28) throw new RangeError('Decimal division scale must be between 0 and 28');
  const a = decimalParts(dividend);
  const b = decimalParts(divisor);
  if (b.coefficient === 0n) throw new RangeError('Cannot divide by zero');
  const numerator = a.coefficient * 10n ** BigInt(b.scale + places);
  const denominator = b.coefficient * 10n ** BigInt(a.scale);
  let quotient = numerator / denominator;
  const remainder = numerator % denominator;
  if ((remainder < 0n ? -remainder : remainder) * 2n >= (denominator < 0n ? -denominator : denominator)) {
    quotient += (numerator < 0n) !== (denominator < 0n) ? -1n : 1n;
  }
  return decimalText(quotient, places);
}

export function addDecimals(values) {
  return values.reduce((total, value) => combine(total, value), '0');
}

export function subtractDecimals(left, right) {
  return combine(left, right, true);
}

export function absDecimal(value) {
  const { coefficient, scale } = decimalParts(value);
  return decimalText(coefficient < 0n ? -coefficient : coefficient, scale);
}

export function roundDecimal(value, places = 2) {
  if (!Number.isInteger(places) || places < 0) throw new RangeError('Decimal places must be a non-negative integer');
  const { coefficient, scale } = decimalParts(value);
  if (scale <= places) return decimalText(coefficient, scale);
  const divisor = 10n ** BigInt(scale - places);
  const negative = coefficient < 0n;
  const absolute = negative ? -coefficient : coefficient;
  let rounded = absolute / divisor;
  if ((absolute % divisor) * 2n >= divisor) rounded += 1n;
  return decimalText(negative ? -rounded : rounded, places);
}

export function roundDecimalHalfEven(value, places = 2) {
  if (!Number.isInteger(places) || places < 0) throw new RangeError('Decimal places must be a non-negative integer');
  const { coefficient, scale } = decimalParts(value);
  if (scale <= places) return decimalText(coefficient, scale);
  const divisor = 10n ** BigInt(scale - places);
  const negative = coefficient < 0n;
  const absolute = negative ? -coefficient : coefficient;
  let rounded = absolute / divisor;
  const remainder = absolute % divisor;
  const twiceRemainder = remainder * 2n;
  if (twiceRemainder > divisor || (twiceRemainder === divisor && rounded % 2n !== 0n)) rounded += 1n;
  return decimalText(negative ? -rounded : rounded, places);
}

export function compareDecimals(left, right) {
  const a = decimalParts(left);
  const b = decimalParts(right);
  const scale = Math.max(a.scale, b.scale);
  const leftValue = a.coefficient * 10n ** BigInt(scale - a.scale);
  const rightValue = b.coefficient * 10n ** BigInt(scale - b.scale);
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
}

export function minDecimal(left, right) {
  const value = compareDecimals(left, right) <= 0 ? left : right;
  const { coefficient, scale } = decimalParts(value);
  return decimalText(coefficient, scale);
}
