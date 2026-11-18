import { useEffect, useMemo, useState } from 'react';
import { api, dataPath } from '../../../lib/api.js';
import { app } from '../../../lib/state.js';
import { uiTextWith } from '../../../lib/i18n.js';
import helpdeskEnglish from '../helpdesk.en.js';

const t = (text) => uiTextWith(text, helpdeskEnglish);
const emptyTicket = { subject: '', party: '', priority: 'normal', channel: 'email', sla_policy: '', description: '', assignee: '', assignee_employee: '' };

export function useHelpdeskWorkbenchWorkflow({ tickets, parties, policies, employees, load, setError }) {
  const [selectedId, setSelectedId] = useState('');
  const [ticketForm, setTicketForm] = useState(emptyTicket);
  const [messageForm, setMessageForm] = useState({ direction: 'outbound', author: app.user?.name || '', body: '' });
  const [assignment, setAssignment] = useState('');
  const [assignmentEmployee, setAssignmentEmployee] = useState('');
  const [resolution, setResolution] = useState('');
  const [filter, setFilter] = useState('active');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const selected = tickets.find((ticket) => ticket.id === selectedId);
  const visibleTickets = useMemo(() => tickets.filter((ticket) => filter === 'all'
    || (filter === 'active' ? ['open', 'in_progress'].includes(ticket.status) : ticket.status === filter)), [tickets, filter]);

  useEffect(() => {
    setSelectedId((current) => current && tickets.some((ticket) => ticket.id === current) ? current : tickets[0]?.id || '');
  }, [tickets]);
  useEffect(() => {
    setTicketForm((current) => ({ ...current, party: current.party || [...parties.keys()][0] || '', sla_policy: current.sla_policy || [...policies.keys()][0] || '' }));
  }, [parties, policies]);
  useEffect(() => {
    if (!visibleTickets.some((ticket) => ticket.id === selectedId)) setSelectedId(visibleTickets[0]?.id || '');
  }, [visibleTickets, selectedId]);
  useEffect(() => {
    setAssignment(selected?.assignee || '');
    setAssignmentEmployee(selected?.assignee_employee || '');
    setResolution(selected?.resolution || '');
    setMessageForm((current) => ({ ...current, author: app.user?.name || current.author || '' }));
  }, [selectedId]);

  async function run(key, operation, success) {
    setBusy(key); setError(''); setNotice('');
    try {
      const result = await operation();
      await load(true);
      if (success) setNotice(t(success));
      return result;
    } catch (reason) {
      setError(t(reason.message || 'KhÃ´ng thá»ƒ hoÃ n táº¥t thao tÃ¡c.'));
      await load(true);
    } finally { setBusy(''); }
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
    }, 'ÄÃ£ tiáº¿p nháº­n ticket há»— trá»£.');
    if (created) { setFilter('active'); setSelectedId(created.id); }
  }

  async function saveAssignment(event) {
    event.preventDefault(); if (!selected) return;
    const employee = employees.get(assignmentEmployee);
    await run(`${selected.id}:assignment`, () => api(dataPath('helpdesk.ticket', selected.id), { method: 'PATCH', body: {
      assignee: employee?.name || assignment.trim() || null,
      assignee_employee: assignmentEmployee || null,
    } }), 'ÄÃ£ lÆ°u ngÆ°á»i phá»¥ trÃ¡ch.');
  }

  async function addMessage(event) {
    event.preventDefault(); if (!selected) return;
    const direction = messageForm.direction;
    await run(`${selected.id}:message`, async () => {
      await api(dataPath('helpdesk.message'), { method: 'POST', body: {
        ticket: selected.id, direction, author: messageForm.author.trim(), body: messageForm.body.trim(),
      } });
      setMessageForm((current) => ({ ...current, body: '' }));
    }, direction === 'outbound' ? 'ÄÃ£ gá»­i pháº£n há»“i vÃ  cáº­p nháº­t thá»i Ä‘iá»ƒm pháº£n há»“i SLA.' : direction === 'internal' ? 'ÄÃ£ lÆ°u ghi chÃº ná»™i bá»™.' : 'ÄÃ£ ghi nháº­n tin nháº¯n khÃ¡ch hÃ ng.');
  }

  async function resolveTicket(event) {
    event.preventDefault(); if (!selected) return;
    await run(`${selected.id}:resolved`, () => api(dataPath('helpdesk.ticket', selected.id, 'resolved'), { method: 'POST', body: { resolution: resolution.trim() } }), 'ÄÃ£ giáº£i quyáº¿t ticket vÃ  ghi thá»i Ä‘iá»ƒm SLA.');
  }

  async function transition(action, message) {
    if (!selected) return;
    await run(`${selected.id}:${action}`, () => api(dataPath('helpdesk.ticket', selected.id, action), { method: 'POST' }), message);
  }

  return {
    selectedId, setSelectedId, selected, ticketForm, setTicketForm, messageForm, setMessageForm,
    assignment, setAssignment, assignmentEmployee, setAssignmentEmployee, resolution, setResolution,
    filter, setFilter, busy, notice, visibleTickets,
    createTicket, saveAssignment, addMessage, resolveTicket, transition,
  };
}
