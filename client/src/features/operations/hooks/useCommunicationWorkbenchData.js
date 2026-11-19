import { useCallback, useEffect, useState } from 'react';
import { api, dataPath } from '../../../lib/api.js';
import { uiTextWith } from '../../../lib/i18n.js';
import { can, loadIndependentData, loadRefs } from '../../../lib/state.js';
import { useLatestRequest } from '../../../lib/useLatestRequest.js';
import communicationEnglish from '../communication.en.js';

const t = (text) => uiTextWith(text, communicationEnglish);
const rows = (response) => Array.isArray(response?.items) ? response.items : [];
const emptyPage = () => ({ items: [], total: 0 });
const emptyMap = () => new Map();
export const REMINDER_PAGE_SIZE = 25;
export const MESSAGE_PAGE_SIZE = 50;
const MESSAGE_STATUSES = ['queued', 'processing', 'retry', 'sent', 'failed'];

const pageRequest = (qname, page, pageSize, sort, dir, filters = {}) => {
  const query = new URLSearchParams({ limit: String(pageSize), offset: String(page * pageSize), sort, dir, ...filters });
  return api(`${dataPath(qname)}?${query}`);
};

export function useCommunicationWorkbenchData({ filter, messagePage, reminderPage, setMessagePage, setReminderPage }) {
  const [reminders, setReminders] = useState([]);
  const [reminderTotal, setReminderTotal] = useState(0);
  const [messages, setMessages] = useState([]);
  const [messageTotal, setMessageTotal] = useState(0);
  const [messageCounts, setMessageCounts] = useState({});
  const [pendingReminderCount, setPendingReminderCount] = useState(0);
  const [parties, setParties] = useState(emptyMap);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const latestRequest = useLatestRequest();

  const load = useCallback(async (quiet = false) => {
    const isLatest = latestRequest();
    setError('');
    if (!quiet) setLoading(true);
    const reads = {
      reminders: can('communication.reminder.read')
        ? pageRequest('communication.reminder', reminderPage, REMINDER_PAGE_SIZE, 'send_at', 'asc', filter === 'all' ? {} : { status: filter })
        : Promise.resolve(emptyPage()),
      messages: can('communication.message_log.read')
        ? pageRequest('communication.message_log', messagePage, MESSAGE_PAGE_SIZE, 'createdAt', 'desc')
        : Promise.resolve(emptyPage()),
      parties: can('master-data.party.read') ? loadRefs('master-data.party') : Promise.resolve(emptyMap()),
      pending: can('communication.reminder.read')
        ? pageRequest('communication.reminder', 0, 1, 'send_at', 'asc', { status: 'pending' })
        : Promise.resolve({ total: 0 }),
      ...Object.fromEntries(MESSAGE_STATUSES.map((status) => [
        `count_${status}`,
        can('communication.message_log.read')
          ? pageRequest('communication.message_log', 0, 1, 'createdAt', 'desc', { status })
          : Promise.resolve({ total: 0 }),
      ])),
    };
    const fallbacks = {
      reminders: emptyPage(), messages: emptyPage(), parties: emptyMap(), pending: { total: 0 },
      ...Object.fromEntries(MESSAGE_STATUSES.map((status) => [`count_${status}`, { total: 0 }])),
    };
    try {
      const { data, errors } = await loadIndependentData(reads, fallbacks);
      if (!isLatest()) return;
      const nextReminderTotal = Number(data.reminders.total || 0);
      const nextMessageTotal = Number(data.messages.total || 0);
      if (reminderPage > 0 && reminderPage * REMINDER_PAGE_SIZE >= nextReminderTotal) setReminderPage(Math.max(0, Math.ceil(nextReminderTotal / REMINDER_PAGE_SIZE) - 1));
      if (messagePage > 0 && messagePage * MESSAGE_PAGE_SIZE >= nextMessageTotal) setMessagePage(Math.max(0, Math.ceil(nextMessageTotal / MESSAGE_PAGE_SIZE) - 1));
      setReminders(rows(data.reminders)); setReminderTotal(nextReminderTotal);
      setMessages(rows(data.messages)); setMessageTotal(nextMessageTotal);
      setParties(data.parties); setPendingReminderCount(Number(data.pending.total || 0));
      setMessageCounts(Object.fromEntries(MESSAGE_STATUSES.map((status) => [status, Number(data[`count_${status}`]?.total || 0)])));
      if (errors.length) setError(errors.map((reason) => t(reason.message || 'Không tải được lịch và nhật ký gửi.')).join(' · '));
    } catch (reason) {
      if (isLatest()) setError(t(reason.message || 'Không tải được lịch và nhật ký gửi.'));
    } finally {
      if (isLatest()) setLoading(false);
    }
  }, [filter, messagePage, reminderPage, latestRequest, setMessagePage, setReminderPage]);

  useEffect(() => { load(); }, [load]);
  return { reminders, reminderTotal, messages, messageTotal, messageCounts, pendingReminderCount, parties, loading, error, load };
}
