import { useState } from 'react';
import { localMonth } from '../../../lib/dates.js';
import { api, dataPath } from '../../../lib/api.js';

const csvCell = (value) => {
  const text = String(value ?? '');
  const safe = typeof value === 'string' && (/^[\s]*[=+@]/.test(text) || /^[\s]*-/.test(text)) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
};
const action = (entity, row, verb) => api(dataPath(entity, row.id, verb), { method: 'POST' });

export function usePayrollWorkflow({ load, setSelectedId, setError, annualReport, employees, reportYear, t }) {
  const [form, setForm] = useState({ period: localMonth(), hours_per_day: '8', working_weekdays: [1, 2, 3, 4, 5], payment_date: '', payment_method: 'bank' });
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');

  async function run(key, operation, success) {
    setBusy(key); setError(''); setNotice('');
    try { await operation(); setNotice(t(success)); await load(true); }
    catch (reason) { setError(t(reason.message || 'Thao tác không thành công.')); await load(true); }
    finally { setBusy(''); }
  }
  async function createRun(event) {
    event.preventDefault();
    await run('create', async () => {
      const row = await api(dataPath('payroll.payroll_run'), { method: 'POST', body: { period: form.period, hours_per_day: Number(form.hours_per_day || 8), working_weekdays: form.working_weekdays, payment_date: form.payment_date, payment_method: form.payment_method } });
      setSelectedId(row.id); setForm((current) => ({ ...current, period: '', payment_date: '' }));
    }, 'Đã mở bảng lương nháp. Hãy hoàn tất chấm công, nghỉ phép và các khoản điều chỉnh trước khi tính.');
  }
  async function doAction(row, verb) {
    const messages = {
      calculated: 'Đã tính phiếu lương theo nhân viên, lương hiệu lực, chấm công, nghỉ phép, ngày lễ, tăng ca và chính sách thuế/đóng góp đã duyệt.',
      submitted: 'Đã khóa bảng lương và gửi duyệt. Không thể thay đổi dữ liệu đầu vào trong kỳ sau bước này.',
      approved: 'Đã duyệt bảng lương; hệ thống ghi nhận bút toán chi phí và công nợ lương.',
      rejected: 'Bảng lương bị từ chối. Hãy hủy bản nháp này, điều chỉnh dữ liệu đầu vào rồi lập kỳ thay thế.',
      paid: 'Đã ghi nhận thanh toán lương qua tài khoản đã chọn.',
      cancelled: 'Đã hủy bảng lương nháp.',
    };
    await run(`${row.id}:${verb}`, () => action('payroll.payroll_run', row, verb), messages[verb]);
  }
  function exportAnnualReport() {
    const columns = ['Mã nhân viên', 'Nhân viên', 'Số bảng lương đã chi', 'Lương gộp', 'Thu nhập tính thuế', 'Thuế TNCN đã khấu trừ', 'Khoản đóng góp của nhân viên', 'Thực nhận', 'Giảm trừ y tế đã duyệt', 'Giảm trừ giáo dục đã duyệt'].map(t);
    const rows = annualReport.map((row) => {
      const employee = employees.get(row.employee);
      return [employee?.code || '', employee?.name || t('Nhân viên'), row.paidRuns, row.gross, row.taxable_income, row.income_tax, row.employee_contribution, row.net, row.medical_deduction ?? '', row.education_deduction ?? ''].map(csvCell).join(',');
    });
    const blob = new Blob([`\uFEFF${[columns.map(csvCell).join(','), ...rows].join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = `payroll-withholding-${reportYear}.csv`; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return { form, setForm, busy, notice, createRun, doAction, exportAnnualReport };
}
