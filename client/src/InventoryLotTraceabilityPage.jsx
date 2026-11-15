import React, { useEffect, useState } from 'react';
import { api, tenantPath } from './lib/api.js';
import { fmtDate, fmtDateTime, fmtMoney, fmtNumber } from './lib/i18n.js';
import { recordHref } from './lib/routes.js';
import { can, entityLabel } from './lib/state.js';

const quantity = (value) => fmtNumber(Number(value || 0), { maximumFractionDigits: 3 });

export default function InventoryLotTraceabilityPage({ lotId }) {
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    let active = true;
    document.title = 'Truy xuất lô hàng · OSP Suite';
    const params = new URLSearchParams({ limit: '100', offset: String(offset) });
    api(tenantPath(`/reports/inventory/lots/${encodeURIComponent(lotId)}/traceability?${params}`))
      .then((data) => { if (active) setReport(data); })
      .catch((reason) => { if (active) setError(reason.message || 'Không tải được lịch sử lô hàng.'); });
    return () => { active = false; };
  }, [lotId, offset]);

  return <div className="page">
    <div className="page-head"><div><a className="back-link" href={recordHref('inventory.lot', lotId)}>← Mở thẻ lô</a><h1>Truy xuất lô hàng</h1>
      {report && <p className="sub">{report.lot.product} · {report.lot.sku || 'Không có SKU'} · Lô {report.lot.code}{report.lot.expiry ? ` · Hạn dùng ${fmtDate(report.lot.expiry)}` : ''}</p>}
    </div></div>
    {error && <div className="alert danger" role="alert">{error}</div>}
    {!report && !error && <div className="card-pad"><div className="skeleton" data-h="row" /></div>}
    {report && <div className="stack">
      {report.lot.expired && <div className="alert danger" role="alert">Lô đã hết hạn. Hệ thống chặn xuất kho theo quy tắc hạn dùng.</div>}
      <div className="stats">
        <div className="card stat"><span className="stat-label">Còn trong kho</span><strong className="stat-value num">{quantity(report.quantity)}{report.lot.unit ? ` ${report.lot.unit}` : ''}</strong></div>
        <div className="card stat"><span className="stat-label">Giá trị còn lại</span><strong className="stat-value money">{fmtMoney(report.value)}</strong></div>
        <div className="card stat"><span className="stat-label">Biến động</span><strong className="stat-value num">{fmtNumber(Number(report.movementCountTotal))}</strong></div>
      </div>
      <section className="card report-section"><div className="card-head"><h2>Số dư theo kho</h2></div>
        {!report.balances.length ? <div className="empty"><p>Lô chưa có số dư tồn kho.</p></div> : <div className="table-wrap"><table className="table">
          <thead><tr><th scope="col">Kho</th><th scope="col" className="right">Số lượng</th><th scope="col" className="right">Giá trị</th></tr></thead>
          <tbody>{report.balances.map((balance) => <tr key={balance.warehouseId || 'unassigned'}><td>{balance.warehouse || 'Chưa gán kho'}</td><td className="right">{quantity(balance.quantity)}{report.lot.unit ? ` ${report.lot.unit}` : ''}</td><td className="right money">{fmtMoney(balance.value)}</td></tr>)}</tbody>
        </table></div>}
      </section>
      <section className="card report-section"><div className="card-head"><h2>Lịch sử nhập, xuất và điều chuyển</h2><span className="faint">{report.movementCountTotal ? `${offset + 1}–${offset + report.movements.length} / ${report.movementCountTotal}` : 'Theo thời gian phát sinh'}</span></div>
        {!report.movements.length ? <div className="empty"><p>Lô chưa có phiếu kho.</p></div> : <div className="table-wrap"><table className="table">
          <thead><tr><th scope="col">Thời điểm</th><th scope="col">Loại</th><th scope="col">Kho · vị trí</th><th scope="col">Chứng từ nguồn</th><th scope="col">Phiếu kho</th><th scope="col" className="right">Số lượng</th><th scope="col" className="right">Thành tiền</th></tr></thead>
          <tbody>{report.movements.map((movement) => <tr key={movement.id}>
            <td>{fmtDateTime(movement.at)}</td><td><span className={`badge ${movement.direction === 'in' ? 'success' : 'plain'}`}>{movement.direction === 'in' ? 'Nhập' : 'Xuất'}</span></td>
            <td>{movement.warehouse || 'Chưa gán kho'}{movement.locationCode ? ` · ${movement.locationCode}` : ''}</td>
            <td>{movement.sourceEntity && movement.sourceId && can(`${movement.sourceEntity}.read`)
              ? <a href={recordHref(movement.sourceEntity, movement.sourceId)}>{entityLabel(movement.sourceEntity)}{` · ${movement.sourceId.slice(0, 8)}`}</a>
              : <span>{movement.source || 'Không có chứng từ nguồn'}{movement.sourceId ? ` · ${movement.sourceId.slice(0, 8)}` : ''}</span>}</td>
            <td><a href={recordHref('inventory.stock_move', movement.id)}>Chi tiết</a></td>
            <td className="right">{movement.direction === 'out' ? '−' : '+'}{quantity(movement.quantity)}{report.lot.unit ? ` ${report.lot.unit}` : ''}</td>
            <td className="right money">{fmtMoney(movement.totalCost)}</td>
          </tr>)}</tbody>
        </table></div>}
        {report.movementCountTotal > 100 && <div className="card-pad row wrap">
          <button className="btn btn-secondary" type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 100))}>Trang trước</button>
          <button className="btn btn-secondary" type="button" disabled={!report.hasMoreMovements} onClick={() => setOffset(offset + 100)}>Trang sau</button>
        </div>}
      </section>
    </div>}
  </div>;
}
