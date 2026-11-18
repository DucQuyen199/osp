import React from 'react';
import { compareDecimals } from '../../../lib/decimal.js';
import { fmtMoney } from '../../../lib/i18n.js';

function hasPositiveTaxRate(value) {
  try { return compareDecimals(value ?? 0, '0') > 0; }
  catch { return false; }
}

/** Renders the saved food and drink lines for a restaurant order. */
export default function RestaurantOrderLineItems({ lines = [], products, lineTotal, t }) {
  return <ul className="restaurant-detail-lines">{lines.map((line, index) => <li key={`${line.product}:${index}`}>
    <span>{line.product_name || products.get(line.product)?.name || t('Món')} × {line.qty}{hasPositiveTaxRate(line.tax_rate) && <small className="small muted"> · {t('Thuế')} {line.tax_rate}%</small>}{line.note && <small className="small muted"> · {t('Ghi chú:')} {line.note}</small>}</span>
    <strong className="num">{fmtMoney(lineTotal(line))}</strong>
  </li>)}</ul>;
}
