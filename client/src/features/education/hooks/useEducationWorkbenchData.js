import { useCallback, useEffect, useState } from 'react';
import { uiText } from '../../../lib/i18n.js';
import { can, loadAllResponse, loadRefs } from '../../../lib/state.js';

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
      const [classRes, enrollmentRes, studentRes, partyMap, employeeMap, sessionRes, attendanceRes, gradeRes, feeRes, tuitionBatchRes, invoiceRes] = await Promise.all([
        can('school.course_class.read') ? loadAllResponse('school.course_class') : Promise.resolve({ items: [] }),
        can('school.class_enrollment.read') ? loadAllResponse('school.class_enrollment') : Promise.resolve({ items: [] }),
        can('school.student.read') ? loadAllResponse('school.student') : Promise.resolve({ items: [] }),
        can('master-data.party.read') ? loadRefs('master-data.party') : Promise.resolve(new Map()),
        can('hrm.employee.read') ? loadRefs('hrm.employee') : Promise.resolve(new Map()),
        can('school.class_session.read') ? loadAllResponse('school.class_session') : Promise.resolve({ items: [] }),
        can('school.attendance.read') ? loadAllResponse('school.attendance') : Promise.resolve({ items: [] }),
        can('school.grade.read') ? loadAllResponse('school.grade') : Promise.resolve({ items: [] }),
        can('school.fee.read') ? loadAllResponse('school.fee') : Promise.resolve({ items: [] }),
        can('school.tuition_batch.read') ? loadAllResponse('school.tuition_batch') : Promise.resolve({ items: [] }),
        can('accounting.invoice.read') ? loadAllResponse('accounting.invoice') : Promise.resolve({ items: [] }),
      ]);
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
    } catch (reason) {
      setError(reason.message || uiText('Không tải được dữ liệu lớp học.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  return { ...data, loading, error, load };
}
