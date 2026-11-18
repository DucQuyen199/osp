import { useCallback, useEffect, useState } from 'react';
import { uiText } from '../../../lib/i18n.js';
import { can, loadAllResponse, loadIndependentData, loadRefs } from '../../../lib/state.js';

const itemsOf = (response) => Array.isArray(response?.items) ? response.items : [];
const emptyData = () => ({
  employees: [], employeeMap: new Map(), departments: new Map(), positions: new Map(), leaveRequests: [], attendance: [],
  scheduleEntries: [], schedulePatterns: [], scheduleTemplates: [], salaryRevisions: [], allocations: [], approvalRequests: [],
});

export function useHrmOperationsData(attendanceDate, scheduleMonthStart, scheduleMonthEnd, workflowApproval) {
  const [data, setData] = useState(emptyData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (quiet = false) => {
    if (!quiet) { setLoading(true); setError(''); }
    try {
      const emptyMap = () => new Map();
      const emptyResponse = () => ({ items: [] });
      const { data, errors } = await loadIndependentData({
        employeeRes: can('hrm.employee.read') ? loadAllResponse('hrm.employee') : Promise.resolve(emptyResponse()),
        leaveRes: can('hrm.leave_request.read') ? loadAllResponse('hrm.leave_request') : Promise.resolve(emptyResponse()),
        attendanceRes: can('hrm.attendance.read') ? loadAllResponse('hrm.attendance', { date: attendanceDate }) : Promise.resolve(emptyResponse()),
        revisionRes: can('hrm.salary_revision.read') ? loadAllResponse('hrm.salary_revision') : Promise.resolve(emptyResponse()),
        allocationRes: can('hrm.leave_allocation.read') ? loadAllResponse('hrm.leave_allocation') : Promise.resolve(emptyResponse()),
        scheduleRes: can('hrm.work_schedule_entry.read') ? loadAllResponse('hrm.work_schedule_entry', { work_date__gte: scheduleMonthStart, work_date__lt: scheduleMonthEnd, sort: 'work_date' }) : Promise.resolve(emptyResponse()),
        patternRes: can('hrm.work_schedule_pattern.read') ? loadAllResponse('hrm.work_schedule_pattern') : Promise.resolve(emptyResponse()),
        templateRes: can('hrm.work_schedule_template.read') ? loadAllResponse('hrm.work_schedule_template') : Promise.resolve(emptyResponse()),
        departmentMap: can('hrm.department.read') ? loadRefs('hrm.department') : Promise.resolve(emptyMap()),
        positionMap: can('hrm.position.read') ? loadRefs('hrm.position') : Promise.resolve(emptyMap()),
        requestRes: workflowApproval && can('workflow-approval.approval_request.read') ? loadAllResponse('workflow-approval.approval_request') : Promise.resolve(emptyResponse()),
      }, {
        employeeRes: emptyResponse(), leaveRes: emptyResponse(), attendanceRes: emptyResponse(), revisionRes: emptyResponse(), allocationRes: emptyResponse(), scheduleRes: emptyResponse(),
        patternRes: emptyResponse(), templateRes: emptyResponse(), departmentMap: emptyMap(), positionMap: emptyMap(), requestRes: emptyResponse(),
      });
      const { employeeRes, leaveRes, attendanceRes, revisionRes, allocationRes, scheduleRes, patternRes, templateRes, departmentMap, positionMap, requestRes } = data;
      const employees = itemsOf(employeeRes).sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'vi'));
      setData({
        employees,
        employeeMap: new Map(employees.map((row) => [row.id, row])),
        departments: departmentMap,
        positions: positionMap,
        leaveRequests: itemsOf(leaveRes).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))),
        attendance: itemsOf(attendanceRes).sort((a, b) => String(a.check_in || '').localeCompare(String(b.check_in || ''))),
        scheduleEntries: itemsOf(scheduleRes).sort((a, b) => String(a.work_date || '').localeCompare(String(b.work_date || ''))),
        schedulePatterns: itemsOf(patternRes).sort((a, b) => String(b.start_date || '').localeCompare(String(a.start_date || ''))),
        scheduleTemplates: itemsOf(templateRes).sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'vi')),
        salaryRevisions: itemsOf(revisionRes).sort((a, b) => String(b.effective_from || '').localeCompare(String(a.effective_from || ''))),
        allocations: itemsOf(allocationRes),
        approvalRequests: itemsOf(requestRes),
      });
      setError(errors[0]?.message || (errors.length ? uiText('Một số dữ liệu nhân sự không tải được.') : ''));
    } catch (reason) {
      setError(reason.message || uiText('Không tải được dữ liệu nhân sự.'));
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [attendanceDate, scheduleMonthEnd, scheduleMonthStart, workflowApproval]);

  useEffect(() => { load(); }, [load]);
  return { ...data, loading, error, setError, load };
}
