import React, { useCallback, useEffect, useState } from 'react';
import { useDocumentTitle } from '../../lib/useDocumentTitle.js';
import { api, tenantPath } from '../../lib/api.js';
import { toast } from '../../lib/feedback.js';
import { uiText } from '../../lib/i18n.js';
import { app, can } from '../../lib/state.js';
import SettingsTabs from './SettingsTabs.jsx';
const roles = () => Object.entries(app.meta.roles || {});
export default function UsersSettingsPage() {
  useDocumentTitle(`${uiText('Người dùng')} · ${uiText('Cài đặt')} · OSP Suite`);
  const [users, setUsers] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [editingRoles, setEditingRoles] = useState('');
  const [roleSelection, setRoleSelection] = useState([]);
  const [passwordUser, setPasswordUser] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [mfaResetUser, setMfaResetUser] = useState('');
  const [mfaResetReason, setMfaResetReason] = useState('');
  const reload = useCallback(async () => {
    setError('');
    try { setUsers(await api(tenantPath('/users'))); }
    catch (reason) { setError(reason.message || uiText('Không tải được người dùng.')); }
  }, []);
  useEffect(() => {  reload(); }, [reload]);
  const saveRoles = async (user) => {
    setBusy(user.id);
    try {
      await api(tenantPath(`/users/${user.id}`), { method: 'PATCH', body: { roles: roleSelection } });
      setEditingRoles('');
      toast(uiText('Đã cập nhật vai trò.'), 'success');
      await reload();
    } catch (reason) { setError(reason.message || uiText('Không cập nhật được vai trò.')); }
    finally { setBusy(''); }
  };
  const createUser = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy('create');
    setError('');
    try {
      await api(tenantPath('/users'), {
        method: 'POST',
        body: {
          name: form.get('name'), email: form.get('email') || undefined,
          password: form.get('password') || undefined,
          roles: roles().filter(([id]) => form.getAll('roles').includes(id)).map(([id]) => id),
        },
      });
      setShowAdd(false);
      toast(uiText('Đã thêm người dùng.'), 'success');
      await reload();
    } catch (reason) { setError(reason.message || uiText('Không tạo được người dùng.')); }
    finally { setBusy(''); }
  };
  const toggleDisabled = async (user) => {
    setBusy(user.id);
    setError('');
    try {
      await api(tenantPath(`/users/${user.id}`), { method: 'PATCH', body: { disabled: !user.disabled } });
      toast(uiText(user.disabled ? 'Đã mở khóa tài khoản.' : 'Đã khóa tài khoản.'), 'success');
      await reload();
    } catch (reason) { setError(reason.message || uiText('Không đổi được trạng thái tài khoản.')); }
    finally { setBusy(''); }
  };
  const savePassword = async (user) => {
    setBusy(user.id);
    setError('');
    try {
      await api(tenantPath(`/users/${user.id}`), { method: 'PATCH', body: { password: newPassword } });
      setPasswordUser('');
      setNewPassword('');
      toast(uiText('Đã đặt lại mật khẩu; các phiên cũ đã bị đăng xuất.'), 'success');
      await reload();
    } catch (reason) { setError(reason.message || uiText('Không đặt lại được mật khẩu.')); }
    finally { setBusy(''); }
  };
  const resetMfa = async (user) => {
    setBusy(user.id); setError('');
    try {
      await api(tenantPath(`/auth/mfa/users/${encodeURIComponent(user.id)}/reset`), {
        method: 'POST', body: { reason: mfaResetReason.trim() },
      });
      setMfaResetUser(''); setMfaResetReason('');
      toast(uiText('Đã đặt lại MFA và thu hồi phiên của người dùng.'), 'success');
      await reload();
    } catch (reason) { setError(reason.message || uiText('Không đặt lại được MFA.')); }
    finally { setBusy(''); }
  };
  if (!can('tenant.admin')) return <div className="page"><div className="alert danger" role="alert">{uiText('Chỉ quản trị viên mới được quản lý người dùng.')}</div></div>;
  return <div className="page">
    <div className="page-head"><div><h1>{uiText('Cài đặt')}</h1><p className="sub">{uiText('Quản trị người dùng của doanh nghiệp')} “{app.meta.name}”.</p></div></div>
    <SettingsTabs active="users" />
    <section className="stack" aria-label={uiText('Quản lý người dùng')}>
      {error && <div className="alert danger" role="alert">{uiText(error)}</div>}
      {showAdd && <form className="card stack" onSubmit={createUser}>
        <div className="card-head"><h2>{uiText('Thêm người dùng')}</h2></div>
        <div className="form-grid">
          <div className="field"><label htmlFor="user-name">{uiText('Họ tên')}</label><input className="input" id="user-name" name="name" required /></div>
          <div className="field"><label htmlFor="user-email">{uiText('Email đăng nhập')}</label><input className="input" id="user-email" name="email" type="email" /></div>
          <div className="field"><label htmlFor="user-password">{uiText('Mật khẩu')}</label><input className="input" id="user-password" name="password" type="password" minLength="8" autoComplete="new-password" /><p className="hint">{uiText('Để trống để tạo tài khoản máy, chỉ dùng API token.')}</p></div>
        </div>
        <fieldset className="field"><legend className="label">{uiText('Vai trò')}</legend><div className="kv">{roles().map(([id, role]) => <label className="check" key={id}><input type="checkbox" name="roles" value={id} defaultChecked={id === 'viewer'} />{uiText(role.name)}</label>)}</div></fieldset>
        <div className="row"><button className="btn btn-primary" type="submit" disabled={busy === 'create'}>{busy === 'create' ? uiText('Đang lưu…') : uiText('Thêm người dùng')}</button><button className="btn" type="button" onClick={() => setShowAdd(false)}>{uiText('Hủy')}</button></div>
      </form>}
      <section className="card">
        <div className="card-head"><h2>{uiText('Người dùng')}</h2><button className="btn btn-primary btn-sm" type="button" onClick={() => setShowAdd((shown) => !shown)}>{showAdd ? uiText('Đóng biểu mẫu') : uiText('Thêm người dùng')}</button></div>
        {users.length === 0 ? <div className="card-pad muted">{uiText('Chưa có người dùng.')}</div> : <div className="table-wrap"><table className="table">
          <thead><tr><th>{uiText('Họ tên')}</th><th>Email</th><th>{uiText('Vai trò')}</th><th>MFA</th><th>{uiText('Trạng thái')}</th><th><span className="sr-only">{uiText('Thao tác')}</span></th></tr></thead>
          <tbody>{users.map((user) => <tr key={user.id}>
            <td><strong>{user.name}</strong>{user.id === app.user.id && <span className="chip neutral">{uiText('Bạn')}</span>}
              {passwordUser === user.id && <div className="row wrap u-mt-8" ><input className="input" aria-label={`${uiText('Mật khẩu mới cho')} ${user.name}`} type="password" minLength="8" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /><button className="btn btn-sm btn-primary" type="button" disabled={busy === user.id || newPassword.length < 8} onClick={() => savePassword(user)}>{uiText('Lưu mật khẩu')}</button><button className="btn btn-sm" type="button" onClick={() => setPasswordUser('')}>{uiText('Hủy')}</button></div>}</td>
            <td>{user.email || `— (${uiText('tài khoản máy')})`}</td>
            <td>{editingRoles === user.id ? <div className="stack-sm">{roles().map(([id, role]) => <label className="check" key={id}><input type="checkbox" checked={roleSelection.includes(id)} onChange={(event) => setRoleSelection((current) => event.target.checked ? [...current, id] : current.filter((value) => value !== id))} />{uiText(role.name)}</label>)}<div className="row"><button className="btn btn-sm btn-primary" type="button" disabled={busy === user.id} onClick={() => saveRoles(user)}>{uiText('Lưu')}</button><button className="btn btn-sm" type="button" onClick={() => setEditingRoles('')}>{uiText('Hủy')}</button></div></div> : <div className="kv">{user.roles.map((id) => <span className="chip" key={id}>{uiText(app.meta.roles[id]?.name || id)}</span>)}</div>}</td>
            <td><span className={`badge ${user.mfaEnabled ? 'success' : 'plain'}`}>{user.mfaEnabled ? uiText('Bật') : uiText('Tắt')}</span>{mfaResetUser === user.id && <div className="stack-sm u-mt-8" ><textarea className="input" aria-label={`${uiText('Lý do đặt lại MFA cho')} ${user.name}`} rows="2" minLength="10" maxLength="500" placeholder={uiText('Lý do bắt buộc (10–500 ký tự)')} value={mfaResetReason} onChange={(event) => setMfaResetReason(event.target.value)} /><div className="row"><button className="btn btn-sm btn-danger" type="button" disabled={busy === user.id || mfaResetReason.trim().length < 10} onClick={() => resetMfa(user)}>{uiText('Xác nhận đặt lại')}</button><button className="btn btn-sm" type="button" onClick={() => { setMfaResetUser(''); setMfaResetReason(''); }}>{uiText('Hủy')}</button></div></div>}</td>
            <td><span className={`badge ${user.disabled ? 'danger' : 'success'}`}>{user.disabled ? uiText('Đã khóa') : uiText('Hoạt động')}</span></td>
            <td className="right"><div className="row wrap"><button className="btn btn-sm" type="button" disabled={Boolean(busy)} onClick={() => { setRoleSelection(user.roles); setEditingRoles(user.id); }}>{uiText('Vai trò')}</button>{user.hasPassword && <button className="btn btn-sm" type="button" disabled={Boolean(busy)} onClick={() => { setPasswordUser(user.id); setNewPassword(''); }}>{uiText('Đặt lại mật khẩu')}</button>}{user.mfaEnabled && <button className="btn btn-sm" type="button" disabled={Boolean(busy)} onClick={() => { setMfaResetUser(user.id); setMfaResetReason(''); }}>{uiText('Đặt lại MFA')}</button>}<button className="btn btn-sm" type="button" disabled={Boolean(busy)} onClick={() => toggleDisabled(user)}>{user.disabled ? uiText('Mở khóa') : uiText('Khóa')}</button></div></td>
          </tr>)}</tbody>
        </table></div>}
      </section>
    </section>
  </div>;
}
