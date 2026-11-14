import React, { useEffect, useRef, useState } from 'react';
import { ApiError, api, tenantPath } from './lib/api.js';
import { entityLabel } from './lib/state.js';

export default function EntityImportDialog({ qname, onClose, onDone }) {
  const dialog = useRef(null);
  const fileInput = useRef(null);
  const [file, setFile] = useState(null);
  const [errors, setErrors] = useState([]);
  const [message, setMessage] = useState('');
  const [success, setSuccess] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const node = dialog.current;
    if (node && !node.open) node.showModal();
    fileInput.current?.focus();
    return () => { if (node?.open) node.close(); };
  }, []);

  const close = () => { dialog.current?.close(); onClose?.(); };
  const upload = async (event) => {
    event.preventDefault();
    setErrors([]);
    setMessage('');
    setSuccess(false);
    if (!file) {
      setMessage('Chọn một tệp CSV trước.');
      return;
    }
    setSaving(true);
    try {
      const csv = await file.text();
      const result = await api(tenantPath(`/import/${qname.replace('.', '/')}`), {
        method: 'POST', body: csv, headers: { 'content-type': 'text/csv' },
      });
      setSuccess(true);
      setMessage(`Đã nhập ${result.imported} dòng.`);
      onDone?.(result);
    } catch (reason) {
      const rowErrors = reason instanceof ApiError && Array.isArray(reason.details?.errors)
        ? reason.details.errors
        : [];
      setErrors(rowErrors.slice(0, 20));
      setMessage(rowErrors.length
        ? `Không nhập được — chưa ghi dòng nào${rowErrors.length > 20 ? ` (${rowErrors.length - 20} lỗi khác chưa hiển thị)` : ''}.`
        : reason.message || 'Không nhập được tệp CSV.');
    } finally {
      setSaving(false);
    }
  };

  return <dialog ref={dialog} className="modal" aria-labelledby="entity-import-title" onCancel={(event) => { event.preventDefault(); close(); }}>
    <form onSubmit={upload} noValidate>
      <div className="modal-body stack">
        <h2 id="entity-import-title">Nhập {entityLabel(qname).toLowerCase()} từ CSV</h2>
        <p className="muted small">Dòng đầu là tên cột (khớp tên trường, ví dụ name, phone). Nhập theo kiểu tất-cả-hoặc-không: có lỗi thì không dòng nào được ghi. Dữ liệu nhập không kích hoạt các bước tự động.</p>
        <div className="field">
          <label htmlFor="entity-import-file">Tệp CSV (UTF-8)</label>
          <input ref={fileInput} id="entity-import-file" className="input" type="file" accept=".csv,text/csv" onChange={(event) => setFile(event.target.files?.[0] || null)} />
        </div>
        {message && <div className={`alert ${success ? 'success' : 'danger'}`} role={success ? 'status' : 'alert'}>{message}</div>}
        {errors.length > 0 && <ul className="error-list">{errors.map((error, index) => <li key={`${error.row}:${index}`}>Dòng {error.row}: {error.message}</li>)}</ul>}
      </div>
      <div className="modal-foot">
        <button className="btn" type="button" disabled={saving} onClick={close}>Đóng</button>
        <button className="btn btn-primary" type="submit" disabled={saving}>{saving ? 'Đang nhập…' : 'Nhập'}</button>
      </div>
    </form>
  </dialog>;
}
