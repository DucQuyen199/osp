import { addDecimals, compareDecimals, multiplyDecimals, roundDecimal, subtractDecimals } from '../../../lib/decimal.js';

const maxZero = (value) => compareDecimals(value, '0') < 0 ? '0' : value;
const minDecimal = (left, right) => compareDecimals(left, right) <= 0 ? left : right;

export function estimateUtilityCharge(reading, previousReading, meter) {
  const consumption = maxZero(subtractDecimals(reading || 0, previousReading || 0));
  const tiers = Array.isArray(meter?.tariff_tiers) ? meter.tariff_tiers : [];
  let baseAmount = '0';
  if (!tiers.length) {
    baseAmount = roundDecimal(multiplyDecimals([consumption, meter?.rate || 0]), 4);
  } else {
    let lower = '0';
    for (const tier of tiers) {
      const upper = tier.up_to == null ? consumption : String(tier.up_to);
      const units = maxZero(subtractDecimals(minDecimal(consumption, upper), lower));
      if (compareDecimals(units, '0') > 0) {
        baseAmount = addDecimals([baseAmount, roundDecimal(multiplyDecimals([units, tier.rate || 0]), 4)]);
      }
      if (tier.up_to == null || compareDecimals(consumption, upper) <= 0) break;
      lower = upper;
    }
  }
  return {
    consumption,
    baseAmount,
    total: addDecimals([baseAmount, meter?.fixed_charge || 0]),
  };
}
