import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { selectableTableRowProps } from '../../lib/accessibility.js';
import { api, dataPath } from '../../lib/api.js';
import { fmtDateTime, statusLabel } from '../../lib/i18n.js';
import { app, can, loadAllResponse, loadRefs, recordLabel } from '../../lib/state.js';

const emptyTicket = { subject: '', party: '', priority: 'normal', channel: 'email', sla_policy: '', description: '', assignee: '', assignee_employee: '' };

export default function HelpdeskWorkbenchPage() {
  const [tickets, setTickets] = useState([]);
  const [messages, setMessages] = useState([]);
  const [parties, setParties] = useState(new Map());
  const [policies, setPolicies] = useState(new Map());
  const [employees, setEmployees] = useState(new Map());
  const [selectedId, setSelectedId] = useState('');
  const [ticketForm, setTicketForm] = useState(emptyTicket);
  const [messageForm, setMessageForm] = useState({ direction: 'outbound', author: app.user?.name || '', body: '' });
  const [assignment, setAssignment] = useState('');
  const [assignmentEmployee, setAssignmentEmployee] = useState('');
  const [resolution, setResolution] = useState('');
  const [filter, setFilter] = useState('active');
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async (quiet = false) => {
    if (!quiet) { setLoading(true); setError(''); }
    try {
      const [ticketRes, messageRes, partyMap, policyMap, employeeMap] = await Promise.all([
        can('helpdesk.ticket.read') ? loadAllResponse('helpdesk.ticket') : Promise.resolve({ items: [] }),
        can('helpdesk.message.read') ? loadAllResponse('helpdesk.message') : Promise.resolve({ items: [] }),
        can('master-data.party.read') ? loadRefs('master-data.party') : Promise.resolve(new Map()),
        can('helpdesk.sla_policy.read') ? loadRefs('helpdesk.sla_policy') : Promise.resolve(new Map()),
        can('hrm.employee.read') ? loadRefs('hrm.employee') : Promise.resolve(new Map()),
      ]);
      const ticketRows = (ticketRes.items || []).sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));
      setTickets(ticketRows); setMessages(messageRes.items || []); setParties(partyMap); setPolicies(policyMap); setEmployees(employeeMap);
      setSelectedId((current) => ticketRows.some((ticket) => ticket.id === current) ? current : ticketRows[0]?.id || '');
      setTicketForm((current) => ({ ...current, party: current.party || [...partyMap.keys()][0] || '', sla_policy: current.sla_policy || [...policyMap.keys()][0] || '' }));
    } catch (reason) { setError(reason.message || 'Không thể tải hộp thư hỗ trợ.'); }
    finally { if (!quiet) setLoading(false); }
  }, []);

  useEffect(() => { document.title = 'Hộp thư hỗ trợ · OSP Suite'; load(); }, [load]);
  const selected = tickets.find((ticket) => ticket.id === selectedId);
  const thread = useMemo(() => messages.filter((message) => message.ticket === selectedId).sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || ''))), [messages, selectedId]);
  const visibleTickets = tickets.filter((ticket) => filter === 'all' || (filter === 'active' ? ['open', 'in_progress'].includes(ticket.status) : ticket.status === filter));

  useEffect(() => {
    if (!visibleTickets.some((ticket) => ticket.id === selectedId)) setSelectedId(visibleTickets[0]?.id || '');
  }, [filter, tickets, selectedId]);

  useEffect(() => {
    setAssignment(selected?.assignee || '');
    setAssignmentEmployee(selected?.assignee_employee || '');
    setResolution(selected?.resolution || '');
    setMessageForm((current) => ({ ...current, author: app.user?.name || current.author || '' }));
  }, [selectedId]);

  async function run(key, operation, success) {
    setBusy(key); setError(''); setNotice('');
    try { const result = await operation(); await load(true); if (success) setNotice(success); return result; }
    catch (reason) { setError(reason.message || 'Không thể hoàn tất thao tác.'); await load(true); }
    finally { setBusy(''); }
  }

  async function createTicket(event) {
    event.preventDefault();
    const created = await run('ticket', async () => {
      const ticket = await api(dataPath('helpdesk.ticket'), { method: 'POST', body: {
        subject: ticketForm.subject.trim(), ...(ticketForm.party ? { party: ticketForm.party } : {}),
        priority: ticketForm.priority, channel: ticketForm.channel,
        ...(ticketForm.sla_policy ? { sla_policy: ticketForm.sla_policy } : {}),
        ...(ticketForm.description.trim() ? { description: ticketForm.description.trim() } : {}),
        ...(ticketForm.assignee.trim() ? { assignee: ticketForm.assignee.trim() } : {}),
        ...(ticketForm.assignee_employee ? { assignee_employee: ticketForm.assignee_employee } : {}),
      } });
      setTicketForm({ ...emptyTicket, party: ticketForm.party, sla_policy: ticketForm.sla_policy });
      return ticket;
    }, 'Đã tiếp nhận ticket hỗ trợ.');
    if (created) { setFilter('active'); setSelectedId(created.id); }
  }

  async function saveAssignment(event) {
    event.preventDefault(); if (!selected) return;
    const employee = employees.get(assignmentEmployee);
    await run(`${selected.id}:assignment`, () => api(dataPath('helpdesk.ticket', selected.id), { method: 'PATCH', body: {
      assignee: employee?.name || assignment.trim() || null,
      assignee_employee: assignmentEmployee || null,
    } }), 'Đã lưu người phụ trách.');
  }

  async function addMessage(event) {
    event.preventDefault(); if (!selected) return;
    const direction = messageForm.direction;
    await run(`${selected.id}:message`, async () => {
      await api(dataPath('helpdesk.message'), { method: 'POST', body: {
        ticket: selected.id, direction, author: messageForm.author.trim(), body: messageForm.body.trim(),
      } });
      setMessageForm((current) => ({ ...current, body: '' }));
    }, direction === 'outbound' ? 'Đã gửi phản hồi và cập nhật thời điểm phản hồi SLA.' : direction === 'internal' ? 'Đã lưu ghi chú nội bộ.' : 'Đã ghi nhận tin nhắn khách hàng.');
  }

  async function resolveTicket(event) {
    event.preventDefault(); if (!selected) return;
    await run(`${selected.id}:resolved`, () => api(dataPath('helpdesk.ticket', selected.id, 'resolved'), { method: 'POST', body: { resolution: resolution.trim() } }), 'Đã giải quyết ticket và ghi thời điểm SLA.');
  }

  async function transition(action, message) {
    if (!selected) return;
    await run(`${selected.id}:${action}`, () => api(dataPath('helpdesk.ticket', selected.id, action), { method: 'POST' }), message);
  }

  const partyName = (ticket) => ticket?.party ? recordLabel('master-data.party', parties.get(ticket.party) || { id: ticket.party }) : 'Khách chưa gắn hồ sơ';
  const activeEmployees = [...employees.values()].filter((employee) => employee.status === 'active');
  const directionLabel = { inbound: 'Khách hàng', outbound: 'Phản hồi', internal: 'Ghi chú nội bộ' };

  return <div className="page">
    <div className="page-head"><div><h1>Hộp thư hỗ trợ</h1><p className="sub">Tiếp nhận, phân công, trao đổi với khách hàng, theo dõi SLA và lưu kết quả xử lý trong cùng hồ sơ.</p></div><div className="row wrap"><a className="btn btn-secondary" href="#/reports/helpdesk/sla">Báo cáo SLA</a><button className="btn btn-secondary" type="button" disabled={loading || Boolean(busy)} onClick={() => load()}>Làm mới</button></div></div>
    {error && <div className="alert danger" role="alert">{error}</div>}{notice && <div className="alert success" role="status">{notice}</div>}
    {can('helpdesk.ticket.create') && <section className="card card-pad"><h2>Tiếp nhận ticket</h2><form className="form-grid" onSubmit={createTicket}>
      <label className="field"><span className="label">Tiêu đề *</span><input className="input" required maxLength="240" value={ticketForm.subject} onChange={(event) => setTicketForm((current) => ({ ...current, subject: event.target.value }))} /></label>
      <label className="field"><span className="label">Khách hàng</span><select className="select" value={ticketForm.party} onChange={(event) => setTicketForm((current) => ({ ...current, party: event.target.value }))}><option value="">Chưa gắn hồ sơ khách</option>{[...parties.values()].filter((party) => party.is_customer !== false).map((party) => <option key={party.id} value={party.id}>{recordLabel('master-data.party', party)}</option>)}</select></label>
      <label className="field"><span className="label">Mức ưu tiên</span><select className="select" value={ticketForm.priority} onChange={(event) => setTicketForm((current) => ({ ...current, priority: event.target.value }))}>{[['low','Thấp'],['normal','Bình thường'],['high','Cao'],['urgent','Khẩn cấp']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="field"><span className="label">Kênh tiếp nhận</span><select className="select" value={ticketForm.channel} onChange={(event) => setTicketForm((current) => ({ ...current, channel: event.target.value }))}>{[['email','Email'],['phone','Điện thoại'],['chat','Trò chuyện'],['field','Dịch vụ hiện trường'],['other','Khác']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="field"><span className="label">Chính sách SLA</span><select className="select" value={ticketForm.sla_policy} onChange={(event) => setTicketForm((current) => ({ ...current, sla_policy: event.target.value }))}><option value="">Chưa gắn SLA</option>{[...policies.values()].map((policy) => <option key={policy.id} value={policy.id}>{policy.name} · phản hồi {policy.response_hours}h / xử lý {policy.resolve_hours}h</option>)}</select></label>
      {can('hrm.employee.read') && <label className="field"><span className="label">Nhân viên phụ trách</span><select className="select" value={ticketForm.assignee_employee} onChange={(event) => setTicketForm((current) => ({ ...current, assignee_employee: event.target.value, assignee: employees.get(event.target.value)?.name || '' }))}><option value="">Nhà thầu / người phụ trách ngoài</option>{activeEmployees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select></label>}
      <label className="field"><span className="label">Người phụ trách ngoài</span><input className="input" maxLength="160" readOnly={Boolean(ticketForm.assignee_employee)} value={ticketForm.assignee} onChange={(event) => setTicketForm((current) => ({ ...current, assignee: event.target.value }))} /></label>
      <label className="field full"><span className="label">Mô tả yêu cầu</span><textarea className="textarea" rows="3" maxLength="10000" value={ticketForm.description} onChange={(event) => setTicketForm((current) => ({ ...current, description: event.target.value }))} /></label>
      <div className="row full"><span className="grow"/><button className="btn btn-primary" disabled={Boolean(busy) || loading}>Tạo ticket</button></div>
    </form></section>}
    <div className="tabs" role="tablist" aria-label="Lọc ticket" style={{ marginTop: 16 }}>
      {['active','resolved','closed','all'].map((value) => <button className="tab" key={value} type="button" role="tab" aria-selected={filter === value} onClick={() => setFilter(value)}>{({active:'Đang xử lý',resolved:'Đã giải quyết',closed:'Đã đóng',all:'Tất cả'})[value]}</button>)}
    </div>
    {loading ? <div className="card-pad"><div className="skeleton" data-h="row" /></div> : !visibleTickets.length ? <div className="card card-pad empty">Không có ticket trong bộ lọc này.</div> : <div className="layout-split">
      <section className="card card-pad"><div className="table-wrap"><table className="table"><thead><tr><th>Ticket</th><th>Ưu tiên</th><th>Trạng thái</th></tr></thead><tbody>{visibleTickets.map((ticket) => <tr {...selectableTableRowProps} key={ticket.id} aria-selected={selectedId === ticket.id} className={selectedId === ticket.id ? 'selected' : ''} onClick={() => setSelectedId(ticket.id)} style={{ cursor: 'pointer' }}><td><strong>{ticket.subject}</strong><div className="small muted">{partyName(ticket)} · {fmtDateTime(ticket.createdAt)}</div></td><td>{statusLabel(ticket.priority)}</td><td>{statusLabel(ticket.status)}</td></tr>)}</tbody></table></div></section>
      {selected && <section className="card card-pad"><div className="row wrap"><div><h2>{selected.subject}</h2><div className="small muted">{partyName(selected)} · {statusLabel(selected.channel)} · {fmtDateTime(selected.createdAt)}</div></div><span className="grow"/><span className="badge warning">{statusLabel(selected.status)}</span></div>
        <div className="row wrap small muted" style={{ marginTop: 8 }}><span>Ưu tiên: {statusLabel(selected.priority)}</span><span>· Phụ trách: {selected.assignee || 'Chưa phân công'}</span><span>· SLA: {policies.get(selected.sla_policy)?.name || 'Chưa gắn'}</span></div>
        {selected.description && <div className="card card-pad" style={{ marginTop: 12 }}><strong>Yêu cầu ban đầu</strong><p className="pre-wrap">{selected.description}</p></div>}
        {can('helpdesk.ticket.update') && ['open','in_progress'].includes(selected.status) && <form className="row wrap" style={{ marginTop: 12 }} onSubmit={saveAssignment}>{can('hrm.employee.read') && <label className="field"><span className="label">Nhân viên nội bộ</span><select className="select" value={assignmentEmployee} onChange={(event) => { const employee = employees.get(event.target.value); setAssignmentEmployee(event.target.value); setAssignment(employee?.name || ''); }}><option value="">Người phụ trách ngoài</option>{assignmentEmployee && !employees.has(assignmentEmployee) && <option value={assignmentEmployee}>Nhân viên {assignmentEmployee.slice(0, 8)} · không còn trong danh mục</option>}{activeEmployees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select></label>}<label className="field grow"><span className="label">Người phụ trách ngoài</span><input className="input" maxLength="160" readOnly={Boolean(assignmentEmployee)} value={assignment} onChange={(event) => setAssignment(event.target.value)} /></label><button className="btn btn-secondary btn-sm" disabled={Boolean(busy)}>Lưu phân công</button></form>}
        <div className="row wrap" style={{ marginTop: 14 }}><h3>Trao đổi</h3><span className="grow"/><span className="small muted">Phản hồi đầu tiên tự ghi nhận SLA và chuyển ticket sang đang xử lý.</span></div>
        {!can('helpdesk.message.read') ? <div className="small muted">Bạn chưa có quyền xem trao đổi ticket.</div> : !thread.length ? <div className="empty">Chưa có trao đổi. Gửi phản hồi hoặc ghi nhận tin nhắn đầu tiên.</div> : <div className="stack-sm" style={{ marginTop: 8 }}>{thread.map((message) => <article className="card card-pad" key={message.id}><div className="row wrap"><strong>{message.author}</strong><span className="badge plain">{directionLabel[message.direction] || message.direction}</span><span className="grow"/><span className="small muted">{fmtDateTime(message.createdAt)}</span></div><p className="pre-wrap" style={{ marginBottom: 0 }}>{message.body}</p></article>)}</div>}
        {can('helpdesk.message.create') && can('helpdesk.message.read') && <form className="card card-pad" style={{ marginTop: 12 }} onSubmit={addMessage}><div className="form-grid"><label className="field"><span className="label">Loại trao đổi</span><select className="select" value={messageForm.direction} onChange={(event) => setMessageForm((current) => ({ ...current, direction: event.target.value }))}>{[['outbound','Phản hồi khách hàng'],['inbound','Tin nhắn khách hàng'],['internal','Ghi chú nội bộ']].map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="field"><span className="label">Người gửi *</span><input className="input" required maxLength="160" value={messageForm.author} onChange={(event) => setMessageForm((current) => ({ ...current, author: event.target.value }))} /></label><label className="field full"><span className="label">Nội dung *</span><textarea className="textarea" rows="3" required minLength="1" maxLength="10000" value={messageForm.body} onChange={(event) => setMessageForm((current) => ({ ...current, body: event.target.value }))} /></label></div>{messageForm.direction === 'outbound' && selected.status === 'open' && !selected.assignee?.trim() && <p className="small muted">Phân công người phụ trách trước khi gửi phản hồi đầu tiên.</p>}{(selected.status === 'resolved' || selected.status === 'closed') && <p className="small muted">Tin nhắn khách hàng sẽ tự mở lại ticket; mở ticket trước khi gửi phản hồi mới.</p>}<div className="row"><span className="grow"/><button className="btn btn-primary" disabled={Boolean(busy) || (messageForm.direction === 'outbound' && ['resolved','closed'].includes(selected.status)) || (messageForm.direction === 'internal' && selected.status === 'closed')}>Lưu trao đổi</button></div></form>}
        {selected.status === 'open' || selected.status === 'in_progress' ? <form className="card card-pad" style={{ marginTop: 12 }} onSubmit={resolveTicket}><h3>Giải quyết ticket</h3><label className="field"><span className="label">Kết quả xử lý *</span><textarea className="textarea" required minLength="1" maxLength="4000" rows="3" value={resolution} onChange={(event) => setResolution(event.target.value)} /></label><div className="row" style={{ marginTop: 8 }}><span className="grow"/><button className="btn btn-primary" disabled={Boolean(busy) || !can('helpdesk.ticket.update') || !can('helpdesk.ticket.resolved')}>Giải quyết</button></div></form> : selected.resolution && <div className="card card-pad" style={{ marginTop: 12 }}><strong>Kết quả xử lý</strong><p className="pre-wrap">{selected.resolution}</p></div>}
        <div className="row wrap" style={{ marginTop: 12 }}>{selected.status === 'resolved' && can('helpdesk.ticket.closed') && <button className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => transition('closed', 'Đã đóng ticket.')}>Đóng ticket</button>}{['resolved','closed'].includes(selected.status) && can('helpdesk.ticket.reopened') && <button className="btn btn-ghost btn-sm" disabled={Boolean(busy)} onClick={() => transition('reopened', 'Đã mở lại ticket.')}>Mở lại</button>}</div>
      </section>}
    </div>}
  </div>;
}
