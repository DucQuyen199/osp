import { useEffect, useState } from 'react';
import { api, dataPath, tenantPath } from '../../../lib/api.js';
import { confirmDialog } from '../../../lib/feedback.js';
import { app } from '../../../lib/state.js';
import { uiTextWith } from '../../../lib/i18n.js';
import integrationEnglish from '../integration.en.js';

const t = (text) => uiTextWith(text, integrationEnglish);

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

export function useIntegrationHubWorkflow({ load, setError }) {
  const [connectorForm, setConnectorForm] = useState({ name: '', kind: '', config: connectorConfigs.http_event_sink });
  const [connectorAdapter, setConnectorAdapter] = useState('http_event_sink');
  const [plaidAccounts, setPlaidAccounts] = useState({});
  const [saltEdgeAccounts, setSaltEdgeAccounts] = useState({});
  const [webhookForm, setWebhookForm] = useState({ url: '', events: '', secret: '' });
  const [eventSearch, setEventSearch] = useState('');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const availableEvents = app.meta?.events || [];

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
  }, [load, setError]);

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

  function selectConnectorAdapter(adapter) {
    setConnectorAdapter(adapter);
    setConnectorForm((form) => ({ ...form, kind: adapter === 'carrier_tracking_webhook' ? 'carrier' : form.kind, config: connectorConfigs[adapter] }));
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

  async function testConnector(row) {
    await run(`${row.id}:test`, () => api(tenantPath(`/connectors/${row.id}/test`), { method: 'POST', body: {} }), 'Đã kết nối thử thành công.');
  }

  async function testWebhook(row) {
    await run(`${row.id}:test`, () => api(tenantPath(`/webhooks/${row.id}/test`), { method: 'POST', body: {} }), 'Đã gửi thử thành công.');
  }

  return {
    connectorForm, setConnectorForm, connectorAdapter, selectConnectorAdapter,
    plaidAccounts, saltEdgeAccounts, webhookForm, setWebhookForm, eventSearch, setEventSearch,
    busy, notice, availableEvents, run, createConnector, connectPlaid, loadPlaidAccounts,
    disconnectPlaid, connectSaltEdge, loadSaltEdgeAccounts, disconnectSaltEdge,
    createWebhook, addCatalogEvent, toggle, testConnector, testWebhook,
  };
}
