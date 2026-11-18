import { useEffect, useMemo, useState } from 'react';
import { addCalendarDays, localDate } from '../../../lib/dates.js';
import { api, dataPath } from '../../../lib/api.js';
import { uiText } from '../../../lib/i18n.js';
import { can } from '../../../lib/state.js';

const MAX_ROTATION_DAYS = 3653;
const MAX_GENERATED_SCHEDULE_ROWS = 40_000;
const blankCycleDay = (is_working = true) => ({
  rowId: crypto.randomUUID(),
  is_working,
  start_time: is_working ? '09:00' : '',
  end_time: is_working ? '17:00' : '',
  break_minutes: is_working ? 60 : 0,
});
const serializeCycle = (cycle) => cycle.map(({ rowId, ...day }) => day);
const rotationDayLimit = (employeeCount) => Math.min(
  MAX_ROTATION_DAYS,
  Math.floor(MAX_GENERATED_SCHEDULE_ROWS / Math.max(employeeCount, 1)),
);
const addLocalDays = addCalendarDays;
const action = (entity, row, verb) => api(dataPath(entity, row.id, verb), { method: 'POST' });

export function useSchedulePatternController({ employees, scheduleTemplates, run }) {
  const [patternForm, setPatternForm] = useState(() => ({
    employees: [],
    start_date: localDate(),
    end_date: addLocalDays(localDate(), 27),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    cycle: [blankCycleDay(), blankCycleDay(false)],
  }));
  const [scheduleTemplateName, setScheduleTemplateName] = useState('');
  const [scheduleTemplateId, setScheduleTemplateId] = useState('');
  const [patternEmployeeFilter, setPatternEmployeeFilter] = useState('');

  useEffect(() => {
    setPatternForm((form) => ({
      ...form,
      employees: form.employees.filter((id) => employees.some((row) => row.id === id && row.status === 'active')),
    }));
  }, [employees]);

  const activeEmployees = useMemo(() => employees.filter((row) => row.status === 'active'), [employees]);
  const matchingPatternEmployees = useMemo(() => activeEmployees
    .filter((row) => `${row.name || ''} ${row.code || ''}`
      .toLocaleLowerCase('vi')
      .includes(patternEmployeeFilter.trim().toLocaleLowerCase('vi')))
    .slice(0, 50), [activeEmployees, patternEmployeeFilter]);
  const dayLimit = rotationDayLimit(patternForm.employees.length);
  const maxPatternEndDate = patternForm.start_date
    ? addLocalDays(patternForm.start_date, dayLimit - 1)
    : undefined;

  async function createSchedulePattern(event) {
    event.preventDefault();
    await run('schedule-pattern:create', async () => {
      const row = await api(dataPath('hrm.work_schedule_pattern'), {
        method: 'POST',
        body: { ...patternForm, cycle: serializeCycle(patternForm.cycle) },
      });
      if (can('hrm.work_schedule_pattern.applied')) await action('hrm.work_schedule_pattern', row, 'applied');
    }, can('hrm.work_schedule_pattern.applied')
      ? uiText('Đã tạo lịch luân phiên và sinh các ca theo ngày; payroll và hạn mức phép sẽ dùng lịch mới.')
      : uiText('Đã lưu mẫu ca nháp để người có quyền áp dụng.'));
  }

  function updatePatternEmployees(employeeId, selected) {
    setPatternForm((form) => {
      const selectedEmployees = selected
        ? [...form.employees, employeeId]
        : form.employees.filter((id) => id !== employeeId);
      const maxEnd = addLocalDays(form.start_date, rotationDayLimit(selectedEmployees.length) - 1);
      return {
        ...form,
        employees: selectedEmployees,
        end_date: form.end_date > maxEnd ? maxEnd : form.end_date,
      };
    });
  }

  function updatePatternStartDate(startDate) {
    setPatternForm((form) => {
      const maxEnd = addLocalDays(startDate, rotationDayLimit(form.employees.length) - 1);
      return {
        ...form,
        start_date: startDate,
        end_date: !form.end_date || form.end_date < startDate
          ? startDate
          : form.end_date > maxEnd ? maxEnd : form.end_date,
      };
    });
  }

  function updatePatternField(field, value) {
    setPatternForm((form) => ({ ...form, [field]: value }));
  }

  function togglePatternCycleDay(index, isWorking) {
    setPatternForm((form) => ({
      ...form,
      cycle: form.cycle.map((day, itemIndex) => itemIndex === index ? {
        ...day,
        is_working: isWorking,
        start_time: isWorking ? (day.start_time || '09:00') : '',
        end_time: isWorking ? (day.end_time || '17:00') : '',
        break_minutes: isWorking ? (day.break_minutes || 0) : 0,
      } : day),
    }));
  }

  function updatePatternCycleField(index, field, value) {
    setPatternForm((form) => ({
      ...form,
      cycle: form.cycle.map((day, itemIndex) => itemIndex === index ? { ...day, [field]: value } : day),
    }));
  }

  function removePatternCycleDay(index) {
    setPatternForm((form) => ({ ...form, cycle: form.cycle.filter((_, itemIndex) => itemIndex !== index) }));
  }

  function addPatternCycleDay() {
    setPatternForm((form) => ({ ...form, cycle: [...form.cycle, blankCycleDay()] }));
  }

  function useScheduleTemplate(id) {
    setScheduleTemplateId(id);
    const template = scheduleTemplates.find((row) => row.id === id);
    setScheduleTemplateName(template?.name || '');
    if (template) {
      setPatternForm((form) => ({
        ...form,
        timezone: template.timezone || form.timezone,
        cycle: Array.isArray(template.cycle)
          ? template.cycle.map((day) => ({ ...day, rowId: crypto.randomUUID() }))
          : form.cycle,
      }));
    }
  }

  async function saveScheduleTemplate() {
    const name = scheduleTemplateName.trim();
    if (!name) return;
    await run('schedule-template:save', async () => {
      const body = { name, timezone: patternForm.timezone, cycle: serializeCycle(patternForm.cycle) };
      if (scheduleTemplateId && scheduleTemplates.some((row) => row.id === scheduleTemplateId)) {
        await api(dataPath('hrm.work_schedule_template', scheduleTemplateId), { method: 'PATCH', body });
      } else {
        const row = await api(dataPath('hrm.work_schedule_template'), { method: 'POST', body });
        setScheduleTemplateId(row.id);
      }
    }, uiText('Đã lưu mẫu ca vào thư viện để tái sử dụng.'));
  }

  async function removeScheduleTemplate(row) {
    await run(`${row.id}:template-remove`, () => api(dataPath('hrm.work_schedule_template', row.id), { method: 'DELETE' }), uiText('Đã xóa mẫu ca khỏi thư viện.'));
    if (scheduleTemplateId === row.id) {
      setScheduleTemplateId('');
      setScheduleTemplateName('');
    }
  }

  async function applySchedulePattern(row) {
    await run(`${row.id}:applied`, () => action('hrm.work_schedule_pattern', row, 'applied'), uiText('Đã sinh lịch luân phiên thành các ca theo ngày.'));
  }

  async function removeSchedulePattern(row) {
    await run(`${row.id}:remove`, () => api(dataPath('hrm.work_schedule_pattern', row.id), { method: 'DELETE' }), uiText('Đã xóa mẫu ca nháp.'));
  }

  return {
    patternForm,
    scheduleTemplateName,
    scheduleTemplateId,
    patternEmployeeFilter,
    matchingPatternEmployees,
    dayLimit,
    maxPatternEndDate,
    setScheduleTemplateName,
    setPatternEmployeeFilter,
    createSchedulePattern,
    updatePatternEmployees,
    updatePatternStartDate,
    updatePatternField,
    togglePatternCycleDay,
    updatePatternCycleField,
    removePatternCycleDay,
    addPatternCycleDay,
    useScheduleTemplate,
    saveScheduleTemplate,
    removeScheduleTemplate,
    applySchedulePattern,
    removeSchedulePattern,
  };
}
