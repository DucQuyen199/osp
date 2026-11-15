import React, { useEffect, useState } from 'react';
import { api, tenantPath } from './lib/api.js';
import { toast } from './lib/feedback.js';
import { fmtDateTime } from './lib/i18n.js';
import { app, can } from './lib/state.js';
import SettingsTabs from './SettingsTabs.jsx';

export default function TokensSettingsPage() {
  const [tokens, setTokens] = useState([]);
  const [users, setUsers] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [revealed, setRevealed] = useState(null);
  const [tokenMode, setTokenMode] = useState('scoped');

  const reload = async () => {
    setError('');
    try {
      const [tokenRows, userRows] = await Promise.all([api(tenantPath('/tokens')), api(tenantPath('/users'))]);
      setTokens(tokenRows);
      setUsers(userRows);
    } catch (reason) { setError(reason.message || 'Không tải được token.'); }
  };

  useEffect(() => { document.title = 'API token · Cài đặt · OSP Suite'; reload(); }, []);

  const create = async (event) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const scopes = tokenMode === 'scoped'
      ? String(values.get('scopes') || '').split(/[\n,;]/).map((scope) => scope.trim()).filter(Boolean)
      : null;
    if (tokenMode === 'scoped' && !scopes.length) { setError('Nhập ít nhất một quyền cho token giới hạn.'); return; }
    setBusy('create');
    setError('');
    try {
      const result = await api(tenantPath('/tokens'), { method: 'POST', body: {
        userId: values.get('userId'), label: String(values.get('label') || '').trim() || undefined,
        ttlDays: values.get('ttlDays') || undefined,
        ...(scopes ? { scopes } : {}),
      } });
      setRevealed({ token: result.token, expiresAt: result.expiresAt });
      setShowCreate(false);
      toast('Đã tạo token. Hãy sao chép ngay vì bí mật chỉ hiển thị một lần.', 'success');
      await reload();
    } catch (reason) { setError(reason.message || 'Không tạo được token.'); }
    finally { setBusy(''); }
  };

  const revoke = async (token) => {
    if (!window.confirm(`Thu hồi token ${token.label || token.id}? Hệ thống đang dùng token này sẽ mất quyền truy cập ngay.`)) return;
    setBusy(token.id);
    setError('');
    try {
      await api(tenantPath(`/tokens/${token.id}`), { method: 'DELETE' });
      toast('Đã thu hồi token.', 'success');
      await reload();
    } catch (reason) { setError(reason.message || 'Không thu hồi được token.'); }
    finally { setBusy(''); }
  };

  const copy = async () => {
    try { await navigator.clipboard.writeText(revealed.token); toast('Đã sao chép token.', 'success'); }
    catch { setError('Không sao chép được tự động. Hãy chọn token và sao chép thủ công.'); }
  };

  if (!can('tenant.admin')) return <div className="page"><div className="alert danger" role="alert">Chỉ quản trị viên mới được quản lý API token.</div></div>;

  return <div className="page">
    <div className="page-head"><div><h1>Cài đặt</h1><p className="sub">API token của doanh nghiệp “{app.meta.name}”.</p></div></div>
    <SettingsTabs active="tokens" />
    <section className="stack">
      {error && <div className="alert danger" role="alert">{error}</div>}
      {revealed && <section className="card stack">
        <div className="card-head"><h2>Sao chép token ngay</h2></div>
        <div className="card-pad stack">
          <div className="alert warning">Token chỉ hiển thị một lần. Nếu mất, hãy tạo token mới và thu hồi token này.</div>
          <label className="field"><span className="label">Token</span><input className="input mono" readOnly value={revealed.token} onFocus={(event) => event.target.select()} /></label>
          <p className="hint">{revealed.expiresAt ? `Hết hạn: ${fmtDateTime(revealed.expiresAt)}` : 'Token không có ngày hết hạn.'}</p>
          <div className="row"><button className="btn" type="button" onClick={copy}>Sao chép</button><button className="btn btn-primary" type="button" onClick={() => setRevealed(null)}>Đã lưu, đóng</button></div>
        </div>
      </section>}
      {showCreate && <form className="card stack" onSubmit={create}>
        <div className="card-head"><h2>Tạo API token</h2></div>
        {users.length === 0 ? <div className="alert danger">Cần có người dùng trước khi cấp token.</div> : <div className="form-grid">
          <div className="field"><label htmlFor="token-mode">Phạm vi token</label><select className="select" id="token-mode" value={tokenMode} onChange={(event) => setTokenMode(event.target.value)}><option value="scoped">Giới hạn theo quyền</option><option value="api">Toàn bộ quyền của người dùng</option></select><p className="hint">Token giới hạn chỉ thực hiện được các quyền khai báo bên dưới. Không thể cấp quyền thuộc tenant.</p></div>
          <div className="field"><label htmlFor="token-user">Cấp cho</label><select className="select" id="token-user" name="userId" required>{users.filter((user) => !user.disabled).map((user) => <option key={user.id} value={user.id}>{user.name}{user.email ? ` · ${user.email}` : ''}</option>)}</select><p className="hint">Chọn người phụ trách để lưu dấu vết và thu hồi token.</p></div>
          <div className="field"><label htmlFor="token-label">Ghi chú</label><input className="input" id="token-label" name="label" placeholder="Ví dụ: Kết nối kế toán" /></div>
          <div className="field"><label htmlFor="token-ttl">Hết hạn sau (ngày)</label><input className="input" id="token-ttl" name="ttlDays" type="number" min="1" step="1" /><p className="hint">Để trống nếu cần token không hết hạn.</p></div>
          {tokenMode === 'scoped' && <div className="field full"><label htmlFor="token-scopes">Quyền được phép, mỗi dòng một quyền *</label><textarea className="input mono" id="token-scopes" name="scopes" rows="5" required placeholder={'sales.sales_order.read\nsales.sales_order.create\ninventory.stock_move.read'} /><p className="hint">Dạng module.entity.action. Có thể dùng wildcard cụ thể như sales.sales_order.*; mọi quyền thuộc tenant bị từ chối.</p></div>}
        </div>}
        <div className="row"><button className="btn btn-primary" type="submit" disabled={Boolean(busy) || users.every((user) => user.disabled)}>{busy === 'create' ? 'Đang tạo…' : 'Tạo token'}</button><button className="btn" type="button" onClick={() => setShowCreate(false)}>Hủy</button></div>
      </form>}
      <section className="card">
        <div className="card-head"><h2>API token và phiên đăng nhập</h2><button className="btn btn-primary btn-sm" type="button" onClick={() => setShowCreate((value) => !value)}>{showCreate ? 'Đóng biểu mẫu' : 'Tạo API token'}</button></div>
        {tokens.length === 0 ? <div className="card-pad muted">Không có token hoặc phiên còn hiệu lực.</div> : <div className="table-wrap"><table className="table">
          <thead><tr><th>Loại</th><th>Người dùng</th><th>Ghi chú</th><th>Tạo lúc</th><th>Hết hạn</th><th><span className="sr-only">Thao tác</span></th></tr></thead>
          <tbody>{tokens.map((token) => <tr key={token.id}><td><span className="badge plain">{token.kind === 'api' ? 'API đầy đủ' : token.kind === 'scoped_api' ? 'API giới hạn' : 'Phiên'}</span></td><td>{users.find((user) => user.id === token.userId)?.name || token.userId}</td><td>{token.label || '—'}{token.kind === 'scoped_api' && <div className="small muted">{Array.isArray(token.scopes) ? token.scopes.join(' · ') : 'Không có quyền'}</div>}</td><td className="nowrap">{fmtDateTime(token.createdAt)}</td><td>{token.expiresAt ? fmtDateTime(token.expiresAt) : 'Không'}</td><td className="right"><button className="btn btn-sm" type="button" disabled={Boolean(busy)} onClick={() => revoke(token)}>Thu hồi</button></td></tr>)}</tbody>
        </table></div>}
      </section>
    </section>
  </div>;
}
