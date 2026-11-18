import React from 'react';

export default function EmployeeWeekScheduleTable({ employees, weekdays, recordLabel, t }) {
  const scheduledEmployees = employees.filter((employee) =>
    Array.isArray(employee.work_weekdays) || employee.standard_hours_per_day,
  );
  if (scheduledEmployees.length === 0) return null;

  return <section className="card card-pad">
    <h2>{t('Lịch tuần riêng')}</h2>
    <div className="table-wrap">
      <table className="table">
        <thead><tr><th>{t('Nhân viên')}</th><th>{t('Ngày làm việc')}</th><th>{t('Giờ chuẩn mỗi ngày')}</th></tr></thead>
        <tbody>{scheduledEmployees.map((employee) => <tr key={employee.id}>
          <td>{recordLabel('hrm.employee', employee)}</td>
          <td>{Array.isArray(employee.work_weekdays)
            ? employee.work_weekdays.map((day) => weekdays.find(([number]) => number === Number(day))?.[1]).filter(Boolean).join(', ')
            : t('Theo lịch kỳ lương')}
          </td>
          <td>{employee.standard_hours_per_day || t('Theo lịch kỳ lương')}</td>
        </tr>)}</tbody>
      </table>
    </div>
    <p className="small muted">{t('Lịch tuần là mặc định; các ca và ngày nghỉ cụ thể ghi ở phần Lịch ca theo ngày phía trên sẽ được ưu tiên.')}</p>
  </section>;
}
