import React, { useMemo, useState } from 'react';
import { useDocumentTitle } from '../../lib/useDocumentTitle.js';
import { fmtDateTime, statusLabel, uiText } from '../../lib/i18n.js';
import { can, recordLabel } from '../../lib/state.js';
import { useQualityWorkbenchData } from './hooks/useQualityWorkbenchData.js';
import { useQualityWorkbenchWorkflow } from './hooks/useQualityWorkbenchWorkflow.js';
import QualityNonconformanceTable from './components/QualityNonconformanceTable.jsx';
export default function QualityWorkbenchPage() {
  useDocumentTitle(`${uiText('Sổ sự không phù hợp')} · OSP Suite`);
  const severityLabels = { minor: uiText('Nhẹ'), major: uiText('Nghiêm trọng'), critical: uiText('Tới hạn') };
  const { records, inspections, products, loading, error: loadError, setError: setLoadError, load } = useQualityWorkbenchData();
  const [filter, setFilter] = useState('open');
  const workflow = useQualityWorkbenchWorkflow({ load, clearLoadError: () => setLoadError('') });
  const { form, setForm, busy, error: workflowError, notice, create, close } = workflow;
  const error = loadError || workflowError;
  const visible = useMemo(() => records.filter((record) => filter === 'all' || record.status === filter), [records, filter]);
  const openCount = records.filter((record) => record.status === 'open').length;
  const criticalCount = records.filter((record) => record.status === 'open' && record.severity === 'critical').length;
  return <div className="page">
    <div className="page-head"><div><h1>{uiText('Sổ sự không phù hợp')}</h1><p className="sub">{uiText('Theo dõi nguyên nhân, mức độ và trạng thái xử lý của các vấn đề chất lượng; NCR từ phiếu QC không đạt được ghi nhận tự động.')}</p></div><button className="btn btn-secondary" type="button" disabled={loading || Boolean(busy)} onClick={() => load()}>{uiText('Làm mới')}</button></div>
    {error && <div className="alert danger" role="alert">{uiText(error)}</div>}{notice && <div className="alert success" role="status">{uiText(notice)}</div>}
    <div className="stats u-mb-16" ><div className="card stat"><span className="stat-label">{uiText('NCR đang mở')}</span><strong className="stat-value">{openCount}</strong></div><div className="card stat"><span className="stat-label">{uiText('NCR tới hạn đang mở')}</span><strong className="stat-value">{criticalCount}</strong></div><div className="card stat"><span className="stat-label">{uiText('Tổng hồ sơ')}</span><strong className="stat-value">{records.length}</strong></div></div>
    {can('quality.nonconformance.create') && <section className="card card-pad"><h2>{uiText('Ghi nhận vấn đề chất lượng')}</h2><form className="form-grid" onSubmit={create}>
      <label className="field"><span className="label">{uiText('Tiêu đề')} *</span><input className="input" required maxLength="240" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })}/></label>
      <label className="field"><span className="label">{uiText('Mức độ')}</span><select className="select" value={form.severity} onChange={(event) => setForm({ ...form, severity: event.target.value })}><option value="minor">{uiText('Nhẹ')}</option><option value="major">{uiText('Nghiêm trọng')}</option><option value="critical">{uiText('Tới hạn')}</option></select></label>
      {can('quality.inspection.read') && <label className="field"><span className="label">{uiText('Phiếu kiểm tra liên quan')}</span><select className="select" value={form.inspection} onChange={(event) => setForm({ ...form, inspection: event.target.value })}><option value="">{uiText('Không gắn phiếu kiểm tra')}</option>{[...inspections.values()].map((inspection) => <option key={inspection.id} value={inspection.id}>{products.get(inspection.product)?.name || uiText('Sản phẩm')} · {statusLabel(inspection.status)} · {fmtDateTime(inspection.createdAt)}</option>)}</select></label>}
      <label className="field full"><span className="label">{uiText('Mô tả / nguyên nhân')}</span><textarea className="input" rows="3" maxLength="10000" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })}/></label>
      <div className="row full"><span className="grow"/><button className="btn btn-primary" disabled={Boolean(busy)}>{uiText('Ghi nhận NCR')}</button></div>
    </form></section>}
    {!can('quality.nonconformance.read') ? <div className="empty">{uiText('Bạn chưa có quyền xem hồ sơ NCR.')}</div> : loading ? <div className="skeleton" data-h="row"/> : <section className="card card-pad u-mt-16" >
      <div className="row wrap"><div><h2>{uiText('Danh sách NCR')}</h2><p className="small muted">{uiText('NCR được tạo khi phiếu kiểm tra chuyển sang không đạt và đóng tự động khi phiếu được thông qua.')}</p></div><span className="grow"/><label className="field"><span className="label">{uiText('Lọc trạng thái')}</span><select className="select" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="open">{uiText('Đang mở')}</option><option value="closed">{uiText('Đã đóng')}</option><option value="all">{uiText('Tất cả')}</option></select></label></div>
      {!visible.length ? <div className="empty">{uiText('Không có hồ sơ NCR trong bộ lọc này.')}</div> : <QualityNonconformanceTable records={visible} inspections={inspections} products={products} severityLabels={severityLabels} busy={busy} canClose={can('quality.nonconformance.closed')} fmtDateTime={fmtDateTime} statusLabel={statusLabel} recordLabel={recordLabel} uiText={uiText} onClose={close} />}
    </section>}
  </div>;
}
