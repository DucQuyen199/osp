import { useState } from 'react';
import { api, tenantPath } from '../../../lib/api.js';
import { uiText } from '../../../lib/i18n.js';

export function useAccountingReportsWorkflow({ asOf, load }) {
  const [fxMemo, setFxMemo] = useState('Đánh giá lại công nợ ngoại tệ');
  const [fxJournal, setFxJournal] = useState(null);
  const [postingFx, setPostingFx] = useState(false);
  const [error, setError] = useState('');

  async function createFxDraft() {
    setPostingFx(true); setError(''); setFxJournal(null);
    try {
      const result = await api(tenantPath('/reports/accounting/fx-revaluation-journals'), {
        method: 'POST', body: { asOf, memo: fxMemo },
      });
      const journal = result.journal || null;
      const id = journal?.id || result.journalId;
      setFxJournal({ id, status: journal?.status || result.status || 'draft', existing: result.existing });
      await load();
    } catch (reason) {
      setError(reason.message || uiText('Không tạo được bút toán đánh giá lại ngoại tệ nháp.'));
    } finally {
      setPostingFx(false);
    }
  }

  return { fxMemo, setFxMemo, fxJournal, postingFx, error, createFxDraft };
}
