import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useDocumentTitle } from '../../lib/useDocumentTitle.js';
import { useLatestRequest } from '../../lib/useLatestRequest.js';
import { localDate } from '../../lib/dates.js';
import { fmtDate, fmtMoney, fmtNumber, statusLabel, uiTextWith } from '../../lib/i18n.js';
import { addDecimals, subtractDecimals } from '../../lib/decimal.js';
import { app, can, loadAllResponse, loadRefs, loadIndependentData, recordLabel } from '../../lib/state.js';
import projectEnglish from './project.en.js';
import ProjectTasksSection from './components/ProjectTasksSection.jsx';
import ProjectTimesheetsPanel from './components/ProjectTimesheetsPanel.jsx';
import { useProjectWorkflow } from './hooks/useProjectWorkflow.js';
const t = (text) => uiTextWith(text, projectEnglish);
const emptyProject = { name: '', party: '', budget: '' };
const emptyTask = { title: '', assignee: '', assignee_employee: '', due: '' };
const emptyDependency = { predecessor: '', successor: '' };
const emptyTimesheet = { task: '', employee: '', employee_ref: '', hours: '', date: localDate(), rate: '' };
export default function ProjectWorkbenchPage() {
  useDocumentTitle(t("Quản lý dự án · OSP Suite"));
  const [projects, setProjects] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [dependencies, setDependencies] = useState([]);
  const [timesheets, setTimesheets] = useState([]);
  const [parties, setParties] = useState(new Map());
  const [employees, setEmployees] = useState(new Map());
  const [projectId, setProjectId] = useState('');
  const [projectForm, setProjectForm] = useState(emptyProject);
  const [taskForm, setTaskForm] = useState(emptyTask);
  const [dependencyForm, setDependencyForm] = useState(emptyDependency);
  const [timesheetForm, setTimesheetForm] = useState({ ...emptyTimesheet, employee: app.user?.name || '' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const latestRequest = useLatestRequest();
  const load = useCallback(async (quiet = false) => {
    const isLatest = latestRequest();
    if (!quiet) { setLoading(true); setError(''); }
    try {
      const { data, errors } = await loadIndependentData({
        projects: can('project.project.read') ? loadAllResponse('project.project') : Promise.resolve({ items: [] }),
        tasks: can('project.task.read') ? loadAllResponse('project.task') : Promise.resolve({ items: [] }),
        dependencies: can('project.task_dependency.read') ? loadAllResponse('project.task_dependency') : Promise.resolve({ items: [] }),
        timesheets: can('project.timesheet.read') ? loadAllResponse('project.timesheet') : Promise.resolve({ items: [] }),
        parties: can('master-data.party.read') ? loadRefs('master-data.party') : Promise.resolve(new Map()),
        employees: can('hrm.employee.read') ? loadRefs('hrm.employee') : Promise.resolve(new Map()),
      }, {
        projects: { items: [] }, tasks: { items: [] }, dependencies: { items: [] },
        timesheets: { items: [] }, parties: new Map(), employees: new Map(),
      });
      const projectRows = data.projects.items || [];
      const partyMap = data.parties;
      if (isLatest()) {
        setProjects(projectRows); setTasks(data.tasks.items || []); setDependencies(data.dependencies.items || []); setTimesheets(data.timesheets.items || []); setParties(partyMap);
        setEmployees(data.employees);
        setProjectId((current) => projectRows.some((project) => project.id === current) ? current : projectRows[0]?.id || '');
        setProjectForm((current) => ({ ...current, party: current.party || [...partyMap.keys()][0] || '' }));
        if (errors.length) setError(errors.map((reason) => reason?.message || t('Không tải được dữ liệu dự án.')).join(' · '));
      }
    } catch (reason) { if (isLatest()) setError(reason.message || t("Không tải được dữ liệu dự án.")); }
    finally { if (isLatest()) setLoading(false); }
  }, [latestRequest]);
  useEffect(() => { load(); }, [load]);
  const selectedProject = projects.find((project) => project.id === projectId);
  const projectTasks = useMemo(() => tasks.filter((task) => task.project === projectId).sort((a, b) => String(a.due || '9999').localeCompare(String(b.due || '9999')) || String(a.title).localeCompare(String(b.title), 'vi')), [tasks, projectId]);
  const taskById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  const projectDependencies = useMemo(() => dependencies.filter((dependency) => projectTasks.some((task) => task.id === dependency.predecessor)), [dependencies, projectTasks]);
  const projectTimesheets = useMemo(() => timesheets.filter((entry) => entry.project === projectId).sort((a, b) => String(b.date).localeCompare(String(a.date))), [timesheets, projectId]);
  const incompleteTasks = projectTasks.filter((task) => task.status !== 'done').length;
  const projectLaborCost = addDecimals(projectTimesheets.map((entry) => entry.amount));
  const projectBudget = selectedProject?.budget || 0;
  const pendingPredecessors = (task) => projectDependencies.filter((dependency) => dependency.successor === task.id).map((dependency) => taskById.get(dependency.predecessor)).filter((predecessor) => predecessor && predecessor.status !== 'done');
  const workflow = useProjectWorkflow({
    load, selectedProject, employees, projectForm, setProjectForm, taskForm, setTaskForm,
    dependencyForm, setDependencyForm, timesheetForm, setTimesheetForm, emptyProject,
    emptyTask, emptyDependency, emptyTimesheet, defaultEmployeeName: app.user?.name || '',
    setProjectId, setError, messages: {
      translate: t,
      genericError: t('Không thể hoàn tất thao tác.'),
      createProject: t('Đã tạo dự án ở trạng thái dự kiến.'),
      createTask: t('Đã thêm công việc vào dự án.'),
      assignTask: t('Đã cập nhật người phụ trách công việc.'),
      createDependency: t('Đã lưu quan hệ tiên quyết. Hệ thống sẽ chặn vòng lặp và chỉ cho hoàn tất sau khi công việc trước đã xong.'),
      removeDependency: t('Đã gỡ quan hệ phụ thuộc.'),
      createTimesheet: t('Đã ghi timesheet; thành tiền được máy chủ tính theo số giờ và đơn giá.'),
    },
  });
  const {
    taskAssignment, busy, notice, createProject, createTask, saveTaskAssignment,
    changeStatus, createDependency, removeDependency, createTimesheet,
    onTaskFieldChange, onAssignmentEmployeeChange, onAssignmentNameChange,
  } = workflow;
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
    <section className="card card-pad u-mt-16" >
      {!projects.length ? <div className="empty">{t("Chưa có dự án. Tạo dự án ở trên để lập kế hoạch và ghi nhận giờ công.")}</div> : <>
        <div className="form-grid"><label className="field"><span className="label">{t("Dự án")}</span><select className="select" value={projectId} onChange={(event) => setProjectId(event.target.value)}>{projects.map((project) => <option key={project.id} value={project.id}>{project.name} · {statusLabel(project.status)}</option>)}</select></label><div className="field"><span className="label">{t("Ngân sách")}</span><strong>{fmtMoney(selectedProject?.budget || 0)}</strong></div><div className="field"><span className="label">{t("Công việc hoàn tất")}</span><strong>{projectTasks.length - incompleteTasks}/{projectTasks.length}</strong></div><div className="field"><span className="label">{t("Tổng giờ ghi nhận")}</span><strong>{fmtNumber(addDecimals(projectTimesheets.map((entry) => entry.hours || 0)))}</strong></div>{can('project.timesheet.read') && <><div className="field"><span className="label">{t("Chi phí nhân công")}</span><strong>{fmtMoney(projectLaborCost)}</strong></div>{projectBudget > 0 && <div className="field"><span className="label">{t("Ngân sách sau nhân công")}</span><strong>{fmtMoney(subtractDecimals(projectBudget, projectLaborCost))}</strong></div>}</>}</div>
        {selectedProject?.status === 'planned' && can('project.project.started') && <button className="btn btn-primary btn-sm u-mt-12"  disabled={Boolean(busy)} onClick={() => changeStatus('project.project', selectedProject, 'started', 'Đã khởi động dự án. Có thể bắt đầu công việc và ghi giờ.')}>{t("Khởi động")}</button>}
        {selectedProject?.status === 'active' && <div className="row wrap u-mt-12" >{can('project.project.completed') && <button className="btn btn-primary btn-sm" disabled={Boolean(busy) || incompleteTasks > 0} title={incompleteTasks ? t('Hoàn tất các công việc còn mở trước.') : ''} onClick={() => changeStatus('project.project', selectedProject, 'completed', 'Đã hoàn tất dự án.')}>{t("Hoàn tất dự án")}</button>}{can('project.project.cancelled') && <button className="btn btn-ghost btn-sm" disabled={Boolean(busy)} onClick={() => changeStatus('project.project', selectedProject, 'cancelled', 'Đã hủy dự án.')}>{t("Hủy dự án")}</button>}</div>}
      </>}
    </section>
    {selectedProject && <>
      <ProjectTasksSection
        project={selectedProject} tasks={projectTasks} taskForm={taskForm} activeEmployees={activeEmployees}
        employees={employees} busy={busy} canCreateTask={can('project.task.create')}
        canAssignTasks={can('project.task.update')} canReadEmployees={can('hrm.employee.read')}
        canStartTasks={can('project.task.started')} canCompleteTasks={can('project.task.done')}
        pendingPredecessors={pendingPredecessors} taskAssignment={taskAssignment}
        onCreateTask={createTask}
        onTaskFieldChange={onTaskFieldChange}
        onAssignmentEmployeeChange={onAssignmentEmployeeChange}
        onAssignmentNameChange={onAssignmentNameChange}
        onSaveAssignment={saveTaskAssignment}
        onStatusChange={(task, action) => changeStatus(
          'project.task', task, action, action === 'started' ? 'Đã bắt đầu công việc.' : 'Đã hoàn tất công việc.',
        )}
        fmtDate={fmtDate} statusLabel={statusLabel} t={t}
      />
      {selectedProject.status === 'active' && can('project.task_dependency.read') && <section className="card card-pad u-mt-16" ><h2>{t("Quan hệ tiên quyết")}</h2><p className="small muted">{t("Một công việc chỉ được hoàn tất sau khi các công việc tiên quyết đã xong. Quan hệ phải nằm trong cùng dự án và không tạo vòng lặp.")}</p>
        {can('project.task_dependency.create') && dependencyOptions.length > 1 && <form className="form-grid u-margin-12-0"  onSubmit={createDependency}><label className="field"><span className="label">{t("Công việc tiên quyết *")}</span><select className="select" required value={dependencyForm.predecessor} onChange={(event) => setDependencyForm((current) => ({ ...current, predecessor: event.target.value }))}><option value="">{t("Chọn công việc trước")}</option>{dependencyOptions.filter((task) => task.id !== dependencyForm.successor).map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}</select></label><label className="field"><span className="label">{t("Công việc kế tiếp *")}</span><select className="select" required value={dependencyForm.successor} onChange={(event) => setDependencyForm((current) => ({ ...current, successor: event.target.value }))}><option value="">{t("Chọn công việc sau")}</option>{dependencyOptions.filter((task) => task.id !== dependencyForm.predecessor).map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}</select></label><div className="row full"><span className="grow"/><button className="btn btn-secondary" disabled={busy === 'dependency' || !dependencyForm.predecessor || !dependencyForm.successor}>{t("Thêm quan hệ")}</button></div></form>}
        {!projectDependencies.length ? <div className="empty">{t("Chưa khai báo công việc tiên quyết.")}</div> : <div className="table-wrap"><table className="table"><thead><tr><th>{t("Tiên quyết")}</th><th>{t("Kế tiếp")}</th><th>{t("Trạng thái")}</th><th/></tr></thead><tbody>{projectDependencies.map((dependency) => <tr key={dependency.id}><td>{taskById.get(dependency.predecessor)?.title || t('Công việc')}</td><td>{taskById.get(dependency.successor)?.title || t('Công việc')}</td><td>{statusLabel(taskById.get(dependency.predecessor)?.status)}</td><td>{can('project.task_dependency.delete') && <button className="btn btn-ghost btn-sm" disabled={Boolean(busy)} onClick={() => removeDependency(dependency)}>{t("Gỡ")}</button>}</td></tr>)}</tbody></table></div>}
      </section>}
      {can('project.timesheet.read') && <ProjectTimesheetsPanel
        timesheets={projectTimesheets}
        tasks={dependencyOptions}
        taskById={taskById}
        employees={employees}
        activeEmployees={activeEmployees}
        form={timesheetForm}
        busy={busy}
        canCreate={selectedProject.status === 'active' && can('project.timesheet.create')}
        canReadEmployees={can('hrm.employee.read')}
        today={localDate()}
        fmtDate={fmtDate}
        fmtNumber={fmtNumber}
        fmtMoney={fmtMoney}
        recordLabel={recordLabel}
        onFieldChange={(field, value) => setTimesheetForm((current) => ({ ...current, [field]: value }))}
        onEmployeeRefChange={(value) => setTimesheetForm((current) => ({ ...current, employee_ref: value, employee: employees.get(value)?.name || '' }))}
        onCreate={createTimesheet}
        t={t}
      />}
    </>}
  </div>;
}
