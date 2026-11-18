import { useCallback, useEffect, useRef, useState } from 'react';
import { app, can, loadAll, loadIndependentData, loadRefs } from '../../../lib/state.js';

export function useBankReconciliationData(statementId, translate) {
  const [statements, setStatements] = useState([]);
  const [allLines, setAllLines] = useState([]);
  const [linesLoading, setLinesLoading] = useState(false);
  const [accounts, setAccounts] = useState(new Map());
  const [currencies, setCurrencies] = useState(new Map());
  const [parties, setParties] = useState(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const lineLoadVersion = useRef(0);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) { setLoading(true); setError(''); }
    try {
      const emptyRows = () => [];
      const emptyMap = () => new Map();
      const { data, errors } = await loadIndependentData({
        statementRows: can('accounting.bank_statement.read') ? loadAll('accounting.bank_statement') : Promise.resolve(emptyRows()),
        accountMap: can('accounting.account.read') ? loadRefs('accounting.account') : Promise.resolve(emptyMap()),
        currencyMap: can('master-data.currency.read') ? loadRefs('master-data.currency') : Promise.resolve(emptyMap()),
        partyMap: can('master-data.party.read') ? loadRefs('master-data.party') : Promise.resolve(emptyMap()),
      }, { statementRows: emptyRows(), accountMap: emptyMap(), currencyMap: emptyMap(), partyMap: emptyMap() });
      const { statementRows, accountMap, currencyMap, partyMap } = data;
      statementRows.sort((a, b) => String(b.start_date || '').localeCompare(String(a.start_date || '')));
      setStatements(statementRows);
      setAccounts(accountMap);
      setCurrencies(currencyMap);
      setParties(partyMap);
      setError(errors[0]?.message || (errors.length ? translate('Một số dữ liệu đối soát ngân hàng không tải được.') : ''));
    } catch (reason) {
      setError(reason.message || translate('Không tải được dữ liệu đối soát ngân hàng.'));
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [translate]);

  const loadLines = useCallback(async (id, quiet = false) => {
    const version = ++lineLoadVersion.current;
    if (!id || !can('accounting.bank_statement_line.read')) {
      setAllLines([]);
      setLinesLoading(false);
      return;
    }
    if (!quiet) setLinesLoading(true);
    try {
      const rows = await loadAll('accounting.bank_statement_line', { statement: id });
      if (version === lineLoadVersion.current) setAllLines(rows);
    } catch (reason) {
      if (version === lineLoadVersion.current) setError(reason.message || translate('Không tải được các dòng trong sao kê.'));
    } finally {
      if (version === lineLoadVersion.current && !quiet) setLinesLoading(false);
    }
  }, [translate]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadLines(statementId); }, [statementId, loadLines]);

  const baseCurrency = [...currencies.values()].find((currency) => String(currency.code).toUpperCase() === String(app.meta?.settings?.baseCurrency || 'VND').toUpperCase());
  return { statements, allLines, linesLoading, accounts, currencies, parties, baseCurrency, loading, error, setError, load, loadLines };
}
