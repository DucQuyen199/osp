import { useCallback, useEffect, useState } from 'react';
import { uiText } from '../../../lib/i18n.js';
import { can, loadAllResponse, loadRefs } from '../../../lib/state.js';

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
      const [employeeRes, leaveRes, attendanceRes, revisionRes, allocationRes, scheduleRes, patternRes, templateRes, departmentMap, positionMap, requestRes] = await Promise.all([
        can('hrm.employee.read') ? loadAllResponse('hrm.employee') : Promise.resolve({ items: [] }),
        can('hrm.leave_request.read') ? loadAllResponse('hrm.leave_request') : Promise.resolve({ items: [] }),
        can('hrm.attendance.read') ? loadAllResponse('hrm.attendance', { date: attendanceDate }) : Promise.resolve({ items: [] }),
        can('hrm.salary_revision.read') ? loadAllResponse('hrm.salary_revision') : Promise.resolve({ items: [] }),
        can('hrm.leave_allocation.read') ? loadAllResponse('hrm.leave_allocation') : Promise.resolve({ items: [] }),
        can('hrm.work_schedule_entry.read') ? loadAllResponse('hrm.work_schedule_entry', { work_date__gte: scheduleMonthStart, work_date__lt: scheduleMonthEnd, sort: 'work_date' }) : Promise.resolve({ items: [] }),
        can('hrm.work_schedule_pattern.read') ? loadAllResponse('hrm.work_schedule_pattern') : Promise.resolve({ items: [] }),
        can('hrm.work_schedule_template.read') ? loadAllResponse('hrm.work_schedule_template') : Promise.resolve({ items: [] }),
        can('hrm.department.read') ? loadRefs('hrm.department') : Promise.resolve(new Map()),
        can('hrm.position.read') ? loadRefs('hrm.position') : Promise.resolve(new Map()),
        workflowApproval && can('workflow-approval.approval_request.read') ? loadAllResponse('workflow-approval.approval_request') : Promise.resolve({ items: [] }),
      ]);
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
    } catch (reason) {
      setError(reason.message || uiText('Không tải được dữ liệu nhân sự.'));
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [attendanceDate, scheduleMonthEnd, scheduleMonthStart, workflowApproval]);

  useEffect(() => { load(); }, [load]);
  return { ...data, loading, error, setError, load };
}
