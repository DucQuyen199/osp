import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { selectableTableRowProps } from '../../lib/accessibility.js';
import { localDate } from '../../lib/dates.js';
import { api, dataPath } from '../../lib/api.js';
import { fmtDate, fmtDateTime, fmtMoney, statusLabel, uiTextWith } from '../../lib/i18n.js';
import { can, loadRefs, recordLabel, loadAllResponse } from '../../lib/state.js';
import servicesEnglish from './professional-services.en.js';

const t = (text) => uiTextWith(text, servicesEnglish);

const today = localDate;
const itemsOf = (response) => Array.isArray(response?.items) ? response.items : [];
const action = (entity, row, verb) => api(dataPath(entity, row.id, verb), { method: 'POST' });

export default function ProfessionalServicesWorkbenchPage() {
  const [cases, setCases] = useState([]);
  const [notes, setNotes] = useState([]);
  const [timeEntries, setTimeEntries] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [parties, setParties] = useState(new Map());
  const [caseId, setCaseId] = useState('');
  const [caseForm, setCaseForm] = useState({ title: '', party: '', kind: '', owner: '', opened_on: today() });
  const [noteBody, setNoteBody] = useState('');
  const [timeForm, setTimeForm] = useState({ who: '', date: today(), hours: '', rate: '' });
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async (quiet = false) => {
    if (!quiet) { setLoading(true); setError(''); }
    try {
      const [caseRes, noteRes, timeRes, invoiceRes, partyMap] = await Promise.all([
        can('case-management.case.read') ? loadAllResponse('case-management.case') : Promise.resolve({ items: [] }),
        can('case-management.case_note.read') ? loadAllResponse('case-management.case_note') : Promise.resolve({ items: [] }),
        can('case-management.time_entry.read') ? loadAllResponse('case-management.time_entry') : Promise.resolve({ items: [] }),
        can('accounting.invoice.read') ? loadAllResponse('accounting.invoice') : Promise.resolve({ items: [] }),
        can('master-data.party.read') ? loadRefs('master-data.party') : Promise.resolve(new Map()),
      ]);
      const caseRows = itemsOf(caseRes);
      setCases(caseRows.sort((a, b) => String(b.opened_on || '').localeCompare(String(a.opened_on || ''))));
      setNotes(itemsOf(noteRes)); setTimeEntries(itemsOf(timeRes)); setInvoices(itemsOf(invoiceRes)); setParties(partyMap);
      setCaseId((current) => caseRows.some((row) => row.id === current) ? current : caseRows[0]?.id || '');
      setCaseForm((current) => ({ ...current, party: current.party || [...partyMap.keys()][0] || '' }));
    } catch (reason) { setError(t(reason.message || 'Không tải được hồ sơ vụ việc.')); }
    finally { if (!quiet) setLoading(false); }
  }, []);

  useEffect(() => { document.title = `${t('Hồ sơ và giờ dịch vụ')} · OSP Suite`; load(); }, [load]);
  const selectedCase = cases.find((row) => row.id === caseId);
  const caseEntries = useMemo(() => timeEntries.filter((row) => row.case === caseId).sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))), [timeEntries, caseId]);
  const caseNotes = useMemo(() => notes.filter((row) => row.case === caseId).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))), [notes, caseId]);
  const invoiceByTime = useMemo(() => new Map(invoices.filter((row) => row.source === 'time_entry').map((row) => [row.source_id, row])), [invoices]);
  const recorded = caseEntries.filter((row) => row.status === 'recorded');
  const wip = recorded.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const billedAmount = caseEntries.filter((row) => row.status === 'billed').reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const allWip = timeEntries.filter((row) => row.status === 'recorded').reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const allBilled = timeEntries.filter((row) => row.status === 'billed').reduce((sum, row) => sum + Number(row.amount || 0), 0);

  async function run(key, operation, success) {
    setBusy(key); setError(''); setNotice('');
    try { await operation(); setNotice(t(success)); await load(true); }
    catch (reason) { setError(t(reason.message || 'Thao tác không thành công.')); await load(true); }
    finally { setBusy(''); }
  }

  async function createCase(event) {
    event.preventDefault();
    await run('case', () => api(dataPath('case-management.case'), { method: 'POST', body: { ...caseForm, title: caseForm.title.trim(), kind: caseForm.kind.trim() || undefined, owner: caseForm.owner.trim() || undefined, status: 'open' } }), 'Đã mở hồ sơ vụ việc.');
    setCaseForm((current) => ({ ...current, title: '', kind: '', owner: '' }));
  }

  async function createNote(event) {
    event.preventDefault();
    await run('note', () => api(dataPath('case-management.case_note'), { method: 'POST', body: { case: caseId, body: noteBody.trim() } }), 'Đã lưu ghi chú hồ sơ vào lịch sử bất biến.');
    setNoteBody('');
  }

  async function createTime(event) {
    event.preventDefault();
    await run('time', () => api(dataPath('case-management.time_entry'), { method: 'POST', body: { case: caseId, who: timeForm.who.trim(), date: timeForm.date, hours: Number(timeForm.hours), rate: Number(timeForm.rate), status: 'recorded' } }), 'Đã ghi giờ công. Khách hàng và phí được chụp từ hồ sơ và đơn giá giờ.');
    setTimeForm((current) => ({ ...current, hours: '' }));
  }

  async function changeCase(row, verb) {
    const messages = { on_hold: 'Đã tạm dừng hồ sơ.', resumed: 'Đã tiếp tục xử lý hồ sơ.', closed: 'Đã đóng hồ sơ sau khi xuất hóa đơn toàn bộ giờ công.' };
    await run(`${row.id}:${verb}`, () => action('case-management.case', row, verb), messages[verb]);
  }

  async function billTime(row) {
    await run(`${row.id}:billed`, () => action('case-management.time_entry', row, 'billed'), 'Đã xuất hóa đơn dịch vụ cho khoản giờ công. Giờ công đã khóa khỏi chỉnh sửa.');
  }

  return <div className="page">
    <div className="page-head"><div><h1>{t('Hồ sơ vụ việc và giờ dịch vụ')}</h1><p className="sub">{t('Tiếp nhận thân chủ, lưu diễn biến, ghi giờ tính phí và xuất hóa đơn theo từng hồ sơ.')}</p></div><button className="btn btn-secondary" type="button" disabled={loading || Boolean(busy)} onClick={() => load()}>{t('Làm mới')}</button></div>
    {error && <div className="alert danger" role="alert">{t(error)}</div>}{notice && <div className="alert success" role="status">{t(notice)}</div>}
    <div className="stats" data-inline-style="inline-bf4a218e05"><div className="card stat"><span className="stat-label">{t('Hồ sơ đang mở')}</span><strong className="stat-value">{cases.filter((row) => row.status === 'open').length}</strong></div><div className="card stat"><span className="stat-label">{t('Giờ chưa xuất hóa đơn')}</span><strong className="stat-value">{fmtMoney(allWip)}</strong></div><div className="card stat"><span className="stat-label">{t('Doanh thu đã lập hóa đơn')}</span><strong className="stat-value">{fmtMoney(allBilled)}</strong></div></div>
    {can('case-management.case.create') && <section className="card card-pad"><h2>{t('Mở hồ sơ mới')}</h2><form className="form-grid" onSubmit={createCase}><label className="field"><span className="label">{t('Tiêu đề hồ sơ *')}</span><input className="input" required value={caseForm.title} onChange={(e) => setCaseForm({ ...caseForm, title: e.target.value })}/></label><label className="field"><span className="label">{t('Thân chủ / khách hàng *')}</span><select className="select" required value={caseForm.party} onChange={(e) => setCaseForm({ ...caseForm, party: e.target.value })}><option value="">{t('Chọn khách hàng')}</option>{[...parties.values()].map((party) => <option key={party.id} value={party.id}>{recordLabel('master-data.party', party)}</option>)}</select></label><label className="field"><span className="label">{t('Loại vụ việc')}</span><input className="input" value={caseForm.kind} onChange={(e) => setCaseForm({ ...caseForm, kind: e.target.value })}/></label><label className="field"><span className="label">{t('Người phụ trách')}</span><input className="input" value={caseForm.owner} onChange={(e) => setCaseForm({ ...caseForm, owner: e.target.value })}/></label><label className="field"><span className="label">{t('Ngày tiếp nhận *')}</span><input className="input" required type="date" max={today()} value={caseForm.opened_on} onChange={(e) => setCaseForm({ ...caseForm, opened_on: e.target.value })}/></label><div className="row full"><span className="grow"/><button className="btn btn-primary" disabled={Boolean(busy) || !parties.size}>{t('Mở hồ sơ')}</button></div></form></section>}
    {loading ? <div className="skeleton" data-h="row"/> : !cases.length ? <div className="card card-pad empty">{t('Chưa có hồ sơ vụ việc.')}</div> : <div className="layout-split" data-inline-style="inline-92c18f6bda">
      <section className="card card-pad"><h2>{t('Danh sách hồ sơ')}</h2><div className="table-wrap"><table className="table"><thead><tr><th>{t('Hồ sơ')}</th><th>{t('Thân chủ')}</th><th>{t('Mở ngày')}</th><th>{t('Trạng thái')}</th></tr></thead><tbody>{cases.map((row) => <tr {...selectableTableRowProps} key={row.id} aria-selected={caseId === row.id} className={caseId === row.id ? 'selected' : ''} onClick={() => setCaseId(row.id)} data-inline-style="inline-9463ff4798"><td><strong>{row.title}</strong><div className="small muted">{row.kind || t('Vụ việc')} · {row.owner || t('Chưa phân công')}</div></td><td>{parties.has(row.party) ? recordLabel('master-data.party', parties.get(row.party)) : '—'}</td><td>{fmtDate(row.opened_on)}</td><td>{statusLabel(row.status)}</td></tr>)}</tbody></table></div></section>
      {selectedCase && <section className="card card-pad"><div className="row wrap"><div><h2>{selectedCase.title}</h2><div className="small muted">{parties.has(selectedCase.party) ? recordLabel('master-data.party', parties.get(selectedCase.party)) : t('Thân chủ')} · {selectedCase.kind || t('Vụ việc')} · {selectedCase.owner || t('Chưa phân công')}</div></div><span className="grow"/><span className="badge warning">{statusLabel(selectedCase.status)}</span></div>
        {selectedCase.status === 'open' && can('case-management.case.on_hold') && <button className="btn btn-secondary btn-sm" data-inline-style="inline-0ee7f66ad9" disabled={Boolean(busy)} onClick={() => changeCase(selectedCase, 'on_hold')}>{t('Tạm dừng')}</button>}{selectedCase.status === 'on_hold' && can('case-management.case.resumed') && <button className="btn btn-primary btn-sm" data-inline-style="inline-0ee7f66ad9" disabled={Boolean(busy)} onClick={() => changeCase(selectedCase, 'resumed')}>{t('Tiếp tục')}</button>}{selectedCase.status !== 'closed' && can('case-management.case.closed') && <button className="btn btn-ghost btn-sm" data-inline-style="inline-29e4f6d361" disabled={Boolean(busy) || recorded.length > 0} title={recorded.length ? t('Xuất hóa đơn các giờ công còn ghi nhận trước khi đóng.') : undefined} onClick={() => changeCase(selectedCase, 'closed')}>{t('Đóng hồ sơ')}</button>}
        <div className="stats" data-inline-style="inline-92c18f6bda"><div className="card stat"><span className="stat-label">{t('WIP chưa lập hóa đơn')}</span><strong className="stat-value">{fmtMoney(wip)}</strong></div><div className="card stat"><span className="stat-label">{t('Giờ đã lập hóa đơn')}</span><strong className="stat-value">{fmtMoney(billedAmount)}</strong></div></div>
        {selectedCase.status !== 'closed' && can('case-management.case_note.create') && <form onSubmit={createNote} data-inline-style="inline-92c18f6bda"><label className="field"><span className="label">{t('Thêm ghi chú hồ sơ')}</span><textarea className="input" required rows="3" value={noteBody} onChange={(e) => setNoteBody(e.target.value)}/></label><div className="row" data-inline-style="inline-43a97fe494"><span className="grow"/><button className="btn btn-secondary" disabled={Boolean(busy)}>{t('Lưu ghi chú')}</button></div></form>}
        {caseNotes.length > 0 && <div className="table-wrap" data-inline-style="inline-0ee7f66ad9"><table className="table"><thead><tr><th>{t('Ghi chú')}</th><th>{t('Thời điểm')}</th></tr></thead><tbody>{caseNotes.map((row) => <tr key={row.id}><td data-inline-style="inline-092af903b2">{row.body}</td><td>{row.created_at ? fmtDateTime(row.created_at) : '—'}</td></tr>)}</tbody></table></div>}
        {selectedCase.status === 'open' && can('case-management.time_entry.create') && <form className="form-grid" data-inline-style="inline-eee3f850c9" onSubmit={createTime}><h3 className="full">{t('Ghi giờ tính phí')}</h3><label className="field"><span className="label">{t('Chuyên viên *')}</span><input className="input" required value={timeForm.who} onChange={(e) => setTimeForm({ ...timeForm, who: e.target.value })}/></label><label className="field"><span className="label">{t('Ngày làm việc *')}</span><input className="input" required type="date" max={today()} value={timeForm.date} onChange={(e) => setTimeForm({ ...timeForm, date: e.target.value })}/></label><label className="field"><span className="label">{t('Số giờ *')}</span><input className="input" required type="number" min="0.01" max="24" step="0.01" value={timeForm.hours} onChange={(e) => setTimeForm({ ...timeForm, hours: e.target.value })}/></label><label className="field"><span className="label">{t('Đơn giá / giờ *')}</span><input className="input" required type="number" min="0" step="any" value={timeForm.rate} onChange={(e) => setTimeForm({ ...timeForm, rate: e.target.value })}/></label><div className="row full"><span className="grow"/><strong>Phí dự kiến: {fmtMoney((Number(timeForm.hours) || 0) * (Number(timeForm.rate) || 0))}</strong><button className="btn btn-primary" disabled={Boolean(busy)}>{t('Ghi giờ công')}</button></div></form>}
        <div className="table-wrap" data-inline-style="inline-c53ea1da23"><table className="table"><thead><tr><th>{t('Ngày')}</th><th>{t('Chuyên viên')}</th><th>{t('Giờ')}</th><th>{t('Phí')}</th><th>{t('Trạng thái / hóa đơn')}</th></tr></thead><tbody>{caseEntries.map((row) => <tr key={row.id}><td>{fmtDate(row.date)}</td><td>{row.who}</td><td>{row.hours}</td><td>{fmtMoney(row.amount)}</td><td><span className="badge warning">{statusLabel(row.status)}</span>{row.status === 'recorded' && can('case-management.time_entry.billed') && <button className="btn btn-primary btn-sm" data-inline-style="inline-9d5367afed" disabled={Boolean(busy)} onClick={() => billTime(row)}>{t('Lập hóa đơn')}</button>}{invoiceByTime.has(row.id) && <a className="btn btn-ghost btn-sm" data-inline-style="inline-4b17347c23" href={`#/e/accounting/invoice/${invoiceByTime.get(row.id).id}`}>{t('Mở hóa đơn')} {statusLabel(invoiceByTime.get(row.id).status)}</a>}</td></tr>)}</tbody></table></div>
      </section>}
    </div>}
  </div>;
}
