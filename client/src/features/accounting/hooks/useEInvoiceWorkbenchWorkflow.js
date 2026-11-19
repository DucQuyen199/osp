import { useState } from 'react';
import { api, dataPath } from '../../../lib/api.js';
import { uiText } from '../../../lib/i18n.js';

export function useEInvoiceWorkbenchWorkflow({ load, clearLoadError }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function run(row, action, success, operation = () => api(dataPath('einvoice.einvoice', row.id, action), { method: 'POST' })) {
    clearLoadError(); setBusy(`${row.id}:${action}`); setError(''); setNotice('');
    try {
      await operation();
      setNotice(success);
      await load();
    } catch (failure) {
      setError(failure.message || uiText('Không cập nhật được yêu cầu hóa đơn điện tử.'));
    } finally {
      setBusy('');
    }
  }

  function requestCancellation(row) {
    const value = reason.trim();
    if (!value) { setError(uiText('Nhập lý do hủy theo quy trình nghiệp vụ trước khi gửi nhà cung cấp.')); return; }
    if (value.length > 2000) { setError(uiText('Lý do hủy không được vượt quá 2.000 ký tự.')); return; }
    run(row, 'cancel_requested', uiText('Đã đưa yêu cầu hủy vào hàng đợi xử lý.'), async () => {
      await api(dataPath('einvoice.einvoice', row.id, 'cancel_requested'), { method: 'POST', body: { cancellation_reason: value } });
      setReason('');
    });
  }

  return { reason, setReason, busy, error, notice, run, requestCancellation };
}
