import React from 'react';

/** Renders saved harvest and farm-input records for the selected crop cycle. */
export default function AgricultureCycleHistory({
  harvests = [],
  inputs = [],
  lots,
  products,
  warehouses,
  inputKinds,
  unitLabel,
  canViewLots,
  lotHref,
  fmtDate,
  fmtNumber,
  t,
}) {
  return <div className="agriculture-history-grid">
    <article className="card agriculture-panel">
      <h3>{t('Lịch sử thu hoạch')}</h3>
      {harvests.length ? <div className="agriculture-history">
        {harvests.map((harvest) => {
          const lot = [...lots.values()].find((item) => item.product === harvest.product && item.code === harvest.lot_code);
          return <div className="agriculture-history-row" key={harvest.id}>
            <div>
              <strong>{products.get(harvest.product)?.name || t('Nông sản')} · {fmtNumber(harvest.qty)} {unitLabel(harvest)}{harvest.base_qty != null && harvest.uom_ratio > 1 ? ` (${fmtNumber(harvest.base_qty)} ${t('base')})` : ''}</strong>
              <div className="small muted">{fmtDate(harvest.date)}{harvest.grade ? ` · ${harvest.grade}` : ''}{harvest.lot_code ? ` · ${t('Lô')} ${harvest.lot_code}` : ''}</div>
            </div>
            {lot && canViewLots && <a className="small" href={lotHref(lot.id)}>{t('Truy xuất lô')}</a>}
          </div>;
        })}
      </div> : <div className="empty">{t('Chưa ghi nhận thu hoạch.')}</div>}
    </article>
    <article className="card agriculture-panel">
      <h3>{t('Nhật ký vật tư')}</h3>
      {inputs.length ? <div className="agriculture-history">
        {inputs.map((record) => <div className="agriculture-history-row" key={record.id}>
          <div>
            <strong>{t(inputKinds.find(([value]) => value === record.kind)?.[1] || record.kind)}{record.product ? ` · ${products.get(record.product)?.name || t('Sản phẩm')}` : ''}</strong>
            <div className="small muted">{fmtDate(record.date)} · {fmtNumber(record.qty)} {unitLabel(record)}{record.base_qty != null && record.uom_ratio > 1 ? ` (${fmtNumber(record.base_qty)} ${t('base')})` : ''}{record.kind === 'pesticide' && record.preharvest_interval_days != null ? ` · ${t('Cách ly trước thu hoạch')} ${fmtNumber(record.preharvest_interval_days)} ${t('ngày')}` : ''}{record.warehouse ? ` · ${warehouses.get(record.warehouse)?.name || t('Kho')}` : ''}</div>
          </div>
        </div>)}
      </div> : <div className="empty">{t('Chưa ghi nhận vật tư.')}</div>}
    </article>
  </div>;
}
