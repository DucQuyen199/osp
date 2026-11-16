import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { selectableTableRowProps } from '../../lib/accessibility.js';
import { localDate } from '../../lib/dates.js';
import { api, dataPath, tenantPath } from '../../lib/api.js';
import { confirmDialog } from '../../lib/feedback.js';
import { fmtDate, fmtMoney, statusLabel, uiText } from '../../lib/i18n.js';
import { app, can, loadRefs, recordLabel } from '../../lib/state.js';
import { recordHref } from '../../lib/routes.js';

const itemsOf = (response) => Array.isArray(response?.items) ? response.items : [];
async function listAll(qname, filters = {}) {
  const rows = [];
  let total = Number.POSITIVE_INFINITY;
  for (let offset = 0; offset < total; offset += 1000) {
    const query = new URLSearchParams({ ...filters, limit: '1000', offset: String(offset) });
    const response = await api(`${dataPath(qname)}?${query}`);
    const items = itemsOf(response);
    rows.push(...items);
    total = Number(response?.total ?? rows.length);
    if (!items.length) break;
  }
  return rows;
}
const today = localDate;
const shiftDate = (value, days) => { const date = new Date(`${value}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); };
const money = (value) => Number(value || 0);
const action = (entity, row, verb) => api(dataPath(entity, row.id, verb), { method: 'POST' });
const bankNet = (entry, accountId) => (entry.lines || []).filter((line) => line.account === accountId)
  .reduce((sum, line) => sum + money(line.debit) - money(line.credit), 0);
const sameAmount = (left, right) => Math.abs(money(left) - money(right)) <= .005;
const isBankAccount = (account) => /^112\d*$/.test(String(account?.code || '')) && account.kind === 'asset';

export default function BankReconciliationWorkbenchPage() {
  const [statements, setStatements] = useState([]);
  const [allLines, setAllLines] = useState([]);
  const [linesLoading, setLinesLoading] = useState(false);
  const [matchCandidates, setMatchCandidates] = useState({});
  const [candidateLoading, setCandidateLoading] = useState({});
  const [matcherOpen, setMatcherOpen] = useState({});
  const [accounts, setAccounts] = useState(new Map());
  const [currencies, setCurrencies] = useState(new Map());
  const [parties, setParties] = useState(new Map());
  const [statementId, setStatementId] = useState('');
  const [statementForm, setStatementForm] = useState({ account: '', currency: '', statement_number: '', start_date: `${today().slice(0, 7)}-01`, end_date: today(), opening_balance: '', closing_balance: '' });
  const [lineForm, setLineForm] = useState({ transaction_date: today(), reference: '', description: '', direction: 'credit', amount: '' });
  const [statementFile, setStatementFile] = useState(null);
  const [matchChoices, setMatchChoices] = useState({});
  const [ignoreReasons, setIgnoreReasons] = useState({});
  const [ignoreOpen, setIgnoreOpen] = useState({});
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const lineLoadVersion = useRef(0);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) { setLoading(true); setError(''); }
    try {
      const [statementRows, accountMap, currencyMap, partyMap] = await Promise.all([
        can('accounting.bank_statement.read') ? listAll('accounting.bank_statement') : Promise.resolve([]),
        can('accounting.account.read') ? loadRefs('accounting.account') : Promise.resolve(new Map()),
        can('master-data.currency.read') ? loadRefs('master-data.currency') : Promise.resolve(new Map()),
        can('master-data.party.read') ? loadRefs('master-data.party') : Promise.resolve(new Map()),
      ]);
      statementRows.sort((a, b) => String(b.start_date || '').localeCompare(String(a.start_date || '')));
      setStatements(statementRows);
      setAccounts(accountMap); setCurrencies(currencyMap); setParties(partyMap);
      setStatementId((id) => statementRows.some((row) => row.id === id) ? id : statementRows.find((row) => row.status === 'draft')?.id || statementRows[0]?.id || '');
      const baseCurrency = [...currencyMap.values()].find((currency) => String(currency.code).toUpperCase() === String(app.meta?.settings?.baseCurrency || 'VND').toUpperCase());
      setStatementForm((form) => ({ ...form, account: form.account || [...accountMap.values()].find((account) => account.code === '112')?.id || [...accountMap.values()].find(isBankAccount)?.id || '', currency: form.currency || baseCurrency?.id || '' }));
    } catch (reason) { setError(reason.message || uiText('Không tải được dữ liệu đối soát ngân hàng.')); }
    finally { if (!quiet) setLoading(false); }
  }, []);

  const loadLines = useCallback(async (id) => {
    const version = ++lineLoadVersion.current;
    if (!id || !can('accounting.bank_statement_line.read')) { setAllLines([]); setLinesLoading(false); return; }
    setLinesLoading(true);
    try { const rows = await listAll('accounting.bank_statement_line', { statement: id }); if (version === lineLoadVersion.current) setAllLines(rows); }
    catch (reason) { if (version === lineLoadVersion.current) setError(reason.message || uiText('Không tải được các dòng trong sao kê.')); }
    finally { if (version === lineLoadVersion.current) setLinesLoading(false); }
  }, []);

  useEffect(() => { document.title = `${uiText('Đối soát ngân hàng')} · OSP Suite`; load(); }, [load]);
  useEffect(() => { loadLines(statementId); }, [statementId, loadLines]);

  const selected = statements.find((row) => row.id === statementId);
  const selectedLines = useMemo(() => [...allLines].sort((a, b) => String(a.transaction_date || '').localeCompare(String(b.transaction_date || '')) || String(a.reference || '').localeCompare(String(b.reference || ''))), [allLines]);
  const bankAccount = useMemo(() => accounts.get(selected?.account) || [...accounts.values()].find((account) => account.code === '112'), [accounts, selected?.account]);
  const baseCurrency = useMemo(() => [...currencies.values()].find((currency) => String(currency.code).toUpperCase() === String(app.meta?.settings?.baseCurrency || 'VND').toUpperCase()), [currencies]);
  const matchedPaymentIds = useMemo(() => new Set(allLines.filter((line) => line.status === 'matched' && line.payment).map((line) => line.payment)), [allLines]);
  const matchedJournalIds = useMemo(() => new Set(allLines.filter((line) => line.status === 'matched' && line.journal_entry).map((line) => line.journal_entry)), [allLines]);

  const totals = useMemo(() => {
    const credits = selectedLines.filter((line) => line.direction === 'credit').reduce((sum, line) => sum + money(line.amount), 0);
    const debits = selectedLines.filter((line) => line.direction === 'debit').reduce((sum, line) => sum + money(line.amount), 0);
    const matched = selectedLines.filter((line) => line.status === 'matched').length;
    const ignored = selectedLines.filter((line) => line.status === 'ignored').length;
    const unmatched = selectedLines.length - matched - ignored;
    const calculated = money(selected?.opening_balance) + credits - debits;
    return { credits, debits, matched, ignored, unmatched, calculated, difference: money(selected?.closing_balance) - calculated };
  }, [selected, selectedLines]);

  async function run(key, operation, success) {
    setBusy(key); setError(''); setNotice('');
    try { const result = await operation(); setNotice(typeof success === 'function' ? success(result) : success); await load(true); await loadLines(statementId); }
    catch (reason) { setError(reason.message || uiText('Thao tác đối soát không thành công.')); await load(true); await loadLines(statementId); }
    finally { setBusy(''); }
  }

  async function createStatement(event) {
    event.preventDefault();
    await run('statement:create', async () => {
      const created = await api(dataPath('accounting.bank_statement'), { method: 'POST', body: {
        ...statementForm, opening_balance: Number(statementForm.opening_balance), closing_balance: Number(statementForm.closing_balance),
      } });
      setStatementId(created.id);
      setStatementForm((form) => ({ ...form, statement_number: '', opening_balance: '', closing_balance: '' }));
    }, uiText('Đã mở kỳ sao kê nháp. Nhập tệp ngân hàng hoặc thêm giao dịch để bắt đầu đối chiếu.'));
  }

  async function importFile() {
    if (!selected || !statementFile) return;
    const camt = /\.(xml|camt)$/i.test(statementFile.name);
    await run(`${selected.id}:import`, async () => {
      const result = await api(tenantPath(`/accounting/bank-statements/${selected.id}/${camt ? 'import-camt053' : 'import'}`), {
        method: 'POST', body: await statementFile.text(), headers: { 'content-type': camt ? 'application/xml; charset=utf-8' : 'text/csv; charset=utf-8' },
      });
      setStatementFile(null);
      return result;
    }, (result) => uiText('Đã nhập {imported} dòng; bỏ qua {skipped} dòng trùng.').replace('{imported}', result.imported).replace('{skipped}', result.skipped));
  }

  async function createLine(event) {
    event.preventDefault(); if (!selected) return;
    await run(`${selected.id}:line:create`, async () => {
      await api(dataPath('accounting.bank_statement_line'), { method: 'POST', body: {
        statement: selected.id, ...lineForm, amount: Number(lineForm.amount), reference: lineForm.reference.trim() || undefined, description: lineForm.description.trim() || undefined,
      } });
      setLineForm((form) => ({ ...form, reference: '', description: '', amount: '' }));
    }, uiText('Đã thêm giao dịch vào sao kê.'));
  }

  function candidatesFor(line, override) {
    if (!selected || !bankAccount) return { payments: [], journals: [] };
    const source = override || matchCandidates[line.id] || { payments: [], journals: [] };
    const expected = line.direction === 'credit' ? money(line.base_amount ?? line.amount) : -money(line.base_amount ?? line.amount);
    const statementCurrency = selected.currency || baseCurrency?.id;
    const journalsByPayment = new Map(source.journals.filter((entry) => entry.source === 'payment' && entry.status === 'posted').map((entry) => [entry.source_id, entry]));
    const paymentCandidates = source.payments.filter((payment) => {
      const journal = journalsByPayment.get(payment.id);
      const currency = payment.currency || baseCurrency?.id;
      return journal && ['bank', 'transfer'].includes(payment.method) && currency === statementCurrency
        && sameAmount(Math.abs(money(payment.amount)), line.amount) && sameAmount(Math.abs(money(payment.base_amount ?? payment.amount)), line.base_amount ?? line.amount)
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
          listAll('accounting.payment', { payment_date: date, method: 'bank' }),
          listAll('accounting.payment', { payment_date: date, method: 'transfer' }),
          listAll('accounting.journal_entry', { posting_date: date, status: 'posted' }),
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
    } catch (reason) { setError(reason.message || uiText('Không tải được chứng từ để khớp giao dịch.')); }
    finally { setCandidateLoading((current) => ({ ...current, [line.id]: false })); }
  }

  async function autoMatch(line) {
    await run(`${line.id}:matched`, () => action('accounting.bank_statement_line', line, 'matched'), uiText('Đã tự khớp dòng với bút toán ngân hàng duy nhất phù hợp.'));
  }

  async function manualMatch(line) {
    const selection = matchChoices[line.id] || (line.payment ? `payment:${line.payment}` : line.journal_entry ? `journal:${line.journal_entry}` : '');
    const [kind, id] = selection.split(':');
    if (!id) { setError(uiText('Chọn payment hoặc bút toán đã ghi sổ trước khi khớp.')); return; }
    await run(`${line.id}:manual-match`, async () => {
      const fields = kind === 'payment' ? { payment: id, journal_entry: null } : { payment: null, journal_entry: id };
      await api(dataPath('accounting.bank_statement_line', line.id, 'matched'), { method: 'POST', body: fields });
    }, uiText('Đã đối chiếu dòng sao kê với chứng từ kế toán đã ghi sổ.'));
  }

  async function ignoreLine(line) {
    const reason = String(ignoreReasons[line.id] || line.ignore_reason || '').trim();
    if (!reason) { setError(uiText('Nhập lý do bỏ qua để lưu dấu vết kiểm toán.')); return; }
    await run(`${line.id}:ignored`, async () => {
      await api(dataPath('accounting.bank_statement_line', line.id, 'ignored'), { method: 'POST', body: { ignore_reason: reason } });
    }, uiText('Đã bỏ qua dòng sao kê và lưu lý do.'));
  }

  async function deleteLine(line) {
    if (!await confirmDialog({ title: uiText('Xóa dòng sao kê'), message: uiText('Xóa dòng chưa đối chiếu này khỏi sao kê?'), danger: true, confirmLabel: uiText('Xóa dòng') })) return;
    await run(`${line.id}:delete`, () => api(dataPath('accounting.bank_statement_line', line.id), { method: 'DELETE' }), uiText('Đã xóa dòng sao kê chưa đối chiếu.'));
  }

  async function reconcile() {
    if (!selected) return;
    await run(`${selected.id}:reconciled`, () => action('accounting.bank_statement', selected, 'reconciled'), uiText('Đã khóa đối soát sao kê.'));
  }

  async function cancelStatement() {
    if (!selected || !await confirmDialog({ title: uiText('Hủy sao kê'), message: uiText('Hủy sao kê {number}?').replace('{number}', selected.statement_number), danger: true, confirmLabel: uiText('Hủy sao kê') })) return;
    await run(`${selected.id}:cancelled`, () => action('accounting.bank_statement', selected, 'cancelled'), uiText('Đã hủy sao kê nháp.'));
  }

  const currencyCode = currencies.get(selected?.currency)?.code;
  const readyToReconcile = Boolean(selected && selected.status === 'draft' && selectedLines.length && totals.unmatched === 0 && Math.abs(totals.difference) <= .005);

  return <div className="page">
    <div className="page-head"><div><h1>{uiText("Đối soát ngân hàng")}</h1><p className="sub">{uiText("Nhập sao kê, khớp từng giao dịch với payment hoặc bút toán đã ghi sổ, giải trình dòng bỏ qua và khóa kỳ khi số dư khớp.")}</p></div><button className="btn btn-secondary" type="button" disabled={loading || Boolean(busy)} onClick={async () => { await load(); await loadLines(statementId); }}>{uiText("Làm mới")}</button></div>
    {error && <div className="alert danger" role="alert">{uiText(error)}</div>}{notice && <div className="alert success" role="status">{uiText(notice)}</div>}

    {can('accounting.bank_statement.create') && <section className="card card-pad"><h2>{uiText("Mở sao kê ngân hàng")}</h2><form className="form-grid" onSubmit={createStatement}>
      <label className="field"><span className="label">{uiText("Tài khoản ngân hàng *")}</span><select className="select" required value={statementForm.account} onChange={(event) => setStatementForm((form) => ({ ...form, account: event.target.value }))}><option value="">{uiText("Chọn tài khoản nhóm 112")}</option>{[...accounts.values()].filter(isBankAccount).map((account) => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}</select></label>
      <label className="field"><span className="label">{uiText("Đồng tiền sao kê *")}</span><select className="select" required value={statementForm.currency} onChange={(event) => setStatementForm((form) => ({ ...form, currency: event.target.value }))}><option value="">{uiText("Chọn đồng tiền")}</option>{[...currencies.values()].map((currency) => <option key={currency.id} value={currency.id}>{currency.code} · {currency.name}</option>)}</select></label>
      <label className="field"><span className="label">{uiText("Số sao kê *")}</span><input className="input" required value={statementForm.statement_number} onChange={(event) => setStatementForm((form) => ({ ...form, statement_number: event.target.value }))}/></label>
      <label className="field"><span className="label">{uiText("Từ ngày *")}</span><input className="input" required type="date" value={statementForm.start_date} onChange={(event) => setStatementForm((form) => ({ ...form, start_date: event.target.value }))}/></label>
      <label className="field"><span className="label">{uiText("Đến ngày *")}</span><input className="input" required type="date" min={statementForm.start_date} value={statementForm.end_date} onChange={(event) => setStatementForm((form) => ({ ...form, end_date: event.target.value }))}/></label>
      <label className="field"><span className="label">{uiText("Số dư đầu kỳ *")}</span><input className="input num" required type="number" step="any" value={statementForm.opening_balance} onChange={(event) => setStatementForm((form) => ({ ...form, opening_balance: event.target.value }))}/></label>
      <label className="field"><span className="label">{uiText("Số dư cuối kỳ theo ngân hàng *")}</span><input className="input num" required type="number" step="any" value={statementForm.closing_balance} onChange={(event) => setStatementForm((form) => ({ ...form, closing_balance: event.target.value }))}/></label>
      <div className="row full"><span className="grow"/><button className="btn btn-primary" disabled={Boolean(busy) || loading || !statementForm.account || !statementForm.currency}>{uiText("Mở sao kê nháp")}</button></div>
    </form></section>}

    <div className="layout-split u-legacy-92c18f6bda" >
      <section className="card card-pad"><h2>{uiText("Kỳ sao kê")}</h2>{loading ? <div className="skeleton" data-h="row"/> : !statements.length ? <div className="empty">{uiText("Chưa có sao kê ngân hàng.")}</div> : <div className="table-wrap"><table className="table"><thead><tr><th>{uiText("Số sao kê *")}</th><th>{uiText("Khoảng ngày")}</th><th>{uiText("Tài khoản")}</th><th>{uiText("Trạng thái")}</th></tr></thead><tbody>{statements.map((row) => <tr {...selectableTableRowProps} key={row.id} aria-selected={row.id === statementId} className={[row.id === statementId ? 'selected' : '', 'u-legacy-9463ff4798'].filter(Boolean).join(' ')} onClick={() => setStatementId(row.id)} ><td><strong>{row.statement_number}</strong><div className="small muted">{currencies.get(row.currency)?.code || ''}</div></td><td>{fmtDate(row.start_date)} – {fmtDate(row.end_date)}</td><td>{accounts.get(row.account)?.code || '112'}</td><td><span className="badge warning">{statusLabel(row.status)}</span></td></tr>)}</tbody></table></div>}</section>

      {selected && <section className="card card-pad"><div className="row wrap"><div><h2>{uiText('Sao kê {number}').replace('{number}', selected.statement_number)}</h2><div className="small muted">{accounts.get(selected.account) ? recordLabel('accounting.account', accounts.get(selected.account)) : uiText('Tài khoản 112')} · {fmtDate(selected.start_date)} – {fmtDate(selected.end_date)} · {currencyCode}</div></div><span className="grow"/><span className={`badge ${selected.status === 'reconciled' ? 'success' : 'warning'}`}>{statusLabel(selected.status)}</span>{selected.status === 'draft' && can('accounting.bank_statement.cancelled') && <button className="btn btn-ghost btn-sm" disabled={Boolean(busy)} onClick={cancelStatement}>{uiText("Hủy sao kê")}</button>}</div>
        <div className="stats u-legacy-0ee7f66ad9" ><div className="card stat"><span className="stat-label">{uiText("Giao dịch Có")}</span><strong className="stat-value num">{fmtMoney(totals.credits, currencyCode)}</strong></div><div className="card stat"><span className="stat-label">{uiText("Giao dịch Nợ")}</span><strong className="stat-value num">{fmtMoney(totals.debits, currencyCode)}</strong></div><div className="card stat"><span className="stat-label">{uiText("Khớp / bỏ qua")}</span><strong className="stat-value">{totals.matched} / {totals.ignored}</strong><span className="small muted">{uiText("Còn {count} chưa xử lý").replace("{count}", totals.unmatched)}</span></div><div className="card stat"><span className="stat-label">{uiText("Số dư tính toán / sao kê")}</span><strong className="stat-value num">{fmtMoney(totals.calculated, currencyCode)}</strong><span className={`small ${Math.abs(totals.difference) <= .005 ? 'muted' : 'danger'}`}>{uiText("Chênh lệch {amount}").replace("{amount}", fmtMoney(totals.difference, currencyCode))}</span></div></div>

        {selected.status === 'draft' && <><div className="row wrap u-legacy-0ee7f66ad9" ><label className="field grow"><span className="label">{uiText("Tệp CSV hoặc CAMT.053")}</span><input className="input" type="file" accept=".csv,.xml,.camt,text/csv,application/xml,text/xml" disabled={Boolean(busy)} onChange={(event) => setStatementFile(event.target.files?.[0] || null)}/></label><button className="btn btn-secondary" type="button" disabled={!statementFile || Boolean(busy)} onClick={importFile}>{uiText("Nhập {format}").replace("{format}", statementFile && /\.(xml|camt)$/i.test(statementFile.name) ? 'CAMT.053' : 'CSV')}</button><a className="small" href={recordHref('accounting.bank_statement', selected.id)}>{uiText("Mở chi tiết / sửa số dư")}</a></div>
          {can('accounting.bank_statement_line.create') && <form className="form-grid u-legacy-0ee7f66ad9"  onSubmit={createLine}><div className="full"><h3>{uiText("Thêm giao dịch thủ công")}</h3></div><label className="field"><span className="label">{uiText("Ngày giao dịch *")}</span><input className="input" required type="date" min={selected.start_date} max={selected.end_date} value={lineForm.transaction_date} onChange={(event) => setLineForm((form) => ({ ...form, transaction_date: event.target.value }))}/></label><label className="field"><span className="label">{uiText("Chiều tiền *")}</span><select className="select" value={lineForm.direction} onChange={(event) => setLineForm((form) => ({ ...form, direction: event.target.value }))}><option value="credit">{uiText("Có · tiền vào")}</option><option value="debit">{uiText("Nợ · tiền ra")}</option></select></label><label className="field"><span className="label">{uiText("Số tiền *")}</span><input className="input num" required type="number" min="0.01" step="any" value={lineForm.amount} onChange={(event) => setLineForm((form) => ({ ...form, amount: event.target.value }))}/></label><label className="field"><span className="label">{uiText("Mã tham chiếu")}</span><input className="input" value={lineForm.reference} onChange={(event) => setLineForm((form) => ({ ...form, reference: event.target.value }))}/></label><label className="field"><span className="label">{uiText("Diễn giải")}</span><input className="input" value={lineForm.description} onChange={(event) => setLineForm((form) => ({ ...form, description: event.target.value }))}/></label><div className="row full"><span className="grow"/><button className="btn btn-secondary" disabled={Boolean(busy) || !lineForm.amount}>{uiText("Thêm dòng")}</button></div></form>}
        </>}

        <div className="table-wrap u-legacy-c53ea1da23" >{linesLoading ? <div className="skeleton" data-h="row"/> : !selectedLines.length ? <div className="empty">{uiText("Chưa có giao dịch. Nhập tệp sao kê hoặc thêm dòng thủ công.")}</div> : <table className="table"><thead><tr><th>{uiText("Ngày / tham chiếu")}</th><th>{uiText("Diễn giải")}</th><th>{uiText("Chiều")}</th><th>{uiText("Số tiền")}</th><th>{uiText("Đối chiếu / thao tác")}</th></tr></thead><tbody>{selectedLines.map((line) => {
          const options = candidatesFor(line);
          const currentChoice = matchChoices[line.id] || (line.payment ? `payment:${line.payment}` : line.journal_entry ? `journal:${line.journal_entry}` : '');
          const paymentLabel = (payment) => `${fmtDate(payment.payment_date)} · ${parties.get(payment.party) ? recordLabel('master-data.party', parties.get(payment.party)) : payment.source || uiText('Thanh to\u00e1n')} · ${fmtMoney(payment.amount, currencies.get(payment.currency)?.code || currencyCode)}`;
          const journalLabel = (entry) => `${fmtDate(entry.posting_date)} · ${entry.source || uiText('Bút toán')} · ${fmtMoney(Math.abs(bankNet(entry, bankAccount?.id)), app.meta?.settings?.baseCurrency || 'VND')}`;
          return <tr key={line.id}><td>{fmtDate(line.transaction_date)}<div className="small muted">{line.reference || uiText('Không có mã tham chiếu')}</div></td><td>{line.description || '—'}{line.status === 'ignored' && <div className="small muted">{uiText("Lý do: {reason}").replace("{reason}", line.ignore_reason)}</div>}</td><td>{line.direction === 'credit' ? uiText('Có · vào') : uiText('Nợ · ra')}</td><td className="num">{fmtMoney(line.amount, currencyCode)}</td><td><div className="stack-sm"><span className={`badge ${line.status === 'matched' ? 'success' : line.status === 'ignored' ? 'plain' : 'warning'}`}>{statusLabel(line.status)}</span>
            {line.status === 'unmatched' && selected.status === 'draft' && <><div className="row wrap"><button className="btn btn-primary btn-sm" disabled={Boolean(busy) || !can('accounting.bank_statement_line.matched')} onClick={() => autoMatch(line)}>{uiText("Tự khớp duy nhất")}</button><button className="btn btn-ghost btn-sm" disabled={Boolean(busy) || !can('accounting.bank_statement_line.delete')} onClick={() => deleteLine(line)}>{uiText("Xóa dòng")}</button></div>{!matcherOpen[line.id] ? <button className="btn btn-ghost btn-sm" disabled={Boolean(busy) || !can('accounting.payment.read') || !can('accounting.journal_entry.read')} onClick={() => findCandidates(line)}>{uiText("Tìm chứng từ quanh ngày để khớp")}</button> : candidateLoading[line.id] ? <span className="small muted">{uiText("Đang tìm payment và bút toán…")}</span> : <><select className="select" aria-label={uiText("Chọn payment hoặc bút toán đã ghi sổ")} value={currentChoice} disabled={Boolean(busy)} onChange={(event) => setMatchChoices((current) => ({ ...current, [line.id]: event.target.value }))}><option value="">{uiText("Chọn chứng từ khớp thủ công…")}</option>{options.payments.length > 0 && <optgroup label={uiText("Payment ngân hàng")}>{options.payments.map((payment) => <option key={payment.id} value={`payment:${payment.id}`}>{paymentLabel(payment)}</option>)}</optgroup>}{options.journals.length > 0 && <optgroup label={uiText("Bút toán ngân hàng đã ghi sổ")}>{options.journals.map((entry) => <option key={entry.id} value={`journal:${entry.id}`}>{journalLabel(entry)}</option>)}</optgroup>}</select>{!options.payments.length && !options.journals.length && <span className="small muted">{uiText("Không thấy chứng từ ghi sổ cùng ngày, chiều và số tiền. Tự khớp vẫn có thể tìm đúng bút toán duy nhất.")}</span>}</>}<div className="row wrap"><button className="btn btn-secondary btn-sm" disabled={Boolean(busy) || !currentChoice || !can('accounting.bank_statement_line.matched') || !can('accounting.bank_statement_line.update')} onClick={() => manualMatch(line)}>{uiText("Khớp chứng từ đã chọn")}</button><button className="btn btn-ghost btn-sm" disabled={Boolean(busy) || !can('accounting.bank_statement_line.ignored') || !can('accounting.bank_statement_line.update')} onClick={() => setIgnoreOpen((current) => ({ ...current, [line.id]: !current[line.id] }))}>{uiText("Bỏ qua có giải trình")}</button></div>{ignoreOpen[line.id] && <><input className="input" maxLength="500" aria-label={uiText("Lý do bỏ qua giao dịch")} placeholder={uiText("Nhập lý do bắt buộc")} value={ignoreReasons[line.id] || ''} onChange={(event) => setIgnoreReasons((current) => ({ ...current, [line.id]: event.target.value }))}/><button className="btn btn-sm" disabled={Boolean(busy) || !ignoreReasons[line.id]?.trim() || !can('accounting.bank_statement_line.update')} onClick={() => ignoreLine(line)}>{uiText("Lưu lý do và bỏ qua")}</button></>}</>}
            {line.status === 'matched' && <span className="small muted">{line.payment ? <a href={recordHref('accounting.payment', line.payment)}>{uiText("Mở payment")}</a> : line.journal_entry ? <a href={recordHref('accounting.journal_entry', line.journal_entry)}>{uiText("Mở bút toán")}</a> : uiText('Đã khớp')}</span>}
          </div></td></tr>;
        })}</tbody></table>}</div>
        {selected.status === 'draft' && <div className="row wrap u-legacy-c53ea1da23" ><span className="small muted">{uiText("Số cuối kỳ tính từ đầu kỳ + tiền vào − tiền ra. Mọi dòng cần được khớp hoặc có lý do bỏ qua.")}</span><span className="grow"/><button className="btn btn-primary" disabled={Boolean(busy) || !readyToReconcile || !can('accounting.bank_statement.reconciled')} onClick={reconcile}>{uiText("Đối soát và khóa sao kê")}</button></div>}
      </section>}
    </div>
    <p className="small muted u-legacy-0ee7f66ad9" >{uiText("Tự khớp chỉ chạy khi backend tìm được duy nhất một bút toán TK 112 đã ghi sổ đúng ngày, chiều và số tiền. Khi có nhiều ứng viên, chọn payment hoặc bút toán thủ công; server vẫn kiểm tra đồng tiền, số tiền quy đổi và việc một bút toán không bị dùng hai lần.")}</p>
  </div>;
}
