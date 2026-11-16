import React, { useEffect, useMemo, useState } from 'react';
import { api, tenantPath } from '../../lib/api.js';
import { toast } from '../../lib/feedback.js';
import { CATEGORY_ORDER, categoryLabel } from '../../lib/i18n.js';
import { app, can, loadMeta, resetCaches } from '../../lib/state.js';
import SettingsTabs from './SettingsTabs.jsx';

export default function ModuleSettingsPage() {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const enabled = useMemo(() => new Set(app.meta.modules.map((module) => module.id)), [revision]);
  const groups = useMemo(() => CATEGORY_ORDER
    .map((category) => [category, app.meta.allModules.filter((module) => module.category === category)])
    .filter(([, modules]) => modules.length), [revision]);

  useEffect(() => { document.title = 'Cài đặt module · OSP Suite'; }, []);

  const toggle = async (module, turnOn) => {
    setBusy(module.id);
    setError('');
    try {
      const result = await api(tenantPath(`/modules/${turnOn ? 'enable' : 'disable'}`), {
        method: 'POST', body: turnOn ? { ids: [module.id] } : { id: module.id },
      });
      await loadMeta();
      resetCaches();
      setRevision((value) => value + 1);
      window.dispatchEvent(new Event('osp:meta'));
      const added = result?.added || [];
      toast(turnOn
        ? `Đã bật ${module.name}${added.length > 1 ? ` cùng ${added.length - 1} module phụ thuộc` : ''}.`
        : `Đã tắt ${module.name}; dữ liệu được giữ lại.`, 'success');
    } catch (reason) {
      setError(reason.message || 'Không thay đổi được trạng thái module.');
    } finally {
      setBusy('');
    }
  };

  if (!can('tenant.admin')) return <div className="page"><div className="alert danger" role="alert">Chỉ quản trị viên mới được thay đổi module.</div></div>;

  return <div className="page">
    <div className="page-head"><div><h1>Cài đặt</h1><p className="sub">Quản trị doanh nghiệp “{app.meta.name}”.</p></div></div>
    <SettingsTabs active="modules" />
    <section className="stack" aria-label="Quản lý module">
      <div className="alert">Bật module để nối các luồng liên mô-đun. Tắt module không xóa dữ liệu; bật lại sẽ tiếp tục dùng dữ liệu cũ.</div>
      {error && <div className="alert danger" role="alert">{error}</div>}
      {groups.map(([category, modules]) => <section key={category} className="card">
        <div className="card-head"><h2>{category === 'core' ? 'Dữ liệu gốc' : categoryLabel(category)}</h2></div>
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Module</th><th>Mô tả</th><th>Cần</th><th><span className="sr-only">Thao tác</span></th></tr></thead>
          <tbody>{modules.map((module) => {
            const isEnabled = enabled.has(module.id);
            return <tr key={module.id}>
              <td><strong>{module.name}</strong><div className="faint mono">{module.id}</div></td>
              <td className="muted small">{module.description}</td>
              <td><div className="kv">{module.depends.map((dependency) => <span key={dependency} className="chip neutral">{dependency}</span>)}</div></td>
              <td className="right">{module.core
                ? <span className="badge plain">Luôn bật</span>
                : <button className={`btn btn-sm${isEnabled ? '' : ' btn-primary'}`} type="button" disabled={Boolean(busy)} onClick={() => toggle(module, !isEnabled)}>
                  {busy === module.id ? 'Đang lưu…' : isEnabled ? 'Tắt' : 'Bật'}
                </button>}</td>
            </tr>;
          })}</tbody>
        </table></div>
      </section>)}
    </section>
  </div>;
}
