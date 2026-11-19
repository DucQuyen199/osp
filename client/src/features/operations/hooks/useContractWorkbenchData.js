import { useCallback, useEffect, useState } from 'react';
import { uiTextWith } from '../../../lib/i18n.js';
import { can, loadAllResponse, loadIndependentData, loadRefs } from '../../../lib/state.js';
import { useLatestRequest } from '../../../lib/useLatestRequest.js';
import contractEnglish from '../contracts.en.js';

const t = (text) => uiTextWith(text, contractEnglish);
const rows = (response) => Array.isArray(response?.items) ? response.items : [];
const emptyResponse = () => ({ items: [] });
const emptyMap = () => new Map();
const emptyData = () => ({ contracts: [], clauses: [], amendments: [], approvalRequests: [], parties: new Map() });

export function useContractWorkbenchData(workflowEnabled) {
  const [data, setData] = useState(emptyData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const beginRequest = useLatestRequest();

  const load = useCallback(async (quiet = false) => {
    const isCurrent = beginRequest();
    if (!quiet) { setLoading(true); setError(''); }
    try {
      const { data: reads, errors } = await loadIndependentData({
        contracts: can('contract.contract.read') ? loadAllResponse('contract.contract') : Promise.resolve(emptyResponse()),
        clauses: can('contract.clause.read') ? loadAllResponse('contract.clause') : Promise.resolve(emptyResponse()),
        amendments: can('contract.amendment.read') ? loadAllResponse('contract.amendment') : Promise.resolve(emptyResponse()),
        parties: can('master-data.party.read') ? loadRefs('master-data.party') : Promise.resolve(emptyMap()),
        approvalRequests: workflowEnabled && can('workflow-approval.approval_request.read')
          ? loadAllResponse('workflow-approval.approval_request') : Promise.resolve(emptyResponse()),
      }, { contracts: emptyResponse(), clauses: emptyResponse(), amendments: emptyResponse(), parties: emptyMap(), approvalRequests: emptyResponse() });
      if (!isCurrent()) return;
      setData({
        contracts: rows(reads.contracts).sort((a, b) => String(a.end_date || '9999-12-31').localeCompare(String(b.end_date || '9999-12-31')) || String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))),
        clauses: rows(reads.clauses),
        amendments: rows(reads.amendments),
        parties: reads.parties,
        approvalRequests: rows(reads.approvalRequests),
      });
      if (errors.length) setError(errors.map((reason) => reason?.message || t('Không tải được sổ hợp đồng.')).join(' · '));
    } catch (reason) {
      if (isCurrent()) setError(t(reason.message || 'Không tải được sổ hợp đồng.'));
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [beginRequest, workflowEnabled]);

  useEffect(() => { load(); }, [load]);
  return { ...data, loading, error, setError, load };
}
