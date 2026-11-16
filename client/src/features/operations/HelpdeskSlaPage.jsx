import React, { useEffect, useState } from 'react';
import { api, tenantPath } from '../../lib/api.js';
import { fmtDateTime, fmtNumber } from '../../lib/i18n.js';

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
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    document.title = 'SLA hỗ trợ · OSP Suite';
    api(tenantPath('/reports/helpdesk/sla'))
      .then((data) => { if (active) setReport(data); })
      .catch((reason) => { if (active) setError(reason.message || 'Không tải được báo cáo SLA.'); });
    return () => { active = false; };
  }, []);

  const stats = report ? [
    ['Phản hồi đạt', report.responseMet],
    ['Phản hồi đang trong hạn', report.responsePending],
    ['Phản hồi quá hạn', report.responseBreached],
    ['Giải quyết đạt', report.resolutionMet],
    ['Giải quyết đang trong hạn', report.resolutionPending],
    ['Giải quyết quá hạn', report.resolutionBreached],
  ] : [];

  return <div className="page">
    <div className="page-head"><div><h1>SLA hỗ trợ</h1><p className="sub">Đo phản hồi đầu tiên và thời hạn giải quyết theo chính sách gắn trên ticket.</p></div><a className="btn btn-secondary" href="#/e/helpdesk/ticket">Ticket hỗ trợ</a></div>
    {error && <div className="alert danger" role="alert">{error}</div>}
    {!report && !error && <div className="card-pad"><div className="skeleton" data-h="row" /></div>}
    {report && <div className="stack">
      <div className="stats">
        {stats.map(([label, value]) => <div className="card stat" key={label}><span className="stat-label">{label}</span><strong className="stat-value num">{fmtNumber(Number(value || 0))}</strong></div>)}
        <div className="card stat"><span className="stat-label">Ticket chưa gán SLA</span><strong className="stat-value num">{fmtNumber(Number(report.responseUnassigned || 0))}</strong></div>
        <div className="card stat"><span className="stat-label">Tổng ticket</span><strong className="stat-value num">{fmtNumber(Number(report.totalTickets || 0))}</strong></div>
      </div>
      {!report.tickets?.length ? <div className="empty"><h3>Chưa có ticket</h3><p>Tạo ticket và gắn chính sách SLA để theo dõi thời hạn phản hồi, giải quyết.</p></div> : <div className="card table-wrap"><table className="table">
        <thead><tr><th scope="col">Ticket</th><th scope="col">Trạng thái</th><th scope="col">Tạo lúc</th><th scope="col">Phản hồi đầu</th><th scope="col">Hạn phản hồi</th><th scope="col">SLA phản hồi</th><th scope="col">Hạn giải quyết</th><th scope="col">SLA giải quyết</th></tr></thead>
        <tbody>{report.tickets.map((ticket) => <tr key={ticket.id}>
          <td><a href={`#/e/helpdesk/ticket/${encodeURIComponent(ticket.id)}`}>{ticket.subject}</a></td>
          <td>{labels[ticket.status] || ticket.status}</td>
          <td>{fmtDateTime(ticket.createdAt)}</td>
          <td>{fmtDateTime(ticket.firstResponseAt)}</td>
          <td>{fmtDateTime(ticket.responseDueAt)}</td>
          <td>{labels[ticket.responseSla] || ticket.responseSla}</td>
          <td>{fmtDateTime(ticket.resolutionDueAt)}</td>
          <td>{labels[ticket.resolutionSla] || ticket.resolutionSla}</td>
        </tr>)}</tbody>
      </table></div>}
    </div>}
  </div>;
}
