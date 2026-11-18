import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useDocumentTitle } from '../../lib/useDocumentTitle.js';
import { selectableTableRowProps } from '../../lib/accessibility.js';
import { localDate } from '../../lib/dates.js';
import { api, dataPath, tenantPath } from '../../lib/api.js';
import { confirmDialog } from '../../lib/feedback.js';
import { fmtDate, fmtMoney, statusLabel, uiTextWith } from '../../lib/i18n.js';
import { absDecimal, compareDecimals, subtractDecimals } from '../../lib/decimal.js';
import { app, can, recordLabel } from '../../lib/state.js';
import { recordHref } from '../../lib/routes.js';
import { amountsEqualWithin, calculateBankNet, calculateStatementTotals } from './domain/bankReconciliation.js';
import bankReconciliationEnglish from './bank-reconciliation.en.js';
import { useBankReconciliationData } from './hooks/useBankReconciliationData.js';
import BankStatementLinesTable from './components/BankStatementLinesTable.jsx';
const t = (text) => uiTextWith(text, bankReconciliationEnglish);
const today = localDate;
const shiftDate = (value, days) => { const date = new Date(`${value}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); };
const action = (entity, row, verb) => api(dataPath(entity, row.id, verb), { method: 'POST' });
const bankNet = (entry, accountId) => calculateBankNet(entry.lines, accountId);
const sameAmount = amountsEqualWithin;
const isBankAccount = (account) => /^112\d*$/.test(String(account?.code || '')) && account.kind === 'asset';
export default function BankReconciliationWorkbenchPage() {
  useDocumentTitle(`${t('Đối soát ngân hàng')} · OSP Suite`);
  const [matchCandidates, setMatchCandidates] = useState({});
  const [candidateLoading, setCandidateLoading] = useState({});
  const [matcherOpen, setMatcherOpen] = useState({});
  const [statementId, setStatementId] = useState('');
  const { statements, allLines, linesLoading, accounts, currencies, parties, baseCurrency, loading, error: dataError, setError: setDataError, load: loadData, loadLines } = useBankReconciliationData(statementId, t);
  const [statementForm, setStatementForm] = useState({ account: '', currency: '', statement_number: '', start_date: `${today().slice(0, 7)}-01`, end_date: today(), opening_balance: '', closing_balance: '' });
  const [lineForm, setLineForm] = useState({ transaction_date: today(), reference: '', description: '', direction: 'credit', amount: '' });
  const [statementFile, setStatementFile] = useState(null);
  const [cassoBankAccountId, setCassoBankAccountId] = useState('');
  const [matchChoices, setMatchChoices] = useState({});
  const [ignoreReasons, setIgnoreReasons] = useState({});
  const [ignoreOpen, setIgnoreOpen] = useState({});
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    setStatementId((id) => statements.some((row) => row.id === id) ? id : statements.find((row) => row.status === 'draft')?.id || statements[0]?.id || '');
  }, [statements]);
  useEffect(() => {
    setStatementForm((form) => ({ ...form, account: form.account || [...accounts.values()].find((account) => account.code === '112')?.id || [...accounts.values()].find(isBankAccount)?.id || '', currency: form.currency || baseCurrency?.id || '' }));
  }, [accounts, baseCurrency]);
  const load = async (quiet = false) => {
    if (!quiet) setError('');
    setDataError('');
    await loadData(quiet);
  };
  const selected = statements.find((row) => row.id === statementId);
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
    const casso = /\.json$/i.test(statementFile.name);
    await run(`${selected.id}:import`, async () => {
      const content = await statementFile.text();
      const payload = casso ? JSON.parse(content) : content;
      const result = await api(tenantPath(`/accounting/bank-statements/${selected.id}/${casso ? 'import-casso' : camt ? 'import-camt053' : 'import'}`), {
        method: 'POST', body: casso ? { ...payload, bankAccountId: cassoBankAccountId.trim() } : content, headers: { 'content-type': casso ? 'application/json' : camt ? 'application/xml; charset=utf-8' : 'text/csv; charset=utf-8' },
      });
      setStatementFile(null);
      return result;
    }, (result) => t('Đã nhập {imported} dòng; bỏ qua {skipped} dòng trùng.').replace('{imported}', result.imported).replace('{skipped}', result.skipped));
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
  return <div className="page">
    <div className="page-head"><div><h1>{t("Đối soát ngân hàng")}</h1><p className="sub">{t("Nhập sao kê, khớp từng giao dịch với payment hoặc bút toán đã ghi sổ, giải trình dòng bỏ qua và khóa kỳ khi số dư khớp.")}</p></div><button className="btn btn-secondary" type="button" disabled={loading || Boolean(busy)} onClick={async () => { await load(); await loadLines(statementId); }}>{t("Làm mới")}</button></div>
    {(error || dataError) && <div className="alert danger" role="alert">{t(error || dataError)}</div>}{notice && <div className="alert success" role="status">{t(notice)}</div>}
    {can('accounting.bank_statement.create') && <section className="card card-pad"><h2>{t("Mở sao kê ngân hàng")}</h2><form className="form-grid" onSubmit={createStatement}>
      <label className="field"><span className="label">{t("Tài khoản ngân hàng *")}</span><select className="select" required value={statementForm.account} onChange={(event) => setStatementForm((form) => ({ ...form, account: event.target.value }))}><option value="">{t("Chọn tài khoản nhóm 112")}</option>{[...accounts.values()].filter(isBankAccount).map((account) => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}</select></label>
      <label className="field"><span className="label">{t("Đồng tiền sao kê *")}</span><select className="select" required value={statementForm.currency} onChange={(event) => setStatementForm((form) => ({ ...form, currency: event.target.value }))}><option value="">{t("Chọn đồng tiền")}</option>{[...currencies.values()].map((currency) => <option key={currency.id} value={currency.id}>{currency.code} · {currency.name}</option>)}</select></label>
      <label className="field"><span className="label">{t("Số sao kê *")}</span><input className="input" required value={statementForm.statement_number} onChange={(event) => setStatementForm((form) => ({ ...form, statement_number: event.target.value }))}/></label>
      <label className="field"><span className="label">{t("Từ ngày *")}</span><input className="input" required type="date" value={statementForm.start_date} onChange={(event) => setStatementForm((form) => ({ ...form, start_date: event.target.value }))}/></label>
      <label className="field"><span className="label">{t("Đến ngày *")}</span><input className="input" required type="date" min={statementForm.start_date} value={statementForm.end_date} onChange={(event) => setStatementForm((form) => ({ ...form, end_date: event.target.value }))}/></label>
      <label className="field"><span className="label">{t("Số dư đầu kỳ *")}</span><input className="input num" required type="number" step="any" value={statementForm.opening_balance} onChange={(event) => setStatementForm((form) => ({ ...form, opening_balance: event.target.value }))}/></label>
      <label className="field"><span className="label">{t("Số dư cuối kỳ theo ngân hàng *")}</span><input className="input num" required type="number" step="any" value={statementForm.closing_balance} onChange={(event) => setStatementForm((form) => ({ ...form, closing_balance: event.target.value }))}/></label>
      <div className="row full"><span className="grow"/><button className="btn btn-primary" disabled={Boolean(busy) || loading || !statementForm.account || !statementForm.currency}>{t("Mở sao kê nháp")}</button></div>
    </form></section>}
    <div className="layout-split u-mt-16" >
      <section className="card card-pad"><h2>{t("Kỳ sao kê")}</h2>{loading ? <div className="skeleton" data-h="row"/> : !statements.length ? <div className="empty">{t("Chưa có sao kê ngân hàng.")}</div> : <div className="table-wrap"><table className="table"><thead><tr><th>{t("Số sao kê *")}</th><th>{t("Khoảng ngày")}</th><th>{t("Tài khoản")}</th><th>{t("Trạng thái")}</th></tr></thead><tbody>{statements.map((row) => <tr {...selectableTableRowProps} key={row.id} aria-selected={row.id === statementId} className={[row.id === statementId ? 'selected' : '', 'u-pointer'].filter(Boolean).join(' ')} onClick={() => setStatementId(row.id)} ><td><strong>{row.statement_number}</strong><div className="small muted">{currencies.get(row.currency)?.code || ''}</div></td><td>{fmtDate(row.start_date)} – {fmtDate(row.end_date)}</td><td>{accounts.get(row.account)?.code || '112'}</td><td><span className="badge warning">{statusLabel(row.status)}</span></td></tr>)}</tbody></table></div>}</section>
      {selected && <section className="card card-pad"><div className="row wrap"><div><h2>{t('Sao kê {number}').replace('{number}', selected.statement_number)}</h2><div className="small muted">{accounts.get(selected.account) ? recordLabel('accounting.account', accounts.get(selected.account)) : t('Tài khoản 112')} · {fmtDate(selected.start_date)} – {fmtDate(selected.end_date)} · {currencyCode}</div></div><span className="grow"/><span className={`badge ${selected.status === 'reconciled' ? 'success' : 'warning'}`}>{statusLabel(selected.status)}</span>{selected.status === 'draft' && can('accounting.bank_statement.cancelled') && <button className="btn btn-ghost btn-sm" disabled={Boolean(busy)} onClick={cancelStatement}>{t("Hủy sao kê")}</button>}</div>
        <div className="stats u-mt-12" ><div className="card stat"><span className="stat-label">{t("Giao dịch Có")}</span><strong className="stat-value num">{fmtMoney(totals.credits, currencyCode)}</strong></div><div className="card stat"><span className="stat-label">{t("Giao dịch Nợ")}</span><strong className="stat-value num">{fmtMoney(totals.debits, currencyCode)}</strong></div><div className="card stat"><span className="stat-label">{t("Khớp / bỏ qua")}</span><strong className="stat-value">{totals.matched} / {totals.ignored}</strong><span className="small muted">{t("Còn {count} chưa xử lý").replace("{count}", totals.unmatched)}</span></div><div className="card stat"><span className="stat-label">{t("Số dư tính toán / sao kê")}</span><strong className="stat-value num">{fmtMoney(totals.calculated, currencyCode)}</strong><span className={`small ${compareDecimals(absDecimal(totals.difference), '0.005') <= 0 ? 'muted' : 'danger'}`}>{t("Chênh lệch {amount}").replace("{amount}", fmtMoney(totals.difference, currencyCode))}</span></div></div>
        {selected.status === 'draft' && <><div className="row wrap u-mt-12" ><label className="field grow"><span className="label">{t("Tệp CSV, CAMT.053 hoặc JSON Casso")}</span><input className="input" type="file" accept=".csv,.xml,.camt,.json,text/csv,application/xml,text/xml,application/json" disabled={Boolean(busy)} onChange={(event) => setStatementFile(event.target.files?.[0] || null)}/></label>{statementFile && /\.json$/i.test(statementFile.name) && <label className="field"><span className="label">{t("Số tài khoản Casso trên sao kê *")}</span><input className="input" required maxLength={128} value={cassoBankAccountId} onChange={(event) => setCassoBankAccountId(event.target.value)} /><span className="small muted">{t("Xác nhận số này khớp với tài khoản ngân hàng của sao kê đang chọn.")}</span></label>}<button className="btn btn-secondary" type="button" disabled={!statementFile || (statementFile && /\.json$/i.test(statementFile.name) && !cassoBankAccountId.trim()) || Boolean(busy)} onClick={importFile}>{t("Nhập {format}").replace("{format}", statementFile && /\.json$/i.test(statementFile.name) ? 'Casso JSON' : statementFile && /\.(xml|camt)$/i.test(statementFile.name) ? 'CAMT.053' : 'CSV')}</button><a className="small" href={recordHref('accounting.bank_statement', selected.id)}>{t("Mở chi tiết / sửa số dư")}</a></div>
          {can('accounting.bank_statement_line.create') && <form className="form-grid u-mt-12"  onSubmit={createLine}><div className="full"><h3>{t("Thêm giao dịch thủ công")}</h3></div><label className="field"><span className="label">{t("Ngày giao dịch *")}</span><input className="input" required type="date" min={selected.start_date} max={selected.end_date} value={lineForm.transaction_date} onChange={(event) => setLineForm((form) => ({ ...form, transaction_date: event.target.value }))}/></label><label className="field"><span className="label">{t("Chiều tiền *")}</span><select className="select" value={lineForm.direction} onChange={(event) => setLineForm((form) => ({ ...form, direction: event.target.value }))}><option value="credit">{t("Có · tiền vào")}</option><option value="debit">{t("Nợ · tiền ra")}</option></select></label><label className="field"><span className="label">{t("Số tiền *")}</span><input className="input num" required type="number" min="0.01" step="any" value={lineForm.amount} onChange={(event) => setLineForm((form) => ({ ...form, amount: event.target.value }))}/></label><label className="field"><span className="label">{t("Mã tham chiếu")}</span><input className="input" value={lineForm.reference} onChange={(event) => setLineForm((form) => ({ ...form, reference: event.target.value }))}/></label><label className="field"><span className="label">{t("Diễn giải")}</span><input className="input" value={lineForm.description} onChange={(event) => setLineForm((form) => ({ ...form, description: event.target.value }))}/></label><div className="row full"><span className="grow"/><button className="btn btn-secondary" disabled={Boolean(busy) || !lineForm.amount}>{t("Thêm dòng")}</button></div></form>}
        </>}
        <BankStatementLinesTable
          lines={selectedLines} loading={linesLoading} draft={selected.status === 'draft'} busy={busy}
          currencyCode={currencyCode} t={t} fmtDate={fmtDate} fmtMoney={fmtMoney} statusLabel={statusLabel}
          candidatesFor={candidatesFor} paymentLabel={paymentLabel} journalLabel={journalLabel}
          matcherOpen={matcherOpen} candidateLoading={candidateLoading} matchChoices={matchChoices}
          ignoreOpen={ignoreOpen} ignoreReasons={ignoreReasons}
          permissions={{
            match: can('accounting.bank_statement_line.matched'),
            delete: can('accounting.bank_statement_line.delete'),
            findCandidates: can('accounting.payment.read') && can('accounting.journal_entry.read'),
            ignore: can('accounting.bank_statement_line.ignored'),
            update: can('accounting.bank_statement_line.update'),
          }}
          onAutoMatch={autoMatch} onDeleteLine={deleteLine} onFindCandidates={findCandidates}
          onMatchChoiceChange={(line, value) => setMatchChoices((current) => ({ ...current, [line.id]: value }))}
          onManualMatch={manualMatch}
          onToggleIgnore={(line) => setIgnoreOpen((current) => ({ ...current, [line.id]: !current[line.id] }))}
          onIgnoreReasonChange={(line, value) => setIgnoreReasons((current) => ({ ...current, [line.id]: value }))}
          onIgnoreLine={ignoreLine}
        />        {selected.status === 'draft' && <div className="row wrap u-mt-14" ><span className="small muted">{t("Số cuối kỳ tính từ đầu kỳ + tiền vào − tiền ra. Mọi dòng cần được khớp hoặc có lý do bỏ qua.")}</span><span className="grow"/><button className="btn btn-primary" disabled={Boolean(busy) || !readyToReconcile || !can('accounting.bank_statement.reconciled')} onClick={reconcile}>{t("Đối soát và khóa sao kê")}</button></div>}
      </section>}
    </div>
    <p className="small muted u-mt-12" >{t("Tự khớp chỉ chạy khi backend tìm được duy nhất một bút toán TK 112 đã ghi sổ đúng ngày, chiều và số tiền. Khi có nhiều ứng viên, chọn payment hoặc bút toán thủ công; server vẫn kiểm tra đồng tiền, số tiền quy đổi và việc một bút toán không bị dùng hai lần.")}</p>
  </div>;
}
