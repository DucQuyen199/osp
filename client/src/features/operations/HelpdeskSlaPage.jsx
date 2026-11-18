import React, { useEffect, useState } from 'react';
import { useDocumentTitle } from '../../lib/useDocumentTitle.js';
import { api, tenantPath } from '../../lib/api.js';
import { fmtDateTime, fmtNumber, uiTextWith } from '../../lib/i18n.js';
const helpdeskSlaEnglish = {
  'Đạt': 'Met', 'Đang trong hạn': 'Within target', 'Quá hạn': 'Breached', 'Chưa gán SLA': 'No SLA assigned',
  'Mở': 'Open', 'Đang xử lý': 'In progress', 'Đã xử lý': 'Resolved', 'Đã đóng': 'Closed',
  'SLA hỗ trợ': 'Support SLA', 'Không tải được báo cáo SLA.': 'Could not load the SLA report.',
  'Phản hồi đạt': 'Response met', 'Phản hồi đang trong hạn': 'Response within target', 'Phản hồi quá hạn': 'Response breached',
  'Giải quyết đạt': 'Resolution met', 'Giải quyết đang trong hạn': 'Resolution within target', 'Giải quyết quá hạn': 'Resolution breached',
  'Đo phản hồi đầu tiên và thời hạn giải quyết theo chính sách gắn trên ticket.': 'Measure first response and resolution deadlines against the policy assigned to each ticket.',
  'Ticket hỗ trợ': 'Support tickets', 'Ticket chưa gán SLA': 'Tickets without an SLA', 'Tổng ticket': 'Total tickets',
  'Chưa có ticket': 'No tickets yet', 'Tạo ticket và gắn chính sách SLA để theo dõi thời hạn phản hồi, giải quyết.': 'Create tickets and assign an SLA policy to track response and resolution deadlines.',
  'Đang tải trang': 'Loading page', 'Trang trước': 'Previous page', 'Trang sau': 'Next page', 'Trang {current} / {total}': 'Page {current} / {total}', 'Phân trang ticket SLA': 'SLA ticket pagination', 'Không có ticket ở trang này.': 'No tickets on this page.',
  'Ticket': 'Ticket', 'Trạng thái': 'Status', 'Tạo lúc': 'Created', 'Phản hồi đầu': 'First response',
  'Hạn phản hồi': 'Response due', 'SLA phản hồi': 'Response SLA', 'Hạn giải quyết': 'Resolution due', 'SLA giải quyết': 'Resolution SLA',
};
const t = (text) => uiTextWith(text, helpdeskSlaEnglish);
const labels = {
  met: 'Đạt',
  pending: 'Đang trong hạn',
  breached: 'Quá hạn',
  unassigned: 'Chưa gán SLA',
  open: 'Mở',
  in_progress: 'Đang xử lý',
  resolved: 'Đã xử lý',
  closed: 'Đã đóng',
};
export default function HelpdeskSlaPage() {
  useDocumentTitle(`${t('SLA hỗ trợ')} · OSP Suite`);
  const pageSize = 50;
  const [offset, setOffset] = useState(0);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setLoading(true);
    api(tenantPath(`/reports/helpdesk/sla?limit=${pageSize}&offset=${offset}`))
      .then((data) => { if (active) { setReport(data); setError(''); } })
      .catch((reason) => { if (active) setError(t(reason.message || 'Không tải được báo cáo SLA.')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [offset]);
  const stats = report ? [
    [t('Phản hồi đạt'), report.responseMet],
    [t('Phản hồi đang trong hạn'), report.responsePending],
    [t('Phản hồi quá hạn'), report.responseBreached],
    [t('Giải quyết đạt'), report.resolutionMet],
    [t('Giải quyết đang trong hạn'), report.resolutionPending],
    [t('Giải quyết quá hạn'), report.resolutionBreached],
  ] : [];
  return <div className="page">
    <div className="page-head"><div><h1>{t('SLA hỗ trợ')}</h1><p className="sub">{t('Đo phản hồi đầu tiên và thời hạn giải quyết theo chính sách gắn trên ticket.')}</p></div><a className="btn btn-secondary" href="#/e/helpdesk/ticket">{t('Ticket hỗ trợ')}</a></div>
    {error && <div className="alert danger" role="alert">{t(error)}</div>}
    {!report && !error && <div className="card-pad"><div className="skeleton" data-h="row" /></div>}
    {report && <div className="stack">
      <div className="stats">
        {stats.map(([label, value]) => <div className="card stat" key={label}><span className="stat-label">{label}</span><strong className="stat-value num">{fmtNumber(String(value || 0))}</strong></div>)}
        <div className="card stat"><span className="stat-label">{t('Ticket chưa gán SLA')}</span><strong className="stat-value num">{fmtNumber(String(report.responseUnassigned || 0))}</strong></div>
        <div className="card stat"><span className="stat-label">{t('Tổng ticket')}</span><strong className="stat-value num">{fmtNumber(String(report.totalTickets || 0))}</strong></div>
      </div>
      {!report.tickets?.length && report.totalTickets === 0 ? <div className="empty"><h3>{t('Chưa có ticket')}</h3><p>{t('Tạo ticket và gắn chính sách SLA để theo dõi thời hạn phản hồi, giải quyết.')}</p></div> : !report.tickets?.length ? <div className="empty">{t('Không có ticket ở trang này.')}</div> : <div className="card table-wrap"><table className="table">
        <thead><tr><th scope="col">{t('Ticket')}</th><th scope="col">{t('Trạng thái')}</th><th scope="col">{t('Tạo lúc')}</th><th scope="col">{t('Phản hồi đầu')}</th><th scope="col">{t('Hạn phản hồi')}</th><th scope="col">{t('SLA phản hồi')}</th><th scope="col">{t('Hạn giải quyết')}</th><th scope="col">{t('SLA giải quyết')}</th></tr></thead>
        <tbody>{report.tickets.map((ticket) => <tr key={ticket.id}>
          <td><a href={`#/e/helpdesk/ticket/${encodeURIComponent(ticket.id)}`}>{ticket.subject}</a></td>
          <td>{t(labels[ticket.status] || ticket.status)}</td>
          <td>{fmtDateTime(ticket.createdAt)}</td>
          <td>{fmtDateTime(ticket.firstResponseAt)}</td>
          <td>{fmtDateTime(ticket.responseDueAt)}</td>
          <td>{t(labels[ticket.responseSla] || ticket.responseSla)}</td>
          <td>{fmtDateTime(ticket.resolutionDueAt)}</td>
          <td>{t(labels[ticket.resolutionSla] || ticket.resolutionSla)}</td>
        </tr>)}</tbody>
      </table></div>}
      <nav className="row wrap" aria-label={t('Phân trang ticket SLA')}>
        <span className="small muted" aria-live="polite">{t('Trang {current} / {total}').replace('{current}', String(Math.floor(offset / pageSize) + 1)).replace('{total}', String(Math.max(1, Math.ceil(Number(report.totalTickets || 0) / pageSize))))}{loading ? ` · ${t('Đang tải trang')}` : ''}</span>
        <span className="grow" />
        <button className="btn btn-secondary btn-sm" type="button" disabled={loading || offset === 0} onClick={() => setOffset((current) => Math.max(0, current - pageSize))}>{t('Trang trước')}</button>
        <button className="btn btn-secondary btn-sm" type="button" disabled={loading || !report.hasMore} onClick={() => setOffset((current) => current + pageSize)}>{t('Trang sau')}</button>
      </nav>
    </div>}
  </div>;
}
