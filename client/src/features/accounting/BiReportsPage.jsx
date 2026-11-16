import React, { useCallback, useEffect, useState } from 'react';
import { useDocumentTitle } from '../../lib/useDocumentTitle.js';
import { api, dataPath, tenantPath } from '../../lib/api.js';
import { fmtNumber, uiTextWith } from '../../lib/i18n.js';
import { app, can } from '../../lib/state.js';
import biEnglish from './bi.en.js';
const t = (text) => uiTextWith(text, biEnglish);
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
function pieSlicePath(start, end) {
  const point = (turn) => {
    const angle = turn * Math.PI * 2 - Math.PI / 2;
    return `${50 + Math.cos(angle) * 48} ${50 + Math.sin(angle) * 48}`;
  };
  const largeArc = end - start > 0.5 ? 1 : 0;
  return `M 50 50 L ${point(start)} A 48 48 0 ${largeArc} 1 ${point(end)} Z`;
}
function DataTable({ items }) {
  const columns = items.length ? Object.keys(items[0]).filter((key) => !['id', 'tenantId', 'createdAt', 'updatedAt'].includes(key)) : [];
  if (!items.length) return <div className="empty"><h3>{t("Chưa có dữ liệu")}</h3><p>{t("Truy vấn đã lưu không trả về bản ghi nào.")}</p></div>;
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
      .catch((reason) => { if (active) setError(t(reason.message || 'Không tải được báo cáo.')); });
    return () => { active = false; };
  }, [isKpi, resourceId]);
  if (error) return <div className="alert danger" role="alert">{t(error)}</div>;
  if (!result) return <div className="skeleton" data-h="row" />;
  if (isKpi) return <div className="stat"><span className="stat-label">{result.name}</span><strong className="stat-value num">{fmtNumber(result.value)}</strong><span className="small">{t('Target:')} {result.target == null ? '—' : fmtNumber(result.target)}{result.attainmentPercent == null ? '' : ` · ${fmtNumber(result.attainmentPercent)}%`}</span></div>;
  const items = asItems(result);
  if (widget.type === 'table') return <DataTable items={items} />;
  if (widget.type === 'number') return <div className="stat"><span className="stat-label">{result.name}</span><strong className="stat-value num">{fmtNumber(Number(items[0]?.value) || 0)}</strong></div>;
  const max = Math.max(1, ...items.map((item) => Math.abs(Number(item.value) || 0)));
  if (!items.length) return <div className="empty"><p>{t("Chưa có dữ liệu cho biểu đồ.")}</p></div>;
  if (widget.type === 'pie') {
    const total = items.reduce((sum, item) => sum + Math.max(0, Number(item.value) || 0), 0);
    let cursor = 0;
    const chartColor = (index) => `var(--chart-${(index % 7) + 1})`;
    const slices = items.map((item) => {
      const start = cursor;
      cursor += total > 0 ? Math.max(0, Number(item.value) || 0) / total : 1 / items.length;
      return { start, end: cursor };
    });
    return <div className="bi-pie-wrap"><div className="bi-pie" role="img" aria-label={`${result.name}: ${items.length} nhóm`}><svg viewBox="0 0 100 100" aria-hidden="true">{items.length === 1
      ? <circle cx="50" cy="50" r="48" fill={total > 0 ? chartColor(0) : 'var(--chart-empty)'} />
      : total === 0 ? <circle cx="50" cy="50" r="48" fill="var(--chart-empty)" />
        : items.map((item, index) => <path key={`${item.group}:${index}`} d={pieSlicePath(slices[index].start, slices[index].end)} fill={chartColor(index)} />)}</svg></div>
      <ul className="bi-legend">{items.map((item, index) => <li key={`${item.group}:${index}`}><span className="bi-swatch" aria-hidden="true"><svg viewBox="0 0 1 1"><rect width="1" height="1" fill={chartColor(index)} /></svg></span>{label(item.group)} <strong>{fmtNumber(Number(item.value) || 0)}</strong></li>)}</ul></div>;
  }
  if (widget.type === 'line') {
    const points = items.map((item, index) => `${items.length < 2 ? 50 : 8 + index / (items.length - 1) * 84},${90 - (Number(item.value) || 0) / max * 76}`).join(' ');
    return <div className="bi-line-chart"><svg viewBox="0 0 100 100" role="img" aria-label={`${result.name}: biểu đồ đường`} preserveAspectRatio="none"><line x1="8" y1="90" x2="92" y2="90" className="bi-axis" /><polyline points={points} className="bi-line" />{items.map((item, index) => <circle key={`${item.group}:${index}`} cx={items.length < 2 ? 50 : 8 + index / (items.length - 1) * 84} cy={90 - (Number(item.value) || 0) / max * 76} r="1.6" className="bi-point"><title>{label(item.group)}: {fmtNumber(Number(item.value) || 0)}</title></circle>)}</svg><div className="bi-line-labels">{items.map((item, index) => <span key={`${item.group}:${index}`} title={label(item.group)}>{label(item.group)}</span>)}</div></div>;
  }
  return <div className="bi-bars" role="list" aria-label={result.name}>{items.map((item, index) => <div className="bi-bar-row" role="listitem" key={`${item.group}:${index}`}>
    <span title={label(item.group)}>{label(item.group)}</span><div className="bi-bar-track"><svg className="bi-bar-fill" viewBox="0 0 100 1" preserveAspectRatio="none" aria-hidden="true"><rect width={Math.max(2, Math.abs(Number(item.value) || 0) / max * 100)} height="1" /></svg></div><strong className="num">{fmtNumber(Number(item.value) || 0)}</strong>
  </div>)}</div>;
}
function KpiCard({ kpi }) {
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    api(tenantPath(`/reports/bi/kpis/${encodeURIComponent(kpi.id)}`))
      .then((data) => { if (active) setResult(data); })
      .catch((reason) => { if (active) setError(t(reason.message || 'Không thể tính KPI.')); });
    return () => { active = false; };
  }, [kpi.id]);
  return <article className="card bi-link-card">
    <strong>{kpi.name}</strong>
    {error ? <span className="small danger-text">{t(error)}</span> : result
      ? <><span className="stat-value num">{fmtNumber(result.value)}</span><span className="small">Target: {result.target == null ? '—' : fmtNumber(result.target)}{result.attainmentPercent == null ? '' : ` · ${fmtNumber(result.attainmentPercent)}%`}</span></>
      : <span className="skeleton" data-h="row" />}
  </article>;
}
export default function BiReportsPage({ route }) {
  useDocumentTitle(`${t('Báo cáo & phân tích')} · OSP Suite`);
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
  const [draftSchedule, setDraftSchedule] = useState('');
  const [draftRecipients, setDraftRecipients] = useState('');
  const [reportRuns, setReportRuns] = useState([]);
  const [selectedRun, setSelectedRun] = useState(null);
  const [creatingDashboard, setCreatingDashboard] = useState(false);
  const [savingDashboard, setSavingDashboard] = useState(false);
  const [dashboardName, setDashboardName] = useState('');
  const [widgetReportId, setWidgetReportId] = useState('');
  const [widgetType, setWidgetType] = useState('table');
  const [dashboardWidgets, setDashboardWidgets] = useState([]);
  const [creatingKpi, setCreatingKpi] = useState(false);
  const [savingKpi, setSavingKpi] = useState(false);
  const [kpiName, setKpiName] = useState('');
  const [kpiReportId, setKpiReportId] = useState('');
  const [kpiTarget, setKpiTarget] = useState('');
  const [kpiFormula, setKpiFormula] = useState('');
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
      setError(t(reason.message || 'Không tải được danh mục báo cáo BI.'));
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    let active = true;
    setError('');
    setDashboard(null); setReport(null); setResult(null); setReportRuns([]); setSelectedRun(null);
    if (route.view === 'dashboard' && route.id) {
      api(dataPath('bi.dashboard', route.id)).then((value) => { if (active) setDashboard(value); }).catch((reason) => { if (active) setError(t(reason.message || 'Không tải được dashboard.')); });
    }
    if (route.view === 'report' && route.id) {
      api(dataPath('bi.report', route.id)).then(async (value) => {
        if (!active) return;
        setReport(value);
        if (value.query) setResult(await api(tenantPath(`/reports/bi/${encodeURIComponent(route.id)}`)));
      }).catch((reason) => { if (active) setError(t(reason.message || 'Không tải được báo cáo.')); });
      if (can('bi.report.read')) {
        api(tenantPath(`/reports/bi/${encodeURIComponent(route.id)}/runs`))
          .then((value) => { if (active) setReportRuns(asItems(value)); })
          .catch((reason) => { if (active) setError(t(reason.message || 'Could not load report run history.')); });
      }
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
      setError(t(reason.message || 'Không xuất được báo cáo.'));
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
      const emailRecipients = draftRecipients.split(/[\n,;]/).map((email) => email.trim()).filter(Boolean);
      const created = await api(dataPath('bi.report'), { method: 'POST', body: { name: draftName.trim(), query, ...(draftSchedule ? { schedule: draftSchedule } : {}), ...(emailRecipients.length ? { email_recipients: emailRecipients } : {}) } });
      setDraftName(''); setDraftSchedule(''); setDraftRecipients(''); setCreating(false);
      await load();
      if (created?.id) window.location.hash = `#/reports/bi/report/${encodeURIComponent(created.id)}`;
    } catch (reason) {
      setError(t(reason.message || 'Could not create report.'));
    } finally { setSavingReport(false); }
  };
  const runReportAction = async (action) => {
    if (!route.id) return;
    setError('');
    try {
      await api(dataPath('bi.report', route.id, action), { method: 'POST' });
      const [updated, runs] = await Promise.all([
        api(dataPath('bi.report', route.id)),
        api(tenantPath(`/reports/bi/${encodeURIComponent(route.id)}/runs`)),
      ]);
      setReport(updated); setReportRuns(asItems(runs));
    } catch (reason) { setError(t(reason.message || 'Could not update report schedule.')); }
  };
  const reportWidgetTypes = (item) => {
    if (!item?.query?.aggregate) return ['table'];
    return item.query.group_by ? ['line', 'bar', 'pie'] : ['number'];
  };
  const selectedWidgetReport = reports.find((item) => item.id === widgetReportId);
  const widgetTypeOptions = reportWidgetTypes(selectedWidgetReport);
  const addDashboardWidget = () => {
    const reportItem = reports.find((item) => item.id === widgetReportId);
    if (!reportItem || !reportWidgetTypes(reportItem).includes(widgetType) || dashboardWidgets.length >= 24) return;
    setDashboardWidgets((items) => [...items, { report: reportItem.id, type: widgetType }]);
  };
  const createDashboard = async (event) => {
    event.preventDefault();
    if (savingDashboard || !dashboardName.trim() || !dashboardWidgets.length) return;
    setSavingDashboard(true); setError('');
    try {
      const created = await api(dataPath('bi.dashboard'), { method: 'POST', body: { name: dashboardName.trim(), widgets: dashboardWidgets } });
      setCreatingDashboard(false); setDashboardName(''); setDashboardWidgets([]);
      await load();
      if (created?.id) window.location.hash = `#/reports/bi/dashboard/${encodeURIComponent(created.id)}`;
    } catch (reason) { setError(t(reason.message || 'Could not create dashboard.')); }
    finally { setSavingDashboard(false); }
  };
  const kpiReports = reports.filter((item) => item.query?.aggregate && !item.query?.group_by);
  const createKpi = async (event) => {
    event.preventDefault();
    if (savingKpi || !kpiName.trim() || !kpiReportId) return;
    const body = { name: kpiName.trim(), report: kpiReportId };
    if (kpiTarget.trim()) body.target = kpiTarget;
    if (kpiFormula.trim()) body.formula = kpiFormula.trim();
    setSavingKpi(true); setError('');
    try {
      await api(dataPath('bi.kpi'), { method: 'POST', body });
      setCreatingKpi(false); setKpiName(''); setKpiTarget(''); setKpiFormula('');
      await load();
    } catch (reason) { setError(t(reason.message || 'Could not create KPI.')); }
    finally { setSavingKpi(false); }
  };
  if (route.view === 'dashboard' && route.id) return <div className="page">
    <div className="page-head"><div><a className="back-link" href="#/reports/bi">{t("← Báo cáo & phân tích")}</a><h1>{dashboard?.name || t('Dashboard')}</h1><p className="sub">{t("Các widget được lấy từ báo cáo đã lưu và phân quyền theo tenant.")}</p></div></div>
    {error && <div className="alert danger" role="alert">{t(error)}</div>}
    {!dashboard ? <div className="card-pad"><div className="skeleton" data-h="row" /></div> : <div className="bi-widget-grid">{(dashboard.widgets || []).map((widget, index) => <section className="card report-section bi-widget" key={`${widget.type === 'kpi' ? widget.kpi : widget.report}:${index}`}><div className="card-head"><h2>{widget.type === 'kpi' ? (kpis.find((item) => item.id === widget.kpi)?.name || 'KPI') : (reports.find((item) => item.id === widget.report)?.name || 'Report widget')}</h2><a href={widget.type === 'kpi' ? '#/reports/bi' : `#/reports/bi/report/${encodeURIComponent(widget.report)}`}>{widget.type === 'kpi' ? t('Mở KPI') : t('Mở báo cáo')}</a></div><div className="card-pad"><Widget widget={widget} /></div></section>)}</div>}
  </div>;
  if (route.view === 'report' && route.id) return <div className="page">
    <div className="page-head"><div><a className="back-link" href="#/reports/bi">{t("← Báo cáo & phân tích")}</a><h1>{report?.name || t('Báo cáo')}</h1><p className="sub">{report?.query?.source ? `Nguồn dữ liệu: ${report.query.source}` : 'Báo cáo chưa có truy vấn đã lưu.'}</p></div></div>
    {error && <div className="alert danger" role="alert">{t(error)}</div>}
    {report?.schedule && <section className="card report-section"><div className="card-head"><h2>{t("Lịch snapshot")}</h2><span className="badge plain">{report.schedule === 'daily' ? t('Hằng ngày') : t('Hằng tuần')} · {report.schedule_status === 'scheduled' ? t('Đang chạy') : t('Đã tạm dừng')}</span></div><div className="card-pad row"><span className="small muted">{t("Lần tiếp theo:")} {report.next_run_at || t("Chưa đặt lịch")} (UTC)</span>{report.schedule_status === 'scheduled' && can('bi.report.paused') && <button className="btn" type="button" onClick={() => runReportAction('paused')}>{t("Tạm dừng")}</button>}{report.schedule_status === 'paused' && can('bi.report.scheduled') && <button className="btn btn-primary" type="button" onClick={() => runReportAction('scheduled')}>{t("Tiếp tục")}</button>}</div></section>}
    {reportRuns.length > 0 && <section className="card report-section"><div className="card-head"><h2>{t("Lịch sử snapshot")}</h2><span className="faint">{reportRuns.length} {t("lần gần nhất")}</span></div><div className="card-pad stack-sm">{reportRuns.map((run) => <button className="btn" type="button" key={run.id} aria-pressed={selectedRun?.id === run.id} onClick={() => setSelectedRun(run)}>{run.runAt} · {run.rowCount} dòng</button>)}</div>{selectedRun && <div className="card-pad"><DataTable items={asItems(selectedRun.result)} /></div>}</section>}
    {!report ? <div className="card-pad"><div className="skeleton" data-h="row" /></div> : result ? <section className="card report-section"><div className="card-head"><h2>{t("Kết quả")}</h2><span className="faint">{fmtNumber(result.total || 0)} {t("bản ghi")}</span><button className="btn" type="button" disabled={exporting} onClick={exportReport}>{exporting ? t('Đang xuất…') : t('Tải CSV')}</button></div><div className="card-pad"><DataTable items={asItems(result)} /></div></section> : <div className="empty"><h3>{t("Chưa cấu hình truy vấn")}</h3><p>{t("Thêm định nghĩa truy vấn an toàn vào báo cáo để xem dữ liệu.")}</p></div>}
  </div>;
  return <div className="page">
    <div className="row bi-toolbar">
      {can('bi.report.create') && !creating && <button className="btn btn-primary" type="button" onClick={() => { setCreating(true); if (!draftSource && sources[0]) setDraftSource(sources[0].qname); }}>{t("Tạo báo cáo")}</button>}
      {can('bi.dashboard.create') && can('bi.report.read') && !creatingDashboard && <button className="btn" type="button" onClick={() => setCreatingDashboard(true)}>{t("Tạo dashboard")}</button>}
      {can('bi.kpi.create') && can('bi.report.read') && !creatingKpi && <button className="btn" type="button" onClick={() => setCreatingKpi(true)}>{t("Tạo KPI")}</button>}
    </div>
    {creating && <section className="card report-section"><div className="card-head"><h2>{t("Thiết kế báo cáo")}</h2><button className="btn btn-ghost" type="button" onClick={() => setCreating(false)}>{t("Đóng")}</button></div><form className="card-pad stack" onSubmit={createReport}>
      <div className="form-grid"><label className="field"><span>{t("Tên báo cáo")}</span><input className="input" required maxLength={160} value={draftName} onChange={(event) => setDraftName(event.target.value)} /></label>
        <label className="field"><span>{t("Nguồn dữ liệu")}</span><select className="input" required value={selectedSource?.qname || ''} onChange={(event) => { setDraftSource(event.target.value); setDraftField(''); setDraftGroup(''); setDraftFilter(''); }}><option value="">{t("Chọn module và dữ liệu")}</option>{sources.map((source) => <option key={source.qname} value={source.qname}>{source.label}</option>)}</select></label>
        <label className="field"><span>{t("Kiểu kết quả")}</span><select className="input" value={draftOperation} onChange={(event) => { setDraftOperation(event.target.value); setDraftField(''); setDraftGroup(''); }}><option value="rows">{t("Danh sách bản ghi")}</option><option value="count">{t("Đếm bản ghi")}</option><option value="sum">{t("Tổng")}</option><option value="avg">{t("Trung bình")}</option><option value="min">{t("Nhỏ nhất")}</option><option value="max">{t("Lớn nhất")}</option></select></label>
        {draftOperation !== 'rows' && draftOperation !== 'count' && <label className="field"><span>{t("Trường số cần tính")}</span><select className="input" required value={draftField} onChange={(event) => setDraftField(event.target.value)}><option value="">{t("Chọn trường")}</option>{numericFields.map((field) => <option key={field.name} value={field.name}>{field.label || field.name}</option>)}</select></label>}
        {draftOperation !== 'rows' && <label className="field"><span>{t("Nhóm theo (không bắt buộc)")}</span><select className="input" value={draftGroup} onChange={(event) => setDraftGroup(event.target.value)}><option value="">{t("Không nhóm")}</option>{groupFields.map((field) => <option key={field.name} value={field.name}>{field.label || field.name}</option>)}</select></label>}
        <label className="field"><span>{t("Tìm kiếm văn bản (không bắt buộc)")}</span><input className="input" value={draftSearch} onChange={(event) => setDraftSearch(event.target.value)} /></label>
        <label className="field"><span>{t("Lịch chạy snapshot")}</span><select className="input" value={draftSchedule} onChange={(event) => setDraftSchedule(event.target.value)}><option value="">{t("Chạy thủ công")}</option><option value="daily">{t("Hằng ngày")}</option><option value="weekly">{t("Hằng tuần")}</option></select><span className="small muted">{t("Lịch dùng UTC; snapshot tiếp theo chạy sau một chu kỳ.")}</span></label>
        <label className="field"><span>{t("Email nhận báo cáo (không bắt buộc)")}</span><textarea className="input" rows="3" value={draftRecipients} onChange={(event) => setDraftRecipients(event.target.value)} placeholder="name@example.com, team@example.com" disabled={!draftSchedule} /><span className="small muted">{t("Đính kèm CSV sau mỗi lần chạy theo lịch; cần cấu hình SMTP hoặc email provider.")}</span></label>
        <label className="field"><span>{t("Lọc theo trường (không bắt buộc)")}</span><select className="input" value={draftFilter} onChange={(event) => setDraftFilter(event.target.value)}><option value="">{t("Không lọc")}</option>{sourceFields.filter((field) => field.type !== 'json').map((field) => <option key={field.name} value={field.name}>{field.label || field.name}</option>)}</select></label>
        {draftFilter && <label className="field"><span>{t("Giá trị lọc chính xác")}</span><input className="input" value={draftFilterValue} onChange={(event) => setDraftFilterValue(event.target.value)} /></label>}
      </div>
      {!sources.length && <p className="small muted">{t("Bạn chưa có quyền đọc nguồn dữ liệu nào để thiết kế báo cáo.")}</p>}
      <div className="row"><button className="btn btn-primary" type="submit" disabled={savingReport || !selectedSource}>{savingReport ? 'Đang lưu…' : 'Lưu và chạy báo cáo'}</button></div>
    </form></section>}
    {creatingDashboard && <section className="card report-section"><div className="card-head"><h2>{t("Tạo dashboard")}</h2><button className="btn btn-ghost" type="button" onClick={() => setCreatingDashboard(false)}>{t("Đóng")}</button></div><form className="card-pad stack" onSubmit={createDashboard}>
      <label className="field"><span>{t("Tên dashboard")}</span><input className="input" required maxLength={160} value={dashboardName} onChange={(event) => setDashboardName(event.target.value)} /></label>
      <div className="form-grid"><label className="field"><span>{t("Báo cáo")}</span><select className="input" value={widgetReportId} onChange={(event) => { const next = reports.find((item) => item.id === event.target.value); setWidgetReportId(event.target.value); setWidgetType(reportWidgetTypes(next)[0]); }}><option value="">{t("Chọn báo cáo đã lưu")}</option>{reports.filter((item) => item.query).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="field"><span>{t("Kiểu widget")}</span><select className="input" value={widgetTypeOptions.includes(widgetType) ? widgetType : widgetTypeOptions[0]} onChange={(event) => setWidgetType(event.target.value)}>{widgetTypeOptions.map((type) => <option key={type} value={type}>{t(({ table: 'Bảng', number: 'Chỉ số', line: 'Đường', bar: 'Cột', pie: 'Tròn' })[type])}</option>)}</select></label>
        <button className="btn" type="button" disabled={!selectedWidgetReport || dashboardWidgets.length >= 24} onClick={addDashboardWidget}>{t("Thêm widget")}</button>
      </div>
      {dashboardWidgets.length > 0 && <ol className="stack-sm">{dashboardWidgets.map((widget, index) => <li key={`${widget.report}:${index}`} className="row"><span>{reports.find((item) => item.id === widget.report)?.name || t('Báo cáo')} · {widget.type}</span><button className="btn btn-ghost btn-sm" type="button" aria-label={`Xóa widget ${index + 1}`} onClick={() => setDashboardWidgets((items) => items.filter((_, itemIndex) => itemIndex !== index))}>{t("Xóa")}</button></li>)}</ol>}
      <div className="row"><button className="btn btn-primary" type="submit" disabled={savingDashboard || !dashboardWidgets.length}>{savingDashboard ? t('Đang lưu…') : t('Lưu dashboard')}</button></div>
    </form></section>}
    {creatingKpi && <section className="card report-section"><div className="card-head"><h2>{t("Tạo KPI")}</h2><button className="btn btn-ghost" type="button" onClick={() => setCreatingKpi(false)}>{t("Đóng")}</button></div><form className="card-pad stack" onSubmit={createKpi}>
      <div className="form-grid"><label className="field"><span>{t("Tên KPI")}</span><input className="input" required maxLength={160} value={kpiName} onChange={(event) => setKpiName(event.target.value)} /></label>
        <label className="field"><span>{t("Báo cáo tổng hợp không nhóm")}</span><select className="input" required value={kpiReportId} onChange={(event) => setKpiReportId(event.target.value)}><option value="">{t("Chọn nguồn KPI")}</option>{kpiReports.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="field"><span>{t("Mục tiêu (không bắt buộc)")}</span><input className="input num" type="number" min="0" step="any" value={kpiTarget} onChange={(event) => setKpiTarget(event.target.value)} /></label>
        <label className="field"><span>{t("Công thức (không bắt buộc)")}</span><input className="input" maxLength={500} value={kpiFormula} onChange={(event) => setKpiFormula(event.target.value)} /><span className="small muted">{t("Biến khả dụng: value, target. Ví dụ: value / target * 100")}</span></label>
      </div>
      <div className="row"><button className="btn btn-primary" type="submit" disabled={savingKpi || !kpiReports.length}>{savingKpi ? t('Đang lưu…') : t('Lưu KPI')}</button></div>
    </form></section>}
    <div className="page-head"><div><h1>{t("Báo cáo & phân tích")}</h1><p className="sub">{t("Chạy truy vấn đã lưu và xem dashboard từ dữ liệu tenant mà Rust API cho phép.")}</p></div></div>
    {error && <div className="alert danger" role="alert">{t(error)}</div>}
    {loading ? <div className="card-pad"><div className="skeleton" data-h="row" /></div> : <div className="stack">
      <section className="card report-section"><div className="card-head"><h2>{t('Dashboard')}</h2><span className="faint">{dashboards.length}</span></div><div className="card-pad">{dashboards.length ? <div className="bi-link-grid">{dashboards.map((item) => <a className="card bi-link-card" key={item.id} href={`#/reports/bi/dashboard/${encodeURIComponent(item.id)}`}><strong>{item.name}</strong><span>{(item.widgets || []).length} widget</span></a>)}</div> : <div className="empty"><p>{t("Chưa có dashboard. Tạo dữ liệu dashboard trong module BI để bắt đầu.")}</p></div>}</div></section>
      <section className="card report-section"><div className="card-head"><h2>{t("Báo cáo đã lưu")}</h2><span className="faint">{reports.length}</span></div><div className="card-pad">{reports.length ? <div className="bi-link-grid">{reports.map((item) => <a className="card bi-link-card" key={item.id} href={`#/reports/bi/report/${encodeURIComponent(item.id)}`}><strong>{item.name}</strong><span>{item.query?.source || 'Chưa cấu hình truy vấn'}</span></a>)}</div> : <div className="empty"><p>{t("Chưa có báo cáo. Tạo bản ghi trong module BI và khai báo truy vấn JSON an toàn.")}</p></div>}</div></section>
      {can('bi.kpi.read') && <section className="card report-section"><div className="card-head"><h2>{t('KPI')}</h2><span className="faint">{kpis.length}</span></div><div className="card-pad">{kpis.length ? <div className="bi-link-grid">{kpis.map((item) => <KpiCard key={item.id} kpi={item} />)}</div> : <div className="empty"><p>{t("No KPIs configured.")}</p></div>}</div></section>}
    </div>}
  </div>;
}
