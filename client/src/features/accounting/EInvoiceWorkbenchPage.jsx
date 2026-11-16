import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api, dataPath } from '../../lib/api.js';
import { statusLabel, fmtDateTime } from '../../lib/i18n.js';
import { app, can } from '../../lib/state.js';
import { recordHref } from '../../lib/routes.js';

const itemsOf = (response) => Array.isArray(response?.items) ? response.items : [];
async function listAll(qname) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const response = await api(`${dataPath(qname)}?${new URLSearchParams({ limit: '1000', offset: String(offset) })}`);
    const items = itemsOf(response);
    rows.push(...items);
    if (items.length < 1000 || rows.length >= Number(response?.total ?? rows.length)) break;
  }
  return rows;
}

const timestamp = (row) => row.updatedAt || row.updated_at || row.createdAt || row.created_at || '';
const formatDateTime = (value) => value ? fmtDateTime(value) : '—';
const statusTone = (status) => status === 'issued' || status === 'cancelled' ? 'success' : status === 'failed' ? 'danger' : status === 'withdrawn' ? 'muted' : 'warning';

export default function EInvoiceWorkbenchPage() {
  const [rows, setRows] = useState([]);
  const [invoices, setInvoices] = useState(new Map());
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [requests, invoiceRows] = await Promise.all([
        listAll('einvoice.einvoice'),
        can('accounting.invoice.read') ? listAll('accounting.invoice') : Promise.resolve([]),
      ]);
      requests.sort((a, b) => String(timestamp(b)).localeCompare(String(timestamp(a))));
      setRows(requests);
      setInvoices(new Map(invoiceRows.map((invoice) => [invoice.id, invoice])));
      setSelectedId((current) => requests.some((row) => row.id === current) ? current : requests[0]?.id || '');
    } catch (reason) {
      setError(reason.message || 'Không tải được danh sách hóa đơn điện tử.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    document.title = 'Hóa đơn điện tử · OSP Suite';
    load();
  }, [load]);

  const counts = useMemo(() => rows.reduce((result, row) => {
    result.all += 1;
    result[row.status] = (result[row.status] || 0) + 1;
    return result;
  }, { all: 0 }), [rows]);
  const visibleRows = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase('vi');
    return rows.filter((row) => {
      if (filter !== 'all' && row.status !== filter) return false;
      if (!needle) return true;
      const source = invoices.get(row.invoice);
      return [row.number, row.serial, row.provider, row.provider_reference, row.provider_error, source?.number, row.invoice]
        .some((value) => String(value || '').toLocaleLowerCase('vi').includes(needle));
    });
  }, [rows, invoices, filter, search]);
  const selected = rows.find((row) => row.id === selectedId);
  const selectedInvoice = selected ? invoices.get(selected.invoice) : null;

  async function run(row, action, success, operation = () => api(dataPath('einvoice.einvoice', row.id, action), { method: 'POST' })) {
    setBusy(`${row.id}:${action}`);
    setError('');
    setNotice('');
    try {
      await operation();
      setNotice(success);
      await load();
    } catch (reason) {
      setError(reason.message || 'Không cập nhật được yêu cầu hóa đơn điện tử.');
    } finally {
      setBusy('');
    }
  }

  function requestCancellation(row) {
    const value = reason.trim();
    if (!value) {
      setError('Nhập lý do hủy theo quy trình nghiệp vụ trước khi gửi nhà cung cấp.');
      return;
    }
    if (value.length > 2000) {
      setError('Lý do hủy không được vượt quá 2.000 ký tự.');
      return;
    }
    run(row, 'cancel_requested', 'Đã đưa yêu cầu hủy vào hàng đợi xử lý.', async () => {
      await api(dataPath('einvoice.einvoice', row.id, 'cancel_requested'), { method: 'POST', body: { cancellation_reason: value } });
      setReason('');
    });
  }

  const enabled = app.meta?.modules?.some((module) => module.id === 'einvoice');
  const filterOptions = [
    ['all', 'Tất cả'], ['pending', 'Chờ phát hành'], ['failed', 'Lỗi'],
    ['issued', 'Đã phát hành'], ['cancellation_pending', 'Chờ hủy'], ['cancelled', 'Đã hủy'], ['withdrawn', 'Đã rút'],
  ];

  return <div className="page">
    <div className="page-head"><div><h1>Hóa đơn điện tử</h1><p className="sub">Theo dõi yêu cầu phát hành từ hóa đơn kế toán đã ghi sổ, xử lý lỗi provider và lưu dấu vết hủy theo từng ngành hàng.</p></div><button className="btn btn-secondary" type="button" disabled={loading || Boolean(busy)} onClick={load}>Làm mới</button></div>
    {error && <div className="alert danger" role="alert">{error}</div>}{notice && <div className="alert success" role="status">{notice}</div>}
    {!enabled && <div className="alert warning" role="status">Module hóa đơn điện tử hiện không nằm trong gói ngành của tenant.</div>}
    <div className="stats" style={{ marginBottom: 16 }}>
      {filterOptions.map(([key, label]) => <button key={key} className="card stat" type="button" onClick={() => setFilter(key)} aria-pressed={filter === key} style={filter === key ? { borderColor: 'var(--accent)', background: 'var(--accent-soft)' } : undefined}><span className="stat-label">{label}</span><strong className="stat-value">{counts[key] || 0}</strong></button>)}
    </div>
    <section className="card card-pad">
      <div className="row wrap" style={{ marginBottom: 12 }}><h2>Hàng đợi phát hành</h2><span className="grow"/><input className="input" style={{ maxWidth: 340 }} aria-label="Tìm hóa đơn điện tử" placeholder="Tìm số hóa đơn, provider, lỗi…" value={search} onChange={(event) => setSearch(event.target.value)}/></div>
      {loading ? <div className="skeleton" data-h="row"/> : !visibleRows.length ? <div className="empty">{rows.length ? 'Không có yêu cầu phù hợp bộ lọc.' : 'Chưa có yêu cầu. Hệ thống tạo yêu cầu sau khi hóa đơn kế toán được ghi sổ.'}</div> : <div className="table-wrap"><table className="table"><thead><tr><th>Hóa đơn điện tử</th><th>Hóa đơn kế toán</th><th>Provider</th><th>Trạng thái</th><th>Lần thử / cập nhật</th><th>Thao tác</th></tr></thead><tbody>{visibleRows.map((row) => {
        const invoice = invoices.get(row.invoice);
        const retryAction = row.operation === 'cancel' ? 'retry_cancellation' : 'retry';
        return <tr key={row.id} onClick={() => setSelectedId(row.id)} style={{ cursor: 'pointer', background: selectedId === row.id ? 'var(--surface-2)' : undefined }}>
          <td><strong>{row.number || row.serial || `Yêu cầu ${String(row.id).slice(0, 8)}`}</strong><div className="small muted">{row.lookup_code ? `Mã tra cứu ${row.lookup_code}` : row.provider_reference || 'Chưa có mã từ nhà cung cấp'}</div></td>
          <td>{invoice ? <a href={recordHref('accounting.invoice', invoice.id)} onClick={(event) => event.stopPropagation()}>{invoice.number || String(invoice.id).slice(0, 8)}</a> : <span className="small muted">{row.invoice ? `#${String(row.invoice).slice(0, 8)}` : '—'}</span>}{invoice?.party && <div className="small muted">Đối tác #{String(invoice.party).slice(0, 8)}</div>}</td>
          <td>{row.provider || 'Chưa cấu hình'}{row.serial && <div className="small muted">Ký hiệu {row.serial}</div>}</td>
          <td><span className={`badge ${statusTone(row.status)}`}>{statusLabel(row.status)}</span>{row.retry_at && <div className="small muted">Tự thử lại {formatDateTime(row.retry_at)}</div>}{row.provider_error && <div className="small error-text" title={row.provider_error}>{String(row.provider_error).slice(0, 90)}</div>}</td>
          <td>{Number(row.attempts || 0)} lần<div className="small muted">{formatDateTime(timestamp(row))}</div></td>
          <td onClick={(event) => event.stopPropagation()}><div className="row wrap">
            {row.status === 'failed' && can(`einvoice.einvoice.${retryAction}`) && <button className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => run(row, retryAction, 'Đã đưa yêu cầu vào hàng đợi thử lại.')}>Thử lại</button>}
            {row.status === 'pending' && Number(row.attempts || 0) === 0 && can('einvoice.einvoice.withdrawn') && <button className="btn btn-ghost btn-sm" disabled={Boolean(busy)} onClick={() => run(row, 'withdrawn', 'Đã rút yêu cầu phát hành chưa gửi đến nhà cung cấp.')}>Rút yêu cầu</button>}
            {row.status === 'issued' && can('einvoice.einvoice.cancel_requested') && can('einvoice.einvoice.update') && <button className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => { setSelectedId(row.id); setReason(row.cancellation_reason || ''); document.getElementById('einvoice-cancellation-reason')?.focus(); }}>Yêu cầu hủy</button>}
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => setSelectedId(row.id)}>Chi tiết</button>
          </div></td>
        </tr>;
      })}</tbody></table></div>}
    </section>
    {selected && <section className="card card-pad" style={{ marginTop: 16 }}>
      <div className="row wrap"><div><h2>Chi tiết yêu cầu</h2><p className="small muted">Mã yêu cầu: {selected.id}</p></div><span className="grow"/><span className={`badge ${statusTone(selected.status)}`}>{statusLabel(selected.status)}</span></div>
      <div className="form-grid">
        <div><span className="label">Hóa đơn nguồn</span><p>{selectedInvoice ? <a href={recordHref('accounting.invoice', selectedInvoice.id)}>{selectedInvoice.number || selectedInvoice.id}</a> : selected.invoice || '—'}</p></div>
        <div><span className="label">Nhà cung cấp</span><p>{selected.provider || 'Chưa phát hành'}{selected.provider_reference ? ` · ${selected.provider_reference}` : ''}</p></div>
        <div><span className="label">Số hóa đơn / ký hiệu</span><p>{[selected.number, selected.serial].filter(Boolean).join(' · ') || 'Chưa được cấp'}</p></div>
        <div><span className="label">Mã tra cứu</span><p>{selected.lookup_code || '—'}</p></div>
        <div><span className="label">Số lần gọi provider</span><p>{Number(selected.attempts || 0)}</p></div>
        <div><span className="label">Cập nhật gần nhất</span><p>{formatDateTime(timestamp(selected))}</p></div>
        {selected.retry_at && <div><span className="label">Lần thử tự động tiếp theo</span><p>{formatDateTime(selected.retry_at)}</p></div>}
        {selected.provider_error && <div className="full"><span className="label">Lỗi gần nhất</span><div className="alert danger">{selected.provider_error}</div></div>}
        {selected.cancellation_reason && <div className="full"><span className="label">Lý do hủy</span><p>{selected.cancellation_reason}</p></div>}
      </div>
      {selected.status === 'issued' && can('einvoice.einvoice.cancel_requested') && can('einvoice.einvoice.update') && <form className="form-grid" style={{ marginTop: 16 }} onSubmit={(event) => { event.preventDefault(); requestCancellation(selected); }}>
        <label className="field full"><span className="label">Lý do yêu cầu hủy *</span><textarea id="einvoice-cancellation-reason" className="input" rows="3" maxLength="2000" required value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Nêu lý do nghiệp vụ để gửi đến nhà cung cấp hóa đơn điện tử."/></label>
        <div className="row full"><span className="small muted">Yêu cầu chỉ chuyển sang đã hủy sau khi provider xác nhận.</span><span className="grow"/><button className="btn btn-secondary" disabled={Boolean(busy) || !reason.trim()}>Gửi yêu cầu hủy</button></div>
      </form>}
      {(selected.provider_response || selected.cancellation_response) && <details style={{ marginTop: 16 }}><summary>Phản hồi nhà cung cấp</summary><pre className="code-block" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify({ issuance: selected.provider_response, cancellation: selected.cancellation_response }, null, 2)}</pre></details>}
      {Array.isArray(selected.attempt_history) && selected.attempt_history.length > 0 && <details style={{ marginTop: 12 }}><summary>Lịch sử lần thử ({selected.attempt_history.length})</summary><ol>{selected.attempt_history.map((attempt, index) => <li key={`${attempt.attempt || index}:${index}`}><strong>Lần {attempt.attempt || index + 1}</strong> · {attempt.operation === 'cancel' ? 'Hủy' : 'Phát hành'} · {attempt.error || 'Không có chi tiết lỗi'}</li>)}</ol></details>}
    </section>}
    <p className="small muted" style={{ marginTop: 12 }}>Worker chỉ xử lý yêu cầu khi máy chủ đã cấu hình HTTPS provider. Hợp đồng REST chung cần được ánh xạ và xác nhận với nhà cung cấp thực tế trước khi dùng phát hành chính thức.</p>
  </div>;
}
