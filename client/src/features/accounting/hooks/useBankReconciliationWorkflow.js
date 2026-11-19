import { useEffect, useMemo, useState } from 'react';
import { localDate } from '../../../lib/dates.js';
import { api, dataPath, tenantPath } from '../../../lib/api.js';
import { confirmDialog } from '../../../lib/feedback.js';
import { absDecimal, compareDecimals, subtractDecimals } from '../../../lib/decimal.js';
import { fmtDate, fmtMoney } from '../../../lib/i18n.js';
import { app, can, loadAll, loadAllResponse, recordLabel } from '../../../lib/state.js';
import { workbenchHref } from '../../../lib/routes.js';
import { amountsEqualWithin, calculateBankNet, calculateStatementTotals } from '../domain/bankReconciliation.js';

const today = localDate;
const shiftDate = (value, days) => { const date = new Date(`${value}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); };
const action = (entity, row, verb) => api(dataPath(entity, row.id, verb), { method: 'POST' });
const bankNet = (entry, accountId) => calculateBankNet(entry.lines, accountId);
const sameAmount = amountsEqualWithin;
export const isBankAccount = (account) => /^112\d*$/.test(String(account?.code || '')) && account.kind === 'asset';

async function readOfxFile(file, t) {
  const bytes = await file.arrayBuffer();
  const header = new TextDecoder('ascii').decode(bytes.slice(0, Math.min(bytes.byteLength, 1024)));
  const declaredCharset = header.match(/^CHARSET\s*:\s*([^\r\n]+)/im)?.[1]?.trim().toUpperCase();
  const charset = !declaredCharset || ['UTF-8', 'UTF8', '65001'].includes(declaredCharset)
    ? 'utf-8'
    : ['USASCII', 'ASCII', '1252', 'WINDOWS-1252', 'ISO-8859-1', '8859-1'].includes(declaredCharset)
      ? 'windows-1252'
      : null;
  if (!charset) throw new Error(t('Tệp OFX dùng bảng mã chưa hỗ trợ: {charset}.').replace('{charset}', declaredCharset));
  try { return new TextDecoder(charset, { fatal: true }).decode(bytes); }
  catch { throw new Error(t('Không giải mã được tệp OFX theo bảng mã {charset}.').replace('{charset}', declaredCharset || charset)); }
}

export function useBankReconciliationWorkflow({ data, statementId, setStatementId, t }) {
  const { statements, allLines, accounts, currencies, parties, connectors, baseCurrency, setError: setDataError, load: loadData, loadLines } = data;
  const [matchCandidates, setMatchCandidates] = useState({});
  const [candidateLoading, setCandidateLoading] = useState({});
  const [invoiceSuggestions, setInvoiceSuggestions] = useState({});
  const [invoiceSuggestionLoading, setInvoiceSuggestionLoading] = useState({});
  const [matcherOpen, setMatcherOpen] = useState({});
  const [statementForm, setStatementForm] = useState({ account: '', currency: '', statement_number: '', start_date: `${today().slice(0, 7)}-01`, end_date: today(), opening_balance: '', closing_balance: '' });
  const [lineForm, setLineForm] = useState({ transaction_date: today(), reference: '', description: '', direction: 'credit', amount: '' });
  const [statementFile, setStatementFile] = useState(null);
  const [bankFeedConnectorId, setBankFeedConnectorId] = useState('');
  const [cassoSyncFrom, setCassoSyncFrom] = useState('');
  const [cassoSyncTo, setCassoSyncTo] = useState('');
  const [matchChoices, setMatchChoices] = useState({});
  const [ignoreReasons, setIgnoreReasons] = useState({});
  const [ignoreOpen, setIgnoreOpen] = useState({});
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    setStatementId((id) => statements.some((row) => row.id === id) ? id : statements.find((row) => row.status === 'draft')?.id || statements[0]?.id || '');
  }, [setStatementId, statements]);
  const bankFeedConnectors = useMemo(() => connectors.filter((connector) => connector.enabled && ['casso_bank_feed', 'sepay_bank_feed', 'plaid_bank_feed', 'salt_edge_bank_feed'].includes(connector.config?.adapter)), [connectors]);
  useEffect(() => {
    setBankFeedConnectorId((id) => bankFeedConnectors.some((connector) => connector.id === id) ? id : bankFeedConnectors[0]?.id || '');
  }, [bankFeedConnectors]);
  useEffect(() => {
    setStatementForm((form) => ({ ...form, account: form.account || [...accounts.values()].find((account) => account.code === '112')?.id || [...accounts.values()].find(isBankAccount)?.id || '', currency: form.currency || baseCurrency?.id || '' }));
  }, [accounts, baseCurrency]);

  const load = async (quiet = false) => {
    if (!quiet) setError('');
    setDataError('');
    await loadData(quiet);
  };
  const selected = statements.find((row) => row.id === statementId);
  const selectedBankFeed = bankFeedConnectors.find((connector) => connector.id === bankFeedConnectorId);
  const selectedBankAccount = accounts.get(selected?.account);
  const syncAccountMapped = selectedBankFeed?.config?.adapter === 'casso_bank_feed'
    ? Boolean(selectedBankAccount?.casso_bank_account_id)
    : Boolean(selectedBankAccount?.bank_account_id);
  useEffect(() => {
    setCassoSyncFrom(selected?.start_date || '');
    setCassoSyncTo(selected?.end_date || '');
  }, [selected?.id, selected?.start_date, selected?.end_date]);
  const selectedLines = useMemo(() => [...allLines].sort((a, b) => String(a.transaction_date || '').localeCompare(String(b.transaction_date || '')) || String(a.reference || '').localeCompare(String(b.reference || ''))), [allLines]);
  const bankAccount = useMemo(() => accounts.get(selected?.account) || [...accounts.values()].find((account) => account.code === '112'), [accounts, selected?.account]);
  const matchedPaymentIds = useMemo(() => new Set(allLines.filter((line) => line.status === 'matched' && line.payment).map((line) => line.payment)), [allLines]);
  const matchedJournalIds = useMemo(() => new Set(allLines.filter((line) => line.status === 'matched' && line.journal_entry).map((line) => line.journal_entry)), [allLines]);
  const totals = useMemo(() => calculateStatementTotals(selected, selectedLines), [selected, selectedLines]);

  async function run(key, operation, success) {
    setBusy(key); setError(''); setNotice('');
    try { const result = await operation(); setNotice(typeof success === 'function' ? success(result) : success); await load(true); await loadLines(statementId); }
    catch (reason) { setError(reason.message || t('Thao tác đối soát không thành công.')); await load(true); await loadLines(statementId); }
    finally { setBusy(''); }
  }
  async function createStatement(event) {
    event.preventDefault();
    await run('statement:create', async () => {
      const created = await api(dataPath('accounting.bank_statement'), { method: 'POST', body: {
        ...statementForm, opening_balance: String(statementForm.opening_balance), closing_balance: String(statementForm.closing_balance),
      } });
      setStatementId(created.id);
      setStatementForm((form) => ({ ...form, statement_number: '', opening_balance: '', closing_balance: '' }));
    }, t('Đã mở kỳ sao kê nháp. Nhập tệp ngân hàng hoặc thêm giao dịch để bắt đầu đối chiếu.'));
  }
  async function importFile() {
    if (!selected || !statementFile) return;
    const camt = /\.(xml|camt)$/i.test(statementFile.name);
    const mt940 = /\.(mt940|940|sta)$/i.test(statementFile.name);
    const ofx = /\.(ofx|qfx)$/i.test(statementFile.name);
    const casso = /\.json$/i.test(statementFile.name);
    await run(`${selected.id}:import`, async () => {
      const content = ofx ? await readOfxFile(statementFile, t) : await statementFile.text();
      const payload = casso ? JSON.parse(content) : content;
      const result = await api(tenantPath(`/accounting/bank-statements/${selected.id}/${casso ? 'import-casso' : camt ? 'import-camt053' : mt940 ? 'import-mt940' : ofx ? 'import-ofx' : 'import'}`), {
        method: 'POST', body: payload, headers: { 'content-type': casso ? 'application/json' : camt ? 'application/xml; charset=utf-8' : mt940 ? 'application/x-mt940; charset=utf-8' : ofx ? 'text/plain; charset=utf-8' : 'text/csv; charset=utf-8' },
      });
      setStatementFile(null);
      return result;
    }, (result) => t('Đã nhập {imported} dòng; bỏ qua {skipped} dòng trùng.').replace('{imported}', result.imported).replace('{skipped}', result.skipped));
  }
  async function syncCasso() {
    if (!selected || !selectedBankFeed) return;
    const adapter = selectedBankFeed.config?.adapter;
    const provider = adapter === 'sepay_bank_feed' ? 'SePay' : adapter === 'plaid_bank_feed' ? 'Plaid' : adapter === 'salt_edge_bank_feed' ? 'Salt Edge' : 'Casso';
    const endpoint = adapter === 'sepay_bank_feed' ? 'sync-sepay' : adapter === 'plaid_bank_feed' ? 'sync-plaid' : adapter === 'salt_edge_bank_feed' ? 'sync-salt-edge' : 'sync-casso';
    await run(`${selected.id}:${endpoint}`, async () => api(tenantPath(`/accounting/bank-statements/${selected.id}/${endpoint}`), {
      method: 'POST', body: {
        connectorId: bankFeedConnectorId,
        fromDate: cassoSyncFrom || selected.start_date,
        toDate: cassoSyncTo || selected.end_date,
      },
    }), (result) => t('Đã đồng bộ {imported} giao dịch từ {provider}; bỏ qua {skipped} dòng trùng.').replace('{imported}', result.imported).replace('{skipped}', result.skipped).replace('{provider}', provider));
  }
  async function createLine(event) {
    event.preventDefault(); if (!selected) return;
    await run(`${selected.id}:line:create`, async () => {
      await api(dataPath('accounting.bank_statement_line'), { method: 'POST', body: {
        statement: selected.id, ...lineForm, amount: String(lineForm.amount), reference: lineForm.reference.trim() || undefined, description: lineForm.description.trim() || undefined,
      } });
      setLineForm((form) => ({ ...form, reference: '', description: '', amount: '' }));
    }, t('Đã thêm giao dịch vào sao kê.'));
  }
  function candidatesFor(line, override) {
    if (!selected || !bankAccount) return { payments: [], journals: [] };
    const source = override || matchCandidates[line.id] || { payments: [], journals: [] };
    const amount = line.base_amount ?? line.amount;
    const expected = line.direction === 'credit' ? amount : subtractDecimals(0, amount);
    const statementCurrency = selected.currency || baseCurrency?.id;
    const journalsByPayment = new Map(source.journals.filter((entry) => entry.source === 'payment' && entry.status === 'posted').map((entry) => [entry.source_id, entry]));
    const paymentCandidates = source.payments.filter((payment) => {
      const journal = journalsByPayment.get(payment.id);
      const currency = payment.currency || baseCurrency?.id;
      return journal && ['bank', 'transfer'].includes(payment.method) && currency === statementCurrency
        && sameAmount(absDecimal(payment.amount), line.amount) && sameAmount(absDecimal(payment.base_amount ?? payment.amount), line.base_amount ?? line.amount)
        && sameAmount(bankNet(journal, bankAccount.id), expected) && !matchedJournalIds.has(journal.id) && !matchedPaymentIds.has(payment.id);
    });
    const journalCandidates = source.journals.filter((entry) => entry.status === 'posted' && !matchedJournalIds.has(entry.id)
      && sameAmount(bankNet(entry, bankAccount.id), expected));
    return { payments: paymentCandidates, journals: journalCandidates };
  }
  async function findCandidates(line) {
    setMatcherOpen((current) => ({ ...current, [line.id]: true }));
    if (matchCandidates[line.id]) return;
    setCandidateLoading((current) => ({ ...current, [line.id]: true }));
    setError('');
    try {
      const loadDate = async (date) => {
        const [bankPayments, transferPayments, dateJournals] = await Promise.all([
          loadAll('accounting.payment', { payment_date: date, method: 'bank' }),
          loadAll('accounting.payment', { payment_date: date, method: 'transfer' }),
          loadAll('accounting.journal_entry', { posting_date: date, status: 'posted' }),
        ]);
        return { payments: [...new Map([...bankPayments, ...transferPayments].map((payment) => [payment.id, payment])).values()], journals: dateJournals };
      };
      let result = await loadDate(line.transaction_date);
      const foundOnDate = candidatesFor(line, result);
      if (!foundOnDate.payments.length && !foundOnDate.journals.length) {
        const adjacent = await Promise.all([-1, 1].map((offset) => loadDate(shiftDate(line.transaction_date, offset))));
        result = {
          payments: [...new Map([...result.payments, ...adjacent.flatMap((rows) => rows.payments)].map((payment) => [payment.id, payment])).values()],
          journals: [...new Map([...result.journals, ...adjacent.flatMap((rows) => rows.journals)].map((entry) => [entry.id, entry])).values()],
        };
      }
      setMatchCandidates((current) => ({ ...current, [line.id]: result }));
    } catch (reason) { setError(reason.message || t('Không tải được chứng từ để khớp giao dịch.')); }
    finally { setCandidateLoading((current) => ({ ...current, [line.id]: false })); }
  }
  async function suggestInvoices(line) {
    setInvoiceSuggestionLoading((current) => ({ ...current, [line.id]: true }));
    setError('');
    try {
      const response = await loadAllResponse('accounting.invoice');
      const amount = line.amount;
      const statementCurrency = selected?.currency || baseCurrency?.id;
      const reference = `${line.reference || ''} ${line.description || ''}`.toLocaleLowerCase();
      const invoices = (response.items || []).filter((invoice) => {
        const invoiceCurrency = invoice.currency || baseCurrency?.id;
        return ['posted', 'partially_paid', 'partially_settled'].includes(invoice.status)
          && compareDecimals(invoice.balance_due || 0, '0.005') > 0
          && invoiceCurrency === statementCurrency;
      }).map((invoice) => {
        const number = String(invoice.number || '').trim().toLocaleLowerCase();
        return { invoice, referenceMatch: Boolean(number && reference.includes(number)), amountMatch: sameAmount(invoice.balance_due, amount) };
      }).filter(({ referenceMatch, amountMatch }) => referenceMatch || amountMatch)
        .sort((a, b) => Number(b.referenceMatch) - Number(a.referenceMatch) || Number(b.amountMatch) - Number(a.amountMatch))
        .slice(0, 8);
      setInvoiceSuggestions((current) => ({ ...current, [line.id]: invoices }));
    } catch (reason) {
      setError(reason.message || t('Không tải được hóa đơn còn dư để gợi ý.'));
    } finally {
      setInvoiceSuggestionLoading((current) => ({ ...current, [line.id]: false }));
    }
  }
  function settlementHref(line, invoice) {
    const params = new URLSearchParams({
      invoice: invoice.id,
      party: invoice.party || '',
      currency: invoice.currency || selected?.currency || baseCurrency?.id || '',
      amount: String(compareDecimals(invoice.balance_due || 0, line.amount) < 0 ? invoice.balance_due : line.amount),
      date: line.transaction_date || today(),
      reference: line.reference || '',
    });
    return `${workbenchHref('settlements')}?${params.toString()}`;
  }
  async function autoMatch(line) {
    await run(`${line.id}:matched`, () => action('accounting.bank_statement_line', line, 'matched'), t('Đã tự khớp dòng với bút toán ngân hàng duy nhất phù hợp.'));
  }
  async function manualMatch(line) {
    const selection = matchChoices[line.id] || (line.payment ? `payment:${line.payment}` : line.journal_entry ? `journal:${line.journal_entry}` : '');
    const [kind, id] = selection.split(':');
    if (!id) { setError(t('Chọn payment hoặc bút toán đã ghi sổ trước khi khớp.')); return; }
    await run(`${line.id}:manual-match`, async () => {
      const fields = kind === 'payment' ? { payment: id, journal_entry: null } : { payment: null, journal_entry: id };
      await api(dataPath('accounting.bank_statement_line', line.id, 'matched'), { method: 'POST', body: fields });
    }, t('Đã đối chiếu dòng sao kê với chứng từ kế toán đã ghi sổ.'));
  }
  async function ignoreLine(line) {
    const reason = String(ignoreReasons[line.id] || line.ignore_reason || '').trim();
    if (!reason) { setError(t('Nhập lý do bỏ qua để lưu dấu vết kiểm toán.')); return; }
    await run(`${line.id}:ignored`, async () => {
      await api(dataPath('accounting.bank_statement_line', line.id, 'ignored'), { method: 'POST', body: { ignore_reason: reason } });
    }, t('Đã bỏ qua dòng sao kê và lưu lý do.'));
  }
  async function deleteLine(line) {
    if (!await confirmDialog({ title: t('Xóa dòng sao kê'), message: t('Xóa dòng chưa đối chiếu này khỏi sao kê?'), danger: true, confirmLabel: t('Xóa dòng') })) return;
    await run(`${line.id}:delete`, () => api(dataPath('accounting.bank_statement_line', line.id), { method: 'DELETE' }), t('Đã xóa dòng sao kê chưa đối chiếu.'));
  }
  async function reconcile() {
    if (!selected) return;
    await run(`${selected.id}:reconciled`, () => action('accounting.bank_statement', selected, 'reconciled'), t('Đã khóa đối soát sao kê.'));
  }
  async function cancelStatement() {
    if (!selected || !await confirmDialog({ title: t('Hủy sao kê'), message: t('Hủy sao kê {number}?').replace('{number}', selected.statement_number), danger: true, confirmLabel: t('Hủy sao kê') })) return;
    await run(`${selected.id}:cancelled`, () => action('accounting.bank_statement', selected, 'cancelled'), t('Đã hủy sao kê nháp.'));
  }
  const currencyCode = currencies.get(selected?.currency)?.code;
  const readyToReconcile = Boolean(selected && selected.status === 'draft' && selectedLines.length && totals.unmatched === 0 && compareDecimals(absDecimal(totals.difference), '0.005') <= 0);
  const paymentLabel = (payment) => `${fmtDate(payment.payment_date)} · ${parties.get(payment.party) ? recordLabel('master-data.party', parties.get(payment.party)) : payment.source || t('Thanh toán')} · ${fmtMoney(payment.amount, currencies.get(payment.currency)?.code || currencyCode)}`;
  const journalLabel = (entry) => `${fmtDate(entry.posting_date)} · ${entry.source || t('Bút toán')} · ${fmtMoney(absDecimal(bankNet(entry, bankAccount?.id)), app.meta?.settings?.baseCurrency || 'VND')}`;

  return {
    statementForm, setStatementForm, lineForm, setLineForm, statementFile, setStatementFile,
    bankFeedConnectorId, setBankFeedConnectorId, cassoSyncFrom, setCassoSyncFrom, cassoSyncTo, setCassoSyncTo,
    matchChoices, setMatchChoices, ignoreReasons, setIgnoreReasons, ignoreOpen, setIgnoreOpen,
    matcherOpen, candidateLoading, invoiceSuggestions, invoiceSuggestionLoading,
    busy, error, notice, selected, selectedBankFeed, bankFeedConnectors, syncAccountMapped, selectedLines,
    bankAccount, totals, currencyCode, readyToReconcile, load, createStatement, importFile, syncCasso, createLine,
    candidatesFor, paymentLabel, journalLabel, autoMatch, deleteLine, findCandidates, manualMatch,
    suggestInvoices, settlementHref, ignoreLine, reconcile, cancelStatement,
  };
}
