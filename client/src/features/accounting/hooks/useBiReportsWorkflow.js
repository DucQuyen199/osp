import { useState } from 'react';
import { api, dataPath, tenantPath } from '../../../lib/api.js';
import { uiTextWith } from '../../../lib/i18n.js';
import biEnglish from '../bi.en.js';

const t = (text) => uiTextWith(text, biEnglish);
const asItems = (value) => Array.isArray(value?.items) ? value.items : [];

function downloadBlob(blob, filename) {
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(href), 1000);
}

const reportWidgetTypes = (item) => {
  if (!item?.query?.aggregate) return ['table'];
  return item.query.group_by ? ['line', 'bar', 'pie'] : ['number'];
};

export function useBiReportsWorkflow({ route, load, sources, reports, setError, setReport, setReportRuns }) {
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

  const selectedSource = sources.find((item) => item.qname === draftSource) || sources[0];
  const sourceFields = selectedSource?.fields || [];
  const numericFields = sourceFields.filter((field) => ['number', 'money'].includes(field.type));
  const groupFields = sourceFields.filter((field) => !['json', 'text'].includes(field.type));
  const selectedWidgetReport = reports.find((item) => item.id === widgetReportId);
  const widgetTypeOptions = reportWidgetTypes(selectedWidgetReport);
  const kpiReports = reports.filter((item) => item.query?.aggregate && !item.query?.group_by);

  async function exportReport() {
    if (!route.id || exporting) return;
    setExporting(true); setError('');
    try {
      const response = await api(tenantPath(`/reports/bi/${encodeURIComponent(route.id)}/export`), { raw: true });
      downloadBlob(await response.blob(), `bi-report-${route.id}.csv`);
    } catch (reason) { setError(t(reason.message || 'Không xuất được báo cáo.')); }
    finally { setExporting(false); }
  }

  async function createReport(event) {
    event.preventDefault();
    if (savingReport || !draftName.trim() || !selectedSource) return;
    const query = { source: selectedSource.qname, limit: 100 };
    if (draftSearch.trim()) query.search = draftSearch.trim();
    if (draftFilter && draftFilterValue.trim()) query.filters = { [draftFilter]: draftFilterValue.trim() };
    if (draftOperation !== 'rows') {
      query.aggregate = { operation: draftOperation, ...(draftField ? { field: draftField } : {}) };
      if (draftGroup) query.group_by = draftGroup;
    }
    setSavingReport(true); setError('');
    try {
      const emailRecipients = draftRecipients.split(/[\n,;]/).map((email) => email.trim()).filter(Boolean);
      const created = await api(dataPath('bi.report'), { method: 'POST', body: { name: draftName.trim(), query, ...(draftSchedule ? { schedule: draftSchedule } : {}), ...(emailRecipients.length ? { email_recipients: emailRecipients } : {}) } });
      setDraftName(''); setDraftSchedule(''); setDraftRecipients(''); setCreating(false);
      await load();
      if (created?.id) window.location.hash = `#/reports/bi/report/${encodeURIComponent(created.id)}`;
    } catch (reason) { setError(t(reason.message || 'Could not create report.')); }
    finally { setSavingReport(false); }
  }

  async function runReportAction(action) {
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
  }

  function addDashboardWidget() {
    const reportItem = reports.find((item) => item.id === widgetReportId);
    if (!reportItem || !reportWidgetTypes(reportItem).includes(widgetType) || dashboardWidgets.length >= 24) return;
    setDashboardWidgets((items) => [...items, { report: reportItem.id, type: widgetType }]);
  }

  async function createDashboard(event) {
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
  }

  async function createKpi(event) {
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
  }

  return {
    exporting, creating, setCreating, savingReport, draftName, setDraftName, draftSource, setDraftSource,
    draftOperation, setDraftOperation, draftField, setDraftField, draftGroup, setDraftGroup,
    draftSearch, setDraftSearch, draftFilter, setDraftFilter, draftFilterValue, setDraftFilterValue,
    draftSchedule, setDraftSchedule, draftRecipients, setDraftRecipients,
    creatingDashboard, setCreatingDashboard, savingDashboard, dashboardName,
    setDashboardName, widgetReportId, setWidgetReportId, widgetType, setWidgetType, dashboardWidgets,
    setDashboardWidgets, creatingKpi, setCreatingKpi, savingKpi, kpiName, setKpiName, kpiReportId,
    setKpiReportId, kpiTarget, setKpiTarget, kpiFormula, setKpiFormula, selectedSource, sourceFields,
    numericFields, groupFields, selectedWidgetReport, widgetTypeOptions, kpiReports, reportWidgetTypes, exportReport,
    createReport, runReportAction, addDashboardWidget, createDashboard, createKpi,
  };
}
