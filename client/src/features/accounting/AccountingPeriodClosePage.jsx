import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useDocumentTitle } from '../../lib/useDocumentTitle.js';
import { selectableTableRowProps } from '../../lib/accessibility.js';
import { localDate } from '../../lib/dates.js';
import { api, dataPath } from '../../lib/api.js';
import { confirmDialog } from '../../lib/feedback.js';
import { fmtDate, fmtMoney, statusLabel, uiText } from '../../lib/i18n.js';
import { app, can, loadAll } from '../../lib/state.js';
import { recordHref } from '../../lib/routes.js';
const today = localDate;
const monthStart = () => `${today().slice(0, 7)}-01`;
const monthEnd = () => new Date(Date.UTC(Number(today().slice(0, 4)), Number(today().slice(5, 7)), 0)).toISOString().slice(0, 10);
const dateForJournal = (row) => row.posting_date || String(row.createdAt || '').slice(0, 10);
const inPeriod = (date, period) => Boolean(date && period && date >= period.start_date && date <= period.end_date);
export default function AccountingPeriodClosePage() {
  useDocumentTitle(`${uiText('Khóa sổ kế toán')} · OSP Suite`);
  const [periods, setPeriods] = useState([]);
  const [draftStatements, setDraftStatements] = useState([]);
  const [draftJournals, setDraftJournals] = useState([]);
  const [periodId, setPeriodId] = useState('');
  const [form, setForm] = useState({ name: `${today().slice(0, 7)}`, start_date: monthStart(), end_date: monthEnd() });
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const load = useCallback(async (quiet = false) => {
    if (!quiet) { setLoading(true); setError(''); }
    try {
      const [periodRows, statementRows, journalRows] = await Promise.all([
        can('accounting.period.read') ? loadAll('accounting.period') : Promise.resolve([]),
        can('accounting.bank_statement.read') ? loadAll('accounting.bank_statement', { status: 'draft' }) : Promise.resolve([]),
        can('accounting.journal_entry.read') ? loadAll('accounting.journal_entry', { status: 'draft' }) : Promise.resolve([]),
      ]);
      periodRows.sort((a, b) => String(b.start_date || '').localeCompare(String(a.start_date || '')));
      setPeriods(periodRows); setDraftStatements(statementRows); setDraftJournals(journalRows);
      setPeriodId((id) => periodRows.some((row) => row.id === id) ? id : periodRows.find((row) => row.status === 'open')?.id || periodRows[0]?.id || '');
    } catch (reason) { setError(reason.message || uiText('Không tải được dữ liệu khóa sổ.')); }
    finally { if (!quiet) setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const selected = periods.find((row) => row.id === periodId);
  const blockingStatements = useMemo(() => selected ? draftStatements.filter((row) => row.start_date <= selected.end_date && row.end_date >= selected.start_date) : [], [draftStatements, selected]);
  const blockingJournals = useMemo(() => selected ? draftJournals.filter((row) => inPeriod(dateForJournal(row), selected)) : [], [draftJournals, selected]);
  const periodEnded = Boolean(selected && selected.end_date <= today());
  const closeReady = Boolean(selected && selected.status === 'open' && periodEnded && !blockingStatements.length && !blockingJournals.length);
  async function run(key, operation, success) {
    setBusy(key); setError(''); setNotice('');
    try { await operation(); setNotice(success); await load(true); }
    catch (reason) { setError(reason.message || uiText('Không cập nhật được kỳ kế toán.')); await load(true); }
    finally { setBusy(''); }
  }
  async function createPeriod(event) {
    event.preventDefault();
    await run('period:create', async () => {
      await api(dataPath('accounting.period'), { method: 'POST', body: form });
      setForm((current) => ({ ...current, name: `${today().slice(0, 7)}`, start_date: monthStart(), end_date: monthEnd() }));
    }, uiText('Đã tạo kỳ kế toán. Hệ thống sẽ chặn kỳ bị chồng và bảo vệ ngày sau khi có bút toán.'));
  }
  async function closePeriod() {
    if (!selected) return;
    await run(`${selected.id}:closed`, () => api(dataPath('accounting.period', selected.id, 'closed'), { method: 'POST' }), uiText('Đã khóa kỳ. Hệ thống không cho ghi sổ hoặc sửa bút toán trong khoảng ngày này.'));
  }
  async function reopenPeriod() {
    if (!selected || !await confirmDialog({ title: uiText('Mở lại kỳ'), message: `${selected.name}? ${uiText('Việc này cho phép ghi nhận lại bút toán trong kỳ.')}`, danger: true, confirmLabel: uiText('Mở lại kỳ') })) return;
    await run(`${selected.id}:reopened`, () => api(dataPath('accounting.period', selected.id, 'reopened'), { method: 'POST' }), uiText('Đã mở lại kỳ kế toán.'));
  }
  return <div className="page">
    <div className="page-head"><div><h1>{uiText('Khóa sổ kế toán')}</h1><p className="sub">{uiText('Rà soát chứng từ nháp, xác nhận ngày kết thúc và khóa kỳ bằng quy tắc kiểm tra của hệ thống.')}</p></div><button className="btn btn-secondary" type="button" disabled={loading || Boolean(busy)} onClick={() => load()}>{uiText('Làm mới')}</button></div>
    {error && <div className="alert danger" role="alert">{uiText(error)}</div>}{notice && <div className="alert success" role="status">{uiText(notice)}</div>}
    {can('accounting.period.create') && <section className="card card-pad"><h2>{uiText('Tạo kỳ kế toán')}</h2><form className="form-grid" onSubmit={createPeriod}>
      <label className="field"><span className="label">{uiText('Tên kỳ')} *</span><input className="input" required value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}/></label>
      <label className="field"><span className="label">{uiText('Từ ngày')} *</span><input className="input" required type="date" value={form.start_date} onChange={(event) => setForm((current) => ({ ...current, start_date: event.target.value }))}/></label>
      <label className="field"><span className="label">{uiText('Đến ngày')} *</span><input className="input" required type="date" min={form.start_date} value={form.end_date} onChange={(event) => setForm((current) => ({ ...current, end_date: event.target.value }))}/></label>
      <div className="row full"><span className="grow"/><button className="btn btn-primary" disabled={Boolean(busy) || loading}>{uiText('Tạo kỳ mở')}</button></div>
    </form></section>}
    <div className="layout-split u-legacy-92c18f6bda" >
      <section className="card card-pad"><h2>{uiText('Lịch kỳ kế toán')}</h2>{loading ? <div className="skeleton" data-h="row"/> : !periods.length ? <div className="empty">{uiText('Chưa có kỳ kế toán. Tạo kỳ để bắt đầu kiểm soát ngày ghi sổ.')}</div> : <div className="table-wrap"><table className="table"><thead><tr><th>{uiText('Kỳ')}</th><th>{uiText('Khoảng ngày')}</th><th>{uiText('Trạng thái')}</th></tr></thead><tbody>{periods.map((row) => <tr {...selectableTableRowProps} key={row.id} aria-selected={row.id === periodId} className={[row.id === periodId ? 'selected' : '', 'u-legacy-9463ff4798'].filter(Boolean).join(' ')} onClick={() => setPeriodId(row.id)} ><td><strong>{row.name}</strong></td><td>{fmtDate(row.start_date)} – {fmtDate(row.end_date)}</td><td><span className={`badge ${row.status === 'period_closed' ? 'success' : 'warning'}`}>{statusLabel(row.status)}</span></td></tr>)}</tbody></table></div>}</section>
      {selected && <section className="card card-pad"><div className="row wrap"><div><h2>{selected.name}</h2><div className="small muted">{fmtDate(selected.start_date)} – {fmtDate(selected.end_date)}</div></div><span className="grow"/><span className={`badge ${selected.status === 'period_closed' ? 'success' : 'warning'}`}>{statusLabel(selected.status)}</span><a className="btn btn-ghost btn-sm" href={recordHref('accounting.period', selected.id)}>{uiText('Mở chi tiết kỳ')}</a></div>
        <div className="stats u-legacy-0ee7f66ad9" ><div className="card stat"><span className="stat-label">{uiText('Ngày kết thúc')}</span><strong className="stat-value">{uiText(periodEnded ? 'Đã qua' : 'Chưa tới')}</strong><span className="small muted">{fmtDate(selected.end_date)}</span></div><div className="card stat"><span className="stat-label">{uiText('Sao kê nháp giao kỳ')}</span><strong className="stat-value">{blockingStatements.length}</strong></div><div className="card stat"><span className="stat-label">{uiText('Bút toán nháp trong kỳ')}</span><strong className="stat-value">{blockingJournals.length}</strong></div><div className="card stat"><span className="stat-label">{uiText('Điều kiện khóa sổ')}</span><strong className="stat-value">{uiText(selected.status === 'period_closed' ? 'Đã khóa' : closeReady ? 'Sẵn sàng' : 'Cần xử lý')}</strong></div></div>
        {selected.status === 'open' && <section className="stack u-legacy-c53ea1da23" ><div className={`alert ${closeReady ? 'success' : 'warning'}`} role="status">{uiText(!periodEnded ? 'Chưa thể khóa kỳ: ngày kết thúc phải là hôm nay hoặc trước đó.' : blockingStatements.length || blockingJournals.length ? 'Chưa thể khóa kỳ: hoàn tất hoặc hủy các chứng từ nháp đang hiển thị bên dưới.' : 'Đủ điều kiện theo checklist; máy chủ sẽ kiểm tra lại trong giao dịch khóa sổ.')}</div>
          {blockingStatements.length > 0 && <div><h3>{uiText('Sao kê ngân hàng nháp giao với kỳ')}</h3><div className="table-wrap"><table className="table"><thead><tr><th>{uiText('Số sao kê')}</th><th>{uiText('Khoảng ngày')}</th><th>{uiText('Hành động')}</th></tr></thead><tbody>{blockingStatements.map((row) => <tr key={row.id}><td>{row.statement_number}</td><td>{fmtDate(row.start_date)} – {fmtDate(row.end_date)}</td><td><a href={recordHref('accounting.bank_statement', row.id)}>{uiText('Mở sao kê')}</a></td></tr>)}</tbody></table></div></div>}
          {blockingJournals.length > 0 && <div><h3>{uiText('Bút toán nháp trong kỳ')}</h3><div className="table-wrap"><table className="table"><thead><tr><th>{uiText('Ngày ghi sổ')}</th><th>{uiText('Diễn giải')}</th><th>{uiText('Số tiền')}</th><th>{uiText('Hành động')}</th></tr></thead><tbody>{blockingJournals.map((row) => <tr key={row.id}><td>{fmtDate(dateForJournal(row))}</td><td>{row.memo || row.source || uiText('Bút toán nháp')}</td><td className="num">{fmtMoney(row.amount)}</td><td><a href={recordHref('accounting.journal_entry', row.id)}>{uiText('Mở bút toán')}</a></td></tr>)}</tbody></table></div></div>}
          <div className="row wrap"><span className="small muted">{uiText('Chỉ khóa kỳ đã kết thúc và không còn sao kê hoặc bút toán nháp liên quan.')}</span><span className="grow"/><button className="btn btn-primary" disabled={Boolean(busy) || !closeReady || !can('accounting.period.closed')} onClick={closePeriod}>{uiText('Khóa kỳ')}</button></div>
        </section>}
        {selected.status === 'period_closed' && <div className="row wrap u-legacy-c53ea1da23" ><span className="small muted">{uiText('Kỳ đã khóa sẽ chặn ghi sổ trong khoảng ngày này. Mở lại chỉ khi có quyền và đã xác nhận với người phụ trách kế toán.')}</span><span className="grow"/><button className="btn btn-secondary" disabled={Boolean(busy) || !can('accounting.period.reopened')} onClick={reopenPeriod}>{uiText('Mở lại kỳ')}</button></div>}
      </section>}
    </div>
    <p className="small muted u-legacy-0ee7f66ad9" >{uiText('Kỳ không được chồng lấn. Không thể đổi ngày kỳ sau khi kỳ đã có bút toán hoặc sao kê; kỳ đã khóa không thể xóa.')}</p>
  </div>;
}
