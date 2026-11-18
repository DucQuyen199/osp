import { useState } from 'react';
import { api, tenantPath } from '../../../lib/api.js';
import { toast } from '../../../lib/feedback.js';
import { uiText } from '../../../lib/i18n.js';
import { loadMeta } from '../../../lib/state.js';

export function useRolesSettingsWorkflow() {
  const [roleId, setRoleId] = useState('');
  const [name, setName] = useState('');
  const [permissions, setPermissions] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function edit(id, role) {
    setRoleId(id);
    setName(role.name);
    setPermissions(role.permissions.join('\n'));
    setError('');
  }

  async function save(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api(tenantPath('/roles'), {
        method: 'POST',
        body: {
          id: roleId.trim(),
          name: name.trim(),
          permissions: permissions.split('\n').map((item) => item.trim()).filter(Boolean),
        },
      });
      await loadMeta();
      window.dispatchEvent(new Event('osp:meta'));
      toast(uiText('ÄÃ£ lÆ°u vai trÃ².'), 'success');
    } catch (reason) { setError(reason.message || uiText('KhÃ´ng lÆ°u Ä‘Æ°á»£c vai trÃ².')); }
    finally { setBusy(false); }
  }

  return { roleId, setRoleId, name, setName, permissions, setPermissions, error, busy, edit, save };
}
