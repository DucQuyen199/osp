import { useCallback, useEffect, useState } from 'react';
import { api, dataPath, tenantPath } from '../../../lib/api.js';
import { uiTextWith } from '../../../lib/i18n.js';
import { can, loadAllResponse, loadIndependentData } from '../../../lib/state.js';
import { useLatestRequest } from '../../../lib/useLatestRequest.js';
import biEnglish from '../bi.en.js';

const t = (text) => uiTextWith(text, biEnglish);
const asItems = (value) => Array.isArray(value?.items) ? value.items : [];
const emptyResponse = () => ({ items: [] });

export function useBiReportsData({ route }) {
  const [dashboards, setDashboards] = useState([]);
  const [reports, setReports] = useState([]);
  const [kpis, setKpis] = useState([]);
  const [dashboard, setDashboard] = useState(null);
  const [report, setReport] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [reportRuns, setReportRuns] = useState([]);
  const [selectedRun, setSelectedRun] = useState(null);
  const beginCatalogRequest = useLatestRequest();
  const beginDetailRequest = useLatestRequest();

  const load = useCallback(async () => {
    const isCurrent = beginCatalogRequest();
    setLoading(true); setError('');
    try {
      const { data, errors } = await loadIndependentData({
        dashboards: can('bi.dashboard.read') ? loadAllResponse('bi.dashboard') : Promise.resolve(emptyResponse()),
        reports: can('bi.report.read') ? loadAllResponse('bi.report') : Promise.resolve(emptyResponse()),
        kpis: can('bi.kpi.read') ? loadAllResponse('bi.kpi') : Promise.resolve(emptyResponse()),
      }, { dashboards: emptyResponse(), reports: emptyResponse(), kpis: emptyResponse() });
      if (!isCurrent()) return;
      setDashboards(asItems(data.dashboards)); setReports(asItems(data.reports)); setKpis(asItems(data.kpis));
      if (errors.length) setError(errors.map((reason) => t(reason.message || 'Không tải được danh mục báo cáo BI.')).join(' · '));
    } catch (reason) {
      if (isCurrent()) setError(t(reason.message || 'Không tải được danh mục báo cáo BI.'));
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [beginCatalogRequest]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const isCurrent = beginDetailRequest();
    let active = true;
    setError(''); setDashboard(null); setReport(null); setResult(null); setReportRuns([]); setSelectedRun(null);
    const current = () => active && isCurrent();
    async function loadDetail() {
      if (route.view === 'dashboard' && route.id) {
        try {
          const value = await api(dataPath('bi.dashboard', route.id));
          if (current()) setDashboard(value);
        } catch (reason) {
          if (current()) setError(t(reason.message || 'Không tải được dashboard.'));
        }
      }
      if (route.view === 'report' && route.id) {
        let value;
        try {
          value = await api(dataPath('bi.report', route.id));
          if (current()) setReport(value);
        } catch (reason) {
          if (current()) setError(t(reason.message || 'Không tải được báo cáo.'));
          return;
        }
        const requests = [value.query ? api(tenantPath(`/reports/bi/${encodeURIComponent(route.id)}`)) : Promise.resolve(null)];
        if (can('bi.report.read')) requests.push(api(tenantPath(`/reports/bi/${encodeURIComponent(route.id)}/runs`)));
        const results = await Promise.allSettled(requests);
        if (!current()) return;
        const queryResult = results[0];
        if (queryResult.status === 'fulfilled') setResult(queryResult.value);
        else setError(t(queryResult.reason?.message || 'Không tải được báo cáo.'));
        if (requests.length > 1) {
          const runsResult = results[1];
          if (runsResult.status === 'fulfilled') setReportRuns(asItems(runsResult.value));
          else setError((currentError) => [currentError, t(runsResult.reason?.message || 'Could not load report run history.')].filter(Boolean).join(' · '));
        }
      }
    }
    loadDetail();
    return () => { active = false; };
  }, [route.view, route.id, beginDetailRequest]);

  return {
    dashboards, reports, kpis, dashboard, report, result, error, setError,
    loading, reportRuns, setReportRuns, selectedRun, setSelectedRun, setReport, load,
  };
}
