import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useDocumentTitle } from '../../lib/useDocumentTitle.js';
import { selectableTableRowProps } from '../../lib/accessibility.js';
import { api, dataPath, session } from '../../lib/api.js';
import { confirmDialog } from '../../lib/feedback.js';
import { fmtDateTime, statusLabel, uiTextWith } from '../../lib/i18n.js';
import { app, can, loadAllResponse } from '../../lib/state.js';
import documentsEnglish from './documents.en.js';
const t = (text) => uiTextWith(text, documentsEnglish);
const emptyFolder = { name: '', parent: '' };
const emptyDocument = { title: '', folder: '', tags: '', owner: '' };
const emptySignature = { signer_name: '', signer_email: '' };
const rows = (response) => Array.isArray(response?.items) ? response.items : [];
const attachmentBase = (documentId) => `/api/t/${session.current().tenantId}/documents/${encodeURIComponent(documentId)}/attachments`;
const bytesLabel = (value) => value < 1024 * 1024 ? `${(value / 1024).toFixed(0)} KB` : `${(value / (1024 * 1024)).toFixed(2)} MB`;
export default function DocumentWorkbenchPage() {
  useDocumentTitle(`${t('Thư viện tài liệu')} · OSP Suite`);
  const [folders, setFolders] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [signatures, setSignatures] = useState([]);
  const [attachments, setAttachments] = useState([]);
  const [folderFilter, setFolderFilter] = useState('all');
  const [selectedId, setSelectedId] = useState('');
  const [folderForm, setFolderForm] = useState(emptyFolder);
  const [documentForm, setDocumentForm] = useState(emptyDocument);
  const [signatureForm, setSignatureForm] = useState(emptySignature);
  const [uploadFile, setUploadFile] = useState(null);
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const load = useCallback(async (quiet = false) => {
    if (!quiet) { setLoading(true); setError(''); }
    try {
      const [folderRes, documentRes, signatureRes] = await Promise.all([
        can('document.folder.read') ? loadAllResponse('document.folder') : Promise.resolve({ items: [] }),
        can('document.document.read') ? loadAllResponse('document.document') : Promise.resolve({ items: [] }),
        can('document.signature_request.read') ? loadAllResponse('document.signature_request') : Promise.resolve({ items: [] }),
      ]);
      const folderRows = rows(folderRes).sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'vi'));
      const documentRows = rows(documentRes).sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));
      setFolders(folderRows); setDocuments(documentRows); setSignatures(rows(signatureRes));
      setSelectedId((id) => documentRows.some((row) => row.id === id) ? id : documentRows.find((row) => folderFilter === 'all' || row.folder === folderFilter)?.id || '');
      setDocumentForm((form) => ({ ...form, folder: form.folder || folderFilter !== 'all' && folderFilter || '', owner: form.owner || app.user?.name || '' }));
      setFolderForm((form) => ({ ...form, parent: form.parent || (folderFilter !== 'all' ? folderFilter : '') }));
    } catch (reason) { setError(t(reason.message || 'Không tải được thư viện tài liệu.')); }
    finally { if (!quiet) setLoading(false); }
  }, [folderFilter]);
  useEffect(() => { load(); }, [load]);
  const folderById = useMemo(() => new Map(folders.map((row) => [row.id, row])), [folders]);
  const selected = documents.find((row) => row.id === selectedId);
  const currentAttachment = selected ? attachments.find((item) => item.documentVersion === Number(selected.version || 1)) : null;
  const internalFileUrl = selected?.file_url?.startsWith('/api/t/');
  const visibleDocuments = documents.filter((row) => folderFilter === 'all' || row.folder === folderFilter);
  const selectedSignatures = useMemo(() => signatures.filter((row) => row.document === selectedId).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))), [signatures, selectedId]);
  const documentLocked = selectedSignatures.some((row) => ['signed', 'declined'].includes(row.status));
  useEffect(() => {
    if (!visibleDocuments.some((row) => row.id === selectedId)) setSelectedId(visibleDocuments[0]?.id || '');
  }, [visibleDocuments, selectedId]);
  const loadAttachments = useCallback(async (documentId) => {
    if (!documentId || !can('document.document.read')) { setAttachments([]); return; }
    try { setAttachments(rows(await api(attachmentBase(documentId)))); }
    catch (reason) { setError(t(reason.message || 'Không tải được lịch sử phiên bản tệp.')); }
  }, []);
  useEffect(() => { loadAttachments(selectedId); }, [loadAttachments, selectedId]);
  async function run(key, operation, success) {
    setBusy(key); setError(''); setNotice('');
    try { await operation(); await load(true); if (selectedId) await loadAttachments(selectedId); if (success) setNotice(t(success)); }
    catch (reason) { setError(t(reason.message || 'Thao tác không thành công.')); await load(true); }
    finally { setBusy(''); }
  }
  async function createFolder(event) {
    event.preventDefault();
    await run('folder:create', async () => {
      await api(dataPath('document.folder'), { method: 'POST', body: { name: folderForm.name.trim(), ...(folderForm.parent ? { parent: folderForm.parent } : {}) } });
      setFolderForm((form) => ({ ...emptyFolder, parent: form.parent }));
    }, 'Đã tạo thư mục.');
  }
  async function createDocument(event) {
    event.preventDefault();
    await run('document:create', async () => {
      const created = await api(dataPath('document.document'), { method: 'POST', body: {
        title: documentForm.title.trim(), ...(documentForm.folder ? { folder: documentForm.folder } : {}),
        ...(documentForm.owner.trim() ? { owner: documentForm.owner.trim() } : {}),
        ...(documentForm.tags.trim() ? { tags: documentForm.tags.split(',').map((tag) => tag.trim()).filter(Boolean) } : {}),
      } });
      setDocumentForm((form) => ({ ...emptyDocument, folder: form.folder, owner: app.user?.name || '' })); setSelectedId(created.id);
    }, 'Đã lập hồ sơ tài liệu.');
  }
  async function upload(event) {
    event.preventDefault(); if (!selected || !uploadFile) return;
    if (uploadFile.size > 10 * 1024 * 1024) { setError(t('Tệp vượt quá giới hạn 10 MB.')); return; }
    await run(`${selected.id}:upload`, async () => {
      const response = await api(attachmentBase(selected.id), { method: 'POST', body: uploadFile, raw: true, headers: {
        'content-type': uploadFile.type || 'application/octet-stream',
        'x-file-name': encodeURIComponent(uploadFile.name),
      } });
      await response.json();
      setUploadFile(null);
    }, 'Đã lưu phiên bản tài liệu.');
  }
  async function download(attachment) {
    try {
      const response = await api(`${attachmentBase(selected.id)}/${encodeURIComponent(attachment.id)}`, { raw: true });
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = attachment.fileName; anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (reason) { setError(t(reason.message || 'Không tải được tệp.')); }
  }
  async function createSignature(event) {
    event.preventDefault(); if (!selected) return;
    await run(`${selected.id}:signature`, async () => {
      await api(dataPath('document.signature_request'), { method: 'POST', body: {
        document: selected.id, signer_email: signatureForm.signer_email.trim(),
        ...(signatureForm.signer_name.trim() ? { signer_name: signatureForm.signer_name.trim() } : {}),
      } });
      setSignatureForm(emptySignature);
    }, 'Đã ghi nhận yêu cầu ký cho người ký.');
  }
  async function signatureAction(request, action) {
    await run(`${request.id}:${action}`, () => api(dataPath('document.signature_request', request.id, action), { method: 'POST' }), action === 'signed' ? 'Đã ghi nhận hoàn tất ký.' : 'Đã ghi nhận người ký từ chối.');
  }
  async function removeFolder(folder) {
    if (!await confirmDialog({ title: t('Xóa thư mục'), message: `${t('Xóa thư mục “')}${folder.name}${t('”? Thư mục chỉ xóa được khi không còn dữ liệu bên trong.')}`, danger: true, confirmLabel: t('Xóa thư mục') })) return;
    await run(`${folder.id}:remove`, () => api(dataPath('document.folder', folder.id), { method: 'DELETE' }), 'Đã xóa thư mục.');
  }
  function depth(folder) {
    let value = 0; let parentId = folder.parent; const visited = new Set([folder.id]);
    while (parentId && folderById.has(parentId) && !visited.has(parentId)) { visited.add(parentId); value += 1; parentId = folderById.get(parentId).parent; }
    return value;
  }
  const folderName = (id) => folderById.get(id)?.name || (id ? `${t('Thư mục ')}${String(id).slice(0, 8)}` : t('Chưa phân thư mục'));
  const folderChoices = folders.map((folder) => <option key={folder.id} value={folder.id}>{'　'.repeat(Math.min(depth(folder), 6))}{folder.name}</option>);
  const signedCount = signatures.filter((row) => row.status === 'signed').length;
  const pendingCount = signatures.filter((row) => row.status === 'pending').length;
  return <div className="page">
    <div className="page-head"><div><h1>{t('Thư viện tài liệu')}</h1><p className="sub">{t('Lưu trữ tập trung theo thư mục, quản lý từng phiên bản tệp và theo dõi yêu cầu ký cùng hồ sơ.')}</p></div><button className="btn btn-secondary" type="button" disabled={loading || Boolean(busy)} onClick={() => load()}>{t('Làm mới')}</button></div>
    {error && <div className="alert danger" role="alert">{t(error)}</div>}{notice && <div className="alert success" role="status">{t(notice)}</div>}
    <div className="stats u-legacy-bf4a218e05" ><div className="card stat"><span className="stat-label">{t('Hồ sơ tài liệu')}</span><strong className="stat-value">{documents.length}</strong></div><div className="card stat"><span className="stat-label">{t('Thư mục')}</span><strong className="stat-value">{folders.length}</strong></div><div className="card stat"><span className="stat-label">{t('Yêu cầu ký đang chờ')}</span><strong className="stat-value">{pendingCount}</strong></div><div className="card stat"><span className="stat-label">{t('Đã ký')}</span><strong className="stat-value">{signedCount}</strong></div></div>
    {(can('document.folder.create') || can('document.document.create')) && <div className="two-col">
      {can('document.folder.create') && <section className="card card-pad"><h2>{t('Tạo thư mục')}</h2><form className="form-grid" onSubmit={createFolder}><label className="field"><span className="label">{t('Tên thư mục *')}</span><input className="input" required maxLength="240" value={folderForm.name} onChange={(event) => setFolderForm((form) => ({ ...form, name: event.target.value }))}/></label><label className="field"><span className="label">{t('Thư mục cha')}</span><select className="select" value={folderForm.parent} onChange={(event) => setFolderForm((form) => ({ ...form, parent: event.target.value }))}><option value="">{t('Thư mục gốc')}</option>{folderChoices}</select></label><div className="row full"><span className="grow"/><button className="btn btn-secondary" disabled={Boolean(busy)}>{t('Tạo thư mục')}</button></div></form></section>}
      {can('document.document.create') && <section className="card card-pad"><h2>{t('Lập hồ sơ tài liệu')}</h2><form className="form-grid" onSubmit={createDocument}><label className="field"><span className="label">{t('Tên tài liệu *')}</span><input className="input" required maxLength="500" value={documentForm.title} onChange={(event) => setDocumentForm((form) => ({ ...form, title: event.target.value }))}/></label><label className="field"><span className="label">{t('Thư mục')}</span><select className="select" value={documentForm.folder} onChange={(event) => setDocumentForm((form) => ({ ...form, folder: event.target.value }))}><option value="">{t('Chưa phân thư mục')}</option>{folderChoices}</select></label><label className="field"><span className="label">{t('Người sở hữu')}</span><input className="input" maxLength="160" value={documentForm.owner} onChange={(event) => setDocumentForm((form) => ({ ...form, owner: event.target.value }))}/></label><label className="field"><span className="label">{t('Thẻ, ngăn cách bằng dấu phẩy')}</span><input className="input" maxLength="1000" placeholder={t('Hợp đồng, khách hàng, 2026')} value={documentForm.tags} onChange={(event) => setDocumentForm((form) => ({ ...form, tags: event.target.value }))}/></label><div className="row full"><span className="grow"/><button className="btn btn-primary" disabled={Boolean(busy)}>{t('Tạo hồ sơ')}</button></div></form></section>}
    </div>}
    <section className="card card-pad"><div className="row wrap"><h2>{t('Kho tài liệu')}</h2><span className="grow"/><label className="field"><span className="label">{t('Thư mục')}</span><select className="select" value={folderFilter} onChange={(event) => setFolderFilter(event.target.value)}><option value="all">{t('Tất cả thư mục')}</option>{folderChoices}</select></label></div>
      {!can('document.document.read') ? <div className="empty">{t('Bạn chưa có quyền xem hồ sơ tài liệu.')}</div> : loading ? <div className="skeleton" data-h="row"/> : !visibleDocuments.length ? <div className="empty">{t('Chưa có tài liệu trong thư mục này.')}</div> : <div className="layout-split u-legacy-df928149c5" ><section className="table-wrap"><table className="table"><thead><tr><th>{t('Tài liệu')}</th><th>{t('Thư mục')}</th><th>{t('Phiên bản')}</th><th>{t('Cập nhật')}</th></tr></thead><tbody>{visibleDocuments.map((row) => <tr {...selectableTableRowProps} key={row.id} aria-selected={selectedId === row.id} className={[selectedId === row.id ? 'selected' : '', 'u-legacy-9463ff4798'].filter(Boolean).join(' ')} onClick={() => setSelectedId(row.id)} ><td><strong>{row.title}</strong><div className="small muted">{row.owner || t('Chưa gán người sở hữu')}</div></td><td>{folderName(row.folder)}</td><td>{row.version || 1}{row.file_url ? '' : t('· Chưa có tệp')}</td><td>{fmtDateTime(row.updatedAt || row.createdAt)}</td></tr>)}</tbody></table></section>
        {selected && <section className="card card-pad"><div className="row wrap"><div><h3>{selected.title}</h3><div className="small muted">{folderName(selected.folder)} · {t('Chủ sở hữu:')} {selected.owner || t('Chưa gán')} · v{selected.version || 1}</div></div><span className="grow"/><a className="btn btn-ghost btn-sm" href={`#/e/document/document/${selected.id}`}>{t('Chi tiết')}</a></div>{Array.isArray(selected.tags) && selected.tags.length > 0 && <div className="row wrap u-legacy-43a97fe494" >{selected.tags.map((tag) => <span className="chip neutral" key={tag}>{tag}</span>)}</div>}{selected.file_url && (internalFileUrl && currentAttachment ? <p className="u-legacy-df928149c5"><button className="btn btn-secondary btn-sm" type="button" onClick={() => download(currentAttachment)}>{t('Tải phiên bản hiện tại')}</button></p> : !internalFileUrl ? <p className="u-legacy-df928149c5"><a href={selected.file_url} target="_blank" rel="noreferrer">{t('Mở phiên bản hiện tại')}</a></p> : null)}
          {can('document.document.update') && <form className="row wrap u-legacy-df928149c5"  onSubmit={upload}><label className="field grow"><span className="label">{t('Tải lên tệp mới (tối đa 10 MB)')}</span><input className="input" type="file" required disabled={documentLocked} onChange={(event) => { const file = event.target.files?.[0] || null; setUploadFile(file); if (file && file.size > 10 * 1024 * 1024) setError(t('Tệp vượt quá giới hạn 10 MB.')); else setError(''); }}/></label><button className="btn btn-primary" disabled={Boolean(busy) || documentLocked || !uploadFile || uploadFile.size > 10 * 1024 * 1024}>{t('Lưu phiên bản mới')}</button></form>}{documentLocked && <p className="small muted">{t('Hồ sơ có yêu cầu ký đã hoàn tất; phiên bản đã được khóa để giữ nguyên bằng chứng ký.')}</p>}
          <h3 className="u-legacy-2bdf8e45fd">{t('Lịch sử phiên bản')}</h3>{!attachments.length ? <div className="empty">{t('Chưa có tệp đính kèm.')}</div> : <div className="table-wrap"><table className="table"><thead><tr><th>{t('Phiên bản')}</th><th>{t('Tệp')}</th><th>{t('Kích thước / checksum')}</th><th/></tr></thead><tbody>{attachments.map((attachment) => <tr key={attachment.id}><td>v{attachment.documentVersion}{attachment.documentVersion === Number(selected.version || 1) && <span className="badge success u-legacy-4b17347c23" >{t('Hiện tại')}</span>}</td><td><strong>{attachment.fileName}</strong><div className="small muted">{fmtDateTime(attachment.createdAt)}</div></td><td>{bytesLabel(attachment.sizeBytes)}<div className="small muted" title={attachment.sha256}>{String(attachment.sha256).slice(0, 16)}…</div></td><td><button className="btn btn-secondary btn-sm" type="button" onClick={() => download(attachment)}>{t('Tải xuống')}</button></td></tr>)}</tbody></table></div>}
          <div className="row wrap u-legacy-2bdf8e45fd" ><h3>{t('Yêu cầu ký')}</h3><span className="grow"/><span className="badge plain">{selectedSignatures.length}</span></div>{selectedSignatures.length ? <div className="stack-sm u-legacy-43a97fe494" >{selectedSignatures.map((request) => { const signedAttachment = attachments.find((item) => item.documentVersion === Number(request.document_version)); return <article className="card card-pad" key={request.id}><div className="row wrap"><div><strong>{request.signer_name || request.signer_email}</strong><div className="small muted">{request.signer_email} · {t('yêu cầu v')}{request.document_version || '?'} · {t('· tạo ')}{fmtDateTime(request.createdAt)}</div>{signedAttachment && <button className="btn btn-ghost btn-sm u-legacy-eb2cdaa55e" type="button"  onClick={() => download(signedAttachment)}>{t('Tải bản được yêu cầu ký')}</button>}</div><span className="grow"/><span className={`badge ${request.status === 'signed' ? 'success' : request.status === 'declined' ? 'danger' : 'warning'}`}>{t(statusLabel(request.status || 'pending'))}</span></div><div className="row wrap u-legacy-43a97fe494" >{request.status === 'pending' && can('document.signature_request.signed') && <button className="btn btn-primary btn-sm" disabled={Boolean(busy)} onClick={() => signatureAction(request, 'signed')}>{t('Ghi nhận đã ký')}</button>}{request.status === 'pending' && can('document.signature_request.declined') && <button className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => signatureAction(request, 'declined')}>{t('Ghi nhận từ chối')}</button>}</div></article>; })}</div> : <div className="empty">{t('Chưa có yêu cầu ký cho tài liệu này.')}</div>}
          {selected.file_url && can('document.signature_request.create') && <form className="form-grid u-legacy-df928149c5"  onSubmit={createSignature}><label className="field"><span className="label">{t('Người ký')}</span><input className="input" maxLength="160" value={signatureForm.signer_name} onChange={(event) => setSignatureForm((form) => ({ ...form, signer_name: event.target.value }))}/></label><label className="field"><span className="label">{t('Email người ký *')}</span><input className="input" type="email" required maxLength="320" value={signatureForm.signer_email} onChange={(event) => setSignatureForm((form) => ({ ...form, signer_email: event.target.value }))}/></label><div className="row full"><span className="grow small muted">{t('Yêu cầu được lưu trong hồ sơ và theo dõi trạng thái ký.')}</span><button className="btn btn-secondary" disabled={Boolean(busy)}>{t('Tạo yêu cầu ký')}</button></div></form>}
        </section>}
      </div>}
    </section>
    {can('document.folder.read') && <section className="card card-pad"><div className="row wrap"><h2>{t('Thư mục')}</h2><span className="grow"/><span className="small muted">{folderFilter === 'all' ? t('Tất cả tài liệu') : folderName(folderFilter)}</span></div>{!folders.length ? <div className="empty">{t('Chưa có thư mục.')}</div> : <div className="stack-sm">{folders.map((folder) => { const depthClass = Math.min(depth(folder), 6); return <div className="row wrap u-legacy-8b15cfdb35" key={folder.id} ><span className={`document-folder-label depth-${depthClass}`}><strong>{folder.name}</strong>{folder.parent && <span className="small muted"> · {t('· trong ')}{folderName(folder.parent)}</span>}</span><span className="grow"/><button className="btn btn-ghost btn-sm" type="button" onClick={() => setFolderFilter(folder.id)}>{t('Mở')}</button>{can('document.folder.delete') && <button className="btn btn-ghost btn-sm" type="button" onClick={() => removeFolder(folder)}>{t('Xóa')}</button>}</div>; })}</div>}</section>}
  </div>;
}
