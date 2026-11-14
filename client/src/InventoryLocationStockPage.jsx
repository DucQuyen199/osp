import React, { useCallback, useEffect, useState } from 'react';
import { api, tenantPath } from './lib/api.js';
import { fmtMoney } from './lib/i18n.js';
import { loadRefs } from './lib/state.js';

const quantity = (value) => Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 3 });

export default function InventoryLocationStockPage() {
  const [warehouses, setWarehouses] = useState(new Map());
  const [warehouse, setWarehouse] = useState('');
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => { loadRefs('inventory.warehouse').then(setWarehouses); }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (warehouse) params.set('warehouse', warehouse);
      setReport(await api(`${tenantPath('/reports/inventory/location-stock')}?${params}`));
    } catch (reason) {
      setReport(null);
      setError(reason.message || 'Không tải được tồn theo vị trí.');
    } finally {
      setLoading(false);
    }
  }, [warehouse]);

  useEffect(() => { document.title = 'Tồn theo vị trí · OSP Suite'; load(); }, [load]);

  return <div className="page">
    <div className="page-head"><div><h1>Tồn kho theo vị trí</h1><p className="sub">Số lượng và giá trị được tổng hợp từ phiếu kho theo từng bin.</p></div></div>
    <section className="card"><form className="toolbar" onSubmit={(event) => { event.preventDefault(); load(); }}>
      <label className="field"><span className="label">Kho</span><select className="select" value={warehouse} onChange={(event) => setWarehouse(event.target.value)}>
        <option value="">Tất cả kho</option>
        {[...warehouses.values()].map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
      <button className="btn btn-primary" type="submit" disabled={loading}>{loading ? 'Đang tải…' : 'Làm mới'}</button>
    </form></section>
    {error && <div className="alert danger" role="alert">{error}</div>}
    {loading && !report ? <div className="card-pad"><div className="skeleton" data-h="row" /></div> : report && <section className="card report-section">
      <div className="card-head"><h2>{report.itemCount} dòng tồn</h2></div>
      {!report.items?.length ? <div className="empty"><h3>Chưa có phiếu kho theo vị trí</h3><p>Chọn bin khi điều chuyển hàng để bắt đầu theo dõi tồn theo vị trí.</p></div> : <div className="table-wrap"><table className="table">
        <thead><tr><th scope="col">Kho</th><th scope="col">Mã vị trí</th><th scope="col">Vị trí</th><th scope="col">SKU</th><th scope="col">Sản phẩm</th><th scope="col" className="right">Số lượng</th><th scope="col" className="right">Giá trị</th></tr></thead>
        <tbody>{report.items.map((item) => <tr key={`${item.warehouseId}:${item.locationId || 'unassigned'}:${item.productId}`}>
          <td>{item.warehouse}</td><td className="mono">{item.locationCode || '—'}</td><td>{item.location || 'Chưa gán bin'}</td><td className="mono">{item.sku || '—'}</td><td>{item.product}</td><td className="right">{quantity(item.qty)}</td><td className="right money">{fmtMoney(item.value)}</td>
        </tr>)}</tbody>
      </table></div>}
    </section>}
  </div>;
}
