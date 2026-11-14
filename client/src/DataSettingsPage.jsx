import React, { useState } from 'react';
import { api, session, tenantPath } from './lib/api.js';
import { toast } from './lib/feedback.js';
import { app, can, entityLabel } from './lib/state.js';
import EntityImportDialog from './EntityImportDialog.jsx';
import SettingsTabs from './SettingsTabs.jsx';

function downloadBlob(blob, filename) {
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(href), 1000);
}

export default function DataSettingsPage() {
  const entities = [...app.entities.keys()];
  const [exportEntity, setExportEntity] = useState(entities[0] || '');
  const [importEntity, setImportEntity] = useState(entities[0] || '');
  const [importOpen, setImportOpen] = useState(false);
  const [deleteName, setDeleteName] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const exportData = async (path, filename) => {
    setBusy(path);
    setError('');
    try {
      const response = await api(tenantPath(path), { raw: true });
      downloadBlob(await response.blob(), filename);
      toast('Đã xuất dữ liệu.', 'success');
    } catch (reason) { setError(reason.message || 'Không xuất được dữ liệu.'); }
    finally { setBusy(''); }
  };

  const deleteTenant = async (event) => {
    event.preventDefault();
    if (deleteName !== app.meta.name) return;
    setBusy('delete');
    setError('');
    try {
      await api(tenantPath(''), { method: 'DELETE', body: { confirm: deleteName } });
      session.clear();
      location.hash = '#/login';
      location.reload();
    } catch (reason) { setError(reason.message || 'Không xóa được doanh nghiệp.'); }
    finally { setBusy(''); }
  };

  if (!can('tenant.admin')) return <div className="page"><div className="alert danger" role="alert">Chỉ quản trị viên mới được xuất, nhập hoặc xóa dữ liệu doanh nghiệp.</div></div>;

  return <div className="page">
    <div className="page-head"><div><h1>Cài đặt</h1><p className="sub">Dữ liệu của doanh nghiệp “{app.meta.name}”.</p></div></div>
    <SettingsTabs active="data" />
    <section className="stack">
      {error && <div className="alert danger" role="alert">{error}</div>}
      <section className="card"><div className="card-head"><h2>Xuất dữ liệu</h2></div><div className="card-pad stack">
        <p className="muted">Tải dữ liệu doanh nghiệp về bất cứ lúc nào. Bản JSON gồm dữ liệu, vai trò và trường mở rộng; không chứa mật khẩu hoặc bí mật token.</p>
        <div><button className="btn btn-primary" type="button" disabled={Boolean(busy)} onClick={() => exportData('/export', `osp-${app.meta.id}.json`)}>{busy === '/export' ? 'Đang xuất…' : 'Tải toàn bộ (JSON)'}</button></div>
        <div className="row wrap"><div className="field grow"><label htmlFor="export-entity">Xuất một loại dữ liệu (CSV)</label><select className="select" id="export-entity" value={exportEntity} onChange={(event) => setExportEntity(event.target.value)}>{entities.map((entity) => <option key={entity} value={entity}>{entityLabel(entity)} ({entity})</option>)}</select></div><button className="btn" type="button" disabled={Boolean(busy) || !exportEntity} onClick={() => exportData(`/export/${exportEntity.replace('.', '/')}`, `${exportEntity}.csv`)}>Tải CSV</button></div>
      </div></section>
      <section className="card"><div className="card-head"><h2>Nhập dữ liệu</h2></div><div className="card-pad stack">
        <p className="muted">Nhập CSV theo kiểu tất-cả-hoặc-không. Nếu có lỗi, không bản ghi nào được ghi. Dữ liệu nhập không kích hoạt các bước tự động.</p>
        <div className="row wrap"><div className="field grow"><label htmlFor="import-entity">Loại dữ liệu</label><select className="select" id="import-entity" value={importEntity} onChange={(event) => setImportEntity(event.target.value)}>{entities.map((entity) => <option key={entity} value={entity}>{entityLabel(entity)} ({entity})</option>)}</select></div><button className="btn" type="button" disabled={!importEntity} onClick={() => setImportOpen(true)}>Chọn tệp CSV…</button></div>
      </div></section>
      <section className="card danger-zone"><div className="card-head"><h2>Khu vực nguy hiểm</h2></div><div className="card-pad stack"><p className="muted">Xóa vĩnh viễn doanh nghiệp cùng toàn bộ dữ liệu, người dùng và token. Hành động này không thể khôi phục. Hãy xuất dữ liệu trước.</p>
        <form className="stack-sm" onSubmit={deleteTenant}><div className="field"><label htmlFor="delete-tenant-name">Gõ chính xác tên doanh nghiệp để xác nhận: <strong>{app.meta.name}</strong></label><input className="input" id="delete-tenant-name" value={deleteName} onChange={(event) => setDeleteName(event.target.value)} autoComplete="off" /></div><div><button className="btn btn-danger" type="submit" disabled={Boolean(busy) || deleteName !== app.meta.name}>{busy === 'delete' ? 'Đang xóa…' : 'Xóa vĩnh viễn doanh nghiệp'}</button></div></form>
      </div></section>
    </section>
    {importOpen && <EntityImportDialog qname={importEntity} onClose={() => setImportOpen(false)} onDone={() => toast('Đã nhập dữ liệu.', 'success')} />}
  </div>;
}
