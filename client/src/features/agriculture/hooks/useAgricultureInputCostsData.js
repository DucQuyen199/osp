import { useEffect, useState } from 'react';
import { api, tenantPath } from '../../../lib/api.js';
import { uiTextWith } from '../../../lib/i18n.js';
import agricultureEnglish from '../agriculture.en.js';
import { useLatestRequest } from '../../../lib/useLatestRequest.js';

const t = (text) => uiTextWith(text, agricultureEnglish);

export function useAgricultureInputCostsData({ cycleId, inputs, enabled }) {
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const latestRequest = useLatestRequest();

  useEffect(() => {
    const isCurrent = latestRequest();
    if (!cycleId || !enabled) {
      setReport(null);
      setError('');
      return;
    }

    setReport(null);
    setError('');
    api(tenantPath(`/reports/agriculture/crop-cycles/${encodeURIComponent(cycleId)}/input-costs`))
      .then((nextReport) => { if (isCurrent()) setReport(nextReport); })
      .catch((reason) => {
        if (isCurrent()) setError(reason.message || t('Không tải được chi phí vật tư.'));
      });
  }, [cycleId, inputs, enabled, latestRequest]);

  return { report, error };
}
