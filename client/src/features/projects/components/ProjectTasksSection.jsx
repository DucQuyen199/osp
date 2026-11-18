import React from 'react';

/** Controlled task creation, assignment, blocker and transition presentation. */
export default function ProjectTasksSection({
  project,
  tasks = [],
  taskForm,
  activeEmployees = [],
  employees,
  busy,
  canCreateTask,
  canAssignTasks,
  canReadEmployees,
  canStartTasks,
  canCompleteTasks,
  pendingPredecessors,
  taskAssignment,
  onCreateTask,
  onTaskFieldChange,
  onAssignmentEmployeeChange,
  onAssignmentNameChange,
  onSaveAssignment,
  onStatusChange,
  fmtDate,
  statusLabel,
  t,
}) {
  return <section className="card card-pad u-mt-16">
    <div className="row wrap">
      <div>
        <h2>{t('Công việc')}</h2>
        <p className="small muted">{t('Công việc có thể được lập trong dự án dự kiến; chỉ bắt đầu hoặc hoàn tất khi dự án đang hoạt động.')}</p>
      </div>
      <span className="grow" />
    </div>
    {canCreateTask && ['planned', 'active'].includes(project.status) && <form className="form-grid u-margin-12-0" onSubmit={onCreateTask}>
      <label className="field"><span className="label">{t('Tên công việc *')}</span><input className="input" required maxLength="200" value={taskForm.title} onChange={(event) => onTaskFieldChange('title', event.target.value)} /></label>
      {canReadEmployees && <label className="field"><span className="label">{t('Nhân viên phụ trách')}</span><select className="select" value={taskForm.assignee_employee} onChange={(event) => onTaskFieldChange('assignee_employee', event.target.value)}><option value="">{t('Người phụ trách ngoài')}</option>{activeEmployees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select></label>}
      <label className="field"><span className="label">{t('Người phụ trách ngoài')}</span><input className="input" maxLength="160" readOnly={Boolean(taskForm.assignee_employee)} value={taskForm.assignee} onChange={(event) => onTaskFieldChange('assignee', event.target.value)} /></label>
      <label className="field"><span className="label">{t('Hạn hoàn thành')}</span><input className="input" type="date" value={taskForm.due} onChange={(event) => onTaskFieldChange('due', event.target.value)} /></label>
      <div className="row full"><span className="grow" /><button className="btn btn-secondary" disabled={busy === 'task'}>{t('Thêm công việc')}</button></div>
    </form>}
    {!tasks.length ? <div className="empty">{t('Dự án chưa có công việc.')}</div> : <div className="table-wrap"><table className="table">
      <thead><tr><th>{t('Công việc')}</th><th>{t('Người phụ trách')}</th><th>{t('Hạn')}</th><th>{t('Trạng thái / phụ thuộc')}</th><th>{t('Thao tác')}</th></tr></thead>
      <tbody>{tasks.map((task) => {
        const blockers = pendingPredecessors(task);
        const assignment = taskAssignment(task);
        const mayEditAssignment = task.status !== 'done' && canAssignTasks && ['planned', 'active'].includes(project.status) && (!task.assignee_employee || canReadEmployees);
        return <tr key={task.id}>
          <td>{task.title}</td>
          <td>{mayEditAssignment ? <form className="stack-sm" onSubmit={(event) => onSaveAssignment(event, task)}>
            {canReadEmployees && <select className="select" aria-label={`${t('Nhân viên phụ trách')} ${task.title}`} value={assignment.employee} onChange={(event) => onAssignmentEmployeeChange(task, event.target.value)}>
              <option value="">{t('Người phụ trách ngoài')}</option>
              {assignment.employee && !employees.has(assignment.employee) && <option value={assignment.employee}>{t('Nhân viên')} {assignment.employee.slice(0, 8)} · {t('không còn trong danh mục')}</option>}
              {activeEmployees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}
            </select>}
            <div className="row wrap"><input className="input" aria-label={`${t('Người phụ trách ngoài')} ${task.title}`} maxLength="160" readOnly={Boolean(assignment.employee)} value={assignment.assignee} onChange={(event) => onAssignmentNameChange(task, event.target.value)} /><button className="btn btn-ghost btn-sm" disabled={Boolean(busy) || (assignment.employee === (task.assignee_employee || '') && assignment.assignee === (task.assignee || ''))}>{t('Lưu')}</button></div>
          </form> : <span>{task.assignee || '—'}</span>}</td>
          <td>{task.due ? fmtDate(task.due) : '—'}</td>
          <td>{statusLabel(task.status)}{blockers.length > 0 && <div className="small muted">{t('Chờ')}: {blockers.map((item) => item.title).join(', ')}</div>}</td>
          <td className="row wrap">{task.status === 'todo' && project.status === 'active' && canStartTasks && <button className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => onStatusChange(task, 'started')}>{t('Bắt đầu')}</button>}{task.status === 'doing' && canCompleteTasks && <button className="btn btn-primary btn-sm" disabled={Boolean(busy) || blockers.length > 0} title={blockers.length ? t('Hoàn tất các công việc tiên quyết trước.') : ''} onClick={() => onStatusChange(task, 'done')}>{t('Hoàn tất')}</button>}</td>
        </tr>;
      })}</tbody>
    </table></div>}
  </section>;
}
