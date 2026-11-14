import React, { useEffect, useState } from 'react';
import { api, tenantPath } from './lib/api.js';
import { toast } from './lib/feedback.js';
import { app, can, loadMeta } from './lib/state.js';
import SettingsTabs from './SettingsTabs.jsx';

export default function RolesSettingsPage() {
  const [roleId, setRoleId] = useState('');
  const [name, setName] = useState('');
  const [permissions, setPermissions] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { document.title = 'Vai trò · Cài đặt · OSP Suite'; }, []);

  const edit = (id, role) => {
    setRoleId(id);
    setName(role.name);
    setPermissions(role.permissions.join('\n'));
    setError('');
  };

  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api(tenantPath('/roles'), {
        method: 'POST',
        body: { id: roleId.trim(), name: name.trim(), permissions: permissions.split('\n').map((item) => item.trim()).filter(Boolean) },
      });
      await loadMeta();
      window.dispatchEvent(new Event('osp:meta'));
      toast('Đã lưu vai trò.', 'success');
    } catch (reason) { setError(reason.message || 'Không lưu được vai trò.'); }
    finally { setBusy(false); }
  };

  if (!can('tenant.admin')) return <div className="page"><div className="alert danger" role="alert">Chỉ quản trị viên mới được quản lý vai trò.</div></div>;

  return <div className="page">
    <div className="page-head"><div><h1>Cài đặt</h1><p className="sub">Vai trò và quyền của doanh nghiệp “{app.meta.name}”.</p></div></div>
    <SettingsTabs active="roles" />
    <section className="stack">
      {error && <div className="alert danger" role="alert">{error}</div>}
      <form className="card stack" onSubmit={save}>
        <div className="card-head"><h2>{Object.hasOwn(app.meta.roles, roleId) ? 'Cập nhật vai trò' : 'Tạo vai trò'}</h2><button className="btn btn-sm" type="button" onClick={() => edit('', { name: '', permissions: [] })}>Vai trò mới</button></div>
        <div className="form-grid">
          <div className="field"><label htmlFor="role-id">Mã vai trò</label><input className="input mono" id="role-id" value={roleId} onChange={(event) => setRoleId(event.target.value)} pattern="[a-z][a-z0-9_]*" required /><p className="hint">Chữ thường, số và dấu gạch dưới. Dùng lại mã để cập nhật.</p></div>
          <div className="field"><label htmlFor="role-name">Tên hiển thị</label><input className="input" id="role-name" value={name} onChange={(event) => setName(event.target.value)} required /></div>
          <div className="field full"><label htmlFor="role-permissions">Quyền, mỗi dòng một quyền</label><textarea className="textarea mono" id="role-permissions" rows="6" spellCheck="false" value={permissions} onChange={(event) => setPermissions(event.target.value)} placeholder={'accounting.*\nsales.sales_order.read\n*.*.read'} /><p className="hint">Dạng module.dữ_liệu.hành_động. Dấu * khớp mọi giá trị, ví dụ crm.* hoặc *.*.read.</p></div>
        </div>
        <div><button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Đang lưu…' : 'Lưu vai trò'}</button></div>
      </form>
      <section className="card"><div className="card-head"><h2>Vai trò hiện có</h2></div><div className="table-wrap"><table className="table">
        <thead><tr><th>Vai trò</th><th>Quyền</th><th><span className="sr-only">Thao tác</span></th></tr></thead>
        <tbody>{Object.entries(app.meta.roles).map(([id, role]) => <tr key={id}><td><strong>{role.name}</strong><div className="faint mono">{id}</div></td><td><div className="kv">{role.permissions.map((permission) => <span className="chip neutral mono" key={permission}>{permission}</span>)}</div></td><td className="right">{id === 'admin' ? <span className="badge plain">Hệ thống</span> : <button className="btn btn-sm" type="button" onClick={() => edit(id, role)}>Sửa</button>}</td></tr>)}</tbody>
      </table></div></section>
    </section>
  </div>;
}
