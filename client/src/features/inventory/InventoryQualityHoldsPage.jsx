import React, { useCallback, useEffect, useState } from 'react';
import { useDocumentTitle } from '../../lib/useDocumentTitle.js';
import { useLatestRequest } from '../../lib/useLatestRequest.js';
import { api, dataPath, tenantPath } from '../../lib/api.js';
import { fmtMoney, fmtNumber, uiText } from '../../lib/i18n.js';
import { compareDecimals } from '../../lib/decimal.js';
import { can, loadRefs } from '../../lib/state.js';
const quantity = (value) => fmtNumber(String(value || 0), { maximumFractionDigits: 3 });
const validReleaseQuantity = (qty, maximum) => { try { return compareDecimals(qty || 0, 0) > 0 && compareDecimals(qty, maximum) <= 0; } catch { return false; } };
const unitName = (item) => item.unit || uiText('Chưa đặt đơn vị');
const statusLabel = (value) => uiText(value === 'failed' ? 'Không đạt' : 'Chờ kiểm tra');
const sourceLabel = (value) => uiText(value === 'purchase_receipt' ? 'Phiếu nhận mua' : value === 'purchase_order' ? 'Đơn mua' : value);
export default function InventoryQualityHoldsPage() {
  useDocumentTitle(`${uiText('Hàng tồn đang giữ QC')} · OSP Suite`);
  const [warehouses, setWarehouses] = useState(new Map());
  const [warehouse, setWarehouse] = useState('');
  const [status, setStatus] = useState('all');
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState('');
  const [notes, setNotes] = useState({});
  const [releaseDrafts, setReleaseDrafts] = useState({});
  const latestRequest = useLatestRequest();
  useEffect(() => {
    let active = true;
    if (!can('inventory.warehouse.read')) {
      setWarehouses(new Map());
      return () => { active = false; };
    }
    loadRefs('inventory.warehouse')
      .then((rows) => { if (active) setWarehouses(rows); })
      .catch(() => { if (active) setWarehouses(new Map()); });
    return () => { active = false; };
  }, []);
  const load = useCallback(async () => {
    const isLatest = latestRequest();
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ status });
      if (warehouse) params.set('warehouse', warehouse);
      const nextReport = await api(`${tenantPath('/reports/inventory/quality-holds')}?${params}`);
      if (isLatest()) setReport(nextReport);
    } catch (reason) {
      if (isLatest()) {
        setReport(null);
        setError(reason.message || uiText('Không tải được hàng tồn đang giữ QC.'));
      }
    } finally {
      if (isLatest()) setLoading(false);
    }
  }, [status, warehouse, latestRequest]);
  useEffect(() => { load(); }, [load]);
  const decide = async (item, action) => {
    setBusy(`${item.inspectionId}:${action}`); setError('');
    try {
      if (action === 'failed') {
        const note = notes[item.inspectionId]?.trim() || '';
        if (note.length < 5) throw new Error(uiText('Nhập mô tả lỗi QC từ 5 ký tự trở lên.'));
        await api(dataPath('quality.inspection', item.inspectionId), { method: 'PATCH', body: { note } });
      }
      await api(dataPath('quality.inspection', item.inspectionId, action), { method: 'POST' });
      await load();
    } catch (reason) { setError(reason.message || uiText('Không cập nhật được phiếu QC.')); }
    finally { setBusy(''); }
  };
  const releasePartial = async (item) => {
    const draft = releaseDrafts[item.inspectionId] || {};
    setBusy(`${item.inspectionId}:release`); setError('');
    try {
      const note = draft.note?.trim() || '';
      const releaseQty = String(draft.qty || '');
      if (!note || !validReleaseQuantity(releaseQty, item.heldQty)) throw new Error(uiText('Nhập số lượng và lý do giải phóng hợp lệ.'));
      const disposition = await api(dataPath('quality.inspection_disposition'), { method: 'POST', body: { inspection: item.inspectionId, qty: releaseQty, note } });
      await api(dataPath('quality.inspection_disposition', disposition.id, 'posted'), { method: 'POST' });
      await load();
    } catch (reason) { setError(reason.message || uiText('Không giải phóng được một phần lô hàng.')); }
    finally { setBusy(''); }
  };
  return <div className="page">
    <div className="page-head"><div><h1>{uiText('Hàng tồn đang giữ QC')}</h1><p className="sub">{uiText('Theo dõi số lượng và giá trị còn bị giữ theo phiếu kiểm tra, lô và lớp nhập kho.')}</p></div></div>
    <section className="card"><form className="toolbar" onSubmit={(event) => { event.preventDefault(); load(); }}>
      <label className="field"><span className="label">{uiText('Kho')}</span><select className="select" value={warehouse} onChange={(event) => setWarehouse(event.target.value)}>
        <option value="">{uiText('Tất cả kho')}</option>
        {[...warehouses.values()].map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
      <label className="field"><span className="label">{uiText('Trạng thái QC')}</span><select className="select" value={status} onChange={(event) => setStatus(event.target.value)}>
        <option value="all">{uiText('Chờ kiểm tra và không đạt')}</option><option value="pending">{uiText('Chờ kiểm tra')}</option><option value="failed">{uiText('Không đạt')}</option>
      </select></label>
      <button className="btn btn-primary" type="submit" disabled={loading}>{loading ? uiText('Đang tải…') : uiText('Làm mới')}</button>
    </form></section>
    {error && <div className="alert danger" role="alert">{uiText(error)}</div>}
    {loading && !report ? <div className="card-pad"><div className="skeleton" data-h="row" /></div> : report && <div className="stack">
      <div className="stats">
        <div className="card stat"><span className="stat-label">{uiText('Phiếu kiểm tra còn giữ hàng')}</span><strong className="stat-value num">{fmtNumber(Number(report.itemCount || 0))}</strong></div>
        <div className="card stat"><span className="stat-label">{uiText('Số lượng đang giữ theo đơn vị gốc')}</span><strong className="stat-value num">{report.heldQtyByUnit?.length ? report.heldQtyByUnit.map((row) => `${quantity(row.qty)} ${row.unit}`).join(' · ') : '0'}</strong></div>
        <div className="card stat"><span className="stat-label">{uiText('Giá trị đang giữ')}</span><strong className="stat-value num">{fmtMoney(report.heldValue)}</strong></div>
      </div>
      {!report.items?.length ? <div className="empty"><h2>{uiText('Không có hàng tồn đang giữ QC')}</h2><p>{uiText('Các phiếu chờ kiểm tra hoặc không đạt đã được xử lý.')}</p></div> : <div className="card table-wrap"><table className="table">
        <thead><tr><th scope="col">{uiText('Trạng thái')}</th><th scope="col">{uiText('Sản phẩm')}</th><th scope="col">{uiText('Kho')}</th><th scope="col">{uiText('Lô')}</th><th scope="col">{uiText('Nguồn / lớp nhập')}</th><th scope="col" className="right">{uiText('Đang giữ (đơn vị gốc)')}</th><th scope="col" className="right">{uiText('Đơn giá / đơn vị gốc')}</th><th scope="col" className="right">{uiText('Giá trị')}</th><th scope="col" className="right">{uiText('Số ngày')}</th><th scope="col">{uiText('Thao tác QC')}</th></tr></thead>
        <tbody>{report.items.map((item) => <tr key={item.inspectionId}>
          <td><span className={`badge ${item.inspectionStatus === 'failed' ? 'danger' : 'warning'}`}>{statusLabel(item.inspectionStatus)}</span></td>
          <td><span className="mono">{item.sku || '—'}</span><br />{item.product}</td><td>{item.warehouse}</td><td>{item.lotCode || uiText('Không gán lô')}</td>
          <td>{sourceLabel(item.source)}<br /><span className="faint mono">{item.layerId || item.sourceId}</span></td>
          <td className="right">{quantity(item.heldQty)} {unitName(item)}</td><td className="right money">{fmtMoney(item.unitCost)} / {unitName(item)}</td><td className="right money">{fmtMoney(item.heldValue)}</td><td className="right">{quantity(item.daysHeld)}</td>
          <td><div className="quality-hold-actions">
            {item.inspectionStatus === 'pending' && can('quality.inspection.passed') && <button className="btn btn-primary btn-sm" type="button" disabled={Boolean(busy)} onClick={() => decide(item, 'passed')}>{uiText('Đạt, nhập kho')}</button>}
            {item.inspectionStatus === 'pending' && can('quality.inspection.failed') && can('quality.inspection.update') && <>
              <input className="input" aria-label={uiText('Mô tả lỗi QC')} placeholder={uiText('Mô tả lỗi QC')} minLength={5} maxLength={500} value={notes[item.inspectionId] || ''} onChange={(event) => setNotes((rows) => ({ ...rows, [item.inspectionId]: event.target.value }))} />
              <button className="btn btn-ghost btn-sm" type="button" disabled={Boolean(busy) || (notes[item.inspectionId] || '').trim().length < 5} onClick={() => decide(item, 'failed')}>{uiText('Không đạt')}</button>
            </>}
            {item.inspectionStatus === 'failed' && can('quality.inspection.retest') && <button className="btn btn-ghost btn-sm" type="button" disabled={Boolean(busy)} onClick={() => decide(item, 'retest')}>{uiText('Kiểm tra lại')}</button>}
            {item.inspectionStatus === 'pending' && can('quality.inspection_disposition.create') && can('quality.inspection_disposition.posted') && <div className="quality-partial-release">
              <label className="field"><span className="small muted">{uiText('Số lượng giải phóng')} ({unitName(item)})</span><input className="input" aria-label={`${uiText('Số lượng giải phóng')} (${unitName(item)})`} type="number" min="0.001" max={item.heldQty} step="any" placeholder={`${uiText('Tối đa')} ${quantity(item.heldQty)} ${unitName(item)}`} value={releaseDrafts[item.inspectionId]?.qty || ''} onChange={(event) => setReleaseDrafts((rows) => ({ ...rows, [item.inspectionId]: { ...rows[item.inspectionId], qty: event.target.value } }))} /></label>
              <input className="input" aria-label={uiText('Lý do giải phóng một phần')} placeholder={uiText('Lý do giải phóng')} maxLength={500} value={releaseDrafts[item.inspectionId]?.note || ''} onChange={(event) => setReleaseDrafts((rows) => ({ ...rows, [item.inspectionId]: { ...rows[item.inspectionId], note: event.target.value } }))} />
              <button className="btn btn-ghost btn-sm" type="button" disabled={Boolean(busy) || !releaseDrafts[item.inspectionId]?.note?.trim() || !validReleaseQuantity(releaseDrafts[item.inspectionId]?.qty, item.heldQty)} onClick={() => releasePartial(item)}>{uiText('Giải phóng một phần')}</button>
            </div>}
          </div></td>
        </tr>)}</tbody>
      </table></div>}
    </div>}
  </div>;
}
