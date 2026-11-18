import { useState } from 'react';
import { api, dataPath } from '../../../lib/api.js';

export function useProjectWorkflow({
  load, selectedProject, employees, projectForm, setProjectForm, taskForm, setTaskForm,
  dependencyForm, setDependencyForm, timesheetForm, setTimesheetForm, emptyProject,
  emptyTask, emptyDependency, emptyTimesheet, defaultEmployeeName, setProjectId,
  setError, messages,
}) {
  const [taskAssignmentForms, setTaskAssignmentForms] = useState({});
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');

  async function run(key, operation, success) {
    setBusy(key); setError(''); setNotice('');
    try { await operation(); await load(true); setNotice(success); }
    catch (reason) { setError(reason.message || messages.genericError); await load(true); }
    finally { setBusy(''); }
  }

  async function createProject(event) {
    event.preventDefault();
    await run('project', async () => {
      const project = await api(dataPath('project.project'), { method: 'POST', body: {
        name: projectForm.name.trim(), ...(projectForm.party ? { party: projectForm.party } : {}),
        ...(projectForm.budget !== '' ? { budget: String(projectForm.budget) } : {}), status: 'planned',
      } });
      setProjectId(project.id); setProjectForm(emptyProject);
    }, messages.createProject);
  }

  async function createTask(event) {
    event.preventDefault(); if (!selectedProject) return;
    await run('task', async () => {
      const employee = employees.get(taskForm.assignee_employee);
      await api(dataPath('project.task'), { method: 'POST', body: {
        project: selectedProject.id, title: taskForm.title.trim(),
        ...(employee ? { assignee: employee.name, assignee_employee: employee.id } : taskForm.assignee.trim() ? { assignee: taskForm.assignee.trim() } : {}),
        ...(taskForm.due ? { due: taskForm.due } : {}), status: 'todo',
      } });
      setTaskForm(emptyTask);
    }, messages.createTask);
  }

  function taskAssignment(task) {
    return taskAssignmentForms[task.id] || { employee: task.assignee_employee || '', assignee: task.assignee || '' };
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
    }, messages.assignTask);
  }

  async function changeStatus(entity, row, action, message) {
    await run(`${row.id}:${action}`, () => api(dataPath(entity, row.id, action), { method: 'POST' }), messages.translate(message));
  }

  async function createDependency(event) {
    event.preventDefault();
    await run('dependency', async () => {
      await api(dataPath('project.task_dependency'), { method: 'POST', body: dependencyForm });
      setDependencyForm(emptyDependency);
    }, messages.createDependency);
  }

  async function removeDependency(dependency) {
    await run(`dependency:${dependency.id}`, () => api(dataPath('project.task_dependency', dependency.id), { method: 'DELETE' }), messages.removeDependency);
  }

  async function createTimesheet(event) {
    event.preventDefault(); if (!selectedProject) return;
    await run('timesheet', async () => {
      const employee = employees.get(timesheetForm.employee_ref);
      await api(dataPath('project.timesheet'), { method: 'POST', body: {
        project: selectedProject.id, ...(timesheetForm.task ? { task: timesheetForm.task } : {}),
        ...(employee ? { employee_ref: employee.id, employee: employee.name } : (timesheetForm.employee.trim() ? { employee: timesheetForm.employee.trim() } : {})),
        hours: String(timesheetForm.hours), date: timesheetForm.date,
        ...(timesheetForm.rate !== '' ? { rate: String(timesheetForm.rate) } : {}),
      } });
      setTimesheetForm({ ...emptyTimesheet, employee: defaultEmployeeName || '' });
    }, messages.createTimesheet);
  }

  return {
    taskAssignment, busy, notice, createProject, createTask, saveTaskAssignment,
    changeStatus, createDependency, removeDependency, createTimesheet,
    onTaskFieldChange: (field, value) => setTaskForm((current) => ({
      ...current, [field]: value,
      ...(field === 'assignee_employee' ? { assignee: employees.get(value)?.name || '' } : {}),
    })),
    onAssignmentEmployeeChange: (task, value) => {
      const employee = employees.get(value);
      setTaskAssignmentForms((current) => ({ ...current, [task.id]: { employee: value, assignee: employee?.name || '' } }));
    },
    onAssignmentNameChange: (task, value) => setTaskAssignmentForms((current) => ({
      ...current, [task.id]: { ...taskAssignment(task), assignee: value },
    })),
  };
}
