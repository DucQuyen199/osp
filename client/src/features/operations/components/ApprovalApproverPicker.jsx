import React from 'react';
import { uiTextWith } from '../../../lib/i18n.js';
import approvalEnglish from '../approvals.en.js';

const t = (text) => uiTextWith(text, approvalEnglish);

export default function ApprovalApproverPicker({ roles, selectedRoles, users, selectedUsers, onRolesChange, onUsersChange }) {
  const updateSelection = (current, value, checked) => checked
    ? [...current, value]
    : current.filter((entry) => entry !== value);

  return <div className="form-grid full">
    <fieldset className="field full">
      <legend className="label">{t('Vai trò có thể duyệt')}</legend>
      {!roles.length
        ? <span className="small muted">{t('Tenant chưa có vai trò để phân quyền.')}</span>
        : <div className="row wrap">{roles.map(([id, role]) => <label className="check" key={id}>
          <input
            type="checkbox"
            checked={selectedRoles.includes(id)}
            onChange={(event) => onRolesChange(updateSelection(selectedRoles, id, event.target.checked))}
          />
          <span>{role.name || id}</span>
        </label>)}</div>}
    </fieldset>
    <fieldset className="field full">
      <legend className="label">{t('Người dùng được chỉ định')}</legend>
      {!users.length
        ? <span className="small muted">{t('Chưa có người dùng trong doanh nghiệp.')}</span>
        : <div className="row wrap">{users.map((user) => {
          const selected = selectedUsers.includes(user.id);
          return <label className="check" key={user.id}>
            <input
              type="checkbox"
              checked={selected}
              disabled={Boolean(user.disabled) && !selected}
              onChange={(event) => onUsersChange(updateSelection(selectedUsers, user.id, event.target.checked))}
            />
            <span>{user.name || user.id}{user.disabled ? ` · ${t('Đã khóa')}` : ''}</span>
          </label>;
        })}</div>}
      <span className="small muted">{t('Cần chọn ít nhất một vai trò hoặc người dùng đang hoạt động.')}</span>
    </fieldset>
  </div>;
}
