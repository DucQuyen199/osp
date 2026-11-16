import React, { useState } from 'react';
import { api, tenantPath } from '../../lib/api.js';
import { toast } from '../../lib/feedback.js';
import { app, can } from '../../lib/state.js';
import SettingsTabs from './SettingsTabs.jsx';

export default function BudgetSettingsPage() {
  const [enforce, setEnforce] = useState(app.meta.settings?.enforceBudgetControl === true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const budgetEnabled = app.meta.modules?.includes('budget') === true;

  const changePolicy = async (event) => {
    const next = event.target.checked;
    setBusy(true);
    setError('');
    try {
      const settings = await api(tenantPath('/settings'), {
        method: 'PATCH', body: { enforceBudgetControl: next },
      });
      app.meta.settings = settings;
      setEnforce(next);
      window.dispatchEvent(new Event('osp:meta'));
      toast(next ? 'Đã bật kiểm soát hạn mức ngân sách khi ghi sổ.' : 'Đã tắt kiểm soát hạn mức ngân sách.', 'success');
    } catch (reason) {
      setError(reason.message || 'Không cập nhật được chính sách ngân sách.');
    } finally {
      setBusy(false);
    }
  };

  if (!can('tenant.admin')) return <div className="page"><div className="alert danger" role="alert">Chỉ quản trị viên mới được đổi chính sách ngân sách.</div></div>;

  return <div className="page">
    <div className="page-head"><div><h1>Cài đặt</h1><p className="sub">Kiểm soát ngân sách của doanh nghiệp “{app.meta.name}”.</p></div></div>
    <SettingsTabs active="budget" />
    <section className="stack" aria-label="Kiểm soát ngân sách">
      {error && <div className="alert danger" role="alert">{error}</div>}
      {!budgetEnabled && <div className="alert" role="status">Hãy bật module Ngân sách trước khi cấu hình kiểm soát hạn mức.</div>}
      <section className="card">
        <div className="card-head"><h2>Chặn ghi sổ vượt ngân sách</h2></div>
        <div className="card-pad stack">
          <label className="check">
            <input type="checkbox" checked={enforce} disabled={busy || !budgetEnabled} onChange={changePolicy} />
            Bắt buộc có ngân sách đã duyệt và còn hạn mức cho chi phí
          </label>
          <p className="muted">Khi bật, hệ thống kiểm tra phát sinh Nợ ròng trên từng tài khoản chi phí tại bước ghi sổ. Ngân sách tháng và năm cùng áp dụng nếu cả hai có dòng tương ứng; khoản chi chưa được phân bổ hoặc vượt kế hoạch sẽ bị từ chối. Nếu chưa có ngân sách được duyệt cho kỳ, chi phí không thể ghi sổ. Mặc định chính sách này tắt.</p>
          <div className={`alert${enforce ? ' danger' : ''}`} role="status" aria-live="polite">{enforce ? 'Kiểm soát ngân sách đang bật cho toàn doanh nghiệp.' : 'Kiểm soát ngân sách đang tắt.'}</div>
        </div>
      </section>
    </section>
  </div>;
}
