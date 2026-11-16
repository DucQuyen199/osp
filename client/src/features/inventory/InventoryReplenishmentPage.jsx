import { fmtNumber } from '../../lib/i18n.js';
import React, { useCallback, useEffect, useState } from 'react';
import { api, tenantPath } from '../../lib/api.js';
import { can } from '../../lib/state.js';

const quantity = (value) => fmtNumber(Number(value || 0), { maximumFractionDigits: 3 });

export default function InventoryReplenishmentPage() {
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [creatingWarehouse, setCreatingWarehouse] = useState('');
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setReport(await api(tenantPath('/reports/inventory/replenishment')));
    } catch (reason) {
      setReport(null);
      setError(reason.message || 'Không tải được đề xuất bổ sung tồn kho.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { document.title = 'Bổ sung tồn kho · OSP Suite'; load(); }, [load]);

  const createRequisition = async (warehouseId) => {
    setCreatingWarehouse(warehouseId);
    setError('');
    setNotice(null);
    try {
      const requisition = await api(tenantPath('/reports/inventory/replenishment/purchase-requisitions'), {
        method: 'POST', body: { warehouseId },
      });
      setNotice(requisition?.id ? {
        id: requisition.id,
        message: `Đã tạo đề nghị mua nháp ${requisition.id}. Hãy bổ sung nhà cung cấp và đơn giá trước khi gửi duyệt.`,
      } : { message: 'Đã tạo đề nghị mua nháp.' });
      await load();
    } catch (reason) {
      await load();
      setError(reason.message || 'Không tạo được đề nghị mua.');
    } finally {
      setCreatingWarehouse('');
    }
  };

  const suggestedByWarehouse = (report?.items || []).reduce((groups, item) => {
    if (Number(item.suggestedQty) > 0.000001) {
      const group = groups.get(item.warehouseId) || { id: item.warehouseId, name: item.warehouse, count: 0 };
      group.count += 1;
      groups.set(item.warehouseId, group);
    }
    return groups;
  }, new Map());

  return <div className="page">
    <div className="page-head"><div><h1>Đề xuất bổ sung tồn kho</h1><p className="sub">Tồn khả dụng loại trừ lô hết hạn và hàng giữ để kiểm tra chất lượng; tồn dự kiến tính thêm đơn bán còn phải giao, đơn mua chờ nhận và đề nghị mua mở.</p></div><a className="btn btn-secondary" href="#/e/inventory/reorder_rule">Định mức bổ sung</a></div>
    {error && <div className="alert danger" role="alert">{error}</div>}
    {notice && <div className="alert success" role="status">{notice.message} {notice.id && <a href={`#/e/purchasing/purchase_requisition/${encodeURIComponent(notice.id)}`}>Mở đề nghị mua</a>}</div>}
    {loading && !report ? <div className="card-pad"><div className="skeleton" data-h="row" /></div> : report && <div className="stack">
      <div className="stats">
        <div className="card stat"><span className="stat-label">Sản phẩm cần xử lý</span><strong className="stat-value num">{fmtNumber(Number(report.itemCount || 0))}</strong></div>
        <div className="card stat"><span className="stat-label">Dòng cần đặt hàng</span><strong className="stat-value num">{fmtNumber(Number(report.purchaseLines || 0))}</strong></div>
      </div>
      {can('purchasing.purchase_requisition.create') && suggestedByWarehouse.size > 0 && <section className="card card-pad" aria-labelledby="replenishment-create-title">
        <div className="card-head"><h2 id="replenishment-create-title">Tạo đề nghị mua nháp</h2><span className="faint">Máy chủ tính lại số lượng trước khi tạo</span></div>
        <div className="row wrap">{[...suggestedByWarehouse.values()].map((warehouse) => <button className="btn btn-primary" key={warehouse.id} type="button" disabled={Boolean(creatingWarehouse)} onClick={() => createRequisition(warehouse.id)}>
          {creatingWarehouse === warehouse.id ? 'Đang tạo…' : `Tạo cho ${warehouse.name} · ${warehouse.count} dòng`}
        </button>)}</div>
      </section>}
      {!report.items?.length ? <div className="empty"><h2>Không có đề xuất bổ sung</h2><p>Tồn dự kiến ở các định mức đã cấu hình đang trên ngưỡng tối thiểu.</p></div> : <div className="card table-wrap"><table className="table">
        <thead><tr><th scope="col">SKU</th><th scope="col">Sản phẩm</th><th scope="col">Kho</th><th scope="col" className="right">Tồn khả dụng</th><th scope="col" className="right">Đơn bán chưa giao</th><th scope="col" className="right">Tồn dự kiến</th><th scope="col" className="right">Đơn mua chờ nhận</th><th scope="col" className="right">Đề nghị mua mở</th><th scope="col" className="right">Tối thiểu</th><th scope="col" className="right">Mục tiêu</th><th scope="col" className="right">Đề xuất mua</th></tr></thead>
        <tbody>{report.items.map((item) => <tr key={item.id}>
          <td>{item.sku}</td><td>{item.product}</td><td>{item.warehouse}</td>
          <td className="right">{quantity(item.availableQty)}{item.unit ? ` ${item.unit}` : ''}</td>
          <td className="right">{quantity(item.committedQty)}{item.unit ? ` ${item.unit}` : ''}</td>
          <td className="right">{quantity(item.projectedQty)}{item.unit ? ` ${item.unit}` : ''}</td>
          <td className="right">{quantity(item.incomingQty)}{item.unit ? ` ${item.unit}` : ''}</td>
          <td className="right">{quantity(item.requisitionQty)}{item.unit ? ` ${item.unit}` : ''}</td>
          <td className="right">{quantity(item.minimumQty)}</td><td className="right">{quantity(item.targetQty)}</td>
          <td className="right"><strong>{quantity(item.suggestedQty)}{item.unit ? ` ${item.unit}` : ''}</strong></td>
        </tr>)}</tbody>
      </table></div>}
    </div>}
  </div>;
}
