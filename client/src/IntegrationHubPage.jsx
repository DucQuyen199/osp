import React, { useCallback, useEffect, useState } from 'react';
import { api, dataPath, tenantPath } from './lib/api.js';
import { fmtDateTime } from './lib/i18n.js';
import { app, can, loadAllResponse } from './lib/state.js';

const items = (value) => Array.isArray(value?.items) ? value.items : [];
const eventExamples = ['sales.sales_order.confirmed', 'inventory.stock_move.created'];

export default function IntegrationHubPage() {
  const [connectors, setConnectors] = useState([]);
  const [webhooks, setWebhooks] = useState([]);
  const [connectorForm, setConnectorForm] = useState({ name: '', kind: '', config: '{\n  "adapter": "http_event_sink",\n  "url": "https://api.example.com/osp/events",\n  "events": ["sales.*"],\n  "headers": {},\n  "secret": ""\n}' });
  const [webhookForm, setWebhookForm] = useState({ url: '', events: '', secret: '' });
  const [eventSearch, setEventSearch] = useState('');
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async (quiet = false) => {
    if (!quiet) { setLoading(true); setError(''); }
    try {
      const [connectorRes, webhookRes] = await Promise.all([
        can('integration-hub.connector.read') ? loadAllResponse('integration-hub.connector') : Promise.resolve({ items: [] }),
        can('integration-hub.webhook.read') ? loadAllResponse('integration-hub.webhook') : Promise.resolve({ items: [] }),
      ]);
      setConnectors(items(connectorRes).sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'vi')));
      setWebhooks(items(webhookRes).sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || ''))));
    } catch (reason) { setError(reason.message || 'Không tải được cấu hình tích hợp.'); }
    finally { if (!quiet) setLoading(false); }
  }, []);

  useEffect(() => { document.title = 'Cổng tích hợp · OSP Suite'; load(); }, [load]);

  const availableEvents = app.meta?.events || [];

  async function run(key, operation, success) {
    setBusy(key); setError(''); setNotice('');
    try { await operation(); await load(true); setNotice(success); }
    catch (reason) { setError(reason.message || 'Thao tác không thành công.'); }
    finally { setBusy(''); }
  }

  async function createConnector(event) {
    event.preventDefault();
    let config;
    try { config = connectorForm.config.trim() ? JSON.parse(connectorForm.config) : {}; }
    catch { setError('Cấu hình connector phải là JSON hợp lệ.'); return; }
    if (!config || Array.isArray(config) || typeof config !== 'object') { setError('Cấu hình connector phải là một đối tượng JSON.'); return; }
    await run('connector:create', async () => {
      await api(dataPath('integration-hub.connector'), { method: 'POST', body: { name: connectorForm.name.trim(), kind: connectorForm.kind.trim(), config, enabled: true } });
      setConnectorForm({ name: '', kind: '', config: '{\n  "adapter": "http_event_sink",\n  "url": "https://api.example.com/osp/events",\n  "events": ["sales.*"],\n  "headers": {},\n  "secret": ""\n}' });
    }, 'Đã thêm connector.');
  }

  async function createWebhook(event) {
    event.preventDefault();
    const events = webhookForm.events.split(/[\n,;]/).map((value) => value.trim()).filter(Boolean);
    if (!events.length) { setError('Hãy nhập ít nhất một loại sự kiện webhook nhận.'); return; }
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
    <div className="page-head"><div><h1>Cổng tích hợp</h1><p className="sub">Quản lý connector và webhook để kết nối OSP với dịch vụ bên ngoài. Giao nhận webhook được theo dõi riêng trong Cài đặt → Outbox.</p></div><button className="btn btn-secondary" type="button" disabled={loading || Boolean(busy)} onClick={() => load()}>Làm mới</button></div>
    {error && <div className="alert danger" role="alert">{error}</div>}{notice && <div className="alert success" role="status">{notice}</div>}
    {(can('integration-hub.connector.create') || can('integration-hub.webhook.create')) && <div className="two-col">
      {can('integration-hub.connector.create') && <section className="card card-pad"><h2>Thêm connector HTTP</h2><p className="small muted">Adapter HTTP gửi payload JSON của sự kiện đến API nhà cung cấp, hỗ trợ header xác thực và chữ ký HMAC. Giao nhận có retry và theo dõi trong Outbox.</p><form className="form-grid" onSubmit={createConnector}>
        <label className="field"><span className="label">Tên hiển thị *</span><input className="input" required maxLength="120" value={connectorForm.name} onChange={(event) => setConnectorForm({ ...connectorForm, name: event.target.value })}/></label>
        <label className="field"><span className="label">Nhà cung cấp / mục đích *</span><input className="input" required maxLength="64" placeholder="bank, carrier, einvoice, crm" value={connectorForm.kind} onChange={(event) => setConnectorForm({ ...connectorForm, kind: event.target.value })}/></label>
        <label className="field full"><span className="label">Cấu hình adapter HTTP (JSON)</span><textarea className="input mono" rows="8" spellCheck="false" value={connectorForm.config} onChange={(event) => setConnectorForm({ ...connectorForm, config: event.target.value })}/><p className="hint">Cần adapter=http_event_sink, URL HTTPS công khai, events là danh sách sự kiện hoặc wildcard; headers là object tên/giá trị. Có thể đặt secret để ký X-OSP-Signature. Bí mật sẽ không được trả lại qua API.</p></label>
        <div className="row full"><span className="grow"/><button className="btn btn-primary" disabled={Boolean(busy)}>Thêm connector</button></div>
      </form></section>}
      {can('integration-hub.webhook.create') && <section className="card card-pad"><h2>Đăng ký webhook</h2><p className="small muted">OSP sẽ gửi payload sự kiện đã đăng ký qua HTTPS và ký payload bằng HMAC SHA-256 nếu có bí mật.</p><form className="form-grid" onSubmit={createWebhook}>
        <label className="field full"><span className="label">URL HTTPS *</span><input className="input" required type="url" placeholder="https://example.com/osp/events" value={webhookForm.url} onChange={(event) => setWebhookForm({ ...webhookForm, url: event.target.value })}/></label>
        <label className="field full"><span className="label">Chọn sự kiện từ danh mục</span><div className="row"><input className="input grow" list="integration-event-catalog" placeholder="Tìm tên sự kiện, ví dụ sales.sales_order.confirmed" value={eventSearch} onChange={(event) => setEventSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addCatalogEvent(); } }}/><button className="btn btn-secondary" type="button" disabled={!availableEvents.includes(eventSearch.trim())} onClick={addCatalogEvent}>Thêm sự kiện</button><datalist id="integration-event-catalog">{availableEvents.map((eventType) => <option key={eventType} value={eventType}/>)}</datalist></div><span className="small muted">Danh mục chỉ gồm sự kiện của module đang bật trong doanh nghiệp này.</span></label>
        <label className="field full"><span className="label">Sự kiện nhận *</span><textarea className="input" rows="4" required placeholder={eventExamples.join('\n')} value={webhookForm.events} onChange={(event) => setWebhookForm({ ...webhookForm, events: event.target.value })}/><span className="small muted">Phân cách bằng dấu phẩy hoặc xuống dòng; hỗ trợ wildcard như sales.*</span></label>
        <label className="field full"><span className="label">Bí mật ký (tùy chọn)</span><input className="input" type="password" autoComplete="new-password" minLength="16" maxLength="256" value={webhookForm.secret} onChange={(event) => setWebhookForm({ ...webhookForm, secret: event.target.value })}/></label>
        <div className="row full"><span className="grow"/><button className="btn btn-primary" disabled={Boolean(busy)}>Tạo webhook</button></div>
      </form></section>}
    </div>}

    {can('integration-hub.connector.read') && <section className="card card-pad"><h2>Connectors</h2>{loading ? <div className="skeleton" data-h="row"/> : !connectors.length ? <div className="empty">Chưa có connector.</div> : <div className="table-wrap"><table className="table"><thead><tr><th>Tên</th><th>Loại</th><th>Trạng thái</th><th>Cập nhật</th><th/></tr></thead><tbody>{connectors.map((row) => { const runnable = row.config?.adapter === 'http_event_sink'; const enabled = row.enabled && runnable; return <tr key={row.id}><td><strong>{row.name}</strong></td><td><span className="chip neutral">{row.kind}</span></td><td><span className={`badge ${enabled ? 'success' : row.enabled ? 'warning' : 'plain'}`}>{enabled ? 'Đang gửi' : row.enabled ? 'Thiếu adapter' : 'Đã tắt'}</span></td><td>{fmtDateTime(row.updatedAt || row.createdAt)}</td><td className="right">{can('tenant.admin') && runnable && <button className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => run(`${row.id}:test`, () => api(tenantPath(`/connectors/${row.id}/test`), { method: 'POST', body: {} }), 'Đã kết nối thử thành công.')}>Gửi thử</button>} {can('integration-hub.connector.update') && <button className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => toggle('integration-hub.connector', row, 'enabled')}>{row.enabled ? 'Tạm ngưng' : 'Bật lại'}</button>}</td></tr>; })}</tbody></table></div>}</section>}

    {can('integration-hub.webhook.read') && <section className="card card-pad"><h2>Webhook gửi sự kiện</h2>{loading ? <div className="skeleton" data-h="row"/> : !webhooks.length ? <div className="empty">Chưa đăng ký webhook.</div> : <div className="table-wrap"><table className="table"><thead><tr><th>Endpoint</th><th>Sự kiện</th><th>Trạng thái</th><th>Cập nhật</th><th/></tr></thead><tbody>{webhooks.map((row) => <tr key={row.id}><td className="mono small">{row.url}</td><td>{Array.isArray(row.events) ? row.events.join(', ') : 'Chưa chọn sự kiện'}</td><td><span className={`badge ${row.active ? 'success' : 'plain'}`}>{row.active ? 'Đang gửi' : 'Đã tắt'}</span></td><td>{fmtDateTime(row.updatedAt || row.createdAt)}</td><td className="right">{can('tenant.admin') && <button className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => run(`${row.id}:test`, () => api(tenantPath(`/webhooks/${row.id}/test`), { method: 'POST', body: {} }), 'Đã gửi thử thành công.')}>Gửi thử</button>} {can('integration-hub.webhook.update') && <button className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => toggle('integration-hub.webhook', row, 'active')}>{row.active ? 'Tạm ngưng' : 'Bật lại'}</button>}</td></tr>)}</tbody></table></div>}</section>}
    <p className="small muted">Ví dụ sự kiện: {eventExamples.join(' · ')}. Theo dõi và thử lại lần gửi tới webhook hoặc connector trong <a href="#/settings/outbox">Outbox tích hợp</a>. {can('tenant.admin') && <>Tạo token tích hợp giới hạn quyền tại <a href="#/settings/tokens">Cài đặt API token</a>.</>}</p>
  </div>;
}
