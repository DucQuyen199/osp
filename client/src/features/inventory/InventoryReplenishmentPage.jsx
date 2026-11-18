import { useDocumentTitle } from '../../lib/useDocumentTitle.js';
import { useLatestRequest } from '../../lib/useLatestRequest.js';
import { fmtNumber, uiText } from '../../lib/i18n.js';
import React, { useCallback, useEffect, useState } from 'react';
import { api, tenantPath } from '../../lib/api.js';
import { can } from '../../lib/state.js';
import { compareDecimals } from '../../lib/decimal.js';
const quantity = (value) => fmtNumber(String(value || 0), { maximumFractionDigits: 3 });
export default function InventoryReplenishmentPage() {
  useDocumentTitle(`${uiText('Đề xuất bổ sung tồn kho')} · OSP Suite`);
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [creatingWarehouse, setCreatingWarehouse] = useState('');
  const [notice, setNotice] = useState(null);
  const latestRequest = useLatestRequest();
  const load = useCallback(async () => {
    const isLatest = latestRequest();
    setLoading(true);
    setError('');
    try {
      const nextReport = await api(tenantPath('/reports/inventory/replenishment'));
      if (isLatest()) setReport(nextReport);
    } catch (reason) {
      if (isLatest()) {
        setReport(null);
        setError(reason.message || uiText('Không tải được đề xuất bổ sung tồn kho.'));
      }
    } finally {
      if (isLatest()) setLoading(false);
    }
  }, [latestRequest]);
  useEffect(() => { load(); }, [load]);
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
        message: `${uiText('Đã tạo đề nghị mua nháp')} ${requisition.id}. ${uiText('Hãy bổ sung nhà cung cấp và đơn giá trước khi gửi duyệt.')}`,
      } : { message: uiText('Đã tạo đề nghị mua nháp.') });
      await load();
    } catch (reason) {
      await load();
      setError(reason.message || uiText('Không tạo được đề nghị mua.'));
    } finally {
      setCreatingWarehouse('');
    }
  };
  const suggestedByWarehouse = (report?.items || []).reduce((groups, item) => {
    if (compareDecimals(item.suggestedQty || 0, '0.000001') > 0) {
      const group = groups.get(item.warehouseId) || { id: item.warehouseId, name: item.warehouse, count: 0 };
      group.count += 1;
      groups.set(item.warehouseId, group);
    }
    return groups;
  }, new Map());
  return <div className="page">
    <div className="page-head"><div><h1>{uiText('Đề xuất bổ sung tồn kho')}</h1><p className="sub">{uiText('Tồn khả dụng loại trừ lô hết hạn và hàng giữ để kiểm tra chất lượng; tồn dự kiến tính thêm đơn bán còn phải giao, đơn mua chờ nhận và đề nghị mua mở.')}</p></div><a className="btn btn-secondary" href="#/e/inventory/reorder_rule">{uiText('Định mức bổ sung')}</a></div>
    {error && <div className="alert danger" role="alert">{uiText(error)}</div>}
    {notice && <div className="alert success" role="status">{notice.message} {notice.id && <a href={`#/e/purchasing/purchase_requisition/${encodeURIComponent(notice.id)}`}>{uiText('Mở đề nghị mua')}</a>}</div>}
    {loading && !report ? <div className="card-pad"><div className="skeleton" data-h="row" /></div> : report && <div className="stack">
      <div className="stats">
        <div className="card stat"><span className="stat-label">{uiText('Sản phẩm cần xử lý')}</span><strong className="stat-value num">{fmtNumber(Number(report.itemCount || 0))}</strong></div>
        <div className="card stat"><span className="stat-label">{uiText('Dòng cần đặt hàng')}</span><strong className="stat-value num">{fmtNumber(Number(report.purchaseLines || 0))}</strong></div>
      </div>
      {can('purchasing.purchase_requisition.create') && suggestedByWarehouse.size > 0 && <section className="card card-pad" aria-labelledby="replenishment-create-title">
        <div className="card-head"><h2 id="replenishment-create-title">{uiText('Tạo đề nghị mua nháp')}</h2><span className="faint">{uiText('Máy chủ tính lại số lượng trước khi tạo')}</span></div>
        <div className="row wrap">{[...suggestedByWarehouse.values()].map((warehouse) => <button className="btn btn-primary" key={warehouse.id} type="button" disabled={Boolean(creatingWarehouse)} onClick={() => createRequisition(warehouse.id)}>
          {creatingWarehouse === warehouse.id ? uiText('Đang tạo…') : `${uiText('Tạo cho')} ${warehouse.name} · ${warehouse.count} ${uiText('dòng')}`}
        </button>)}</div>
      </section>}
      {!report.items?.length ? <div className="empty"><h2>{uiText('Không có đề xuất bổ sung')}</h2><p>{uiText('Tồn dự kiến ở các định mức đã cấu hình đang trên ngưỡng tối thiểu.')}</p></div> : <div className="card table-wrap"><table className="table">
        <thead><tr><th scope="col">SKU</th><th scope="col">{uiText('Sản phẩm')}</th><th scope="col">{uiText('Kho')}</th><th scope="col" className="right">{uiText('Tồn khả dụng')}</th><th scope="col" className="right">{uiText('Đơn bán chưa giao')}</th><th scope="col" className="right">{uiText('Tồn dự kiến')}</th><th scope="col" className="right">{uiText('Đơn mua chờ nhận')}</th><th scope="col" className="right">{uiText('Đề nghị mua mở')}</th><th scope="col" className="right">{uiText('Tối thiểu')}</th><th scope="col" className="right">{uiText('Mục tiêu')}</th><th scope="col" className="right">{uiText('Đề xuất mua')}</th></tr></thead>
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
