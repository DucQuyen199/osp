import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useDocumentTitle } from '../../lib/useDocumentTitle.js';
import { useLatestRequest } from '../../lib/useLatestRequest.js';
import { api, dataPath, session } from '../../lib/api.js';
import { confirmDialog } from '../../lib/feedback.js';
import { fmtDateTime, statusLabel, uiTextWith } from '../../lib/i18n.js';
import { app, can, loadAllResponse } from '../../lib/state.js';
import documentsEnglish from './documents.en.js';
import DocumentListTable from './components/DocumentListTable.jsx';
import DocumentDetailPanel from './components/DocumentDetailPanel.jsx';
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
  const latestLoad = useLatestRequest();
  const latestAttachmentLoad = useLatestRequest();
  const load = useCallback(async (quiet = false) => {
    const isLatest = latestLoad();
    if (!quiet) { setLoading(true); setError(''); }
    try {
      const [folderRes, documentRes, signatureRes] = await Promise.all([
        can('document.folder.read') ? loadAllResponse('document.folder') : Promise.resolve({ items: [] }),
        can('document.document.read') ? loadAllResponse('document.document') : Promise.resolve({ items: [] }),
        can('document.signature_request.read') ? loadAllResponse('document.signature_request') : Promise.resolve({ items: [] }),
      ]);
      const folderRows = rows(folderRes).sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'vi'));
      const documentRows = rows(documentRes).sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));
      if (isLatest()) {
        setFolders(folderRows); setDocuments(documentRows); setSignatures(rows(signatureRes));
        setSelectedId((id) => documentRows.some((row) => row.id === id) ? id : documentRows.find((row) => folderFilter === 'all' || row.folder === folderFilter)?.id || '');
        setDocumentForm((form) => ({ ...form, folder: form.folder || folderFilter !== 'all' && folderFilter || '', owner: form.owner || app.user?.name || '' }));
        setFolderForm((form) => ({ ...form, parent: form.parent || (folderFilter !== 'all' ? folderFilter : '') }));
      }
    } catch (reason) { if (isLatest()) setError(t(reason.message || 'Không tải được thư viện tài liệu.')); }
    finally { if (isLatest()) setLoading(false); }
  }, [folderFilter, latestLoad]);
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
    const isLatest = latestAttachmentLoad();
    if (!documentId || !can('document.document.read')) { if (isLatest()) setAttachments([]); return; }
    try {
      const nextAttachments = rows(await api(attachmentBase(documentId)));
      if (isLatest()) setAttachments(nextAttachments);
    } catch (reason) { if (isLatest()) setError(t(reason.message || 'Không tải được lịch sử phiên bản tệp.')); }
  }, [latestAttachmentLoad]);
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
    <div className="stats u-mb-16" ><div className="card stat"><span className="stat-label">{t('Hồ sơ tài liệu')}</span><strong className="stat-value">{documents.length}</strong></div><div className="card stat"><span className="stat-label">{t('Thư mục')}</span><strong className="stat-value">{folders.length}</strong></div><div className="card stat"><span className="stat-label">{t('Yêu cầu ký đang chờ')}</span><strong className="stat-value">{pendingCount}</strong></div><div className="card stat"><span className="stat-label">{t('Đã ký')}</span><strong className="stat-value">{signedCount}</strong></div></div>
    {(can('document.folder.create') || can('document.document.create')) && <div className="two-col">
      {can('document.folder.create') && <section className="card card-pad"><h2>{t('Tạo thư mục')}</h2><form className="form-grid" onSubmit={createFolder}><label className="field"><span className="label">{t('Tên thư mục *')}</span><input className="input" required maxLength="240" value={folderForm.name} onChange={(event) => setFolderForm((form) => ({ ...form, name: event.target.value }))}/></label><label className="field"><span className="label">{t('Thư mục cha')}</span><select className="select" value={folderForm.parent} onChange={(event) => setFolderForm((form) => ({ ...form, parent: event.target.value }))}><option value="">{t('Thư mục gốc')}</option>{folderChoices}</select></label><div className="row full"><span className="grow"/><button className="btn btn-secondary" disabled={Boolean(busy)}>{t('Tạo thư mục')}</button></div></form></section>}
      {can('document.document.create') && <section className="card card-pad"><h2>{t('Lập hồ sơ tài liệu')}</h2><form className="form-grid" onSubmit={createDocument}><label className="field"><span className="label">{t('Tên tài liệu *')}</span><input className="input" required maxLength="500" value={documentForm.title} onChange={(event) => setDocumentForm((form) => ({ ...form, title: event.target.value }))}/></label><label className="field"><span className="label">{t('Thư mục')}</span><select className="select" value={documentForm.folder} onChange={(event) => setDocumentForm((form) => ({ ...form, folder: event.target.value }))}><option value="">{t('Chưa phân thư mục')}</option>{folderChoices}</select></label><label className="field"><span className="label">{t('Người sở hữu')}</span><input className="input" maxLength="160" value={documentForm.owner} onChange={(event) => setDocumentForm((form) => ({ ...form, owner: event.target.value }))}/></label><label className="field"><span className="label">{t('Thẻ, ngăn cách bằng dấu phẩy')}</span><input className="input" maxLength="1000" placeholder={t('Hợp đồng, khách hàng, 2026')} value={documentForm.tags} onChange={(event) => setDocumentForm((form) => ({ ...form, tags: event.target.value }))}/></label><div className="row full"><span className="grow"/><button className="btn btn-primary" disabled={Boolean(busy)}>{t('Tạo hồ sơ')}</button></div></form></section>}
    </div>}
    <section className="card card-pad"><div className="row wrap"><h2>{t('Kho tài liệu')}</h2><span className="grow"/><label className="field"><span className="label">{t('Thư mục')}</span><select className="select" value={folderFilter} onChange={(event) => setFolderFilter(event.target.value)}><option value="all">{t('Tất cả thư mục')}</option>{folderChoices}</select></label></div>
      {!can('document.document.read') ? <div className="empty">{t('Bạn chưa có quyền xem hồ sơ tài liệu.')}</div> : loading ? <div className="skeleton" data-h="row"/> : !visibleDocuments.length ? <div className="empty">{t('Chưa có tài liệu trong thư mục này.')}</div> : <div className="layout-split u-mt-10" ><DocumentListTable documents={visibleDocuments} selectedId={selectedId} onSelect={setSelectedId} folderName={folderName} fmtDateTime={fmtDateTime} t={t} />
        {selected && <DocumentDetailPanel
          document={selected}
          folderName={folderName}
          currentAttachment={currentAttachment}
          internalFileUrl={internalFileUrl}
          attachments={attachments}
          signatures={selectedSignatures}
          documentLocked={documentLocked}
          canUpdateDocument={can('document.document.update')}
          canSign={can('document.signature_request.signed')}
          canDecline={can('document.signature_request.declined')}
          canCreateSignature={Boolean(selected.file_url) && can('document.signature_request.create')}
          signatureForm={signatureForm}
          uploadDisabled={Boolean(busy) || documentLocked || !uploadFile || uploadFile.size > 10 * 1024 * 1024}
          busy={busy}
          fmtDateTime={fmtDateTime}
          statusLabel={statusLabel}
          bytesLabel={bytesLabel}
          onUpload={upload}
          onUploadFileChange={(file) => { setUploadFile(file); if (file && file.size > 10 * 1024 * 1024) setError(t('Tệp vượt quá giới hạn 10 MB.')); else setError(''); }}
          onDownload={download}
          onSignatureFieldChange={(field, value) => setSignatureForm((form) => ({ ...form, [field]: value }))}
          onCreateSignature={createSignature}
          onSignatureAction={signatureAction}
          t={t}
        />}
      </div>}
    </section>
    {can('document.folder.read') && <section className="card card-pad"><div className="row wrap"><h2>{t('Thư mục')}</h2><span className="grow"/><span className="small muted">{folderFilter === 'all' ? t('Tất cả tài liệu') : folderName(folderFilter)}</span></div>{!folders.length ? <div className="empty">{t('Chưa có thư mục.')}</div> : <div className="stack-sm">{folders.map((folder) => { const depthClass = Math.min(depth(folder), 6); return <div className="row wrap u-list-row-divider" key={folder.id} ><span className={`document-folder-label depth-${depthClass}`}><strong>{folder.name}</strong>{folder.parent && <span className="small muted"> · {t('· trong ')}{folderName(folder.parent)}</span>}</span><span className="grow"/><button className="btn btn-ghost btn-sm" type="button" onClick={() => setFolderFilter(folder.id)}>{t('Mở')}</button>{can('document.folder.delete') && <button className="btn btn-ghost btn-sm" type="button" onClick={() => removeFolder(folder)}>{t('Xóa')}</button>}</div>; })}</div>}</section>}
  </div>;
}
