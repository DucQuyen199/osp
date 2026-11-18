import React, { useMemo, useState } from 'react';
import { fmtDate, statusLabel, uiText } from '../../lib/i18n.js';
import { app, can, recordLabel } from '../../lib/state.js';
import { recordHref } from '../../lib/routes.js';
import StockCountLinesEditor from './components/StockCountLinesEditor.jsx';
import { useStockCountData } from './hooks/useStockCountData.js';
import { useStockCountWorkflow } from './hooks/useStockCountWorkflow.js';

export default function InventoryStockCountWorkbenchPage() {
  const workflowApproval = app.meta?.modules?.some((module) => module.id === 'workflow-approval') || false;
  const { counts, warehouses, products, units, lots, locations, approvalRequests, loading, error, setError, load } = useStockCountData(workflowApproval);
  const {
    selectedId, selected, editable, warehouse, setWarehouse, reason, setReason, note, setNote, lines,
    busy, notice, startNew, openCount, changeWarehouse, updateLine, addLine, removeLine,
    saveOnly, saveAndSubmit, decide, cancel,
  } = useStockCountWorkflow({ counts, products, load, setError });
  const [productSearch, setProductSearch] = useState('');
  const [productSuggestionLimit, setProductSuggestionLimit] = useState(100);
  const productRows = useMemo(() => [...products.values()].filter((row) => row.active !== false && row.kind !== 'service' && row.kind !== 'digital'), [products]);
  const unitForProduct = (productId) => {
    const product = products.get(productId);
    return units.get(product?.uom)?.name || (product?.uom ? uiText('đơn vị gốc') : uiText('chưa đặt đơn vị'));
  };
  const matchingProductRows = useMemo(() => productRows.filter((row) => {
    const search = productSearch.trim().toLocaleLowerCase();
    return !search || `${row.sku || ''} ${row.name || ''}`.toLocaleLowerCase().includes(search);
  }), [productRows, productSearch]);
  const matchingProducts = useMemo(() => matchingProductRows.slice(0, productSuggestionLimit), [matchingProductRows, productSuggestionLimit]);
  const approvalFor = (row) => approvalRequests.find((request) => request.entity === 'inventory.stock_count' && request.record_id === row.id);
  function beginNewCount() {
    startNew(); setProductSearch(''); setProductSuggestionLimit(100);
  }
  function selectCount(row) {
    openCount(row); setProductSearch(''); setProductSuggestionLimit(100);
  }

  return <div className="page">
    <div className="page-head"><div><h1>{uiText('Kiểm kê kho')}</h1><p className="sub">{uiText('Ghi số lượng theo đơn vị gốc của sản phẩm, lô và vị trí. Số tồn sổ được chụp khi gửi duyệt; chỉ khi phê duyệt, phần chênh lệch mới tạo biến động kho.')}</p></div><div className="row"><button className="btn btn-secondary" disabled={loading || Boolean(busy)} onClick={load}>{uiText('Làm mới')}</button>{can('inventory.stock_count.create') && <button className="btn btn-primary" disabled={Boolean(busy)} onClick={beginNewCount}>{uiText('Phiếu kiểm kê mới')}</button>}</div></div>
    {error && <div className="alert error" role="alert">{uiText(error)}</div>}{notice && <div className="alert success" role="status">{uiText(notice)}</div>}
    <div className="grid-2 u-align-start" >
      <section className="card card-pad"><div className="row"><h2>{uiText('Phiếu kiểm kê')}</h2><span className="grow"/><span className="small muted">{counts.length} {uiText('phiếu')}</span></div>
        {loading ? <p className="muted">{uiText('Đang tải phiếu kiểm kê…')}</p> : !counts.length ? <div className="empty"><p>{uiText('Chưa có phiếu kiểm kê.')}</p></div> : <div className="stack-sm u-mt-10" >{counts.map((row) => <button key={row.id} className={[`card-pad row wrap ${selectedId === row.id ? 'selected' : ''}`, 'u-full-width-left'].filter(Boolean).join(' ')}  onClick={() => selectCount(row)}><span><strong>{warehouses.get(row.warehouse)?.name || uiText('Kho')}</strong><br/><span className="small muted">{statusLabel(row.reason || 'cycle_count')} · {fmtDate(row.updated_at || row.created_at)}</span></span><span className="grow"/><span className={`badge ${row.status === 'approved' ? 'success' : row.status === 'rejected' || row.status === 'cancelled' ? 'danger' : row.status === 'submitted' ? 'warning' : ''}`}>{statusLabel(row.status)}</span></button>)}</div>}
      </section>

      <section className="card card-pad"><div className="row wrap"><div><h2>{selected ? `${uiText('Kiểm kê')} ${warehouses.get(selected.warehouse)?.name || ''}` : uiText('Bắt đầu kiểm kê')}</h2><span className="small muted">{selected ? `${uiText('Mã')} ${String(selected.id).slice(0, 8)}` : uiText('Bản nháp chưa ảnh hưởng đến tồn kho.')}</span></div><span className="grow"/>{selected && <a className="small" href={recordHref('inventory.stock_count', selected.id)}>{uiText('Mở chứng từ')}</a>}</div>
        {(!selected || editable) && <form onSubmit={saveOnly}>
          <div className="form-grid u-mt-12" >
            <label className="field"><span className="label">{uiText('Kho')} *</span><select className="select" required value={warehouse} onChange={(e) => changeWarehouse(e.target.value)} disabled={Boolean(selected)}><option value="">{uiText('Chọn kho')}</option>{[...warehouses.values()].map((row) => <option key={row.id} value={row.id}>{recordLabel('inventory.warehouse', row)}</option>)}</select></label>
            <label className="field"><span className="label">{uiText('Loại kiểm kê')} *</span><select className="select" value={reason} onChange={(e) => setReason(e.target.value)}><option value="cycle_count">{uiText('Kiểm kê định kỳ')}</option><option value="correction">{uiText('Điều chỉnh sai lệch')}</option><option value="damage">{uiText('Hư hỏng / mất mát')}</option><option value="opening_balance">{uiText('Số dư đầu kỳ')}</option></select></label>
            <label className="field full"><span className="label">{uiText('Ghi chú')}</span><input className="input" maxLength="500" value={note} onChange={(e) => setNote(e.target.value)} placeholder={uiText('Phạm vi, khu vực hoặc lý do kiểm kê')}/></label>
          </div>
          <StockCountLinesEditor lines={lines} matchingProducts={matchingProducts} totalProductMatches={matchingProductRows.length} onShowMoreProducts={() => setProductSuggestionLimit((limit) => limit + 100)} products={products} units={units} lots={lots} locations={locations} warehouse={warehouse} productSearch={productSearch} onProductSearchChange={(value) => { setProductSearch(value); setProductSuggestionLimit(100); }} onAddLine={addLine} onUpdateLine={updateLine} onRemoveLine={removeLine} unitForProduct={unitForProduct} />
          <div className="row wrap u-mt-12" ><span className="small muted">{uiText('Số tồn sổ được giữ kín trong lúc đếm để giảm sai lệch do thiên kiến. Backend sẽ chụp tồn kho và tính chênh lệch khi gửi duyệt.')}</span><span className="grow"/><button className="btn btn-secondary" type="submit" disabled={Boolean(busy) || !can('inventory.stock_count.create') || (selected && !can('inventory.stock_count.update'))}>{uiText('Lưu nháp')}</button><button className="btn btn-primary" type="button" disabled={Boolean(busy) || !can('inventory.stock_count.submitted') || (selected && !can('inventory.stock_count.update'))} onClick={saveAndSubmit}>{busy === 'submit' ? uiText('Đang chốt số đếm…') : uiText('Lưu và gửi duyệt')}</button></div>
        </form>}

        {selected && selected.status === 'submitted' && workflowApproval && approvalFor(selected) && <p className="small muted u-mt-12" >{uiText('Yêu cầu duyệt')}: <a href={recordHref('workflow-approval.approval_request', approvalFor(selected).id)}>{statusLabel(approvalFor(selected).status)} · {uiText('mở yêu cầu')}</a></p>}
        {selected && selected.status === 'submitted' && !workflowApproval && <div className="row wrap u-mt-12" >{can('inventory.stock_count.approved') && <button className="btn btn-primary" disabled={Boolean(busy)} onClick={() => decide(selected, 'approved')}>{uiText('Duyệt và điều chỉnh tồn')}</button>}{can('inventory.stock_count.rejected') && <button className="btn btn-secondary" disabled={Boolean(busy)} onClick={() => decide(selected, 'rejected')}>{uiText('Từ chối')}</button>}</div>}
        {selected && ['draft', 'rejected'].includes(selected.status) && can('inventory.stock_count.cancelled') && <button className="btn btn-ghost btn-sm u-mt-10"  disabled={Boolean(busy)} onClick={() => cancel(selected)}>{uiText('Hủy phiếu')}</button>}
        {selected && ['submitted', 'approved'].includes(selected.status) && <div className="table-wrap u-mt-16" ><h3>{uiText('Số đếm và chênh lệch')}</h3><table className="table"><thead><tr><th>{uiText('Sản phẩm')}</th><th>{uiText('Lô / vị trí')}</th><th className="right">{uiText('Thực tế (đơn vị gốc)')}</th><th className="right">{uiText('Theo sổ (đơn vị gốc)')}</th><th className="right">{uiText('Chênh lệch (đơn vị gốc)')}</th></tr></thead><tbody>{(selected.adjustment_lines || []).map((line, index) => <tr key={`${line.product}-${line.lot || ''}-${line.location || ''}-${index}`}><td>{products.get(line.product) ? recordLabel('master-data.product', products.get(line.product)) : String(line.product || '').slice(0, 8)}</td><td>{line.lot ? lots.get(line.lot)?.code || String(line.lot).slice(0, 8) : '—'}{line.location ? ` · ${locations.get(line.location)?.code || String(line.location).slice(0, 8)}` : ''}</td><td className="right">{line.counted_qty} {unitForProduct(line.product)}</td><td className="right">{line.expected_qty ?? '—'} {unitForProduct(line.product)}</td><td className="right"><strong>{line.variance_qty ?? '—'} {unitForProduct(line.product)}</strong></td></tr>)}</tbody></table></div>}
        {selected?.status === 'approved' && <p className="small muted u-mt-10" >{uiText('Đã duyệt')} {fmtDate(selected.updated_at)}. {uiText('Chênh lệch đã chuyển thành biến động kho theo FIFO/lô và vị trí tương ứng.')}</p>}
      </section>
    </div>
  </div>;
}
