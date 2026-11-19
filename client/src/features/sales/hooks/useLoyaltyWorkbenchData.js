import { useCallback, useEffect, useState } from 'react';
import { uiTextWith } from '../../../lib/i18n.js';
import { can, loadAllResponse, loadIndependentData, loadRefs } from '../../../lib/state.js';
import { useLatestRequest } from '../../../lib/useLatestRequest.js';
import loyaltyEnglish from '../loyalty.en.js';

const t = (text) => uiTextWith(text, loyaltyEnglish);
const rows = (response) => Array.isArray(response?.items) ? response.items : [];
const emptyResponse = () => ({ items: [] });
const emptyMap = () => new Map();

export function useLoyaltyWorkbenchData() {
  const [members, setMembers] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [vouchers, setVouchers] = useState([]);
  const [parties, setParties] = useState(emptyMap);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const beginRequest = useLatestRequest();

  const load = useCallback(async (quiet = false) => {
    const isCurrent = beginRequest();
    setError('');
    if (!quiet) setLoading(true);
    try {
      const { data, errors } = await loadIndependentData({
        members: can('loyalty.member.read') ? loadAllResponse('loyalty.member') : Promise.resolve(emptyResponse()),
        transactions: can('loyalty.point_txn.read') ? loadAllResponse('loyalty.point_txn') : Promise.resolve(emptyResponse()),
        parties: can('master-data.party.read') ? loadRefs('master-data.party') : Promise.resolve(emptyMap()),
        vouchers: can('loyalty.voucher.read') ? loadAllResponse('loyalty.voucher') : Promise.resolve(emptyResponse()),
      }, { members: emptyResponse(), transactions: emptyResponse(), parties: emptyMap(), vouchers: emptyResponse() });
      if (!isCurrent()) return;
      const memberRows = rows(data.members).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
      setMembers(memberRows);
      setTransactions(rows(data.transactions).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))));
      setParties(data.parties);
      setVouchers(rows(data.vouchers).sort((a, b) => String(a.valid_until || '').localeCompare(String(b.valid_until || ''))));
      setSelectedId((id) => memberRows.some((row) => row.id === id) ? id : memberRows[0]?.id || '');
      if (errors.length) setError(errors.map((reason) => reason?.message || t('Không tải được chương trình thành viên.')).join(' · '));
    } catch (reason) {
      if (isCurrent()) setError(t(reason.message || 'Không tải được chương trình thành viên.'));
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [beginRequest]);

  useEffect(() => { load(); }, [load]);
  return { members, transactions, vouchers, parties, selectedId, setSelectedId, loading, error, load };
}
