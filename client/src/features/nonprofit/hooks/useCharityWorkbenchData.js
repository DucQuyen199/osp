import { useCallback, useEffect, useState } from 'react';
import { uiTextWith } from '../../../lib/i18n.js';
import { can, loadAllResponse, loadIndependentData, loadRefs } from '../../../lib/state.js';
import charityEnglish from '../charity.en.js';

const t = (text) => uiTextWith(text, charityEnglish);
const itemsOf = (response) => Array.isArray(response?.items) ? response.items : [];
const emptyResponse = () => ({ items: [] });
const emptyMap = () => new Map();
const emptyData = () => ({ programs: [], beneficiaries: [], donations: [], disbursements: [], parties: new Map(), accounts: [] });

export function useCharityWorkbenchData() {
  const [data, setData] = useState(emptyData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (quiet = false) => {
    if (!quiet) { setLoading(true); setError(''); }
    try {
      const { data: reads, errors } = await loadIndependentData({
        programs: can('charity.program.read') ? loadAllResponse('charity.program') : Promise.resolve(emptyResponse()),
        beneficiaries: can('charity.beneficiary.read') ? loadAllResponse('charity.beneficiary') : Promise.resolve(emptyResponse()),
        donations: can('charity.donation.read') ? loadAllResponse('charity.donation') : Promise.resolve(emptyResponse()),
        disbursements: can('charity.disbursement.read') ? loadAllResponse('charity.disbursement') : Promise.resolve(emptyResponse()),
        parties: can('master-data.party.read') ? loadRefs('master-data.party') : Promise.resolve(emptyMap()),
        accounts: can('accounting.account.read') ? loadAllResponse('accounting.account') : Promise.resolve(emptyResponse()),
      }, {
        programs: emptyResponse(), beneficiaries: emptyResponse(), donations: emptyResponse(),
        disbursements: emptyResponse(), parties: emptyMap(), accounts: emptyResponse(),
      });
      setData({
        programs: itemsOf(reads.programs),
        beneficiaries: itemsOf(reads.beneficiaries),
        donations: itemsOf(reads.donations),
        disbursements: itemsOf(reads.disbursements),
        parties: reads.parties,
        accounts: itemsOf(reads.accounts).filter((row) => row.kind === 'expense'),
      });
      if (errors.length) setError(errors.map((reason) => reason?.message || t('Không tải được dữ liệu chương trình.')).join(' · '));
    } catch (reason) {
      setError(t(reason.message || 'Không tải được dữ liệu chương trình.'));
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  return { ...data, loading, error, setError, load };
}
