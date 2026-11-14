import React, { useCallback, useEffect, useState } from 'react';
import { api, tenantPath } from './lib/api.js';
import { fmtMoney } from './lib/i18n.js';
import { loadRefs } from './lib/state.js';

const quantity = (value) => Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 3 });
const statusLabel = (value) => value === 'failed' ? 'Không đạt' : 'Chờ kiểm tra';
const sourceLabel = (value) => value === 'purchase_receipt' ? 'Phiếu nhận mua' : value === 'purchase_order' ? 'Đơn mua' : value;

export default function InventoryQualityHoldsPage() {
  const [warehouses, setWarehouses] = useState(new Map());
  const [warehouse, setWarehouse] = useState('');
  const [status, setStatus] = useState('all');
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => { loadRefs('inventory.warehouse').then(setWarehouses); }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ status });
      if (warehouse) params.set('warehouse', warehouse);
      setReport(await api(`${tenantPath('/reports/inventory/quality-holds')}?${params}`));
    } catch (reason) {
      setReport(null);
      setError(reason.message || 'Không tải được hàng tồn đang giữ QC.');
    } finally {
      setLoading(false);
    }
  }, [status, warehouse]);

  useEffect(() => { document.title = 'Hàng giữ QC · OSP Suite'; load(); }, [load]);

  return <div className="page">
    <div className="page-head"><div><h1>Hàng tồn đang giữ QC</h1><p className="sub">Theo dõi số lượng và giá trị còn bị giữ theo phiếu kiểm tra, lô và lớp nhập kho.</p></div></div>
    <section className="card"><form className="toolbar" onSubmit={(event) => { event.preventDefault(); load(); }}>
      <label className="field"><span className="label">Kho</span><select className="select" value={warehouse} onChange={(event) => setWarehouse(event.target.value)}>
        <option value="">Tất cả kho</option>
        {[...warehouses.values()].map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
      <label className="field"><span className="label">Trạng thái QC</span><select className="select" value={status} onChange={(event) => setStatus(event.target.value)}>
        <option value="all">Chờ kiểm tra và không đạt</option><option value="pending">Chờ kiểm tra</option><option value="failed">Không đạt</option>
      </select></label>
      <button className="btn btn-primary" type="submit" disabled={loading}>{loading ? 'Đang tải…' : 'Làm mới'}</button>
    </form></section>
    {error && <div className="alert danger" role="alert">{error}</div>}
    {loading && !report ? <div className="card-pad"><div className="skeleton" data-h="row" /></div> : report && <div className="stack">
      <div className="stats">
        <div className="card stat"><span className="stat-label">Phiếu kiểm tra còn giữ hàng</span><strong className="stat-value num">{Number(report.itemCount || 0).toLocaleString()}</strong></div>
        <div className="card stat"><span className="stat-label">Số lượng đang giữ</span><strong className="stat-value num">{quantity(report.heldQty)}</strong></div>
        <div className="card stat"><span className="stat-label">Giá trị đang giữ</span><strong className="stat-value num">{fmtMoney(report.heldValue)}</strong></div>
      </div>
      {!report.items?.length ? <div className="empty"><h3>Không có hàng tồn đang giữ QC</h3><p>Các phiếu chờ kiểm tra hoặc không đạt đã được xử lý.</p></div> : <div className="card table-wrap"><table className="table">
        <thead><tr><th scope="col">Trạng thái</th><th scope="col">Sản phẩm</th><th scope="col">Kho</th><th scope="col">Lô</th><th scope="col">Nguồn / lớp nhập</th><th scope="col" className="right">Đang giữ</th><th scope="col" className="right">Đơn giá</th><th scope="col" className="right">Giá trị</th><th scope="col" className="right">Số ngày</th></tr></thead>
        <tbody>{report.items.map((item) => <tr key={item.inspectionId}>
          <td><span className={`badge ${item.inspectionStatus === 'failed' ? 'danger' : 'warning'}`}>{statusLabel(item.inspectionStatus)}</span></td>
          <td><span className="mono">{item.sku || '—'}</span><br />{item.product}</td><td>{item.warehouse}</td><td>{item.lotCode || 'Không gán lô'}</td>
          <td>{sourceLabel(item.source)}<br /><span className="faint mono">{item.layerId || item.sourceId}</span></td>
          <td className="right">{quantity(item.heldQty)}</td><td className="right money">{fmtMoney(item.unitCost)}</td><td className="right money">{fmtMoney(item.heldValue)}</td><td className="right">{quantity(item.daysHeld)}</td>
        </tr>)}</tbody>
      </table></div>}
    </div>}
  </div>;
}
