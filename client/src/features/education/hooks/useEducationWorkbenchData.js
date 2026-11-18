import { useCallback, useEffect, useState } from 'react';
import { uiText } from '../../../lib/i18n.js';
import { can, loadAllResponse, loadIndependentData, loadRefs } from '../../../lib/state.js';

const itemsOf = (response) => Array.isArray(response?.items) ? response.items : [];
const emptyData = () => ({
  classes: [], enrollments: [], students: new Map(), parties: new Map(), employees: new Map(), sessions: [], attendance: [],
  grades: [], fees: [], tuitionBatches: [], invoices: [],
});

export function useEducationWorkbenchData() {
  const [data, setData] = useState(emptyData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const emptyMap = () => new Map();
      const emptyResponse = () => ({ items: [] });
      const { data, errors } = await loadIndependentData({
        classRes: can('school.course_class.read') ? loadAllResponse('school.course_class') : Promise.resolve(emptyResponse()),
        enrollmentRes: can('school.class_enrollment.read') ? loadAllResponse('school.class_enrollment') : Promise.resolve(emptyResponse()),
        studentRes: can('school.student.read') ? loadAllResponse('school.student') : Promise.resolve(emptyResponse()),
        partyMap: can('master-data.party.read') ? loadRefs('master-data.party') : Promise.resolve(emptyMap()),
        employeeMap: can('hrm.employee.read') ? loadRefs('hrm.employee') : Promise.resolve(emptyMap()),
        sessionRes: can('school.class_session.read') ? loadAllResponse('school.class_session') : Promise.resolve(emptyResponse()),
        attendanceRes: can('school.attendance.read') ? loadAllResponse('school.attendance') : Promise.resolve(emptyResponse()),
        gradeRes: can('school.grade.read') ? loadAllResponse('school.grade') : Promise.resolve(emptyResponse()),
        feeRes: can('school.fee.read') ? loadAllResponse('school.fee') : Promise.resolve(emptyResponse()),
        tuitionBatchRes: can('school.tuition_batch.read') ? loadAllResponse('school.tuition_batch') : Promise.resolve(emptyResponse()),
        invoiceRes: can('accounting.invoice.read') ? loadAllResponse('accounting.invoice') : Promise.resolve(emptyResponse()),
      }, {
        classRes: emptyResponse(), enrollmentRes: emptyResponse(), studentRes: emptyResponse(), partyMap: emptyMap(), employeeMap: emptyMap(), sessionRes: emptyResponse(),
        attendanceRes: emptyResponse(), gradeRes: emptyResponse(), feeRes: emptyResponse(), tuitionBatchRes: emptyResponse(), invoiceRes: emptyResponse(),
      });
      const { classRes, enrollmentRes, studentRes, partyMap, employeeMap, sessionRes, attendanceRes, gradeRes, feeRes, tuitionBatchRes, invoiceRes } = data;
      const classes = itemsOf(classRes);
      const students = new Map(itemsOf(studentRes).map((student) => [student.id, student]));
      setData({
        classes,
        enrollments: itemsOf(enrollmentRes),
        students,
        parties: partyMap,
        employees: employeeMap,
        sessions: itemsOf(sessionRes).sort((a, b) => String(b.starts_at || '').localeCompare(String(a.starts_at || ''))),
        attendance: itemsOf(attendanceRes),
        grades: itemsOf(gradeRes),
        fees: itemsOf(feeRes),
        tuitionBatches: itemsOf(tuitionBatchRes),
        invoices: itemsOf(invoiceRes),
      });
      setError(errors[0]?.message || (errors.length ? uiText('Một số dữ liệu lớp học không tải được.') : ''));
    } catch (reason) {
      setError(reason.message || uiText('Không tải được dữ liệu lớp học.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  return { ...data, loading, error, load };
}
