import React, { useCallback, useEffect, useState } from 'react';
import { useDocumentTitle } from '../../lib/useDocumentTitle.js';
import { api, tenantPath } from '../../lib/api.js';
import { fmtDateTime, uiText } from '../../lib/i18n.js';
import { app } from '../../lib/state.js';
import { useMfaSettingsWorkflow } from './hooks/useMfaSettingsWorkflow.js';
export default function MfaSettingsPage() {
  useDocumentTitle(`${uiText('Bảo mật tài khoản')} · OSP Suite`);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');
  const [sessions, setSessions] = useState([]);
  const reload = useCallback(async () => {
    setError('');
    try {
      const [nextStatus, nextSessions] = await Promise.all([
        api(tenantPath('/auth/mfa/status')),
        api(tenantPath('/auth/sessions')),
      ]);
      setStatus(nextStatus); setSessions(nextSessions);
    }
    catch (reason) { setError(reason.message || uiText('Không tải được trạng thái bảo mật.')); }
  }, []);
  useEffect(() => {  reload(); }, [reload]);
  const {
    notice, busy, password, setPassword, code, setCode, setup, recoveryCodes,
    startSetup, confirmSetup, disableMfa, revokeOtherSessions,
    copyRecoveryCodes, cancelSetup, hideRecoveryCodes,
  } = useMfaSettingsWorkflow({ reload, setStatus, setError });
  return <div className="page">
    <div className="page-head"><div><h1>{uiText('Bảo mật tài khoản')}</h1><p className="sub">{uiText('Thêm mã xác thực cho lần đăng nhập bằng mật khẩu. Mã khôi phục chỉ dùng một lần.')}</p></div></div>
    {error && <div className="alert danger" role="alert">{uiText(error)}</div>}
    {notice && <div className="alert success" role="status">{uiText(notice)}</div>}
    <section className="card stack">
      <div className="card-head"><h2>{uiText('Phiên đăng nhập')}</h2><span className="badge plain">{sessions.length} {uiText('phiên')}</span></div>
      <p className="muted">{uiText('Xem các phiên trình duyệt đang hoạt động. Khi thu hồi, phiên khác sẽ bị đăng xuất ở yêu cầu tiếp theo.')}</p>
      {!sessions.length ? <p className="small muted">{uiText('Không có phiên trình duyệt đang hoạt động.')}</p> : <div className="table-wrap"><table className="table">
        <thead><tr><th>{uiText('Phiên')}</th><th>{uiText('Bắt đầu')}</th><th>{uiText('Hết hạn')}</th></tr></thead>
        <tbody>{sessions.map((item) => <tr key={item.id}>
          <td>{item.current ? <span className="badge success">{uiText('Thiết bị này')}</span> : <span className="badge plain">{item.label || uiText('Trình duyệt')}</span>}</td>
          <td>{fmtDateTime(item.createdAt)}</td>
          <td>{item.expiresAt ? fmtDateTime(item.expiresAt) : uiText('Không hết hạn')}</td>
        </tr>)}</tbody>
      </table></div>}
      {sessions.some((item) => !item.current) && <div><button className="btn btn-secondary" type="button" disabled={busy} onClick={revokeOtherSessions}>{uiText('Đăng xuất các phiên khác')}</button></div>}
    </section>
    {!status ? <div className="card-pad"><div className="skeleton" data-h="row" /></div> : <section className="card stack">
      <div className="card-head"><h2>{uiText('Xác thực hai lớp')}</h2><span className={`badge ${status.enabled ? 'success' : 'plain'}`}>{status.enabled ? uiText('Đang bật') : uiText('Đang tắt')}</span></div>
      {status.enabled && <p className="muted">{uiText('Còn')} {status.recoveryCodesRemaining} {uiText('mã khôi phục. Bật MFA sẽ thu hồi các phiên khác và API token.')}</p>}
      {!app.user?.hasPassword && <div className="alert">{uiText('Tài khoản máy không có mật khẩu đăng nhập tương tác, vì vậy không thể bật TOTP.')}</div>}
      {recoveryCodes.length > 0 && <div className="card card-pad stack">
        <div><h3>{uiText('Lưu mã khôi phục')}</h3><p className="small muted">{uiText('Mỗi mã chỉ dùng được một lần. Chúng sẽ không hiển thị lại sau khi rời trang.')}</p></div>
        <div className="kv mono">{recoveryCodes.map((item) => <code className="chip" key={item}>{item}</code>)}</div>
        <div><button className="btn btn-secondary" type="button" onClick={copyRecoveryCodes}>{uiText('Sao chép mã')}</button><button className="btn" type="button" onClick={hideRecoveryCodes}>{uiText('Đã lưu, ẩn mã')}</button></div>
      </div>}
      {!status.enabled && !setup && app.user?.hasPassword && <form className="stack" onSubmit={startSetup}>
        <p>{uiText('Ứng dụng tương thích TOTP như Google Authenticator, Microsoft Authenticator hoặc 1Password có thể dùng mã này.')}</p>
        <label className="field"><span className="label">{uiText('Mật khẩu hiện tại')}</span><input className="input" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        <div><button className="btn btn-primary" disabled={busy || password.length < 8}>{busy ? uiText('Đang tạo mã…') : uiText('Bắt đầu thiết lập')}</button></div>
      </form>}
      {setup && <div className="stack">
        <div className="alert">{uiText('Thêm tài khoản bằng cách nhập khóa này vào ứng dụng xác thực. Khóa chỉ hiển thị trong phiên thiết lập 10 phút.')}</div>
        <label className="field"><span className="label">{uiText('Khóa TOTP')}</span><code className="input mono u-block-break-words" >{setup.secret}</code></label>
        <details><summary>{uiText('Liên kết otpauth')}</summary><p className="small mono u-break-words" >{setup.otpauthUrl}</p></details>
        <form className="stack" onSubmit={confirmSetup}>
          <label className="field"><span className="label">{uiText('Mã 6 chữ số trong ứng dụng')}</span><input className="input mono" autoComplete="one-time-code" inputMode="numeric" maxLength="6" required value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} /></label>
          <div className="row"><button className="btn btn-primary" disabled={busy || code.length !== 6}>{busy ? uiText('Đang xác minh…') : uiText('Bật xác thực hai lớp')}</button><button className="btn" type="button" disabled={busy} onClick={cancelSetup}>{uiText('Hủy')}</button></div>
        </form>
      </div>}
      {status.enabled && <form className="stack" onSubmit={disableMfa}>
        <h3>{uiText('Tắt xác thực hai lớp')}</h3>
        <label className="field"><span className="label">{uiText('Mật khẩu hiện tại')}</span><input className="input" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        <label className="field"><span className="label">{uiText('Mã TOTP hoặc mã khôi phục')}</span><input className="input mono" autoComplete="one-time-code" required value={code} onChange={(event) => setCode(event.target.value)} /></label>
        <div><button className="btn btn-danger" disabled={busy || password.length < 8 || !code.trim()}>{busy ? uiText('Đang tắt…') : uiText('Tắt xác thực hai lớp')}</button></div>
      </form>}
    </section>}
  </div>;
}
