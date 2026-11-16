import React, { useEffect, useState } from 'react';
import { api, tenantPath } from '../../lib/api.js';
import { toast } from '../../lib/feedback.js';
import { app, can } from '../../lib/state.js';
import SettingsTabs from '../settings/SettingsTabs.jsx';

export default function InventorySettingsPage() {
  const [allowNegative, setAllowNegative] = useState(app.meta.settings?.allowNegativeStock === true);
  const [costMethod, setCostMethod] = useState(app.meta.settings?.inventoryCostMethod || 'moving_average');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { document.title = 'Chính sách kho · Cài đặt · OSP Suite'; }, []);

  const changePolicy = async (event) => {
    const next = event.target.checked;
    setBusy(true);
    setError('');
    try {
      const settings = await api(tenantPath('/settings'), { method: 'PATCH', body: { allowNegativeStock: next } });
      app.meta.settings = settings;
      setAllowNegative(next);
      window.dispatchEvent(new Event('osp:meta'));
      toast(next ? 'Đã cho phép tồn kho âm.' : 'Đã chặn xuất vượt tồn khả dụng.', 'success');
    } catch (reason) { setError(reason.message || 'Không cập nhật được chính sách kho.'); }
    finally { setBusy(false); }
  };

  const changeCostMethod = async (event) => {
    const next = event.target.value;
    setBusy(true);
    setError('');
    try {
      const settings = await api(tenantPath('/settings'), { method: 'PATCH', body: { inventoryCostMethod: next } });
      app.meta.settings = settings;
      setCostMethod(next);
      window.dispatchEvent(new Event('osp:meta'));
      toast(next === 'fifo' ? 'Đã bật giá vốn FIFO.' : 'Đã bật giá vốn bình quân di động.', 'success');
    } catch (reason) { setError(reason.message || 'Không cập nhật được phương pháp giá vốn.'); }
    finally { setBusy(false); }
  };

  if (!can('tenant.admin')) return <div className="page"><div className="alert danger" role="alert">Chỉ quản trị viên mới được đổi chính sách kho.</div></div>;

  return <div className="page">
    <div className="page-head"><div><h1>Cài đặt</h1><p className="sub">Chính sách kho của doanh nghiệp “{app.meta.name}”.</p></div></div>
    <SettingsTabs active="inventory" />
    <section className="stack" aria-label="Chính sách kho">
      {error && <div className="alert danger" role="alert">{error}</div>}
      <section className="card">
        <div className="card-head"><h2>Phương pháp tính giá vốn</h2></div>
        <div className="card-pad stack">
          <label className="field" htmlFor="inventory-cost-method"><span>Phương pháp</span>
            <select className="input" id="inventory-cost-method" value={costMethod} disabled={busy} onChange={changeCostMethod}>
              <option value="moving_average">Bình quân di động</option>
              <option value="fifo">Nhập trước, xuất trước (FIFO)</option>
            </select>
          </label>
          <p className="muted">Chọn phương pháp trước khi ghi nhận tồn đầu kỳ hoặc phiếu kho. Sau giao dịch kho đầu tiên, phương pháp bị khóa để bảo toàn sổ giá vốn. FIFO yêu cầu chặn tồn kho âm.</p>
        </div>
      </section>
      <section className="card">
        <div className="card-head"><h2>Cho phép tồn kho âm</h2></div>
        <div className="card-pad stack">
          <label className="check"><input type="checkbox" checked={allowNegative} disabled={busy || costMethod === 'fifo'} onChange={changePolicy} />Cho phép số tồn khả dụng giảm xuống dưới 0</label>
          <p className="muted">Khi tắt (mặc định), hệ thống từ chối phiếu xuất nếu số lượng vượt tồn sau khi trừ hàng đang giữ chờ kiểm tra chất lượng. Khi bật, nghiệp vụ xuất kho có thể ghi nhận tồn âm; chỉ dùng khi doanh nghiệp cho phép xuất trước, nhập sau.</p>
          <div className={`alert${allowNegative ? ' danger' : ''}`} role="status" aria-live="polite">{allowNegative ? 'Tồn kho âm đang được cho phép cho toàn doanh nghiệp.' : 'Tồn kho âm đang bị chặn cho toàn doanh nghiệp.'}</div>
        </div>
      </section>
    </section>
  </div>;
}
