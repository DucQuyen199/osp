import React, { useMemo } from 'react';
import { useDocumentTitle } from '../../lib/useDocumentTitle.js';
import { selectableTableRowProps } from '../../lib/accessibility.js';
import { localDate } from '../../lib/dates.js';
import { fmtDate, fmtDateTime, fmtMoney, statusLabel, uiTextWith } from '../../lib/i18n.js';
import { addDecimals } from '../../lib/decimal.js';
import { can, recordLabel } from '../../lib/state.js';
import servicesEnglish from './professional-services.en.js';
import { estimateTimeEntryAmount } from './domain/timeEntryTotals.js';
import { useProfessionalServicesData } from './hooks/useProfessionalServicesData.js';
import { useProfessionalServicesWorkflow } from './hooks/useProfessionalServicesWorkflow.js';
import ProfessionalServicesTimeEntriesTable from './components/ProfessionalServicesTimeEntriesTable.jsx';
import TimeEntryRegisterForm from './components/TimeEntryRegisterForm.jsx';
const t = (text) => uiTextWith(text, servicesEnglish);
const today = localDate;
export default function ProfessionalServicesWorkbenchPage() {
  useDocumentTitle(`${t('Hồ sơ và giờ dịch vụ')} · OSP Suite`);
  const { cases, notes, timeEntries, invoices, parties, loading, error, setError, load } = useProfessionalServicesData();
  const {
    caseId, setCaseId, caseForm, setCaseForm, noteBody, setNoteBody,
    timeForm, setTimeForm, busy, notice, createCase, createNote, createTime,
    changeCase, billTime,
  } = useProfessionalServicesWorkflow({ cases, parties, load, setError, t, todayDate: today() });
  const selectedCase = cases.find((row) => row.id === caseId);
  const caseEntries = useMemo(() => timeEntries.filter((row) => row.case === caseId).sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))), [timeEntries, caseId]);
  const caseNotes = useMemo(() => notes.filter((row) => row.case === caseId).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))), [notes, caseId]);
  const invoiceByTime = useMemo(() => new Map(invoices.filter((row) => row.source === 'time_entry').map((row) => [row.source_id, row])), [invoices]);
  const recorded = caseEntries.filter((row) => row.status === 'recorded');
  const wip = addDecimals(recorded.map((row) => row.amount));
  const billedAmount = addDecimals(caseEntries.filter((row) => row.status === 'billed').map((row) => row.amount));
  const allWip = addDecimals(timeEntries.filter((row) => row.status === 'recorded').map((row) => row.amount));
  const allBilled = addDecimals(timeEntries.filter((row) => row.status === 'billed').map((row) => row.amount));
  return <div className="page">
    <div className="page-head"><div><h1>{t('Hồ sơ vụ việc và giờ dịch vụ')}</h1><p className="sub">{t('Tiếp nhận thân chủ, lưu diễn biến, ghi giờ tính phí và xuất hóa đơn theo từng hồ sơ.')}</p></div><button className="btn btn-secondary" type="button" disabled={loading || Boolean(busy)} onClick={() => load()}>{t('Làm mới')}</button></div>
    {error && <div className="alert danger" role="alert">{t(error)}</div>}{notice && <div className="alert success" role="status">{t(notice)}</div>}
    <div className="stats u-mb-16" ><div className="card stat"><span className="stat-label">{t('Hồ sơ đang mở')}</span><strong className="stat-value">{cases.filter((row) => row.status === 'open').length}</strong></div><div className="card stat"><span className="stat-label">{t('Giờ chưa xuất hóa đơn')}</span><strong className="stat-value">{fmtMoney(allWip)}</strong></div><div className="card stat"><span className="stat-label">{t('Doanh thu đã lập hóa đơn')}</span><strong className="stat-value">{fmtMoney(allBilled)}</strong></div></div>
    {can('case-management.case.create') && <section className="card card-pad"><h2>{t('Mở hồ sơ mới')}</h2><form className="form-grid" onSubmit={createCase}><label className="field"><span className="label">{t('Tiêu đề hồ sơ *')}</span><input className="input" required value={caseForm.title} onChange={(e) => setCaseForm({ ...caseForm, title: e.target.value })}/></label><label className="field"><span className="label">{t('Thân chủ / khách hàng *')}</span><select className="select" required value={caseForm.party} onChange={(e) => setCaseForm({ ...caseForm, party: e.target.value })}><option value="">{t('Chọn khách hàng')}</option>{[...parties.values()].map((party) => <option key={party.id} value={party.id}>{recordLabel('master-data.party', party)}</option>)}</select></label><label className="field"><span className="label">{t('Loại vụ việc')}</span><input className="input" value={caseForm.kind} onChange={(e) => setCaseForm({ ...caseForm, kind: e.target.value })}/></label><label className="field"><span className="label">{t('Người phụ trách')}</span><input className="input" value={caseForm.owner} onChange={(e) => setCaseForm({ ...caseForm, owner: e.target.value })}/></label><label className="field"><span className="label">{t('Ngày tiếp nhận *')}</span><input className="input" required type="date" max={today()} value={caseForm.opened_on} onChange={(e) => setCaseForm({ ...caseForm, opened_on: e.target.value })}/></label><div className="row full"><span className="grow"/><button className="btn btn-primary" disabled={Boolean(busy) || !parties.size}>{t('Mở hồ sơ')}</button></div></form></section>}
    {loading ? <div className="skeleton" data-h="row"/> : !cases.length ? <div className="card card-pad empty">{t('Chưa có hồ sơ vụ việc.')}</div> : <div className="layout-split u-mt-16" >
      <section className="card card-pad"><h2>{t('Danh sách hồ sơ')}</h2><div className="table-wrap"><table className="table"><thead><tr><th>{t('Hồ sơ')}</th><th>{t('Thân chủ')}</th><th>{t('Mở ngày')}</th><th>{t('Trạng thái')}</th></tr></thead><tbody>{cases.map((row) => <tr {...selectableTableRowProps} key={row.id} aria-selected={caseId === row.id} className={[caseId === row.id ? 'selected' : '', 'u-pointer'].filter(Boolean).join(' ')} onClick={() => setCaseId(row.id)} ><td><strong>{row.title}</strong><div className="small muted">{row.kind || t('Vụ việc')} · {row.owner || t('Chưa phân công')}</div></td><td>{parties.has(row.party) ? recordLabel('master-data.party', parties.get(row.party)) : '—'}</td><td>{fmtDate(row.opened_on)}</td><td>{statusLabel(row.status)}</td></tr>)}</tbody></table></div></section>
      {selectedCase && <section className="card card-pad"><div className="row wrap"><div><h2>{selectedCase.title}</h2><div className="small muted">{parties.has(selectedCase.party) ? recordLabel('master-data.party', parties.get(selectedCase.party)) : t('Thân chủ')} · {selectedCase.kind || t('Vụ việc')} · {selectedCase.owner || t('Chưa phân công')}</div></div><span className="grow"/><span className="badge warning">{statusLabel(selectedCase.status)}</span></div>
        {selectedCase.status === 'open' && can('case-management.case.on_hold') && <button className="btn btn-secondary btn-sm u-mt-12"  disabled={Boolean(busy)} onClick={() => changeCase(selectedCase, 'on_hold')}>{t('Tạm dừng')}</button>}{selectedCase.status === 'on_hold' && can('case-management.case.resumed') && <button className="btn btn-primary btn-sm u-mt-12"  disabled={Boolean(busy)} onClick={() => changeCase(selectedCase, 'resumed')}>{t('Tiếp tục')}</button>}{selectedCase.status !== 'closed' && can('case-management.case.closed') && <button className="btn btn-ghost btn-sm u-mt-12-ml-6"  disabled={Boolean(busy) || recorded.length > 0} title={recorded.length ? t('Xuất hóa đơn các giờ công còn ghi nhận trước khi đóng.') : undefined} onClick={() => changeCase(selectedCase, 'closed')}>{t('Đóng hồ sơ')}</button>}
        <div className="stats u-mt-16" ><div className="card stat"><span className="stat-label">{t('WIP chưa lập hóa đơn')}</span><strong className="stat-value">{fmtMoney(wip)}</strong></div><div className="card stat"><span className="stat-label">{t('Giờ đã lập hóa đơn')}</span><strong className="stat-value">{fmtMoney(billedAmount)}</strong></div></div>
        {selectedCase.status !== 'closed' && can('case-management.case_note.create') && <form onSubmit={createNote} className="u-mt-16"><label className="field"><span className="label">{t('Thêm ghi chú hồ sơ')}</span><textarea className="input" required rows="3" value={noteBody} onChange={(e) => setNoteBody(e.target.value)}/></label><div className="row u-mt-8" ><span className="grow"/><button className="btn btn-secondary" disabled={Boolean(busy)}>{t('Lưu ghi chú')}</button></div></form>}
        {caseNotes.length > 0 && <div className="table-wrap u-mt-12" ><table className="table"><thead><tr><th>{t('Ghi chú')}</th><th>{t('Thời điểm')}</th></tr></thead><tbody>{caseNotes.map((row) => <tr key={row.id}><td className="u-pre-wrap">{row.body}</td><td>{row.created_at ? fmtDateTime(row.created_at) : '—'}</td></tr>)}</tbody></table></div>}
         {selectedCase.status === 'open' && can('case-management.time_entry.create') && <TimeEntryRegisterForm
          timeForm={timeForm}
          onFieldChange={(field, value) => setTimeForm((current) => ({ ...current, [field]: value }))}
          onSubmit={createTime}
          busy={busy}
          today={today()}
          estimatedAmount={estimateTimeEntryAmount(timeForm.hours, timeForm.rate)}
          fmtMoney={fmtMoney}
          t={t}
        />}
        <ProfessionalServicesTimeEntriesTable entries={caseEntries} invoiceByTime={invoiceByTime} busy={busy} canBill={can('case-management.time_entry.billed')} fmtDate={fmtDate} fmtMoney={fmtMoney} statusLabel={statusLabel} onBill={billTime} t={t} />
      </section>}
    </div>}
  </div>;
}
