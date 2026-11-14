import React, { useCallback, useEffect, useState } from 'react';
import { api, dataPath, tenantPath } from './lib/api.js';
import { fmtNumber } from './lib/i18n.js';
import { app, can } from './lib/state.js';

const asItems = (value) => Array.isArray(value?.items) ? value.items : [];
const label = (value) => String(value ?? '—');

function downloadBlob(blob, filename) {
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(href), 1000);
}

function DataTable({ items }) {
  const columns = items.length ? Object.keys(items[0]).filter((key) => !['id', 'tenantId', 'createdAt', 'updatedAt'].includes(key)) : [];
  if (!items.length) return <div className="empty"><h3>Chưa có dữ liệu</h3><p>Truy vấn đã lưu không trả về bản ghi nào.</p></div>;
  return <div className="table-wrap"><table className="table"><thead><tr>{columns.map((key) => <th scope="col" key={key}>{key}</th>)}</tr></thead>
    <tbody>{items.map((item, index) => <tr key={item.id || index}>{columns.map((key) => <td key={key} className={typeof item[key] === 'number' ? 'right num' : ''}>{typeof item[key] === 'number' ? fmtNumber(item[key]) : label(item[key])}</td>)}</tr>)}</tbody>
  </table></div>;
}

function Widget({ widget }) {
  const isKpi = widget.type === 'kpi';
  const resourceId = isKpi ? widget.kpi : widget.report;
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    api(tenantPath(isKpi
      ? `/reports/bi/kpis/${encodeURIComponent(resourceId)}`
      : `/reports/bi/${encodeURIComponent(resourceId)}`))
      .then((data) => { if (active) setResult(data); })
      .catch((reason) => { if (active) setError(reason.message || 'Không tải được báo cáo.'); });
    return () => { active = false; };
  }, [isKpi, resourceId]);
  if (error) return <div className="alert danger" role="alert">{error}</div>;
  if (!result) return <div className="skeleton" data-h="row" />;
  if (isKpi) return <div className="stat"><span className="stat-label">{result.name}</span><strong className="stat-value num">{fmtNumber(result.value)}</strong><span className="small">Target: {result.target == null ? '—' : fmtNumber(result.target)}{result.attainmentPercent == null ? '' : ` · ${fmtNumber(result.attainmentPercent)}%`}</span></div>;
  const items = asItems(result);
  if (widget.type === 'table') return <DataTable items={items} />;
  if (widget.type === 'number') return <div className="stat"><span className="stat-label">{result.name}</span><strong className="stat-value num">{fmtNumber(Number(items[0]?.value) || 0)}</strong></div>;
  const max = Math.max(1, ...items.map((item) => Math.abs(Number(item.value) || 0)));
  if (!items.length) return <div className="empty"><p>Chưa có dữ liệu cho biểu đồ.</p></div>;
  if (widget.type === 'pie') {
    const total = items.reduce((sum, item) => sum + Math.max(0, Number(item.value) || 0), 0) || 1;
    let cursor = 0;
    const colors = ['#2563eb', '#16a34a', '#f59e0b', '#9333ea', '#dc2626', '#0891b2', '#64748b'];
    const stops = items.map((item, index) => {
      const start = cursor;
      cursor += Math.max(0, Number(item.value) || 0) / total * 100;
      return `${colors[index % colors.length]} ${start}% ${cursor}%`;
    });
    return <div className="bi-pie-wrap"><div className="bi-pie" role="img" aria-label={`${result.name}: ${items.length} nhóm`} style={{ background: `conic-gradient(${stops.join(', ')})` }} />
      <ul className="bi-legend">{items.map((item, index) => <li key={`${item.group}:${index}`}><span className="bi-swatch" style={{ background: colors[index % colors.length] }} />{label(item.group)} <strong>{fmtNumber(Number(item.value) || 0)}</strong></li>)}</ul></div>;
  }
  if (widget.type === 'line') {
    const points = items.map((item, index) => `${items.length < 2 ? 50 : 8 + index / (items.length - 1) * 84},${90 - (Number(item.value) || 0) / max * 76}`).join(' ');
    return <div className="bi-line-chart"><svg viewBox="0 0 100 100" role="img" aria-label={`${result.name}: biểu đồ đường`} preserveAspectRatio="none"><line x1="8" y1="90" x2="92" y2="90" className="bi-axis" /><polyline points={points} className="bi-line" />{items.map((item, index) => <circle key={`${item.group}:${index}`} cx={items.length < 2 ? 50 : 8 + index / (items.length - 1) * 84} cy={90 - (Number(item.value) || 0) / max * 76} r="1.6" className="bi-point"><title>{label(item.group)}: {fmtNumber(Number(item.value) || 0)}</title></circle>)}</svg><div className="bi-line-labels">{items.map((item, index) => <span key={`${item.group}:${index}`} title={label(item.group)}>{label(item.group)}</span>)}</div></div>;
  }
  return <div className="bi-bars" role="list" aria-label={result.name}>{items.map((item, index) => <div className="bi-bar-row" role="listitem" key={`${item.group}:${index}`}>
    <span title={label(item.group)}>{label(item.group)}</span><div className="bi-bar-track"><div className="bi-bar-fill" style={{ width: `${Math.max(2, Math.abs(Number(item.value) || 0) / max * 100)}%` }} /></div><strong className="num">{fmtNumber(Number(item.value) || 0)}</strong>
  </div>)}</div>;
}

function KpiCard({ kpi }) {
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    api(tenantPath(`/reports/bi/kpis/${encodeURIComponent(kpi.id)}`))
      .then((data) => { if (active) setResult(data); })
      .catch((reason) => { if (active) setError(reason.message || 'KPI could not be evaluated.'); });
    return () => { active = false; };
  }, [kpi.id]);
  return <article className="card bi-link-card">
    <strong>{kpi.name}</strong>
    {error ? <span className="small danger-text">{error}</span> : result
      ? <><span className="stat-value num">{fmtNumber(result.value)}</span><span className="small">Target: {result.target == null ? '—' : fmtNumber(result.target)}{result.attainmentPercent == null ? '' : ` · ${fmtNumber(result.attainmentPercent)}%`}</span></>
      : <span className="skeleton" data-h="row" />}
  </article>;
}

export default function BiReportsPage({ route }) {
  const [dashboards, setDashboards] = useState([]);
  const [reports, setReports] = useState([]);
  const [kpis, setKpis] = useState([]);
  const [dashboard, setDashboard] = useState(null);
  const [report, setReport] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [savingReport, setSavingReport] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftSource, setDraftSource] = useState('');
  const [draftOperation, setDraftOperation] = useState('rows');
  const [draftField, setDraftField] = useState('');
  const [draftGroup, setDraftGroup] = useState('');
  const [draftSearch, setDraftSearch] = useState('');
  const [draftFilter, setDraftFilter] = useState('');
  const [draftFilterValue, setDraftFilterValue] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [dashboardList, reportList, kpiList] = await Promise.all([
        can('bi.dashboard.read') ? api(`${dataPath('bi.dashboard')}?limit=100`) : Promise.resolve({ items: [] }),
        can('bi.report.read') ? api(`${dataPath('bi.report')}?limit=100`) : Promise.resolve({ items: [] }),
        can('bi.kpi.read') ? api(`${dataPath('bi.kpi')}?limit=100`) : Promise.resolve({ items: [] }),
      ]);
      setDashboards(asItems(dashboardList));
      setReports(asItems(reportList));
      setKpis(asItems(kpiList));
    } catch (reason) {
      setError(reason.message || 'Không tải được danh mục báo cáo BI.');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { document.title = 'Báo cáo & phân tích · OSP Suite'; load(); }, [load]);
  useEffect(() => {
    let active = true;
    setError('');
    setDashboard(null); setReport(null); setResult(null);
    if (route.view === 'dashboard' && route.id) {
      api(dataPath('bi.dashboard', route.id)).then((value) => { if (active) setDashboard(value); }).catch((reason) => { if (active) setError(reason.message || 'Không tải được dashboard.'); });
    }
    if (route.view === 'report' && route.id) {
      api(dataPath('bi.report', route.id)).then(async (value) => {
        if (!active) return;
        setReport(value);
        if (value.query) setResult(await api(tenantPath(`/reports/bi/${encodeURIComponent(route.id)}`)));
      }).catch((reason) => { if (active) setError(reason.message || 'Không tải được báo cáo.'); });
    }
    return () => { active = false; };
  }, [route.view, route.id]);

  const exportReport = async () => {
    if (!route.id || exporting) return;
    setExporting(true);
    setError('');
    try {
      const path = '/reports/bi/' + encodeURIComponent(route.id) + '/export';
      const response = await api(tenantPath(path), { raw: true });
      downloadBlob(await response.blob(), 'bi-report-' + route.id + '.csv');
    } catch (reason) {
      setError(reason.message || 'Không xuất được báo cáo.');
    } finally {
      setExporting(false);
    }
  };

  const sources = (app.meta?.modules || []).flatMap((module) => (module.entities || [])
    .filter((item) => can(`${module.id}.${item.name}.read`))
    .map((item) => ({ qname: `${module.id}.${item.name}`, label: `${module.name} · ${item.label}`, fields: item.fields || [] })));
  const selectedSource = sources.find((item) => item.qname === draftSource) || sources[0];
  const sourceFields = selectedSource?.fields || [];
  const numericFields = sourceFields.filter((field) => ['number', 'money'].includes(field.type));
  const groupFields = sourceFields.filter((field) => !['json', 'text'].includes(field.type));

  const createReport = async (event) => {
    event.preventDefault();
    if (savingReport || !draftName.trim() || !selectedSource) return;
    const query = { source: selectedSource.qname, limit: 100 };
    if (draftSearch.trim()) query.search = draftSearch.trim();
    if (draftFilter && draftFilterValue.trim()) query.filters = { [draftFilter]: draftFilterValue.trim() };
    if (draftOperation !== 'rows') {
      query.aggregate = { operation: draftOperation, ...(draftField ? { field: draftField } : {}) };
      if (draftGroup) query.group_by = draftGroup;
    }
    setSavingReport(true);
    setError('');
    try {
      const created = await api(dataPath('bi.report'), { method: 'POST', body: { name: draftName.trim(), query } });
      setDraftName(''); setCreating(false);
      await load();
      if (created?.id) window.location.hash = `#/reports/bi/report/${encodeURIComponent(created.id)}`;
    } catch (reason) {
      setError(reason.message || 'Could not create report.');
    } finally { setSavingReport(false); }
  };

  if (route.view === 'dashboard' && route.id) return <div className="page">
    <div className="page-head"><div><a className="back-link" href="#/reports/bi">← Báo cáo & phân tích</a><h1>{dashboard?.name || 'Dashboard'}</h1><p className="sub">Các widget được lấy từ báo cáo đã lưu và phân quyền theo tenant.</p></div></div>
    {error && <div className="alert danger" role="alert">{error}</div>}
    {!dashboard ? <div className="card-pad"><div className="skeleton" data-h="row" /></div> : <div className="bi-widget-grid">{(dashboard.widgets || []).map((widget, index) => <section className="card report-section bi-widget" key={`${widget.type === 'kpi' ? widget.kpi : widget.report}:${index}`}><div className="card-head"><h2>{widget.type === 'kpi' ? (kpis.find((item) => item.id === widget.kpi)?.name || 'KPI') : (reports.find((item) => item.id === widget.report)?.name || 'Report widget')}</h2><a href={widget.type === 'kpi' ? '#/reports/bi' : `#/reports/bi/report/${encodeURIComponent(widget.report)}`}>{widget.type === 'kpi' ? 'Mở KPI' : 'Mở báo cáo'}</a></div><div className="card-pad"><Widget widget={widget} /></div></section>)}</div>}
  </div>;

  if (route.view === 'report' && route.id) return <div className="page">
    <div className="page-head"><div><a className="back-link" href="#/reports/bi">← Báo cáo & phân tích</a><h1>{report?.name || 'Báo cáo'}</h1><p className="sub">{report?.query?.source ? `Nguồn dữ liệu: ${report.query.source}` : 'Báo cáo chưa có truy vấn đã lưu.'}</p></div></div>
    {error && <div className="alert danger" role="alert">{error}</div>}
    {!report ? <div className="card-pad"><div className="skeleton" data-h="row" /></div> : result ? <section className="card report-section"><div className="card-head"><h2>Kết quả</h2><span className="faint">{fmtNumber(result.total || 0)} bản ghi</span><button className="btn" type="button" disabled={exporting} onClick={exportReport}>{exporting ? 'Đang xuất…' : 'Tải CSV'}</button></div><div className="card-pad"><DataTable items={asItems(result)} /></div></section> : <div className="empty"><h3>Chưa cấu hình truy vấn</h3><p>Thêm định nghĩa truy vấn an toàn vào báo cáo để xem dữ liệu.</p></div>}
  </div>;

  return <div className="page">
    {can('bi.report.create') && !creating && <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn btn-primary" type="button" onClick={() => { setCreating(true); if (!draftSource && sources[0]) setDraftSource(sources[0].qname); }}>Tạo báo cáo</button></div>}
    {creating && <section className="card report-section"><div className="card-head"><h2>Thiết kế báo cáo</h2><button className="btn btn-ghost" type="button" onClick={() => setCreating(false)}>Đóng</button></div><form className="card-pad stack" onSubmit={createReport}>
      <div className="form-grid"><label className="field"><span>Tên báo cáo</span><input className="input" required maxLength={160} value={draftName} onChange={(event) => setDraftName(event.target.value)} /></label>
        <label className="field"><span>Nguồn dữ liệu</span><select className="input" required value={selectedSource?.qname || ''} onChange={(event) => { setDraftSource(event.target.value); setDraftField(''); setDraftGroup(''); setDraftFilter(''); }}><option value="">Chọn module và dữ liệu</option>{sources.map((source) => <option key={source.qname} value={source.qname}>{source.label}</option>)}</select></label>
        <label className="field"><span>Kiểu kết quả</span><select className="input" value={draftOperation} onChange={(event) => { setDraftOperation(event.target.value); setDraftField(''); setDraftGroup(''); }}><option value="rows">Danh sách bản ghi</option><option value="count">Đếm bản ghi</option><option value="sum">Tổng</option><option value="avg">Trung bình</option><option value="min">Nhỏ nhất</option><option value="max">Lớn nhất</option></select></label>
        {draftOperation !== 'rows' && draftOperation !== 'count' && <label className="field"><span>Trường số cần tính</span><select className="input" required value={draftField} onChange={(event) => setDraftField(event.target.value)}><option value="">Chọn trường</option>{numericFields.map((field) => <option key={field.name} value={field.name}>{field.label || field.name}</option>)}</select></label>}
        {draftOperation !== 'rows' && <label className="field"><span>Nhóm theo (không bắt buộc)</span><select className="input" value={draftGroup} onChange={(event) => setDraftGroup(event.target.value)}><option value="">Không nhóm</option>{groupFields.map((field) => <option key={field.name} value={field.name}>{field.label || field.name}</option>)}</select></label>}
        <label className="field"><span>Tìm kiếm văn bản (không bắt buộc)</span><input className="input" value={draftSearch} onChange={(event) => setDraftSearch(event.target.value)} /></label>
        <label className="field"><span>Lọc theo trường (không bắt buộc)</span><select className="input" value={draftFilter} onChange={(event) => setDraftFilter(event.target.value)}><option value="">Không lọc</option>{sourceFields.filter((field) => field.type !== 'json').map((field) => <option key={field.name} value={field.name}>{field.label || field.name}</option>)}</select></label>
        {draftFilter && <label className="field"><span>Giá trị lọc chính xác</span><input className="input" value={draftFilterValue} onChange={(event) => setDraftFilterValue(event.target.value)} /></label>}
      </div>
      {!sources.length && <p className="small muted">Bạn chưa có quyền đọc nguồn dữ liệu nào để thiết kế báo cáo.</p>}
      <div className="row"><button className="btn btn-primary" type="submit" disabled={savingReport || !selectedSource}>{savingReport ? 'Đang lưu…' : 'Lưu và chạy báo cáo'}</button></div>
    </form></section>}
    <div className="page-head"><div><h1>Báo cáo & phân tích</h1><p className="sub">Chạy truy vấn đã lưu và xem dashboard từ dữ liệu tenant mà Rust API cho phép.</p></div></div>
    {error && <div className="alert danger" role="alert">{error}</div>}
    {loading ? <div className="card-pad"><div className="skeleton" data-h="row" /></div> : <div className="stack">
      <section className="card report-section"><div className="card-head"><h2>Dashboard</h2><span className="faint">{dashboards.length}</span></div><div className="card-pad">{dashboards.length ? <div className="bi-link-grid">{dashboards.map((item) => <a className="card bi-link-card" key={item.id} href={`#/reports/bi/dashboard/${encodeURIComponent(item.id)}`}><strong>{item.name}</strong><span>{(item.widgets || []).length} widget</span></a>)}</div> : <div className="empty"><p>Chưa có dashboard. Tạo dữ liệu dashboard trong module BI để bắt đầu.</p></div>}</div></section>
      <section className="card report-section"><div className="card-head"><h2>Báo cáo đã lưu</h2><span className="faint">{reports.length}</span></div><div className="card-pad">{reports.length ? <div className="bi-link-grid">{reports.map((item) => <a className="card bi-link-card" key={item.id} href={`#/reports/bi/report/${encodeURIComponent(item.id)}`}><strong>{item.name}</strong><span>{item.query?.source || 'Chưa cấu hình truy vấn'}</span></a>)}</div> : <div className="empty"><p>Chưa có báo cáo. Tạo bản ghi trong module BI và khai báo truy vấn JSON an toàn.</p></div>}</div></section>
      {can('bi.kpi.read') && <section className="card report-section"><div className="card-head"><h2>KPI</h2><span className="faint">{kpis.length}</span></div><div className="card-pad">{kpis.length ? <div className="bi-link-grid">{kpis.map((item) => <KpiCard key={item.id} kpi={item} />)}</div> : <div className="empty"><p>No KPIs configured.</p></div>}</div></section>}
    </div>}
  </div>;
}
