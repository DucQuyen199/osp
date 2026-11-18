import React from 'react';

export default function DocumentDetailPanel({
  document,
  folderName,
  currentAttachment,
  internalFileUrl,
  attachments,
  signatures,
  documentLocked,
  canUpdateDocument,
  canSign,
  canDecline,
  canCreateSignature,
  signatureForm,
  uploadDisabled,
  busy,
  fmtDateTime,
  statusLabel,
  bytesLabel,
  onUpload,
  onUploadFileChange,
  onDownload,
  onSignatureFieldChange,
  onCreateSignature,
  onSignatureAction,
  t,
}) {
  return <section className="card card-pad">
    <div className="row wrap"><div><h3>{document.title}</h3><div className="small muted">{folderName(document.folder)} · {t('Chủ sở hữu:')} {document.owner || t('Chưa gán')} · v{document.version || 1}</div></div><span className="grow"/><a className="btn btn-ghost btn-sm" href={`#/e/document/document/${document.id}`}>{t('Chi tiết')}</a></div>
    {Array.isArray(document.tags) && document.tags.length > 0 && <div className="row wrap u-mt-8">{document.tags.map((tag) => <span className="chip neutral" key={tag}>{tag}</span>)}</div>}
    {document.file_url && (internalFileUrl && currentAttachment ? <p className="u-mt-10"><button className="btn btn-secondary btn-sm" type="button" onClick={() => onDownload(currentAttachment)}>{t('Tải phiên bản hiện tại')}</button></p> : !internalFileUrl ? <p className="u-mt-10"><a href={document.file_url} target="_blank" rel="noreferrer">{t('Mở phiên bản hiện tại')}</a></p> : null)}
    {canUpdateDocument && <form className="row wrap u-mt-10" onSubmit={onUpload}><label className="field grow"><span className="label">{t('Tải lên tệp mới (tối đa 10 MB)')}</span><input className="input" type="file" required disabled={documentLocked} onChange={(event) => onUploadFileChange(event.target.files?.[0] || null)}/></label><button className="btn btn-primary" disabled={uploadDisabled}>{t('Lưu phiên bản mới')}</button></form>}
    {documentLocked && <p className="small muted">{t('Hồ sơ có yêu cầu ký đã hoàn tất; phiên bản đã được khóa để giữ nguyên bằng chứng ký.')}</p>}
    <h3 className="u-mt-18">{t('Lịch sử phiên bản')}</h3>
    {!attachments.length ? <div className="empty">{t('Chưa có tệp đính kèm.')}</div> : <div className="table-wrap"><table className="table"><thead><tr><th>{t('Phiên bản')}</th><th>{t('Tệp')}</th><th>{t('Kích thước / checksum')}</th><th/></tr></thead><tbody>{attachments.map((attachment) => <tr key={attachment.id}>
      <td>v{attachment.documentVersion}{attachment.documentVersion === Number(document.version || 1) && <span className="badge success u-ml-6">{t('Hiện tại')}</span>}</td>
      <td><strong>{attachment.fileName}</strong><div className="small muted">{fmtDateTime(attachment.createdAt)}</div></td>
      <td>{bytesLabel(attachment.sizeBytes)}<div className="small muted" title={attachment.sha256}>{String(attachment.sha256).slice(0, 16)}…</div></td>
      <td><button className="btn btn-secondary btn-sm" type="button" onClick={() => onDownload(attachment)}>{t('Tải xuống')}</button></td>
    </tr>)}</tbody></table></div>}
    <div className="row wrap u-mt-18"><h3>{t('Yêu cầu ký')}</h3><span className="grow"/><span className="badge plain">{signatures.length}</span></div>
    {signatures.length ? <div className="stack-sm u-mt-8">{signatures.map((request) => {
      const signedAttachment = attachments.find((item) => item.documentVersion === Number(request.document_version));
      return <article className="card card-pad" key={request.id}>
        <div className="row wrap"><div><strong>{request.signer_name || request.signer_email}</strong><div className="small muted">{request.signer_email} · {t('yêu cầu v')}{request.document_version || '?'} · {t('· tạo ')}{fmtDateTime(request.createdAt)}</div>{signedAttachment && <button className="btn btn-ghost btn-sm u-mt-4" type="button" onClick={() => onDownload(signedAttachment)}>{t('Tải bản được yêu cầu ký')}</button>}</div><span className="grow"/><span className={`badge ${request.status === 'signed' ? 'success' : request.status === 'declined' ? 'danger' : 'warning'}`}>{t(statusLabel(request.status || 'pending'))}</span></div>
        <div className="row wrap u-mt-8">{request.status === 'pending' && canSign && <button className="btn btn-primary btn-sm" disabled={Boolean(busy)} onClick={() => onSignatureAction(request, 'signed')}>{t('Ghi nhận đã ký')}</button>}{request.status === 'pending' && canDecline && <button className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => onSignatureAction(request, 'declined')}>{t('Ghi nhận từ chối')}</button>}</div>
      </article>;
    })}</div> : <div className="empty">{t('Chưa có yêu cầu ký cho tài liệu này.')}</div>}
    {canCreateSignature && <form className="form-grid u-mt-10" onSubmit={onCreateSignature}>
      <label className="field"><span className="label">{t('Người ký')}</span><input className="input" maxLength="160" value={signatureForm.signer_name} onChange={(event) => onSignatureFieldChange('signer_name', event.target.value)}/></label>
      <label className="field"><span className="label">{t('Email người ký *')}</span><input className="input" type="email" required maxLength="320" value={signatureForm.signer_email} onChange={(event) => onSignatureFieldChange('signer_email', event.target.value)}/></label>
      <div className="row full"><span className="grow small muted">{t('Yêu cầu được lưu trong hồ sơ và theo dõi trạng thái ký.')}</span><button className="btn btn-secondary" disabled={Boolean(busy)}>{t('Tạo yêu cầu ký')}</button></div>
    </form>}
  </section>;
}
