import React from 'react';
import { useDocumentTitle } from '../../lib/useDocumentTitle.js';
import { uiText } from '../../lib/i18n.js';
import { app, can } from '../../lib/state.js';
import SettingsTabs from './SettingsTabs.jsx';
import { useTokensWorkflow } from './hooks/useTokensWorkflow.js';
export default function TokensSettingsPage() {
  useDocumentTitle(`${uiText('API token')} · ${uiText('Cài đặt')} · OSP Suite`);
  const { tokens, users, error, busy, showCreate, setShowCreate, revealed, setRevealed,
    tokenMode, setTokenMode, create, revoke, copy, fmtDateTime } = useTokensWorkflow({ enabled: can('tenant.admin') });
  if (!can('tenant.admin')) return <div className="page"><div className="alert danger" role="alert">{uiText('Chỉ quản trị viên mới được quản lý API token.')}</div></div>;
  return <div className="page">
    <div className="page-head"><div><h1>{uiText('Cài đặt')}</h1><p className="sub">{uiText('API token của doanh nghiệp')} “{app.meta.name}”.</p></div></div>
    <SettingsTabs active="tokens" />
    <section className="stack">
      {error && <div className="alert danger" role="alert">{uiText(error)}</div>}
      {revealed && <section className="card stack">
        <div className="card-head"><h2>{uiText('Sao chép token ngay')}</h2></div>
        <div className="card-pad stack">
          <div className="alert warning">{uiText('Token chỉ hiển thị một lần. Nếu mất, hãy tạo token mới và thu hồi token này.')}</div>
          <label className="field"><span className="label">Token</span><input className="input mono" readOnly value={revealed.token} onFocus={(event) => event.target.select()} /></label>
          <p className="hint">{revealed.expiresAt ? `${uiText('Hết hạn')}: ${fmtDateTime(revealed.expiresAt)}` : uiText('Token không có ngày hết hạn.')}</p>
          <div className="row"><button className="btn" type="button" onClick={copy}>{uiText('Sao chép')}</button><button className="btn btn-primary" type="button" onClick={() => setRevealed(null)}>{uiText('Đã lưu, đóng')}</button></div>
        </div>
      </section>}
      {showCreate && <form className="card stack" onSubmit={create}>
        <div className="card-head"><h2>{uiText('Tạo API token')}</h2></div>
        {users.length === 0 ? <div className="alert danger">{uiText('Cần có người dùng trước khi cấp token.')}</div> : <div className="form-grid">
          <div className="field"><label htmlFor="token-mode">{uiText('Phạm vi token')}</label><select className="select" id="token-mode" value={tokenMode} onChange={(event) => setTokenMode(event.target.value)}><option value="scoped">{uiText('Giới hạn theo quyền')}</option><option value="api">{uiText('Toàn bộ quyền của người dùng')}</option></select><p className="hint">{uiText('Token giới hạn chỉ thực hiện được các quyền khai báo bên dưới. Không thể cấp quyền thuộc tenant.')}</p></div>
          <div className="field"><label htmlFor="token-user">{uiText('Cấp cho')}</label><select className="select" id="token-user" name="userId" required>{users.filter((user) => !user.disabled).map((user) => <option key={user.id} value={user.id}>{user.name}{user.email ? ` · ${user.email}` : ''}</option>)}</select><p className="hint">{uiText('Chọn người phụ trách để lưu dấu vết và thu hồi token.')}</p></div>
          <div className="field"><label htmlFor="token-label">{uiText('Ghi chú')}</label><input className="input" id="token-label" name="label" placeholder={uiText('Ví dụ: Kết nối kế toán')} /></div>
          <div className="field"><label htmlFor="token-ttl">{uiText('Hết hạn sau (ngày)')}</label><input className="input" id="token-ttl" name="ttlDays" type="number" min="1" step="1" /><p className="hint">{uiText('Để trống nếu cần token không hết hạn.')}</p></div>
          {tokenMode === 'scoped' && <div className="field full"><label htmlFor="token-scopes">{uiText('Quyền được phép, mỗi dòng một quyền *')}</label><textarea className="input mono" id="token-scopes" name="scopes" rows="5" required placeholder={'sales.sales_order.read\nsales.sales_order.create\ninventory.stock_move.read'} /><p className="hint">{uiText('Dạng module.entity.action. Có thể dùng wildcard cụ thể như sales.sales_order.*; mọi quyền thuộc tenant bị từ chối.')}</p></div>}
        </div>}
        <div className="row"><button className="btn btn-primary" type="submit" disabled={Boolean(busy) || users.every((user) => user.disabled)}>{busy === 'create' ? uiText('Đang tạo…') : uiText('Tạo token')}</button><button className="btn" type="button" onClick={() => setShowCreate(false)}>{uiText('Hủy')}</button></div>
      </form>}
      <section className="card">
        <div className="card-head"><h2>{uiText('API token và phiên đăng nhập')}</h2><button className="btn btn-primary btn-sm" type="button" onClick={() => setShowCreate((value) => !value)}>{showCreate ? uiText('Đóng biểu mẫu') : uiText('Tạo API token')}</button></div>
        {tokens.length === 0 ? <div className="card-pad muted">{uiText('Không có token hoặc phiên còn hiệu lực.')}</div> : <div className="table-wrap"><table className="table">
          <thead><tr><th>{uiText('Loại')}</th><th>{uiText('Người dùng')}</th><th>{uiText('Ghi chú')}</th><th>{uiText('Tạo lúc')}</th><th>{uiText('Hết hạn')}</th><th><span className="sr-only">{uiText('Thao tác')}</span></th></tr></thead>
          <tbody>{tokens.map((token) => <tr key={token.id}><td><span className="badge plain">{token.kind === 'api' ? uiText('API đầy đủ') : token.kind === 'scoped_api' ? uiText('API giới hạn') : uiText('Phiên')}</span></td><td>{users.find((user) => user.id === token.userId)?.name || token.userId}</td><td>{token.label || '—'}{token.kind === 'scoped_api' && <div className="small muted">{Array.isArray(token.scopes) ? token.scopes.join(' · ') : uiText('Không có quyền')}</div>}</td><td className="nowrap">{fmtDateTime(token.createdAt)}</td><td>{token.expiresAt ? fmtDateTime(token.expiresAt) : uiText('Không')}</td><td className="right"><button className="btn btn-sm" type="button" disabled={Boolean(busy)} onClick={() => revoke(token)}>{uiText('Thu hồi')}</button></td></tr>)}</tbody>
        </table></div>}
      </section>
    </section>
  </div>;
}
