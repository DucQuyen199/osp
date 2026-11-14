import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { localDate } from './lib/dates.js';
import { api, dataPath } from './lib/api.js';
import { fmtDate, fmtMoney, statusLabel } from './lib/i18n.js';
import { can, loadRefs, recordLabel } from './lib/state.js';

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
        can('case-management.case.read') ? api(`${dataPath('case-management.case')}?limit=1000`) : Promise.resolve({ items: [] }),
        can('case-management.case_note.read') ? api(`${dataPath('case-management.case_note')}?limit=1000`) : Promise.resolve({ items: [] }),
        can('case-management.time_entry.read') ? api(`${dataPath('case-management.time_entry')}?limit=1000`) : Promise.resolve({ items: [] }),
        can('accounting.invoice.read') ? api(`${dataPath('accounting.invoice')}?limit=1000`) : Promise.resolve({ items: [] }),
        can('master-data.party.read') ? loadRefs('master-data.party') : Promise.resolve(new Map()),
      ]);
      const caseRows = itemsOf(caseRes);
      setCases(caseRows.sort((a, b) => String(b.opened_on || '').localeCompare(String(a.opened_on || ''))));
      setNotes(itemsOf(noteRes)); setTimeEntries(itemsOf(timeRes)); setInvoices(itemsOf(invoiceRes)); setParties(partyMap);
      setCaseId((current) => caseRows.some((row) => row.id === current) ? current : caseRows[0]?.id || '');
      setCaseForm((current) => ({ ...current, party: current.party || [...partyMap.keys()][0] || '' }));
    } catch (reason) { setError(reason.message || 'Không tải được hồ sơ vụ việc.'); }
    finally { if (!quiet) setLoading(false); }
  }, []);

  useEffect(() => { document.title = 'Hồ sơ và giờ dịch vụ · OSP Suite'; load(); }, [load]);
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
    try { await operation(); setNotice(success); await load(true); }
    catch (reason) { setError(reason.message || 'Thao tác không thành công.'); await load(true); }
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
    <div className="page-head"><div><h1>Hồ sơ vụ việc và giờ dịch vụ</h1><p className="sub">Tiếp nhận thân chủ, lưu diễn biến, ghi giờ tính phí và xuất hóa đơn theo từng hồ sơ.</p></div><button className="btn btn-secondary" type="button" disabled={loading || Boolean(busy)} onClick={() => load()}>Làm mới</button></div>
    {error && <div className="alert danger" role="alert">{error}</div>}{notice && <div className="alert success" role="status">{notice}</div>}
    <div className="stats" style={{ marginBottom: 16 }}><div className="card stat"><span className="stat-label">Hồ sơ đang mở</span><strong className="stat-value">{cases.filter((row) => row.status === 'open').length}</strong></div><div className="card stat"><span className="stat-label">Giờ chưa xuất hóa đơn</span><strong className="stat-value">{fmtMoney(allWip)}</strong></div><div className="card stat"><span className="stat-label">Doanh thu đã lập hóa đơn</span><strong className="stat-value">{fmtMoney(allBilled)}</strong></div></div>
    {can('case-management.case.create') && <section className="card card-pad"><h2>Mở hồ sơ mới</h2><form className="form-grid" onSubmit={createCase}><label className="field"><span className="label">Tiêu đề hồ sơ *</span><input className="input" required value={caseForm.title} onChange={(e) => setCaseForm({ ...caseForm, title: e.target.value })}/></label><label className="field"><span className="label">Thân chủ / khách hàng *</span><select className="select" required value={caseForm.party} onChange={(e) => setCaseForm({ ...caseForm, party: e.target.value })}><option value="">Chọn khách hàng</option>{[...parties.values()].map((party) => <option key={party.id} value={party.id}>{recordLabel('master-data.party', party)}</option>)}</select></label><label className="field"><span className="label">Loại vụ việc</span><input className="input" value={caseForm.kind} onChange={(e) => setCaseForm({ ...caseForm, kind: e.target.value })}/></label><label className="field"><span className="label">Người phụ trách</span><input className="input" value={caseForm.owner} onChange={(e) => setCaseForm({ ...caseForm, owner: e.target.value })}/></label><label className="field"><span className="label">Ngày tiếp nhận *</span><input className="input" required type="date" max={today()} value={caseForm.opened_on} onChange={(e) => setCaseForm({ ...caseForm, opened_on: e.target.value })}/></label><div className="row full"><span className="grow"/><button className="btn btn-primary" disabled={Boolean(busy) || !parties.size}>Mở hồ sơ</button></div></form></section>}
    {loading ? <div className="skeleton" data-h="row"/> : !cases.length ? <div className="card card-pad empty">Chưa có hồ sơ vụ việc.</div> : <div className="layout-split" style={{ marginTop: 16 }}>
      <section className="card card-pad"><h2>Danh sách hồ sơ</h2><div className="table-wrap"><table className="table"><thead><tr><th>Hồ sơ</th><th>Thân chủ</th><th>Mở ngày</th><th>Trạng thái</th></tr></thead><tbody>{cases.map((row) => <tr key={row.id} className={caseId === row.id ? 'selected' : ''} onClick={() => setCaseId(row.id)} style={{ cursor: 'pointer' }}><td><strong>{row.title}</strong><div className="small muted">{row.kind || 'Vụ việc'} · {row.owner || 'Chưa phân công'}</div></td><td>{parties.has(row.party) ? recordLabel('master-data.party', parties.get(row.party)) : '—'}</td><td>{fmtDate(row.opened_on)}</td><td>{statusLabel(row.status)}</td></tr>)}</tbody></table></div></section>
      {selectedCase && <section className="card card-pad"><div className="row wrap"><div><h2>{selectedCase.title}</h2><div className="small muted">{parties.has(selectedCase.party) ? recordLabel('master-data.party', parties.get(selectedCase.party)) : 'Thân chủ'} · {selectedCase.kind || 'Vụ việc'} · {selectedCase.owner || 'Chưa phân công'}</div></div><span className="grow"/><span className="badge warning">{statusLabel(selectedCase.status)}</span></div>
        {selectedCase.status === 'open' && can('case-management.case.on_hold') && <button className="btn btn-secondary btn-sm" style={{ marginTop: 12 }} disabled={Boolean(busy)} onClick={() => changeCase(selectedCase, 'on_hold')}>Tạm dừng</button>}{selectedCase.status === 'on_hold' && can('case-management.case.resumed') && <button className="btn btn-primary btn-sm" style={{ marginTop: 12 }} disabled={Boolean(busy)} onClick={() => changeCase(selectedCase, 'resumed')}>Tiếp tục</button>}{selectedCase.status !== 'closed' && can('case-management.case.closed') && <button className="btn btn-ghost btn-sm" style={{ marginTop: 12, marginLeft: 6 }} disabled={Boolean(busy) || recorded.length > 0} title={recorded.length ? 'Xuất hóa đơn các giờ công còn ghi nhận trước khi đóng.' : undefined} onClick={() => changeCase(selectedCase, 'closed')}>Đóng hồ sơ</button>}
        <div className="stats" style={{ marginTop: 16 }}><div className="card stat"><span className="stat-label">WIP chưa lập hóa đơn</span><strong className="stat-value">{fmtMoney(wip)}</strong></div><div className="card stat"><span className="stat-label">Giờ đã lập hóa đơn</span><strong className="stat-value">{fmtMoney(billedAmount)}</strong></div></div>
        {selectedCase.status !== 'closed' && can('case-management.case_note.create') && <form onSubmit={createNote} style={{ marginTop: 16 }}><label className="field"><span className="label">Thêm ghi chú hồ sơ</span><textarea className="input" required rows="3" value={noteBody} onChange={(e) => setNoteBody(e.target.value)}/></label><div className="row" style={{ marginTop: 8 }}><span className="grow"/><button className="btn btn-secondary" disabled={Boolean(busy)}>Lưu ghi chú</button></div></form>}
        {caseNotes.length > 0 && <div className="table-wrap" style={{ marginTop: 12 }}><table className="table"><thead><tr><th>Ghi chú</th><th>Thời điểm</th></tr></thead><tbody>{caseNotes.map((row) => <tr key={row.id}><td style={{ whiteSpace: 'pre-wrap' }}>{row.body}</td><td>{row.created_at ? new Date(row.created_at).toLocaleString('vi-VN') : '—'}</td></tr>)}</tbody></table></div>}
        {selectedCase.status === 'open' && can('case-management.time_entry.create') && <form className="form-grid" style={{ marginTop: 20 }} onSubmit={createTime}><h3 className="full">Ghi giờ tính phí</h3><label className="field"><span className="label">Chuyên viên *</span><input className="input" required value={timeForm.who} onChange={(e) => setTimeForm({ ...timeForm, who: e.target.value })}/></label><label className="field"><span className="label">Ngày làm việc *</span><input className="input" required type="date" max={today()} value={timeForm.date} onChange={(e) => setTimeForm({ ...timeForm, date: e.target.value })}/></label><label className="field"><span className="label">Số giờ *</span><input className="input" required type="number" min="0.01" max="24" step="0.01" value={timeForm.hours} onChange={(e) => setTimeForm({ ...timeForm, hours: e.target.value })}/></label><label className="field"><span className="label">Đơn giá / giờ *</span><input className="input" required type="number" min="0" step="any" value={timeForm.rate} onChange={(e) => setTimeForm({ ...timeForm, rate: e.target.value })}/></label><div className="row full"><span className="grow"/><strong>Phí dự kiến: {fmtMoney((Number(timeForm.hours) || 0) * (Number(timeForm.rate) || 0))}</strong><button className="btn btn-primary" disabled={Boolean(busy)}>Ghi giờ công</button></div></form>}
        <div className="table-wrap" style={{ marginTop: 14 }}><table className="table"><thead><tr><th>Ngày</th><th>Chuyên viên</th><th>Giờ</th><th>Phí</th><th>Trạng thái / hóa đơn</th></tr></thead><tbody>{caseEntries.map((row) => <tr key={row.id}><td>{fmtDate(row.date)}</td><td>{row.who}</td><td>{row.hours}</td><td>{fmtMoney(row.amount)}</td><td><span className="badge warning">{statusLabel(row.status)}</span>{row.status === 'recorded' && can('case-management.time_entry.billed') && <button className="btn btn-primary btn-sm" style={{ marginLeft: 8 }} disabled={Boolean(busy)} onClick={() => billTime(row)}>Lập hóa đơn</button>}{invoiceByTime.has(row.id) && <a className="btn btn-ghost btn-sm" style={{ marginLeft: 6 }} href={`#/e/accounting/invoice/${invoiceByTime.get(row.id).id}`}>Mở hóa đơn {statusLabel(invoiceByTime.get(row.id).status)}</a>}</td></tr>)}</tbody></table></div>
      </section>}
    </div>}
  </div>;
}
