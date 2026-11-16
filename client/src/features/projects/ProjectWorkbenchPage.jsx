import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { localDate } from '../../lib/dates.js';
import { api, dataPath } from '../../lib/api.js';
import { fmtDate, fmtMoney, fmtNumber, statusLabel, uiTextWith } from '../../lib/i18n.js';
import { app, can, loadAllResponse, loadRefs, recordLabel } from '../../lib/state.js';
import projectEnglish from './project.en.js';

const t = (text) => uiTextWith(text, projectEnglish);

const emptyProject = { name: '', party: '', budget: '' };
const emptyTask = { title: '', assignee: '', assignee_employee: '', due: '' };
const emptyDependency = { predecessor: '', successor: '' };
const emptyTimesheet = { task: '', employee: '', employee_ref: '', hours: '', date: localDate(), rate: '' };

export default function ProjectWorkbenchPage() {
  const [projects, setProjects] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [dependencies, setDependencies] = useState([]);
  const [timesheets, setTimesheets] = useState([]);
  const [parties, setParties] = useState(new Map());
  const [employees, setEmployees] = useState(new Map());
  const [taskAssignmentForms, setTaskAssignmentForms] = useState({});
  const [projectId, setProjectId] = useState('');
  const [projectForm, setProjectForm] = useState(emptyProject);
  const [taskForm, setTaskForm] = useState(emptyTask);
  const [dependencyForm, setDependencyForm] = useState(emptyDependency);
  const [timesheetForm, setTimesheetForm] = useState({ ...emptyTimesheet, employee: app.user?.name || '' });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async (quiet = false) => {
    if (!quiet) { setLoading(true); setError(''); }
    try {
      const [projectRes, taskRes, dependencyRes, timesheetRes, partyMap, employeeMap] = await Promise.all([
        can('project.project.read') ? loadAllResponse('project.project') : Promise.resolve({ items: [] }),
        can('project.task.read') ? loadAllResponse('project.task') : Promise.resolve({ items: [] }),
        can('project.task_dependency.read') ? loadAllResponse('project.task_dependency') : Promise.resolve({ items: [] }),
        can('project.timesheet.read') ? loadAllResponse('project.timesheet') : Promise.resolve({ items: [] }),
        can('master-data.party.read') ? loadRefs('master-data.party') : Promise.resolve(new Map()),
        can('hrm.employee.read') ? loadRefs('hrm.employee') : Promise.resolve(new Map()),
      ]);
      const projectRows = projectRes.items || [];
      setProjects(projectRows); setTasks(taskRes.items || []); setDependencies(dependencyRes.items || []); setTimesheets(timesheetRes.items || []); setParties(partyMap);
      setEmployees(employeeMap);
      setProjectId((current) => projectRows.some((project) => project.id === current) ? current : projectRows[0]?.id || '');
      setProjectForm((current) => ({ ...current, party: current.party || [...partyMap.keys()][0] || '' }));
    } catch (reason) { setError(reason.message || t("Không tải được dữ liệu dự án.")); }
    finally { if (!quiet) setLoading(false); }
  }, []);

  useEffect(() => { document.title = t("Quản lý dự án · OSP Suite"); load(); }, [load]);
  const selectedProject = projects.find((project) => project.id === projectId);
  const projectTasks = useMemo(() => tasks.filter((task) => task.project === projectId).sort((a, b) => String(a.due || '9999').localeCompare(String(b.due || '9999')) || String(a.title).localeCompare(String(b.title), 'vi')), [tasks, projectId]);
  const taskById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  const projectDependencies = useMemo(() => dependencies.filter((dependency) => projectTasks.some((task) => task.id === dependency.predecessor)), [dependencies, projectTasks]);
  const projectTimesheets = useMemo(() => timesheets.filter((entry) => entry.project === projectId).sort((a, b) => String(b.date).localeCompare(String(a.date))), [timesheets, projectId]);
  const incompleteTasks = projectTasks.filter((task) => task.status !== 'done').length;
  const projectLaborCost = projectTimesheets.reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  const projectBudget = Number(selectedProject?.budget || 0);
  const pendingPredecessors = (task) => projectDependencies.filter((dependency) => dependency.successor === task.id).map((dependency) => taskById.get(dependency.predecessor)).filter((predecessor) => predecessor && predecessor.status !== 'done');

  async function run(key, operation, success) {
    setBusy(key); setError(''); setNotice('');
    try { await operation(); await load(true); setNotice(t(success)); }
    catch (reason) { setError(reason.message || t("Không thể hoàn tất thao tác.")); await load(true); }
    finally { setBusy(''); }
  }

  async function createProject(event) {
    event.preventDefault();
    await run('project', async () => {
      const project = await api(dataPath('project.project'), { method: 'POST', body: { name: projectForm.name.trim(), ...(projectForm.party ? { party: projectForm.party } : {}), ...(projectForm.budget !== '' ? { budget: Number(projectForm.budget) } : {}), status: 'planned' } });
      setProjectId(project.id); setProjectForm(emptyProject);
    }, t("Đã tạo dự án ở trạng thái dự kiến."));
  }

  async function createTask(event) {
    event.preventDefault(); if (!selectedProject) return;
    await run('task', async () => {
      const employee = employees.get(taskForm.assignee_employee);
      await api(dataPath('project.task'), { method: 'POST', body: { project: selectedProject.id, title: taskForm.title.trim(), ...(employee ? { assignee: employee.name, assignee_employee: employee.id } : taskForm.assignee.trim() ? { assignee: taskForm.assignee.trim() } : {}), ...(taskForm.due ? { due: taskForm.due } : {}), status: 'todo' } });
      setTaskForm(emptyTask);
    }, t("Đã thêm công việc vào dự án."));
  }

  function taskAssignment(task) {
    return taskAssignmentForms[task.id] || {
      employee: task.assignee_employee || '',
      assignee: task.assignee || '',
    };
  }

  async function saveTaskAssignment(event, task) {
    event.preventDefault();
    const assignment = taskAssignment(task);
    const employee = employees.get(assignment.employee);
    await run(`${task.id}:assignment`, async () => {
      await api(dataPath('project.task', task.id), { method: 'PATCH', body: {
        assignee_employee: employee?.id || null,
        assignee: employee?.name || assignment.assignee.trim(),
      } });
      setTaskAssignmentForms((current) => { const next = { ...current }; delete next[task.id]; return next; });
    }, t("Đã cập nhật người phụ trách công việc."));
  }

  async function changeStatus(entity, row, action, message) {
    await run(`${row.id}:${action}`, () => api(dataPath(entity, row.id, action), { method: 'POST' }), message);
  }

  async function createDependency(event) {
    event.preventDefault();
    await run('dependency', async () => {
      await api(dataPath('project.task_dependency'), { method: 'POST', body: dependencyForm });
      setDependencyForm(emptyDependency);
    }, t("Đã lưu quan hệ tiên quyết. Hệ thống sẽ chặn vòng lặp và chỉ cho hoàn tất sau khi công việc trước đã xong."));
  }

  async function removeDependency(dependency) {
    await run(`dependency:${dependency.id}`, () => api(dataPath('project.task_dependency', dependency.id), { method: 'DELETE' }), t("Đã gỡ quan hệ phụ thuộc."));
  }

  async function createTimesheet(event) {
    event.preventDefault(); if (!selectedProject) return;
    await run('timesheet', async () => {
      await api(dataPath('project.timesheet'), { method: 'POST', body: {
        project: selectedProject.id, ...(timesheetForm.task ? { task: timesheetForm.task } : {}),
        ...(employees.get(timesheetForm.employee_ref)
          ? { employee_ref: timesheetForm.employee_ref, employee: employees.get(timesheetForm.employee_ref).name }
          : (timesheetForm.employee.trim() ? { employee: timesheetForm.employee.trim() } : {})),
        hours: Number(timesheetForm.hours), date: timesheetForm.date,
        ...(timesheetForm.rate !== '' ? { rate: Number(timesheetForm.rate) } : {}),
      } });
      setTimesheetForm({ ...emptyTimesheet, employee: app.user?.name || '' });
    }, t("Đã ghi timesheet; thành tiền được máy chủ tính theo số giờ và đơn giá."));
  }

  const dependencyOptions = projectTasks.filter((task) => task.status !== 'done');
  const activeEmployees = [...employees.values()].filter((employee) => employee.status === 'active');
  return <div className="page">
    <div className="page-head"><div><h1>{t("Quản lý dự án")}</h1><p className="sub">{t("Lập dự án, theo dõi công việc theo quan hệ tiên quyết và ghi nhận giờ công theo dự án.")}</p></div><button className="btn btn-secondary" type="button" disabled={loading || Boolean(busy)} onClick={() => load()}>{t("Làm mới")}</button></div>
    {error && <div className="alert danger" role="alert">{t(error)}</div>}{notice && <div className="alert success" role="status">{t(notice)}</div>}
    {can('project.project.create') && <section className="card card-pad"><h2>{t("Tạo dự án")}</h2><form className="form-grid" onSubmit={createProject}>
      <label className="field"><span className="label">{t("Tên dự án *")}</span><input className="input" required maxLength="160" value={projectForm.name} onChange={(event) => setProjectForm((current) => ({ ...current, name: event.target.value }))} /></label>
      {can('master-data.party.read') && <label className="field"><span className="label">{t("Khách hàng / đối tác")}</span><select className="select" value={projectForm.party} onChange={(event) => setProjectForm((current) => ({ ...current, party: event.target.value }))}><option value="">{t("Không gắn đối tác")}</option>{[...parties.values()].map((party) => <option key={party.id} value={party.id}>{recordLabel('master-data.party', party)}</option>)}</select></label>}
      <label className="field"><span className="label">{t("Ngân sách")}</span><input className="input num" type="number" min="0" step="any" value={projectForm.budget} onChange={(event) => setProjectForm((current) => ({ ...current, budget: event.target.value }))} /></label>
      <div className="row full"><span className="grow"/><button className="btn btn-primary" disabled={busy === 'project' || loading}>{t("Tạo dự án")}</button></div>
    </form></section>}
    <section className="card card-pad u-legacy-92c18f6bda" >
      {!projects.length ? <div className="empty">{t("Chưa có dự án. Tạo dự án ở trên để lập kế hoạch và ghi nhận giờ công.")}</div> : <>
        <div className="form-grid"><label className="field"><span className="label">{t("Dự án")}</span><select className="select" value={projectId} onChange={(event) => setProjectId(event.target.value)}>{projects.map((project) => <option key={project.id} value={project.id}>{project.name} · {statusLabel(project.status)}</option>)}</select></label><div className="field"><span className="label">{t("Ngân sách")}</span><strong>{fmtMoney(selectedProject?.budget || 0)}</strong></div><div className="field"><span className="label">{t("Công việc hoàn tất")}</span><strong>{projectTasks.length - incompleteTasks}/{projectTasks.length}</strong></div><div className="field"><span className="label">{t("Tổng giờ ghi nhận")}</span><strong>{fmtNumber(projectTimesheets.reduce((sum, entry) => sum + Number(entry.hours || 0), 0))}</strong></div>{can('project.timesheet.read') && <><div className="field"><span className="label">{t("Chi phí nhân công")}</span><strong>{fmtMoney(projectLaborCost)}</strong></div>{projectBudget > 0 && <div className="field"><span className="label">{t("Ngân sách sau nhân công")}</span><strong>{fmtMoney(projectBudget - projectLaborCost)}</strong></div>}</>}</div>
        {selectedProject?.status === 'planned' && can('project.project.started') && <button className="btn btn-primary btn-sm u-legacy-0ee7f66ad9"  disabled={Boolean(busy)} onClick={() => changeStatus('project.project', selectedProject, 'started', 'Đã khởi động dự án. Có thể bắt đầu công việc và ghi giờ.')}>{t("Khởi động")}</button>}
        {selectedProject?.status === 'active' && <div className="row wrap u-legacy-0ee7f66ad9" >{can('project.project.completed') && <button className="btn btn-primary btn-sm" disabled={Boolean(busy) || incompleteTasks > 0} title={incompleteTasks ? t('Hoàn tất các công việc còn mở trước.') : ''} onClick={() => changeStatus('project.project', selectedProject, 'completed', 'Đã hoàn tất dự án.')}>{t("Hoàn tất dự án")}</button>}{can('project.project.cancelled') && <button className="btn btn-ghost btn-sm" disabled={Boolean(busy)} onClick={() => changeStatus('project.project', selectedProject, 'cancelled', 'Đã hủy dự án.')}>{t("Hủy dự án")}</button>}</div>}
      </>}
    </section>
    {selectedProject && <>
      <section className="card card-pad u-legacy-92c18f6bda" ><div className="row wrap"><div><h2>{t("Công việc")}</h2><p className="small muted">{t("Công việc có thể được lập trong dự án dự kiến; chỉ bắt đầu hoặc hoàn tất khi dự án đang hoạt động.")}</p></div><span className="grow"/></div>
        {can('project.task.create') && ['planned', 'active'].includes(selectedProject.status) && <form className="form-grid u-legacy-0e001e227c"  onSubmit={createTask}><label className="field"><span className="label">{t("Tên công việc *")}</span><input className="input" required maxLength="200" value={taskForm.title} onChange={(event) => setTaskForm((current) => ({ ...current, title: event.target.value }))} /></label>{can('hrm.employee.read') && <label className="field"><span className="label">{t("Nhân viên phụ trách")}</span><select className="select" value={taskForm.assignee_employee} onChange={(event) => setTaskForm((current) => ({ ...current, assignee_employee: event.target.value, assignee: employees.get(event.target.value)?.name || '' }))}><option value="">{t("Người phụ trách ngoài")}</option>{activeEmployees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select></label>}<label className="field"><span className="label">{t("Người phụ trách ngoài")}</span><input className="input" maxLength="160" readOnly={Boolean(taskForm.assignee_employee)} value={taskForm.assignee} onChange={(event) => setTaskForm((current) => ({ ...current, assignee: event.target.value }))} /></label><label className="field"><span className="label">{t("Hạn hoàn thành")}</span><input className="input" type="date" value={taskForm.due} onChange={(event) => setTaskForm((current) => ({ ...current, due: event.target.value }))} /></label><div className="row full"><span className="grow"/><button className="btn btn-secondary" disabled={busy === 'task'}>{t("Thêm công việc")}</button></div></form>}
        {!projectTasks.length ? <div className="empty">{t("Dự án chưa có công việc.")}</div> : <div className="table-wrap"><table className="table"><thead><tr><th>{t("Công việc")}</th><th>{t("Người phụ trách")}</th><th>{t("Hạn")}</th><th>{t("Trạng thái / phụ thuộc")}</th><th>{t("Thao tác")}</th></tr></thead><tbody>{projectTasks.map((task) => { const blockers = pendingPredecessors(task); const assignment = taskAssignment(task); return <tr key={task.id}><td>{task.title}</td><td>{task.status !== 'done' && can('project.task.update') && ['planned', 'active'].includes(selectedProject.status) && (!task.assignee_employee || can('hrm.employee.read')) ? <form className="stack-sm" onSubmit={(event) => saveTaskAssignment(event, task)}>{can('hrm.employee.read') && <select className="select" aria-label={`${t('Nhân viên phụ trách')} ${task.title}`} value={assignment.employee} onChange={(event) => { const employee = employees.get(event.target.value); setTaskAssignmentForms((current) => ({ ...current, [task.id]: { employee: event.target.value, assignee: employee?.name || '' } })); }}><option value="">{t("Người phụ trách ngoài")}</option>{assignment.employee && !employees.has(assignment.employee) && <option value={assignment.employee}>{t('Nhân viên')} {assignment.employee.slice(0, 8)} · {t('không còn trong danh mục')}</option>}{activeEmployees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select>}<div className="row wrap"><input className="input" aria-label={`${t('Người phụ trách ngoài')} ${task.title}`} maxLength="160" readOnly={Boolean(assignment.employee)} value={assignment.assignee} onChange={(event) => setTaskAssignmentForms((current) => ({ ...current, [task.id]: { ...assignment, assignee: event.target.value } }))} /><button className="btn btn-ghost btn-sm" disabled={Boolean(busy) || (assignment.employee === (task.assignee_employee || '') && assignment.assignee === (task.assignee || ''))}>{t("Lưu")}</button></div></form> : <span>{task.assignee || '—'}</span>}</td><td>{task.due ? fmtDate(task.due) : '—'}</td><td>{statusLabel(task.status)}{blockers.length > 0 && <div className="small muted">{t('Chờ')}: {blockers.map((item) => item.title).join(', ')}</div>}</td><td className="row wrap">{task.status === 'todo' && selectedProject.status === 'active' && can('project.task.started') && <button className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => changeStatus('project.task', task, 'started', 'Đã bắt đầu công việc.')}>{t("Bắt đầu")}</button>}{task.status === 'doing' && can('project.task.done') && <button className="btn btn-primary btn-sm" disabled={Boolean(busy) || blockers.length > 0} title={blockers.length ? t('Hoàn tất các công việc tiên quyết trước.') : ''} onClick={() => changeStatus('project.task', task, 'done', 'Đã hoàn tất công việc.')}>{t("Hoàn tất")}</button>}</td></tr>; })}</tbody></table></div>}
      </section>
      {selectedProject.status === 'active' && can('project.task_dependency.read') && <section className="card card-pad u-legacy-92c18f6bda" ><h2>{t("Quan hệ tiên quyết")}</h2><p className="small muted">{t("Một công việc chỉ được hoàn tất sau khi các công việc tiên quyết đã xong. Quan hệ phải nằm trong cùng dự án và không tạo vòng lặp.")}</p>
        {can('project.task_dependency.create') && dependencyOptions.length > 1 && <form className="form-grid u-legacy-0e001e227c"  onSubmit={createDependency}><label className="field"><span className="label">{t("Công việc tiên quyết *")}</span><select className="select" required value={dependencyForm.predecessor} onChange={(event) => setDependencyForm((current) => ({ ...current, predecessor: event.target.value }))}><option value="">{t("Chọn công việc trước")}</option>{dependencyOptions.filter((task) => task.id !== dependencyForm.successor).map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}</select></label><label className="field"><span className="label">{t("Công việc kế tiếp *")}</span><select className="select" required value={dependencyForm.successor} onChange={(event) => setDependencyForm((current) => ({ ...current, successor: event.target.value }))}><option value="">{t("Chọn công việc sau")}</option>{dependencyOptions.filter((task) => task.id !== dependencyForm.predecessor).map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}</select></label><div className="row full"><span className="grow"/><button className="btn btn-secondary" disabled={busy === 'dependency' || !dependencyForm.predecessor || !dependencyForm.successor}>{t("Thêm quan hệ")}</button></div></form>}
        {!projectDependencies.length ? <div className="empty">{t("Chưa khai báo công việc tiên quyết.")}</div> : <div className="table-wrap"><table className="table"><thead><tr><th>{t("Tiên quyết")}</th><th>{t("Kế tiếp")}</th><th>{t("Trạng thái")}</th><th/></tr></thead><tbody>{projectDependencies.map((dependency) => <tr key={dependency.id}><td>{taskById.get(dependency.predecessor)?.title || 'Công việc'}</td><td>{taskById.get(dependency.successor)?.title || 'Công việc'}</td><td>{statusLabel(taskById.get(dependency.predecessor)?.status)}</td><td>{can('project.task_dependency.delete') && <button className="btn btn-ghost btn-sm" disabled={Boolean(busy)} onClick={() => removeDependency(dependency)}>{t("Gỡ")}</button>}</td></tr>)}</tbody></table></div>}
      </section>}
      {can('project.timesheet.read') && <section className="card card-pad u-legacy-92c18f6bda" ><h2>Timesheet</h2>
        {selectedProject.status === 'active' && can('project.timesheet.create') && <form className="form-grid u-legacy-0e001e227c"  onSubmit={createTimesheet}><label className="field"><span className="label">{t("Công việc")}</span><select className="select" value={timesheetForm.task} onChange={(event) => setTimesheetForm((current) => ({ ...current, task: event.target.value }))}><option value="">{t("Giờ công chung cho dự án")}</option>{projectTasks.filter((task) => task.status !== 'done').map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}</select></label>{can('hrm.employee.read') && <label className="field"><span className="label">{t("Nhân viên nội bộ")}</span><select className="select" value={timesheetForm.employee_ref} onChange={(event) => setTimesheetForm((current) => ({ ...current, employee_ref: event.target.value, employee: employees.get(event.target.value)?.name || '' }))}><option value="">{t("Nhà thầu / nhân viên ngoài")}</option>{activeEmployees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select></label>}<label className="field"><span className="label">{t("Người thực hiện ngoài")}</span><input className="input" maxLength="160" readOnly={Boolean(timesheetForm.employee_ref)} value={timesheetForm.employee} onChange={(event) => setTimesheetForm((current) => ({ ...current, employee: event.target.value }))} /></label><label className="field"><span className="label">{t("Ngày *")}</span><input className="input" type="date" required max={localDate()} value={timesheetForm.date} onChange={(event) => setTimesheetForm((current) => ({ ...current, date: event.target.value }))} /></label><label className="field"><span className="label">{t("Số giờ *")}</span><input className="input num" type="number" min="0.001" max="24" step="any" required value={timesheetForm.hours} onChange={(event) => setTimesheetForm((current) => ({ ...current, hours: event.target.value }))} /></label><label className="field"><span className="label">{t("Đơn giá giờ công")}</span><input className="input num" type="number" min="0" step="any" value={timesheetForm.rate} onChange={(event) => setTimesheetForm((current) => ({ ...current, rate: event.target.value }))} /></label><div className="row full"><span className="grow"/><button className="btn btn-primary" disabled={busy === 'timesheet'}>{t("Ghi giờ công")}</button></div></form>}
        {!projectTimesheets.length ? <div className="empty">{t("Chưa ghi nhận giờ công.")}</div> : <div className="table-wrap"><table className="table"><thead><tr><th>{t("Ngày")}</th><th>{t("Nhân viên")}</th><th>{t("Công việc")}</th><th>{t("Số giờ")}</th><th>{t("Thành tiền")}</th></tr></thead><tbody>{projectTimesheets.map((entry) => <tr key={entry.id}><td>{fmtDate(entry.date)}</td><td>{employees.get(entry.employee_ref) ? recordLabel('hrm.employee', employees.get(entry.employee_ref)) : entry.employee || '—'}</td><td>{taskById.get(entry.task)?.title || 'Dự án chung'}</td><td>{fmtNumber(entry.hours)}</td><td>{fmtMoney(entry.amount || 0)}</td></tr>)}</tbody></table></div>}
      </section>}
    </>}
  </div>;
}
