import { useState } from 'react';
import { api, tenantPath } from '../../../lib/api.js';
import { toast } from '../../../lib/feedback.js';
import { uiText } from '../../../lib/i18n.js';

export function useUsersSettingsWorkflow({ reload, setError, roles }) {
  const [busy, setBusy] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [editingRoles, setEditingRoles] = useState('');
  const [roleSelection, setRoleSelection] = useState([]);
  const [passwordUser, setPasswordUser] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [mfaResetUser, setMfaResetUser] = useState('');
  const [mfaResetReason, setMfaResetReason] = useState('');

  async function saveRoles(user) {
    setBusy(user.id);
    try {
      await api(tenantPath(`/users/${user.id}`), { method: 'PATCH', body: { roles: roleSelection } });
      setEditingRoles('');
      toast(uiText('Đã cập nhật vai trò.'), 'success');
      await reload();
    } catch (reason) { setError(reason.message || uiText('Không cập nhật được vai trò.')); }
    finally { setBusy(''); }
  }

  async function createUser(event) {
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
  }

  async function toggleDisabled(user) {
    setBusy(user.id);
    setError('');
    try {
      await api(tenantPath(`/users/${user.id}`), { method: 'PATCH', body: { disabled: !user.disabled } });
      toast(uiText(user.disabled ? 'Đã mở khóa tài khoản.' : 'Đã khóa tài khoản.'), 'success');
      await reload();
    } catch (reason) { setError(reason.message || uiText('Không đổi được trạng thái tài khoản.')); }
    finally { setBusy(''); }
  }

  async function savePassword(user) {
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
  }

  async function resetMfa(user) {
    setBusy(user.id);
    setError('');
    try {
      await api(tenantPath(`/auth/mfa/users/${encodeURIComponent(user.id)}/reset`), {
        method: 'POST', body: { reason: mfaResetReason.trim() },
      });
      setMfaResetUser('');
      setMfaResetReason('');
      toast(uiText('Đã đặt lại MFA và thu hồi phiên của người dùng.'), 'success');
      await reload();
    } catch (reason) { setError(reason.message || uiText('Không đặt lại được MFA.')); }
    finally { setBusy(''); }
  }

  function startRoleEdit(user) {
    setRoleSelection(user.roles);
    setEditingRoles(user.id);
  }

  function startPasswordReset(user) {
    setPasswordUser(user.id);
    setNewPassword('');
  }

  function cancelPasswordReset() {
    setPasswordUser('');
    setNewPassword('');
  }

  function startMfaReset(user) {
    setMfaResetUser(user.id);
    setMfaResetReason('');
  }

  function cancelMfaReset() {
    setMfaResetUser('');
    setMfaResetReason('');
  }

  return {
    busy, showAdd, setShowAdd, editingRoles, setEditingRoles,
    roleSelection, setRoleSelection, passwordUser, setPasswordUser,
    newPassword, setNewPassword, mfaResetUser, mfaResetReason, setMfaResetReason,
    saveRoles, createUser, toggleDisabled, savePassword, resetMfa,
    startRoleEdit, startPasswordReset, cancelPasswordReset, startMfaReset, cancelMfaReset,
  };
}
