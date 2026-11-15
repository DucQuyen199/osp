import React, { useEffect, useState } from 'react';
import { api, tenantPath } from './lib/api.js';
import { fmtDate, fmtMoney, fmtNumber } from './lib/i18n.js';
import { can } from './lib/state.js';

const quantity = (value) => fmtNumber(Number(value || 0), { maximumFractionDigits: 3 });

export default function InventoryLotExpiryPage() {
  const [days, setDays] = useState(90);
  const [offset, setOffset] = useState(0);
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [creatingWarehouse, setCreatingWarehouse] = useState('');
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ days: String(days), limit: '100', offset: String(offset) });
    api(tenantPath(`/reports/inventory/lot-expiry?${params}`))
      .then((data) => { if (active) setReport(data); })
      .catch((reason) => { if (active) setError(reason.message || 'Không tải được danh sách lô cận hạn.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [days, offset]);

  useEffect(() => { document.title = 'Lô cận hạn · OSP Suite'; }, []);

  const changeDays = (value) => { setDays(value); setOffset(0); };
  const createWriteoff = async (warehouse) => {
    setCreatingWarehouse(warehouse.id);
    setError('');
    setNotice(null);
    try {
      const result = await api(tenantPath('/reports/inventory/lot-expiry/writeoff-counts'), {
        method: 'POST', body: { warehouseId: warehouse.id },
      });
      setNotice({ id: result.id, message: result.existing ? `Đã có phiếu kiểm kê ${result.status} cho ${warehouse.name}.` : `Đã tạo phiếu kiểm kê nháp gồm ${result.lineCount} vị trí lô hết hạn tại ${warehouse.name}.` });
    } catch (reason) {
      setError(reason.message || 'Không tạo được phiếu kiểm kê xử lý hàng hết hạn.');
    } finally {
      setCreatingWarehouse('');
    }
  };

  const expiredByWarehouse = (report?.items || []).reduce((groups, item) => {
    if (!item.expired || !item.warehouseId) return groups;
    const group = groups.get(item.warehouseId) || { id: item.warehouseId, name: item.warehouse };
    groups.set(item.warehouseId, group);
    return groups;
  }, new Map());

  return <div className="page">
    <div className="page-head"><div><h1>Lô sắp hết hạn</h1><p className="sub">Tồn dương của các lô đã hết hạn hoặc sẽ hết hạn trong kỳ đã chọn, theo kho.</p></div></div>
    <section className="card"><div className="toolbar">
      <label className="field"><span className="label">Khoảng cảnh báo</span><select className="select" value={days} onChange={(event) => changeDays(Number(event.target.value))}>
        <option value="0">Đã hết hạn</option><option value="30">30 ngày</option><option value="60">60 ngày</option><option value="90">90 ngày</option><option value="180">180 ngày</option><option value="365">365 ngày</option>
      </select></label>
      <span className="muted">Lô không khai báo hạn dùng sẽ không xuất hiện.</span>
    </div></section>
    {error && <div className="alert danger" role="alert">{error}</div>}
    {notice && <div className="alert success" role="status">{notice.message} {notice.id && <a href={`#/e/inventory/stock_count/${encodeURIComponent(notice.id)}`}>Mở phiếu để rà soát và duyệt</a>}</div>}
    {report?.items.some((item) => item.expired && !item.warehouseId) && <div className="alert warning" role="status">Một số lô hết hạn chưa gán kho nên chưa thể tạo phiếu kiểm kê xử lý. Hãy gán tồn vào kho trước.</div>}
    {loading && !report ? <div className="card-pad"><div className="skeleton" data-h="row" /></div> : report && <section className="card report-section">
      <div className="card-head"><h2>{fmtNumber(Number(report.itemCount))} dòng tồn theo kho</h2><span className="faint">{report.items.length ? `${offset + 1}–${offset + report.items.length} / ${report.itemCount}` : ''}</span></div>
      {can('inventory.stock_count.create') && expiredByWarehouse.size > 0 && <div className="card-pad stack-sm">
        <p className="small muted">Tạo phiếu kiểm kê nháp đặt số đếm các lô hết hạn về 0. Tồn kho và bút toán hao hụt chỉ thay đổi sau khi phiếu được gửi duyệt và phê duyệt.</p>
        <div className="row wrap">{[...expiredByWarehouse.values()].map((warehouse) => <button className="btn btn-primary" key={warehouse.id} type="button" disabled={Boolean(creatingWarehouse)} onClick={() => createWriteoff(warehouse)}>
          {creatingWarehouse === warehouse.id ? 'Đang tạo…' : `Tạo phiếu xử lý tại ${warehouse.name}`}
        </button>)}</div>
      </div>}
      {!report.items.length ? <div className="empty"><h3>Không có lô cần xử lý</h3><p>Không có lô tồn dương trong khoảng cảnh báo này.</p></div> : <div className="table-wrap"><table className="table">
        <thead><tr><th scope="col">Hạn dùng</th><th scope="col">SKU · sản phẩm</th><th scope="col">Lô</th><th scope="col">Kho</th><th scope="col" className="right">Số lượng</th><th scope="col" className="right">Giá trị</th><th scope="col"></th></tr></thead>
        <tbody>{report.items.map((item) => <tr key={`${item.lotId}:${item.warehouseId || 'unassigned'}`}>
          <td><span className={`badge ${item.expired ? 'danger' : 'warning'}`}>{item.expired ? 'Đã hết hạn' : `${item.daysToExpiry} ngày`}</span><div className="small muted">{fmtDate(item.expiry)}</div></td>
          <td>{item.sku ? <span className="mono">{item.sku} · </span> : ''}{item.product}</td><td className="mono">{item.code}</td><td>{item.warehouse || 'Chưa gán kho'}</td>
          <td className="right">{quantity(item.quantity)}{item.unit ? ` ${item.unit}` : ''}</td><td className="right money">{fmtMoney(item.value)}</td>
          <td><a className="btn btn-sm" href={`#/reports/inventory/lots/${encodeURIComponent(item.lotId)}/traceability`}>Truy xuất</a></td>
        </tr>)}</tbody>
      </table></div>}
      {report.itemCount > 100 && <div className="card-pad row wrap">
        <button className="btn btn-secondary" type="button" disabled={offset === 0 || loading} onClick={() => setOffset(Math.max(0, offset - 100))}>Trang trước</button>
        <button className="btn btn-secondary" type="button" disabled={!report.hasMore || loading} onClick={() => setOffset(offset + 100)}>Trang sau</button>
      </div>}
    </section>}
  </div>;
}
