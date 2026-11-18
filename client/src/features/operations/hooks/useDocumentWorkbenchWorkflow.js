import { useEffect, useState } from 'react';
import { api, dataPath } from '../../../lib/api.js';
import { confirmDialog } from '../../../lib/feedback.js';
import { app } from '../../../lib/state.js';

const emptyFolder = { name: '', parent: '' };
const emptyDocument = { title: '', folder: '', tags: '', owner: '' };
const emptySignature = { signer_name: '', signer_email: '' };
export function useDocumentWorkbenchWorkflow({ folderFilter, folders, selected, selectedId, setSelectedId, attachmentBase, load, loadAttachments, setError, t }) {
  const [folderForm, setFolderForm] = useState(emptyFolder);
  const [documentForm, setDocumentForm] = useState(emptyDocument);
  const [signatureForm, setSignatureForm] = useState(emptySignature);
  const [uploadFile, setUploadFile] = useState(null);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    setDocumentForm((form) => ({ ...form, folder: form.folder || folderFilter !== 'all' && folderFilter || '', owner: form.owner || app.user?.name || '' }));
    setFolderForm((form) => ({ ...form, parent: form.parent || (folderFilter !== 'all' ? folderFilter : '') }));
  }, [folderFilter, folders]);

  async function run(key, operation, success) {
    setBusy(key); setError(''); setNotice('');
    try {
      await operation(); await load(true); if (selectedId) await loadAttachments(selectedId); if (success) setNotice(t(success));
    } catch (reason) { setError(t(reason.message || 'Thao tác không thành công.')); await load(true); }
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
      await response.json(); setUploadFile(null);
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
  function onUploadFileChange(file) {
    setUploadFile(file);
    if (file && file.size > 10 * 1024 * 1024) setError(t('Tệp vượt quá giới hạn 10 MB.'));
    else setError('');
  }

  return {
    folderForm, setFolderForm, documentForm, setDocumentForm, signatureForm, setSignatureForm,
    uploadFile, busy, notice, createFolder, createDocument, upload, download, createSignature,
    signatureAction, removeFolder, onUploadFileChange,
  };
}
