import React from 'react';
import { recordHref } from '../../../lib/routes.js';

function PageControls({ total, page, pageSize, onPageChange, t }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, pages - 1);
  if (pages <= 1) return null;
  const from = currentPage * pageSize + 1;
  const to = Math.min(total, from + pageSize - 1);
  return <nav className="row wrap" aria-label={t('Điều hướng trang danh sách')}>
    <span className="small muted">{t('{from}–{to} trong {total}').replace('{from}', String(from)).replace('{to}', String(to)).replace('{total}', String(total))}</span>
    <span className="grow" />
    <button className="btn btn-ghost btn-sm" type="button" disabled={currentPage === 0} onClick={() => onPageChange(currentPage - 1)}>{t('Trước')}</button>
    <span className="small">{t('Trang')} {currentPage + 1} / {pages}</span>
    <button className="btn btn-ghost btn-sm" type="button" disabled={currentPage + 1 >= pages} onClick={() => onPageChange(currentPage + 1)}>{t('Sau')}</button>
  </nav>;
}

export function LeaveRequestsTable({
  loading, leaveRequests, employeeMap, workflowApproval, approvalFor, can, busy,
  onDecision, onSubmitAgain, statusLabel, formatDate, page, pageSize, onPageChange, t,
}) {
  const currentPage = Math.min(page, Math.max(0, Math.ceil(leaveRequests.length / pageSize) - 1));
  const visibleRequests = leaveRequests.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  return <section className="card card-pad">
    <h2>{t('Đơn nghỉ phép cần xử lý')}</h2>
    {loading ? <div className="skeleton" data-h="row"/> : !leaveRequests.length
      ? <div className="empty">{t('Chưa có đơn nghỉ phép.')}</div>
      : <div className="table-wrap"><table className="table">
        <thead><tr>
          <th>{t('Nhân viên / loại nghỉ')}</th><th>{t('Thời gian')}</th>
          <th>{t('Hưởng lương')}</th><th>{t('Trạng thái')}</th>
          <th scope="col">{t('Thao tác')}</th>
        </tr></thead>
        <tbody>{visibleRequests.map((row) => {
          const request = approvalFor('hrm.leave_request', row.id);
          return <tr key={row.id}>
            <td><strong>{employeeMap.get(row.employee)?.name || t('Nhân viên')}</strong><div className="small muted">
              {statusLabel(row.kind)}{row.partial_day !== 'full' ? ` · ${statusLabel(row.partial_day)}` : ''}
            </div></td>
            <td>{formatDate(row.start_date)} – {formatDate(row.end_date)}</td>
            <td>{statusLabel(row.pay_treatment)}</td>
            <td>{statusLabel(row.status)}{row.status === 'submitted' && workflowApproval && request && <div className="small">
              <a href={`#/e/workflow-approval/approval_request/${request.id}`}>{t('Mở yêu cầu duyệt')}</a>
            </div>}</td>
            <td>
              {row.status === 'submitted' && !workflowApproval && can('hrm.leave_request.approved') && <div className="row wrap">
                <button className="btn btn-primary btn-sm" disabled={Boolean(busy)} onClick={() => onDecision(row, 'approved')}>{t('Duyệt')}</button>
                <button className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => onDecision(row, 'rejected')}>{t('Từ chối')}</button>
              </div>}
              {['draft', 'rejected'].includes(row.status) && can('hrm.leave_request.submitted') && <div className="row wrap">
                <a className="small" href={recordHref('hrm.leave_request', row.id)}>{t('Mở / sửa')}</a>
                <button className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => onSubmitAgain(row)}>{t('Gửi lại')}</button>
              </div>}
            </td>
          </tr>;
        })}</tbody>
      </table></div>}
    {!loading && <PageControls total={leaveRequests.length} page={currentPage} pageSize={pageSize} onPageChange={onPageChange} t={t} />}
  </section>;
}

export function EmployeeDirectoryTable({
  loading, employees, departments, positions, can, busy, onTerminate,
  recordLabel, formatDate, statusLabel, page, pageSize, onPageChange, t,
}) {
  const currentPage = Math.min(page, Math.max(0, Math.ceil(employees.length / pageSize) - 1));
  const visibleEmployees = employees.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  return <section className="card card-pad">
    <h2>{t('Hồ sơ nhân viên')}</h2>
    {loading ? <div className="skeleton" data-h="row"/> : !employees.length
      ? <div className="empty">{t('Chưa có hồ sơ nhân viên.')}</div>
      : <div className="table-wrap"><table className="table">
        <thead><tr>
          <th>{t('Nhân viên / chức danh')}</th><th>{t('Ngày vào')}</th>
          <th>{t('Trạng thái')}</th><th scope="col">{t('Thao tác')}</th>
        </tr></thead>
        <tbody>{visibleEmployees.map((row) => <tr key={row.id}>
          <td><strong>{recordLabel('hrm.employee', row)}</strong><div className="small muted">
            {departments.get(row.department)?.name || t('Chưa phân phòng ban')}{positions.get(row.position)?.name ? ` · ${positions.get(row.position).name}` : ''}
          </div></td>
          <td>{formatDate(row.hire_date)}</td><td>{statusLabel(row.status)}</td>
          <td>{row.status === 'active' && can('hrm.employee.update') && can('hrm.employee.terminated') && <button
            className="btn btn-ghost btn-sm" disabled={Boolean(busy)} onClick={() => onTerminate(row)}
          >{t('Kết thúc')}</button>}</td>
        </tr>)}</tbody>
      </table></div>}
    {!loading && <PageControls total={employees.length} page={currentPage} pageSize={pageSize} onPageChange={onPageChange} t={t} />}
  </section>;
}

export function SalaryRevisionsTable({
  salaryRevisions, employeeMap, can, busy, onDecision, onSubmitAgain,
  statusLabel, formatDate, formatMoney, page, pageSize, onPageChange, t,
}) {
  const currentPage = Math.min(page, Math.max(0, Math.ceil(salaryRevisions.length / pageSize) - 1));
  const visibleRevisions = salaryRevisions.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  return <section className="card card-pad u-mt-16">
    <h2>{t('Điều chỉnh lương theo hiệu lực')}</h2>
    {!salaryRevisions.length ? <div className="empty">{t('Chưa có đề nghị điều chỉnh lương.')}</div>
      : <div className="table-wrap"><table className="table">
        <thead><tr>
          <th>{t('Nhân viên / lý do')}</th><th>{t('Hiệu lực')}</th>
          <th>{t('Mức mới')}</th><th>{t('Trạng thái')}</th><th scope="col">{t('Thao tác')}</th>
        </tr></thead>
        <tbody>{visibleRevisions.map((row) => <tr key={row.id}>
          <td><strong>{employeeMap.get(row.employee)?.name || t('Nhân viên')}</strong><div className="small muted">{row.reason}</div></td>
          <td>{formatDate(row.effective_from)}</td><td>{formatMoney(row.base_salary || 0)}</td><td>{statusLabel(row.status)}</td>
          <td>
            {row.status === 'submitted' && can('hrm.salary_revision.approved') && <div className="row wrap">
              <button className="btn btn-primary btn-sm" disabled={Boolean(busy)} onClick={() => onDecision(row, 'approved')}>{t('Duyệt')}</button>
              <button className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => onDecision(row, 'rejected')}>{t('Từ chối')}</button>
            </div>}
            {['draft', 'rejected'].includes(row.status) && can('hrm.salary_revision.submitted') && <div className="row wrap">
              <a className="small" href={recordHref('hrm.salary_revision', row.id)}>{t('Mở / sửa')}</a>
              <button className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => onSubmitAgain(row)}>{t('Gửi lại')}</button>
            </div>}
          </td>
        </tr>)}</tbody>
      </table></div>}
    <PageControls total={salaryRevisions.length} page={currentPage} pageSize={pageSize} onPageChange={onPageChange} t={t} />
  </section>;
}
