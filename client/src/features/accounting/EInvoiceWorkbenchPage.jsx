import React, { useEffect, useMemo, useState } from 'react';
import { useDocumentTitle } from '../../lib/useDocumentTitle.js';
import { selectableTableRowProps } from '../../lib/accessibility.js';
import { statusLabel, fmtDateTime, uiText, uiLocale } from '../../lib/i18n.js';
import { app, can } from '../../lib/state.js';
import { recordHref } from '../../lib/routes.js';
import { useEInvoiceWorkbenchData } from './hooks/useEInvoiceWorkbenchData.js';
import { useEInvoiceWorkbenchWorkflow } from './hooks/useEInvoiceWorkbenchWorkflow.js';
const formatDateTime = (value) => value ? fmtDateTime(value) : '—';
const statusTone = (status) => status === 'issued' || status === 'cancelled' ? 'success' : status === 'failed' ? 'danger' : status === 'withdrawn' ? 'muted' : 'warning';
export default function EInvoiceWorkbenchPage() {
  useDocumentTitle(`${uiText('Hóa đơn điện tử')} · OSP Suite`);
  const { rows, invoices, loading, error: loadError, setError: setLoadError, load } = useEInvoiceWorkbenchData();
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const workflow = useEInvoiceWorkbenchWorkflow({ load, clearLoadError: () => setLoadError('') });
  const { reason, setReason, busy, error: workflowError, notice, run, requestCancellation } = workflow;
  const error = loadError || workflowError;
  useEffect(() => { setSelectedId((current) => current && rows.some((row) => row.id === current) ? current : rows[0]?.id || ''); }, [rows]);
  const counts = useMemo(() => rows.reduce((result, row) => {
    result.all += 1;
    result[row.status] = (result[row.status] || 0) + 1;
    return result;
  }, { all: 0 }), [rows]);
  const visibleRows = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase(uiLocale);
    return rows.filter((row) => {
      if (filter !== 'all' && row.status !== filter) return false;
      if (!needle) return true;
      const source = invoices.get(row.invoice);
      return [row.number, row.serial, row.provider, row.provider_reference, row.provider_error, source?.number, row.invoice]
        .some((value) => String(value || '').toLocaleLowerCase(uiLocale).includes(needle));
    });
  }, [rows, invoices, filter, search, uiLocale]);
  const selected = rows.find((row) => row.id === selectedId);
  const selectedInvoice = selected ? invoices.get(selected.invoice) : null;
  const enabled = app.meta?.modules?.some((module) => module.id === 'einvoice');
  const filterOptions = [
    ['all', 'Tất cả'], ['pending', 'Chờ phát hành'], ['failed', 'Lỗi'],
    ['issued', 'Đã phát hành'], ['cancellation_pending', 'Chờ hủy'], ['cancelled', 'Đã hủy'], ['withdrawn', 'Đã rút'],
  ];
  return <div className="page">
    <div className="page-head"><div><h1>{uiText("Hóa đơn điện tử")}</h1><p className="sub">{uiText("Theo dõi yêu cầu phát hành từ hóa đơn kế toán đã ghi sổ, xử lý lỗi provider và lưu dấu vết hủy theo từng ngành hàng.")}</p></div><button className="btn btn-secondary" type="button" disabled={loading || Boolean(busy)} onClick={load}>{uiText("Làm mới")}</button></div>
    {error && <div className="alert danger" role="alert">{uiText(error)}</div>}{notice && <div className="alert success" role="status">{uiText(notice)}</div>}
    {!enabled && <div className="alert warning" role="status">{uiText("Module hóa đơn điện tử hiện không nằm trong gói ngành của tenant.")}</div>}
    <div className="stats u-mb-16" >
      {filterOptions.map(([key, label]) => <button key={key} className={`card stat einvoice-filter${filter === key ? ' is-active' : ''}`} type="button" onClick={() => setFilter(key)} aria-pressed={filter === key}><span className="stat-label">{uiText(label)}</span><strong className="stat-value">{counts[key] || 0}</strong></button>)}
    </div>
    <section className="card card-pad">
      <div className="row wrap u-mb-12" ><h2>{uiText("Hàng đợi phát hành")}</h2><span className="grow"/><input className="input u-max-w-340"  aria-label={uiText('Tìm hóa đơn điện tử')} placeholder={uiText('Tìm số hóa đơn, provider, lỗi…')} value={search} onChange={(event) => setSearch(event.target.value)}/></div>
      {loading ? <div className="skeleton" data-h="row"/> : !visibleRows.length ? <div className="empty">{rows.length ? uiText('Không có yêu cầu phù hợp bộ lọc.') : uiText('Chưa có yêu cầu. Hệ thống tạo yêu cầu sau khi hóa đơn kế toán được ghi sổ.')}</div> : <div className="table-wrap"><table className="table"><thead><tr><th>{uiText("Hóa đơn điện tử")}</th><th>{uiText("Hóa đơn kế toán")}</th><th>{uiText("Provider")}</th><th>{uiText("Trạng thái")}</th><th>{uiText("Lần thử / cập nhật")}</th><th>{uiText("Thao tác")}</th></tr></thead><tbody>{visibleRows.map((row) => {
        const invoice = invoices.get(row.invoice);
        const retryAction = row.operation === 'cancel' ? 'retry_cancellation' : 'retry';
        return <tr {...selectableTableRowProps} key={row.id} className={`einvoice-row${selectedId === row.id ? ' selected' : ''}`} aria-selected={selectedId === row.id} onClick={() => setSelectedId(row.id)}>
          <td><strong>{row.number || row.serial || `${uiText('Yêu cầu')} ${String(row.id).slice(0, 8)}`}</strong><div className="small muted">{row.lookup_code ? `${uiText('Mã tra cứu')} ${row.lookup_code}` : row.provider_reference || uiText('Chưa có mã từ nhà cung cấp')}</div></td>
          <td>{invoice ? <a href={recordHref('accounting.invoice', invoice.id)} onClick={(event) => event.stopPropagation()}>{invoice.number || String(invoice.id).slice(0, 8)}</a> : <span className="small muted">{row.invoice ? `#${String(row.invoice).slice(0, 8)}` : '—'}</span>}{invoice?.party && <div className="small muted">{uiText('Đối tác')} #{String(invoice.party).slice(0, 8)}</div>}</td>
          <td>{row.provider || uiText('Chưa cấu hình')}{row.serial && <div className="small muted">{uiText('Ký hiệu')} {row.serial}</div>}</td>
          <td><span className={`badge ${statusTone(row.status)}`}>{statusLabel(row.status)}</span>{row.retry_at && <div className="small muted">{uiText('Tự thử lại')} {formatDateTime(row.retry_at)}</div>}{row.provider_error && <div className="small error-text" title={row.provider_error}>{String(row.provider_error).slice(0, 90)}</div>}</td>
          <td>{Number(row.attempts || 0)} {uiText('lần')}<div className="small muted">{formatDateTime(timestamp(row))}</div></td>
          <td onClick={(event) => event.stopPropagation()}><div className="row wrap">
            {row.status === 'failed' && can(`einvoice.einvoice.${retryAction}`) && <button className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => run(row, retryAction, uiText('Đã đưa yêu cầu vào hàng đợi thử lại.'))}>{uiText("Thử lại")}</button>}
            {row.status === 'pending' && Number(row.attempts || 0) === 0 && can('einvoice.einvoice.withdrawn') && <button className="btn btn-ghost btn-sm" disabled={Boolean(busy)} onClick={() => run(row, 'withdrawn', uiText('Đã rút yêu cầu phát hành chưa gửi đến nhà cung cấp.'))}>{uiText("Rút yêu cầu")}</button>}
            {row.status === 'issued' && can('einvoice.einvoice.cancel_requested') && can('einvoice.einvoice.update') && <button className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => { setSelectedId(row.id); setReason(row.cancellation_reason || ''); document.getElementById('einvoice-cancellation-reason')?.focus(); }}>{uiText("Yêu cầu hủy")}</button>}
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => setSelectedId(row.id)}>{uiText("Chi tiết")}</button>
          </div></td>
        </tr>;
      })}</tbody></table></div>}
    </section>
    {selected && <section className="card card-pad u-mt-16" >
      <div className="row wrap"><div><h2>{uiText("Chi tiết yêu cầu")}</h2><p className="small muted">{uiText('Mã yêu cầu:')} {selected.id}</p></div><span className="grow"/><span className={`badge ${statusTone(selected.status)}`}>{statusLabel(selected.status)}</span></div>
      <div className="form-grid">
        <div><span className="label">{uiText("Hóa đơn nguồn")}</span><p>{selectedInvoice ? <a href={recordHref('accounting.invoice', selectedInvoice.id)}>{selectedInvoice.number || selectedInvoice.id}</a> : selected.invoice || '—'}</p></div>
        <div><span className="label">{uiText("Nhà cung cấp")}</span><p>{selected.provider || uiText('Chưa phát hành')}{selected.provider_reference ? ` · ${selected.provider_reference}` : ''}</p></div>
        <div><span className="label">{uiText("Số hóa đơn / ký hiệu")}</span><p>{[selected.number, selected.serial].filter(Boolean).join(' · ') || uiText('Chưa được cấp')}</p></div>
        <div><span className="label">{uiText("Mã tra cứu")}</span><p>{selected.lookup_code || '—'}</p></div>
        <div><span className="label">{uiText("Số lần gọi provider")}</span><p>{Number(selected.attempts || 0)}</p></div>
        <div><span className="label">{uiText("Cập nhật gần nhất")}</span><p>{formatDateTime(timestamp(selected))}</p></div>
        {selected.retry_at && <div><span className="label">{uiText("Lần thử tự động tiếp theo")}</span><p>{formatDateTime(selected.retry_at)}</p></div>}
        {selected.provider_error && <div className="full"><span className="label">{uiText("Lỗi gần nhất")}</span><div className="alert danger">{selected.provider_error}</div></div>}
        {selected.cancellation_reason && <div className="full"><span className="label">{uiText("Lý do hủy")}</span><p>{selected.cancellation_reason}</p></div>}
      </div>
      {selected.status === 'issued' && can('einvoice.einvoice.cancel_requested') && can('einvoice.einvoice.update') && <form className="form-grid u-mt-16"  onSubmit={(event) => { event.preventDefault(); requestCancellation(selected); }}>
        <label className="field full"><span className="label">{uiText("Lý do yêu cầu hủy *")}</span><textarea id="einvoice-cancellation-reason" className="input" rows="3" maxLength="2000" required value={reason} onChange={(event) => setReason(event.target.value)} placeholder={uiText('Nêu lý do nghiệp vụ để gửi đến nhà cung cấp hóa đơn điện tử.')}/></label>
        <div className="row full"><span className="small muted">{uiText("Yêu cầu chỉ chuyển sang đã hủy sau khi provider xác nhận.")}</span><span className="grow"/><button className="btn btn-secondary" disabled={Boolean(busy) || !reason.trim()}>{uiText("Gửi yêu cầu hủy")}</button></div>
      </form>}
      {(selected.provider_response || selected.cancellation_response) && <details className="u-mt-16"><summary>{uiText("Phản hồi nhà cung cấp")}</summary><pre className="code-block u-pre-wrap-break-words" >{JSON.stringify({ issuance: selected.provider_response, cancellation: selected.cancellation_response }, null, 2)}</pre></details>}
      {Array.isArray(selected.attempt_history) && selected.attempt_history.length > 0 && <details className="u-mt-12"><summary>{uiText('Lịch sử lần thử')} ({selected.attempt_history.length})</summary><ol>{selected.attempt_history.map((attempt, index) => <li key={`${attempt.attempt || index}:${index}`}><strong>{uiText('Lần')} {attempt.attempt || index + 1}</strong> · {uiText(attempt.operation === 'cancel' ? 'Hủy' : 'Phát hành')} · {attempt.error || uiText('Không có chi tiết lỗi')}</li>)}</ol></details>}
    </section>}
    <p className="small muted u-mt-12" >{uiText('Worker chỉ xử lý yêu cầu khi máy chủ đã cấu hình HTTPS provider. Hợp đồng REST chung cần được ánh xạ và xác nhận với nhà cung cấp thực tế trước khi dùng phát hành chính thức.')}</p>
  </div>;
}
