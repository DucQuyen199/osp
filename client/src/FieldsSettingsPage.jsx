import React, { useEffect, useState } from 'react';
import { api, tenantPath } from './lib/api.js';
import { toast } from './lib/feedback.js';
import { app, can, entityLabel, fieldLabelOf, loadMeta, resetCaches } from './lib/state.js';
import SettingsTabs from './SettingsTabs.jsx';

export default function FieldsSettingsPage() {
  const entities = [...app.entities.keys()];
  const [qname, setQname] = useState(entities[0] || '');
  const [spec, setSpec] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { document.title = 'Trường mở rộng · Cài đặt · OSP Suite'; }, []);

  const add = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api(tenantPath('/custom-fields'), { method: 'POST', body: { entity: qname, field: spec.trim() } });
      await loadMeta();
      resetCaches();
      window.dispatchEvent(new Event('osp:meta'));
      setSpec('');
      toast('Đã thêm trường mở rộng.', 'success');
    } catch (reason) { setError(reason.message || 'Không tạo được trường mở rộng.'); }
    finally { setBusy(false); }
  };

  if (!can('tenant.admin')) return <div className="page"><div className="alert danger" role="alert">Chỉ quản trị viên mới được thêm trường mở rộng.</div></div>;

  return <div className="page">
    <div className="page-head"><div><h1>Cài đặt</h1><p className="sub">Trường mở rộng của doanh nghiệp “{app.meta.name}”.</p></div></div>
    <SettingsTabs active="fields" />
    <section className="stack">
      {error && <div className="alert danger" role="alert">{error}</div>}
      <form className="card stack" onSubmit={add}>
        <div className="card-head"><h2>Thêm trường cho một loại dữ liệu</h2></div>
        <div className="form-grid">
          <div className="field"><label htmlFor="custom-field-entity">Loại dữ liệu</label><select className="select" id="custom-field-entity" value={qname} onChange={(event) => setQname(event.target.value)}>{entities.map((entity) => <option value={entity} key={entity}>{entityLabel(entity)} ({entity})</option>)}</select></div>
          <div className="field"><label htmlFor="custom-field-spec">Khai báo trường</label><input className="input mono" id="custom-field-spec" value={spec} onChange={(event) => setSpec(event.target.value)} placeholder="ngay_sinh:date | xep_hang:enum:A|B|C | ghi_chu:text" required /></div>
        </div>
        <p className="hint">Cú pháp: tên[!]:kiểu[:tham số]. Kiểu: string, text, number, money, date, datetime, bool, json, enum hoặc ref (module.dữ_liệu). Dấu ! = bắt buộc. Tên chỉ gồm chữ không dấu, số, gạch dưới.</p>
        <div><button className="btn btn-primary" type="submit" disabled={busy || !qname}>{busy ? 'Đang lưu…' : 'Thêm trường'}</button></div>
      </form>
      <section className="card"><div className="card-head"><h2>Trường đã thêm</h2></div>
        {Object.keys(app.meta.extensions || {}).length === 0 ? <div className="card-pad muted">Chưa có trường nào do bạn thêm. Các trường đặc thù ngành đã được áp dụng sẵn.</div> : <div className="table-wrap"><table className="table">
          <thead><tr><th>Loại dữ liệu</th><th>Trường</th></tr></thead>
          <tbody>{Object.entries(app.meta.extensions || {}).map(([entity, fields]) => <tr key={entity}><td>{entityLabel(entity)}<div className="faint mono">{entity}</div></td><td><div className="kv">{fields.map((field) => <span className="chip mono" key={field.name}>{fieldLabelOf(entity, field.name)}{field.required ? '!' : ''}:{field.type}</span>)}</div></td></tr>)}</tbody>
        </table></div>}
      </section>
    </section>
  </div>;
}
