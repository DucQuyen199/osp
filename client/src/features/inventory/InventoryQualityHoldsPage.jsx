import React, { useCallback, useEffect, useState } from 'react';
import { api, dataPath, tenantPath } from '../../lib/api.js';
import { fmtMoney, fmtNumber } from '../../lib/i18n.js';
import { can, loadRefs } from '../../lib/state.js';

const quantity = (value) => fmtNumber(Number(value || 0), { maximumFractionDigits: 3 });
const unitName = (item) => item.unit || 'Chưa đặt đơn vị';
const statusLabel = (value) => value === 'failed' ? 'Không đạt' : 'Chờ kiểm tra';
const sourceLabel = (value) => value === 'purchase_receipt' ? 'Phiếu nhận mua' : value === 'purchase_order' ? 'Đơn mua' : value;

export default function InventoryQualityHoldsPage() {
  const [warehouses, setWarehouses] = useState(new Map());
  const [warehouse, setWarehouse] = useState('');
  const [status, setStatus] = useState('all');
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState('');
  const [notes, setNotes] = useState({});
  const [releaseDrafts, setReleaseDrafts] = useState({});

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

  const decide = async (item, action) => {
    setBusy(`${item.inspectionId}:${action}`); setError('');
    try {
      if (action === 'failed') {
        const note = notes[item.inspectionId]?.trim() || '';
        if (note.length < 5) throw new Error('Nhập mô tả lỗi QC từ 5 ký tự trở lên.');
        await api(dataPath('quality.inspection', item.inspectionId), { method: 'PATCH', body: { note } });
      }
      await api(dataPath('quality.inspection', item.inspectionId, action), { method: 'POST' });
      await load();
    } catch (reason) { setError(reason.message || 'Không cập nhật được phiếu QC.'); }
    finally { setBusy(''); }
  };
  const releasePartial = async (item) => {
    const draft = releaseDrafts[item.inspectionId] || {};
    setBusy(`${item.inspectionId}:release`); setError('');
    try {
      const note = draft.note?.trim() || '';
      const releaseQty = Number(draft.qty);
      if (!note || !Number.isFinite(releaseQty) || releaseQty <= 0) throw new Error('Nhập số lượng và lý do giải phóng hợp lệ.');
      const disposition = await api(dataPath('quality.inspection_disposition'), { method: 'POST', body: { inspection: item.inspectionId, qty: releaseQty, note } });
      await api(dataPath('quality.inspection_disposition', disposition.id, 'posted'), { method: 'POST' });
      await load();
    } catch (reason) { setError(reason.message || 'Không giải phóng được một phần lô hàng.'); }
    finally { setBusy(''); }
  };

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
        <div className="card stat"><span className="stat-label">Phiếu kiểm tra còn giữ hàng</span><strong className="stat-value num">{fmtNumber(Number(report.itemCount || 0))}</strong></div>
        <div className="card stat"><span className="stat-label">Số lượng đang giữ theo đơn vị gốc</span><strong className="stat-value num">{report.heldQtyByUnit?.length ? report.heldQtyByUnit.map((row) => `${quantity(row.qty)} ${row.unit}`).join(' · ') : '0'}</strong></div>
        <div className="card stat"><span className="stat-label">Giá trị đang giữ</span><strong className="stat-value num">{fmtMoney(report.heldValue)}</strong></div>
      </div>
      {!report.items?.length ? <div className="empty"><h2>Không có hàng tồn đang giữ QC</h2><p>Các phiếu chờ kiểm tra hoặc không đạt đã được xử lý.</p></div> : <div className="card table-wrap"><table className="table">
        <thead><tr><th scope="col">Trạng thái</th><th scope="col">Sản phẩm</th><th scope="col">Kho</th><th scope="col">Lô</th><th scope="col">Nguồn / lớp nhập</th><th scope="col" className="right">Đang giữ (đơn vị gốc)</th><th scope="col" className="right">Đơn giá / đơn vị gốc</th><th scope="col" className="right">Giá trị</th><th scope="col" className="right">Số ngày</th><th scope="col">Thao tác QC</th></tr></thead>
        <tbody>{report.items.map((item) => <tr key={item.inspectionId}>
          <td><span className={`badge ${item.inspectionStatus === 'failed' ? 'danger' : 'warning'}`}>{statusLabel(item.inspectionStatus)}</span></td>
          <td><span className="mono">{item.sku || '—'}</span><br />{item.product}</td><td>{item.warehouse}</td><td>{item.lotCode || 'Không gán lô'}</td>
          <td>{sourceLabel(item.source)}<br /><span className="faint mono">{item.layerId || item.sourceId}</span></td>
          <td className="right">{quantity(item.heldQty)} {unitName(item)}</td><td className="right money">{fmtMoney(item.unitCost)} / {unitName(item)}</td><td className="right money">{fmtMoney(item.heldValue)}</td><td className="right">{quantity(item.daysHeld)}</td>
          <td><div className="quality-hold-actions">
            {item.inspectionStatus === 'pending' && can('quality.inspection.passed') && <button className="btn btn-primary btn-sm" type="button" disabled={Boolean(busy)} onClick={() => decide(item, 'passed')}>Đạt, nhập kho</button>}
            {item.inspectionStatus === 'pending' && can('quality.inspection.failed') && can('quality.inspection.update') && <>
              <input className="input" aria-label="Mô tả lỗi QC" placeholder="Mô tả lỗi QC" minLength={5} maxLength={500} value={notes[item.inspectionId] || ''} onChange={(event) => setNotes((rows) => ({ ...rows, [item.inspectionId]: event.target.value }))} />
              <button className="btn btn-ghost btn-sm" type="button" disabled={Boolean(busy) || (notes[item.inspectionId] || '').trim().length < 5} onClick={() => decide(item, 'failed')}>Không đạt</button>
            </>}
            {item.inspectionStatus === 'failed' && can('quality.inspection.retest') && <button className="btn btn-ghost btn-sm" type="button" disabled={Boolean(busy)} onClick={() => decide(item, 'retest')}>Kiểm tra lại</button>}
            {item.inspectionStatus === 'pending' && can('quality.inspection_disposition.create') && can('quality.inspection_disposition.posted') && <div className="quality-partial-release">
              <label className="field"><span className="small muted">Số lượng giải phóng ({unitName(item)})</span><input className="input" aria-label={`Số lượng giải phóng (${unitName(item)})`} type="number" min="0.001" max={item.heldQty} step="any" placeholder={`Tối đa ${quantity(item.heldQty)} ${unitName(item)}`} value={releaseDrafts[item.inspectionId]?.qty || ''} onChange={(event) => setReleaseDrafts((rows) => ({ ...rows, [item.inspectionId]: { ...rows[item.inspectionId], qty: event.target.value } }))} /></label>
              <input className="input" aria-label="Lý do giải phóng một phần" placeholder="Lý do giải phóng" maxLength={500} value={releaseDrafts[item.inspectionId]?.note || ''} onChange={(event) => setReleaseDrafts((rows) => ({ ...rows, [item.inspectionId]: { ...rows[item.inspectionId], note: event.target.value } }))} />
              <button className="btn btn-ghost btn-sm" type="button" disabled={Boolean(busy) || !releaseDrafts[item.inspectionId]?.note?.trim() || !(Number(releaseDrafts[item.inspectionId]?.qty) > 0)} onClick={() => releasePartial(item)}>Giải phóng một phần</button>
            </div>}
          </div></td>
        </tr>)}</tbody>
      </table></div>}
    </div>}
  </div>;
}
