import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useDocumentTitle } from '../../lib/useDocumentTitle.js';
import { useLatestRequest } from '../../lib/useLatestRequest.js';
import { api, session } from '../../lib/api.js';
import { fmtDateTime, statusLabel, uiTextWith } from '../../lib/i18n.js';
import { can, loadAllResponse } from '../../lib/state.js';
import documentsEnglish from './documents.en.js';
import DocumentListTable from './components/DocumentListTable.jsx';
import DocumentDetailPanel from './components/DocumentDetailPanel.jsx';
import { useDocumentWorkbenchWorkflow } from './hooks/useDocumentWorkbenchWorkflow.js';
const t = (text) => uiTextWith(text, documentsEnglish);
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
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
  const {
    folderForm, setFolderForm, documentForm, setDocumentForm, signatureForm, setSignatureForm,
    uploadFile, busy, notice, createFolder, createDocument, upload, download, createSignature,
    signatureAction, removeFolder, onUploadFileChange,
  } = useDocumentWorkbenchWorkflow({
    folderFilter, folders, selected, selectedId, setSelectedId, attachmentBase, load, loadAttachments, setError, t,
  });
  useEffect(() => { loadAttachments(selectedId); }, [loadAttachments, selectedId]);
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
          onUploadFileChange={onUploadFileChange}
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
