import React, { useEffect, useState } from 'react';
import { useDocumentTitle } from '../../lib/useDocumentTitle.js';
import { api, dataPath, session, tenantPath } from '../../lib/api.js';
import { confirmDialog } from '../../lib/feedback.js';
import { fmtDateTime, uiTextWith } from '../../lib/i18n.js';
import { app, can } from '../../lib/state.js';
import integrationEnglish from './integration.en.js';
import { useIntegrationHubData } from './hooks/useIntegrationHubData.js';
const t = (text) => uiTextWith(text, integrationEnglish);
const eventExamples = ['sales.sales_order.confirmed', 'inventory.stock_move.created'];
const connectorConfigs = {
  http_event_sink: '{\n  "adapter": "http_event_sink",\n  "url": "https://api.example.com/osp/events",\n  "events": ["sales.*"],\n  "headers": {},\n  "secret": ""\n}',
  casso_bank_feed: '{\n  "adapter": "casso_bank_feed",\n  "app_id": "",\n  "app_secret": ""\n}',
  sepay_bank_feed: '{\n  "adapter": "sepay_bank_feed",\n  "environment": "sandbox",\n  "api_token": "",\n  "bank_account_id": ""\n}',
  plaid_bank_feed: '{\n  "adapter": "plaid_bank_feed",\n  "environment": "sandbox",\n  "client_id": "",\n  "secret": "",\n  "country_codes": ["US"]\n}',
  salt_edge_bank_feed: '{\n  "adapter": "salt_edge_bank_feed",\n  "app_id": "",\n  "secret": ""\n}',
  carrier_tracking_webhook: '{\n  "adapter": "carrier_tracking_webhook",\n  "carrier_name": "VNPost",\n  "secret_env": "OSP_CARRIER_WEBHOOK_SECRET_VNPOST"\n}',
};
function ensurePlaidLinkSdk() {
  if (window.Plaid?.create) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let script = document.querySelector('script[data-plaid-link-sdk]');
    if (!script) {
      script = document.createElement('script');
      script.src = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';
      script.async = true;
      script.dataset.plaidLinkSdk = 'true';
      document.head.appendChild(script);
    }
    script.addEventListener('load', () => window.Plaid?.create ? resolve() : reject(new Error('Plaid Link could not be initialized.')), { once: true });
    script.addEventListener('error', () => reject(new Error('Could not load Plaid Link.')), { once: true });
  });
}
export default function IntegrationHubPage() {
  useDocumentTitle(`${t('Cổng tích hợp')} · OSP Suite`);
  const { connectors, webhooks, loading, error, setError, load } = useIntegrationHubData();
  const [connectorForm, setConnectorForm] = useState({ name: '', kind: '', config: connectorConfigs.http_event_sink });
  const [connectorAdapter, setConnectorAdapter] = useState('http_event_sink');
  const [plaidAccounts, setPlaidAccounts] = useState({});
  const [saltEdgeAccounts, setSaltEdgeAccounts] = useState({});
  const [webhookForm, setWebhookForm] = useState({ url: '', events: '', secret: '' });
  const [eventSearch, setEventSearch] = useState('');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connectorId = params.get('salt_edge_connector');
    const connectionId = params.get('connection_id');
    const errorClass = params.get('error_class');
    if (!connectorId || (!connectionId && !errorClass)) return;
    const cleaned = new URL(window.location.href);
    ['salt_edge_connector', 'connection_id', 'error_class'].forEach((key) => cleaned.searchParams.delete(key));
    window.history.replaceState({}, '', `${cleaned.pathname}${cleaned.search}${cleaned.hash}`);
    if (errorClass || !connectionId) {
      setError(t(`Salt Edge could not complete the bank connection${errorClass ? ` (${errorClass})` : ''}.`));
      return;
    }
    (async () => {
      setBusy(`${connectorId}:salt-edge-complete`); setError('');
      try {
        await api(tenantPath(`/connectors/${connectorId}/salt-edge/complete`), { method: 'POST', body: { connectionId } });
        const result = await api(tenantPath(`/connectors/${connectorId}/salt-edge/accounts`));
        setSaltEdgeAccounts((current) => ({ ...current, [connectorId]: result.accounts || [] }));
        await load();
        setNotice(t('Salt Edge bank linked. Set its account ID as bank_account_id on the matching ledger account.'));
      } catch (reason) { setError(reason.message || t('Could not complete Salt Edge bank connection.')); }
      finally { setBusy(''); }
    })();
  }, []);
  const availableEvents = app.meta?.events || [];
  async function run(key, operation, success) {
    setBusy(key); setError(''); setNotice('');
    try { await operation(); await load(true); setNotice(t(success)); }
    catch (reason) { setError(t(reason.message || 'Thao tác không thành công.')); }
    finally { setBusy(''); }
  }
  async function createConnector(event) {
    event.preventDefault();
    let config;
    try { config = connectorForm.config.trim() ? JSON.parse(connectorForm.config) : {}; }
    catch { setError(t('Cấu hình connector phải là JSON hợp lệ.')); return; }
    if (!config || Array.isArray(config) || typeof config !== 'object') { setError(t('Cấu hình connector phải là một đối tượng JSON.')); return; }
    if (config.adapter !== connectorAdapter) { setError(t('Adapter trong cấu hình phải khớp loại connector đã chọn.')); return; }
    await run('connector:create', async () => {
      await api(dataPath('integration-hub.connector'), { method: 'POST', body: { name: connectorForm.name.trim(), kind: connectorForm.kind.trim(), config, enabled: true } });
      setConnectorForm({ name: '', kind: '', config: connectorConfigs.http_event_sink });
      setConnectorAdapter('http_event_sink');
    }, 'Đã thêm connector.');
  }
  async function connectPlaid(row) {
    setBusy(`${row.id}:plaid`); setError(''); setNotice('');
    try {
      const { linkToken } = await api(tenantPath(`/connectors/${row.id}/plaid/link-token`), { method: 'POST', body: {} });
      await ensurePlaidLinkSdk();
      await new Promise((resolve, reject) => {
        let finished = false;
        const finish = () => { if (!finished) { finished = true; resolve(); } };
        const handler = window.Plaid.create({
          token: linkToken,
          onSuccess: async (publicToken, metadata) => {
            try {
              await api(tenantPath(`/connectors/${row.id}/plaid/exchange`), { method: 'POST', body: { publicToken } });
              await load();
              try {
                const result = await api(tenantPath(`/connectors/${row.id}/plaid/accounts`));
                setPlaidAccounts((current) => ({ ...current, [row.id]: result.accounts || [] }));
              } catch {
                const accounts = (metadata?.accounts || []).map((account) => ({ accountId: account.id, name: account.name, mask: account.mask, type: account.type, subtype: account.subtype }));
                setPlaidAccounts((current) => ({ ...current, [row.id]: accounts }));
              }
              setNotice(t('Đã liên kết ngân hàng Plaid. Dùng account ID bên dưới làm bank_account_id trên tài khoản sổ cái.'));
              finish();
            } catch (reason) { reject(reason); }
          },
          onExit: (linkError) => {
            if (linkError) setError(linkError.display_message || linkError.error_message || t('Không thể hoàn tất kết nối Plaid.'));
            finish();
          },
        });
        handler.open();
      });
    } catch (reason) { setError(reason.message || t('Không thể hoàn tất kết nối Plaid.')); }
    finally { setBusy(''); }
  }
  async function loadPlaidAccounts(row) {
    setBusy(`${row.id}:plaid-accounts`); setError('');
    try {
      const result = await api(tenantPath(`/connectors/${row.id}/plaid/accounts`));
      setPlaidAccounts((current) => ({ ...current, [row.id]: result.accounts || [] }));
    } catch (reason) { setError(reason.message || t('Không thể tải tài khoản Plaid.')); }
    finally { setBusy(''); }
  }
  async function disconnectPlaid(row) {
    if (!await confirmDialog({ title: t('Disconnect Plaid'), message: t('Revoke Plaid access and remove this linked bank Item?'), danger: true, confirmLabel: t('Disconnect bank') })) return;
    setBusy(`${row.id}:plaid-disconnect`); setError(''); setNotice('');
    try {
      await api(tenantPath(`/connectors/${row.id}/plaid/disconnect`), { method: 'POST', body: {} });
      setPlaidAccounts((current) => { const next = { ...current }; delete next[row.id]; return next; });
      setNotice(t('Plaid bank disconnected.'));
      await load();
    } catch (reason) { setError(reason.message || t('Could not disconnect Plaid.')); }
    finally { setBusy(''); }
  }
  async function connectSaltEdge(row) {
    setBusy(`${row.id}:salt-edge`); setError(''); setNotice('');
    try {
      const returnUrl = new URL(window.location.href);
      returnUrl.searchParams.set('salt_edge_connector', row.id);
      const { connectUrl } = await api(tenantPath(`/connectors/${row.id}/salt-edge/connect`), { method: 'POST', body: { returnTo: returnUrl.toString() } });
      window.location.assign(connectUrl);
    } catch (reason) { setError(reason.message || t('Could not start Salt Edge bank connection.')); setBusy(''); }
  }
  async function loadSaltEdgeAccounts(row) {
    setBusy(`${row.id}:salt-edge-accounts`); setError('');
    try {
      const result = await api(tenantPath(`/connectors/${row.id}/salt-edge/accounts`));
      setSaltEdgeAccounts((current) => ({ ...current, [row.id]: result.accounts || [] }));
    } catch (reason) { setError(reason.message || t('Could not load Salt Edge accounts.')); }
    finally { setBusy(''); }
  }
  async function disconnectSaltEdge(row) {
    if (!await confirmDialog({ title: t('Disconnect Salt Edge'), message: t('Remove the linked bank connection from Salt Edge?'), danger: true, confirmLabel: t('Disconnect bank') })) return;
    setBusy(`${row.id}:salt-edge-disconnect`); setError(''); setNotice('');
    try {
      await api(tenantPath(`/connectors/${row.id}/salt-edge/disconnect`), { method: 'POST', body: {} });
      setSaltEdgeAccounts((current) => { const next = { ...current }; delete next[row.id]; return next; });
      setNotice(t('Salt Edge bank disconnected.'));
      await load();
    } catch (reason) { setError(reason.message || t('Could not disconnect Salt Edge.')); }
    finally { setBusy(''); }
  }
  async function createWebhook(event) {
    event.preventDefault();
    const events = webhookForm.events.split(/[\n,;]/).map((value) => value.trim()).filter(Boolean);
    if (!events.length) { setError(t('Hãy nhập ít nhất một loại sự kiện webhook nhận.')); return; }
    await run('webhook:create', async () => {
      await api(dataPath('integration-hub.webhook'), { method: 'POST', body: {
        url: webhookForm.url.trim(), events, active: true,
        ...(webhookForm.secret ? { secret: webhookForm.secret } : {}),
      } });
      setWebhookForm({ url: '', events: '', secret: '' });
    }, 'Đã tạo webhook. Bí mật ký chỉ được nhập lúc tạo và không hiển thị trong danh sách.');
  }
  function addCatalogEvent() {
    const eventType = eventSearch.trim();
    if (!eventType || !availableEvents.includes(eventType)) return;
    const selected = webhookForm.events.split(/[\n,;]/).map((value) => value.trim()).filter(Boolean);
    if (!selected.includes(eventType)) selected.push(eventType);
    setWebhookForm((current) => ({ ...current, events: selected.join('\n') }));
    setEventSearch('');
  }
  async function toggle(entity, row, field) {
    const next = !(row[field] === true);
    await run(`${row.id}:${field}`, () => api(dataPath(entity, row.id), { method: 'PATCH', body: { [field]: next } }), next ? 'Đã bật cấu hình.' : 'Đã tạm ngưng cấu hình.');
  }
  return <div className="page">
    <div className="page-head"><div><h1>{t('Cổng tích hợp')}</h1><p className="sub">{t('Quản lý connector và webhook để kết nối OSP với dịch vụ bên ngoài. Giao nhận webhook được theo dõi riêng trong Cài đặt → Outbox.')}</p></div><button className="btn btn-secondary" type="button" disabled={loading || Boolean(busy)} onClick={() => load()}>{t('Làm mới')}</button></div>
    {error && <div className="alert danger" role="alert">{t(error)}</div>}{notice && <div className="alert success" role="status">{t(notice)}</div>}
    {(can('integration-hub.connector.create') || can('integration-hub.webhook.create')) && <div className="two-col">
      {can('integration-hub.connector.create') && <section className="card card-pad"><h2>{t("Thêm connector")}</h2><p className="small muted">{t("Chọn adapter HTTP gửi sự kiện ra ngoài hoặc một nhà cung cấp để đồng bộ giao dịch ngân hàng vào sao kê.")}</p><form className="form-grid" onSubmit={createConnector}>
        <label className="field full"><span className="label">{t("Adapter")}</span><select className="select" value={connectorAdapter} onChange={(event) => { const adapter = event.target.value; setConnectorAdapter(adapter); setConnectorForm((form) => ({ ...form, kind: adapter === 'carrier_tracking_webhook' ? 'carrier' : form.kind, config: connectorConfigs[adapter] })); }}><option value="http_event_sink">{t("HTTP event sink")}</option><option value="casso_bank_feed">{t("Casso Flow v3 bank feed")}</option><option value="sepay_bank_feed">{t("SePay API v2 bank feed")}</option><option value="plaid_bank_feed">{t("Plaid international bank feed")}</option><option value="salt_edge_bank_feed">{t("Salt Edge international bank feed")}</option><option value="carrier_tracking_webhook">{t("Carrier tracking webhook")}</option></select></label>
        <label className="field"><span className="label">{t('Tên hiển thị *')}</span><input className="input" required maxLength="120" value={connectorForm.name} onChange={(event) => setConnectorForm({ ...connectorForm, name: event.target.value })}/></label>
        <label className="field"><span className="label">{t('Nhà cung cấp / mục đích *')}</span><input className="input" required maxLength="64" placeholder="bank, carrier, einvoice, crm" value={connectorForm.kind} onChange={(event) => setConnectorForm({ ...connectorForm, kind: event.target.value })}/></label>
        <label className="field full"><span className="label">{t("Cấu hình JSON")}</span><textarea className="input mono" rows="8" spellCheck="false" value={connectorForm.config} onChange={(event) => setConnectorForm({ ...connectorForm, config: event.target.value })}/><p className="hint">{connectorAdapter === "casso_bank_feed" ? t("Nhập app_id và app_secret từ Casso Open Platform; app_secret được che khi đọc lại. Cần scope flow:transaction:read.") : connectorAdapter === "sepay_bank_feed" ? t("SePay API v2: chọn sandbox để thử hoặc production để chạy thật; nhập API token 64 ký tự và bank account UUID trong SePay. Token được che khi đọc lại. Trên tài khoản kế toán, cấu hình bank_account_id bằng số tài khoản ngân hàng.") : connectorAdapter === "plaid_bank_feed" ? t("Plaid kết nối qua Plaid Link; nhập client_id, secret, môi trường và country_codes được tài khoản Plaid cho phép. Kết nối một ngân hàng bằng nút Connect, rồi chọn account ID trả về để điền bank_account_id trên tài khoản sổ cái. Plaid không hỗ trợ ngân hàng Việt Nam.") : connectorAdapter === "salt_edge_bank_feed" ? t("Salt Edge Account Information API v6: nhập App ID và Secret từ Salt Edge Dashboard. Secret được che khi đọc lại. OSP_PUBLIC_URL phải là HTTPS và cùng origin với URL trả về; cấu hình callback URLs trên Salt Edge Dashboard nếu cần nhận cập nhật nền. Kết nối ngân hàng rồi điền account ID vào bank_account_id trên tài khoản sổ cái. Ngân hàng hiển thị tùy theo quốc gia và quyền truy cập dự án Salt Edge.") : connectorAdapter === "carrier_tracking_webhook" ? t("Chỉ nhận cập nhật tracking. Đặt secret 16–256 byte trong biến môi trường máy chủ có tên OSP_CARRIER_WEBHOOK_SECRET_... rồi lưu tên biến vào secret_env; không nhập secret thật vào JSON. Hãng phải gửi X-OSP-Signature: sha256=<HMAC-SHA256 của body JSON gốc>.") : t("Cần URL HTTPS công khai, events và header xác thực. Secret được che khi đọc lại.")}</p></label>
        <div className="row full"><span className="grow"/><button className="btn btn-primary" disabled={Boolean(busy)}>{t('Thêm connector')}</button></div>
      </form></section>}
      {can('integration-hub.webhook.create') && <section className="card card-pad"><h2>{t('Đăng ký webhook')}</h2><p className="small muted">{t('OSP sẽ gửi payload sự kiện đã đăng ký qua HTTPS và ký payload bằng HMAC SHA-256 nếu có bí mật.')}</p><form className="form-grid" onSubmit={createWebhook}>
        <label className="field full"><span className="label">{t('URL HTTPS *')}</span><input className="input" required type="url" placeholder="https://example.com/osp/events" value={webhookForm.url} onChange={(event) => setWebhookForm({ ...webhookForm, url: event.target.value })}/></label>
        <label className="field full"><span className="label">{t('Chọn sự kiện từ danh mục')}</span><div className="row"><input className="input grow" list="integration-event-catalog" placeholder={t("Tìm tên sự kiện, ví dụ sales.sales_order.confirmed")} value={eventSearch} onChange={(event) => setEventSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addCatalogEvent(); } }}/><button className="btn btn-secondary" type="button" disabled={!availableEvents.includes(eventSearch.trim())} onClick={addCatalogEvent}>{t('Thêm sự kiện')}</button><datalist id="integration-event-catalog">{availableEvents.map((eventType) => <option key={eventType} value={eventType}/>)}</datalist></div><span className="small muted">{t('Danh mục chỉ gồm sự kiện của module đang bật trong doanh nghiệp này.')}</span></label>
        <label className="field full"><span className="label">{t('Sự kiện nhận *')}</span><textarea className="input" rows="4" required placeholder={eventExamples.join('\n')} value={webhookForm.events} onChange={(event) => setWebhookForm({ ...webhookForm, events: event.target.value })}/><span className="small muted">{t('Phân cách bằng dấu phẩy hoặc xuống dòng; hỗ trợ wildcard như sales.*')}</span></label>
        <label className="field full"><span className="label">{t('Bí mật ký (tùy chọn)')}</span><input className="input" type="password" autoComplete="new-password" minLength="16" maxLength="256" value={webhookForm.secret} onChange={(event) => setWebhookForm({ ...webhookForm, secret: event.target.value })}/></label>
        <div className="row full"><span className="grow"/><button className="btn btn-primary" disabled={Boolean(busy)}>{t('Tạo webhook')}</button></div>
      </form></section>}
    </div>}
    {can('integration-hub.connector.read') && <section className="card card-pad"><h2>{t('Connectors')}</h2>{loading ? <div className="skeleton" data-h="row"/> : !connectors.length ? <div className="empty">{t('Chưa có connector.')}</div> : <div className="table-wrap"><table className="table"><thead><tr><th>{t('Tên')}</th><th>{t('Loại')}</th><th>{t('Trạng thái')}</th><th>{t('Cập nhật')}</th><th><span className="sr-only">{t('Thao tác')}</span></th></tr></thead><tbody>{connectors.map((row) => { const adapter = row.config?.adapter; const runnable = ['http_event_sink', 'casso_bank_feed', 'sepay_bank_feed', 'plaid_bank_feed', 'salt_edge_bank_feed', 'carrier_tracking_webhook'].includes(adapter); const testable = adapter === 'http_event_sink'; const enabled = row.enabled && runnable; const carrierEndpoint = adapter === "carrier_tracking_webhook" ? `${window.location.origin}/api/hooks/carrier/${session.current()?.tenantId}/${row.id}` : ""; return <tr key={row.id}><td><strong>{row.name}</strong>{carrierEndpoint && <div className="mono small muted u-mt-4">{carrierEndpoint}</div>}</td><td><span className="chip neutral">{row.kind}</span></td><td><span className={`badge ${enabled ? 'success' : row.enabled ? 'warning' : 'plain'}`}>{t(enabled ? (adapter === 'http_event_sink' ? 'Đang gửi' : adapter === 'plaid_bank_feed' ? (row.config?.item_id ? 'Linked' : 'Connect required') : adapter === 'salt_edge_bank_feed' ? (row.config?.connection_id ? 'Linked' : 'Connect required') : adapter === 'carrier_tracking_webhook' ? 'Nhận tracking' : 'Đã cấu hình') : row.enabled ? 'Thiếu adapter' : 'Đã tắt')}</span></td><td>{fmtDateTime(row.updatedAt || row.createdAt)}</td><td className="right">{can('tenant.admin') && testable && <button className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => run(`${row.id}:test`, () => api(tenantPath(`/connectors/${row.id}/test`), { method: 'POST', body: {} }), 'Đã kết nối thử thành công.')}>{t('Gửi thử')}</button>} {can('integration-hub.connector.update') && row.enabled && adapter === 'plaid_bank_feed' && !row.config?.item_id && <button className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => connectPlaid(row)}>{t('Connect bank')}</button>} {can('integration-hub.connector.read') && adapter === 'plaid_bank_feed' && row.config?.item_id && <button className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => loadPlaidAccounts(row)}>{t('Plaid accounts')}</button>} {can('integration-hub.connector.update') && adapter === 'plaid_bank_feed' && row.config?.item_id && <button className="btn btn-ghost btn-sm" disabled={Boolean(busy)} onClick={() => disconnectPlaid(row)}>{t('Disconnect bank')}</button>} {can('integration-hub.connector.update') && row.enabled && adapter === 'salt_edge_bank_feed' && !row.config?.connection_id && <button className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => connectSaltEdge(row)}>{t('Connect bank')}</button>} {can('integration-hub.connector.read') && adapter === 'salt_edge_bank_feed' && row.config?.connection_id && <button className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => loadSaltEdgeAccounts(row)}>{t('Salt Edge accounts')}</button>} {can('integration-hub.connector.update') && adapter === 'salt_edge_bank_feed' && row.config?.connection_id && <button className="btn btn-ghost btn-sm" disabled={Boolean(busy)} onClick={() => disconnectSaltEdge(row)}>{t('Disconnect bank')}</button>} {can('integration-hub.connector.update') && <button className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => toggle('integration-hub.connector', row, 'enabled')}>{t(row.enabled ? 'Tạm ngưng' : 'Bật lại')}</button>}</td></tr>; })}</tbody></table></div>}</section>}
    {Object.entries(plaidAccounts).map(([connectorId, accounts]) => <section className="card card-pad" key={connectorId}><h2>{t('Plaid accounts')}</h2><p className="small muted">{t('Set the account ID as bank_account_id on the matching ledger bank account.')}</p>{accounts.length === 0 ? <div className="empty">{t('Plaid returned no transaction accounts.')}</div> : <div className="table-wrap"><table className="table"><thead><tr><th>{t('Account name')}</th><th>{t('Type')}</th><th>{t('Mask')}</th><th>{t('Account ID')}</th></tr></thead><tbody>{accounts.map((account) => <tr key={account.accountId}><td>{account.officialName || account.name}</td><td>{[account.type, account.subtype].filter(Boolean).join(' · ')}</td><td>{account.mask || '—'}</td><td className="mono small">{account.accountId}</td></tr>)}</tbody></table></div>}</section>)}
    {Object.entries(saltEdgeAccounts).map(([connectorId, accounts]) => <section className="card card-pad" key={connectorId}><h2>{t('Salt Edge accounts')}</h2><p className="small muted">{t('Set the account ID as bank_account_id on the matching ledger bank account.')}</p>{accounts.length === 0 ? <div className="empty">{t('Salt Edge returned no accounts.')}</div> : <div className="table-wrap"><table className="table"><thead><tr><th>{t('Account name')}</th><th>{t('Type')}</th><th>{t('Currency')}</th><th>{t('Account ID')}</th></tr></thead><tbody>{accounts.map((account) => <tr key={account.accountId}><td>{account.name || '—'}</td><td>{account.nature || '—'}</td><td>{account.currency || '—'}</td><td className="mono small">{account.accountId}</td></tr>)}</tbody></table></div>}</section>)}
    {can('integration-hub.webhook.read') && <section className="card card-pad"><h2>{t('Webhook gửi sự kiện')}</h2>{loading ? <div className="skeleton" data-h="row"/> : !webhooks.length ? <div className="empty">{t('Chưa đăng ký webhook.')}</div> : <div className="table-wrap"><table className="table"><thead><tr><th>{t('Endpoint')}</th><th>{t('Sự kiện')}</th><th>{t('Trạng thái')}</th><th>{t('Cập nhật')}</th><th><span className="sr-only">{t('Thao tác')}</span></th></tr></thead><tbody>{webhooks.map((row) => <tr key={row.id}><td className="mono small">{row.url}</td><td>{Array.isArray(row.events) ? row.events.join(', ') : t('Chưa chọn sự kiện')}</td><td><span className={`badge ${row.active ? 'success' : 'plain'}`}>{t(row.active ? 'Đang gửi' : 'Đã tắt')}</span></td><td>{fmtDateTime(row.updatedAt || row.createdAt)}</td><td className="right">{can('tenant.admin') && <button className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => run(`${row.id}:test`, () => api(tenantPath(`/webhooks/${row.id}/test`), { method: 'POST', body: {} }), 'Đã gửi thử thành công.')}>{t('Gửi thử')}</button>} {can('integration-hub.webhook.update') && <button className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => toggle('integration-hub.webhook', row, 'active')}>{t(row.active ? 'Tạm ngưng' : 'Bật lại')}</button>}</td></tr>)}</tbody></table></div>}</section>}
    <p className="small muted">{t('Ví dụ sự kiện:')} {eventExamples.join(' · ')}. {t('Theo dõi và thử lại lần gửi tới webhook hoặc connector trong')} <a href="#/settings/outbox">{t('Outbox tích hợp')}</a>. {can('tenant.admin') && <>{t('Tạo token tích hợp giới hạn quyền tại')} <a href="#/settings/tokens">{t('Cài đặt API token')}</a>.</>}</p>
  </div>;
}
