import React from 'react';
import { useDocumentTitle } from '../../lib/useDocumentTitle.js';
import { fmtNumber, uiTextWith } from '../../lib/i18n.js';
import { app, can } from '../../lib/state.js';
import biEnglish from './bi.en.js';
import BiReportBuilderForm from './components/BiReportBuilderForm.jsx';
import { BiDataTable, BiKpiCard, BiReportWidget } from './components/BiReportVisualizations.jsx';
import { useBiReportsData } from './hooks/useBiReportsData.js';
import { useBiReportsWorkflow } from './hooks/useBiReportsWorkflow.js';
const t = (text) => uiTextWith(text, biEnglish);
const asItems = (value) => Array.isArray(value?.items) ? value.items : [];
export default function BiReportsPage({ route }) {
  useDocumentTitle(`${t('Báo cáo & phân tích')} · OSP Suite`);
  const data = useBiReportsData({ route });
  const {
    dashboards, reports, kpis, dashboard, report, result, error, setError,
    loading, reportRuns, setReportRuns, selectedRun, setSelectedRun, setReport, load,
  } = data;
  const sources = (app.meta?.modules || []).flatMap((module) => (module.entities || [])
    .filter((item) => can(`${module.id}.${item.name}.read`))
    .map((item) => ({ qname: `${module.id}.${item.name}`, label: `${module.name} · ${item.label}`, fields: item.fields || [] })));
  const workflow = useBiReportsWorkflow({ route, load, sources, reports, setError, setReport, setReportRuns });
  const {
    exporting, creating, setCreating, savingReport, draftName, setDraftName, draftSource, setDraftSource,
    draftOperation, setDraftOperation, draftField, setDraftField, draftGroup, setDraftGroup,
    draftSearch, setDraftSearch, draftFilter, setDraftFilter, draftFilterValue, setDraftFilterValue,
    draftSchedule, setDraftSchedule, draftRecipients, setDraftRecipients, creatingDashboard,
    setCreatingDashboard, savingDashboard, dashboardName, setDashboardName, widgetReportId,
    setWidgetReportId, widgetType, setWidgetType, dashboardWidgets, setDashboardWidgets,
    creatingKpi, setCreatingKpi, savingKpi, kpiName, setKpiName, kpiReportId, setKpiReportId,
    kpiTarget, setKpiTarget, kpiFormula, setKpiFormula, selectedSource, sourceFields,
    numericFields, groupFields, selectedWidgetReport, widgetTypeOptions, kpiReports, reportWidgetTypes,
    exportReport, createReport, runReportAction, addDashboardWidget, createDashboard, createKpi,
  } = workflow;
  if (route.view === 'dashboard' && route.id) return <div className="page">
    <div className="page-head"><div><a className="back-link" href="#/reports/bi">{t("← Báo cáo & phân tích")}</a><h1>{dashboard?.name || t('Dashboard')}</h1><p className="sub">{t("Các widget được lấy từ báo cáo đã lưu và phân quyền theo tenant.")}</p></div></div>
    {error && <div className="alert danger" role="alert">{t(error)}</div>}
    {!dashboard ? <div className="card-pad"><div className="skeleton" data-h="row" /></div> : <div className="bi-widget-grid">{(dashboard.widgets || []).map((widget, index) => <section className="card report-section bi-widget" key={`${widget.type === 'kpi' ? widget.kpi : widget.report}:${index}`}><div className="card-head"><h2>{widget.type === 'kpi' ? (kpis.find((item) => item.id === widget.kpi)?.name || 'KPI') : (reports.find((item) => item.id === widget.report)?.name || 'Report widget')}</h2><a href={widget.type === 'kpi' ? '#/reports/bi' : `#/reports/bi/report/${encodeURIComponent(widget.report)}`}>{widget.type === 'kpi' ? t('Mở KPI') : t('Mở báo cáo')}</a></div><div className="card-pad"><BiReportWidget widget={widget} /></div></section>)}</div>}
  </div>;
  if (route.view === 'report' && route.id) return <div className="page">
    <div className="page-head"><div><a className="back-link" href="#/reports/bi">{t("← Báo cáo & phân tích")}</a><h1>{report?.name || t('Báo cáo')}</h1><p className="sub">{report?.query?.source ? `Nguồn dữ liệu: ${report.query.source}` : t('Báo cáo chưa có truy vấn đã lưu.')}</p></div></div>
    {error && <div className="alert danger" role="alert">{t(error)}</div>}
    {report?.schedule && <section className="card report-section"><div className="card-head"><h2>{t("Lịch snapshot")}</h2><span className="badge plain">{report.schedule === 'daily' ? t('Hằng ngày') : t('Hằng tuần')} · {report.schedule_status === 'scheduled' ? t('Đang chạy') : t('Đã tạm dừng')}</span></div><div className="card-pad row"><span className="small muted">{t("Lần tiếp theo:")} {report.next_run_at || t("Chưa đặt lịch")} (UTC)</span>{report.schedule_status === 'scheduled' && can('bi.report.paused') && <button className="btn" type="button" onClick={() => runReportAction('paused')}>{t("Tạm dừng")}</button>}{report.schedule_status === 'paused' && can('bi.report.scheduled') && <button className="btn btn-primary" type="button" onClick={() => runReportAction('scheduled')}>{t("Tiếp tục")}</button>}</div></section>}
    {reportRuns.length > 0 && <section className="card report-section"><div className="card-head"><h2>{t("Lịch sử snapshot")}</h2><span className="faint">{reportRuns.length} {t("lần gần nhất")}</span></div><div className="card-pad stack-sm">{reportRuns.map((run) => <button className="btn" type="button" key={run.id} aria-pressed={selectedRun?.id === run.id} onClick={() => setSelectedRun(run)}>{run.runAt} · {run.rowCount} dòng</button>)}</div>{selectedRun && <div className="card-pad"><BiDataTable items={asItems(selectedRun.result)} /></div>}</section>}
    {!report ? <div className="card-pad"><div className="skeleton" data-h="row" /></div> : result ? <section className="card report-section"><div className="card-head"><h2>{t("Kết quả")}</h2><span className="faint">{fmtNumber(result.total || 0)} {t("bản ghi")}</span><button className="btn" type="button" disabled={exporting} onClick={exportReport}>{exporting ? t('Đang xuất…') : t('Tải CSV')}</button></div><div className="card-pad"><BiDataTable items={asItems(result)} /></div></section> : <div className="empty"><h3>{t("Chưa cấu hình truy vấn")}</h3><p>{t("Thêm định nghĩa truy vấn an toàn vào báo cáo để xem dữ liệu.")}</p></div>}
  </div>;
  return <div className="page">
    <div className="row bi-toolbar">
      {can('bi.report.create') && !creating && <button className="btn btn-primary" type="button" onClick={() => { setCreating(true); if (!draftSource && sources[0]) setDraftSource(sources[0].qname); }}>{t("Tạo báo cáo")}</button>}
      {can('bi.dashboard.create') && can('bi.report.read') && !creatingDashboard && <button className="btn" type="button" onClick={() => setCreatingDashboard(true)}>{t("Tạo dashboard")}</button>}
      {can('bi.kpi.create') && can('bi.report.read') && !creatingKpi && <button className="btn" type="button" onClick={() => setCreatingKpi(true)}>{t("Tạo KPI")}</button>}
    </div>
    {creating && <BiReportBuilderForm
      sources={sources} selectedSource={selectedSource} sourceFields={sourceFields}
      numericFields={numericFields} groupFields={groupFields} name={draftName}
      operation={draftOperation} field={draftField} group={draftGroup} search={draftSearch}
      filter={draftFilter} filterValue={draftFilterValue} schedule={draftSchedule}
      recipients={draftRecipients} saving={savingReport} onNameChange={setDraftName}
      onSourceChange={(value) => { setDraftSource(value); setDraftField(''); setDraftGroup(''); setDraftFilter(''); }}
      onOperationChange={(value) => { setDraftOperation(value); setDraftField(''); setDraftGroup(''); }}
      onFieldChange={setDraftField} onGroupChange={setDraftGroup} onSearchChange={setDraftSearch}
      onFilterChange={setDraftFilter} onFilterValueChange={setDraftFilterValue}
      onScheduleChange={setDraftSchedule} onRecipientsChange={setDraftRecipients}
      onSubmit={createReport} onClose={() => setCreating(false)} t={t}
    />}
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
      <section className="card report-section"><div className="card-head"><h2>{t("Báo cáo đã lưu")}</h2><span className="faint">{reports.length}</span></div><div className="card-pad">{reports.length ? <div className="bi-link-grid">{reports.map((item) => <a className="card bi-link-card" key={item.id} href={`#/reports/bi/report/${encodeURIComponent(item.id)}`}><strong>{item.name}</strong><span>{item.query?.source || t('Chưa cấu hình truy vấn')}</span></a>)}</div> : <div className="empty"><p>{t("Chưa có báo cáo. Tạo bản ghi trong module BI và khai báo truy vấn JSON an toàn.")}</p></div>}</div></section>
      {can('bi.kpi.read') && <section className="card report-section"><div className="card-head"><h2>{t('KPI')}</h2><span className="faint">{kpis.length}</span></div><div className="card-pad">{kpis.length ? <div className="bi-link-grid">{kpis.map((item) => <BiKpiCard key={item.id} kpi={item} />)}</div> : <div className="empty"><p>{t("No KPIs configured.")}</p></div>}</div></section>}
    </div>}
  </div>;
}
