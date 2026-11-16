import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { selectableTableRowProps } from '../../lib/accessibility.js';
import { localDate } from '../../lib/dates.js';
import { api, dataPath } from '../../lib/api.js';
import { fmtDate, fmtMoney, statusLabel, uiText } from '../../lib/i18n.js';
import { app, can, loadRefs, recordLabel } from '../../lib/state.js';
import { recordHref } from '../../lib/routes.js';

const itemsOf = (response) => Array.isArray(response?.items) ? response.items : [];
const number = (value) => Number(value || 0);
async function listAll(qname) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const response = await api(`${dataPath(qname)}?${new URLSearchParams({ limit: '1000', offset: String(offset) })}`);
    const items = itemsOf(response); rows.push(...items);
    if (items.length < 1000 || rows.length >= Number(response?.total ?? rows.length)) break;
  }
  return rows;
}
const action = (row, verb) => api(dataPath('purchasing.rfq', row.id, verb), { method: 'POST' });

export default function PurchasingSourcingWorkbenchPage() {
  const emailQueueEnabled = app.meta?.modules?.some((module) => module.id === 'communication') || false;
  const [requisitions, setRequisitions] = useState([]);
  const [rfqs, setRfqs] = useState([]);
  const [orders, setOrders] = useState([]);
  const [suppliers, setSuppliers] = useState(new Map());
  const [products, setProducts] = useState(new Map());
  const [units, setUnits] = useState(new Map());
  const [taxes, setTaxes] = useState(new Map());
  const [selectedId, setSelectedId] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [responseDue, setResponseDue] = useState('');
  const [quoteDrafts, setQuoteDrafts] = useState({});
  const [quoteMeta, setQuoteMeta] = useState({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async (quiet = false) => {
    if (!quiet) { setLoading(true); setError(''); }
    try {
      const [requisitionRows, rfqRows, orderRows, supplierMap, productMap, unitMap, taxRows] = await Promise.all([
        can('purchasing.purchase_requisition.read') ? listAll('purchasing.purchase_requisition') : Promise.resolve([]),
        can('purchasing.rfq.read') ? listAll('purchasing.rfq') : Promise.resolve([]),
        can('purchasing.purchase_order.read') ? listAll('purchasing.purchase_order') : Promise.resolve([]),
        can('master-data.party.read') ? loadRefs('master-data.party') : Promise.resolve(new Map()),
        can('master-data.product.read') ? loadRefs('master-data.product') : Promise.resolve(new Map()),
        can('master-data.uom.read') ? loadRefs('master-data.uom') : Promise.resolve(new Map()),
        can('master-data.tax.read') ? listAll('master-data.tax') : Promise.resolve([]),
      ]);
      const activeRequisitions = requisitionRows.filter((row) => row.sourcing_method === 'competitive' && ['approved', 'sourced'].includes(row.status)).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
      setRequisitions(activeRequisitions); setRfqs(rfqRows); setOrders(orderRows);
      setSuppliers(new Map([...supplierMap].filter(([, row]) => row.is_supplier !== false)));
      setProducts(productMap); setUnits(unitMap); setTaxes(new Map(taxRows.map((row) => [row.id, row])));
      setSelectedId((current) => activeRequisitions.some((row) => row.id === current) ? current : activeRequisitions[0]?.id || '');
    } catch (reason) { setError(reason.message || uiText('Không tải được hồ sơ RFQ và đề nghị mua cạnh tranh.')); }
    finally { if (!quiet) setLoading(false); }
  }, []);
  useEffect(() => { document.title = `${uiText('RFQ và so sánh báo giá')} · OSP Suite`; load(); }, [load]);

  const selected = requisitions.find((row) => row.id === selectedId);
  const quotes = useMemo(() => rfqs.filter((row) => row.purchase_requisition === selectedId).sort((a, b) => quoteTotal(a) - quoteTotal(b)), [rfqs, selectedId, taxes]);
  const winner = quotes.find((row) => row.status === 'accepted');
  const acceptedOrder = winner && orders.find((row) => row.source === 'rfq' && row.source_id === winner.id);
  const invitedSuppliers = new Set(quotes.map((row) => row.supplier));
  const eligibleSuppliers = [...suppliers.values()].filter((row) => row.active !== false && !invitedSuppliers.has(row.id));

  function quoteTotal(row) {
    return (row.quote_lines || []).reduce((sum, line) => {
      const rate = number(taxes.get(line.tax)?.rate);
      return sum + number(line.qty) * number(line.price) * (1 + rate / 100);
    }, 0);
  }
  function quoteLines(row) {
    const lines = quoteDrafts[row.id] || (row.quote_lines?.length ? row.quote_lines : (row.lines || []).map((line) => ({ ...line, price: '', tax: '' })));
    return lines.map((line) => ({ ...line, uom_name: line.uom_name || units.get(line.uom)?.name || '' }));
  }
  async function run(key, operation, success) {
    setBusy(key); setError(''); setNotice('');
    try { await operation(); setNotice(success); await load(true); }
    catch (reason) { setError(reason.message || uiText('Không cập nhật được hồ sơ báo giá.')); await load(true); }
    finally { setBusy(''); }
  }
  async function createRfq(event) {
    event.preventDefault();
    if (!selected || !supplierId || winner) return;
    await run('rfq:create', async () => {
      await api(dataPath('purchasing.rfq'), { method: 'POST', body: {
        purchase_requisition: selected.id, supplier: supplierId, warehouse: selected.warehouse,
        department: selected.department || undefined, lines: selected.lines || [], quote_lines: [],
        response_due: responseDue || undefined,
      } });
      setSupplierId('');
    }, uiText('Đã lập hồ sơ RFQ cho nhà cung cấp. Gửi yêu cầu, sau đó ghi báo giá nhận được vào đúng hồ sơ.'));
  }
  async function saveQuote(row) {
    const lines = quoteLines(row).map((line) => ({
      product: line.product, qty: number(line.qty), price: number(line.price), ...(line.uom ? { uom: line.uom } : {}), ...(line.tax ? { tax: line.tax } : {}),
    }));
    if (!lines.length || lines.some((line) => !Number.isFinite(line.price) || line.price <= 0)) {
      setError(uiText('Nhập đơn giá lớn hơn 0 cho mọi dòng báo giá.')); return;
    }
    const meta = quoteMeta[row.id] || {};
    await run(`${row.id}:quoted`, async () => {
      const body = { quote_lines: lines };
      const quoteReference = meta.quote_reference ?? row.quote_reference;
      const validUntil = meta.valid_until ?? row.valid_until;
      if (quoteReference != null) body.quote_reference = String(quoteReference).trim() || null;
      if (validUntil != null) body.valid_until = validUntil || null;
      await api(dataPath('purchasing.rfq', row.id, 'quoted'), { method: 'POST', body });
    }, uiText('Đã lưu báo giá và đưa vào bảng so sánh.'));
  }
  async function rfqAction(row, verb) {
    const messages = {
      sent: uiText(emailQueueEnabled
        ? 'RFQ đã được đánh dấu gửi và email mời báo giá đã xếp vào hàng đợi gửi.'
        : 'Đã ghi nhận yêu cầu báo giá đã gửi cho nhà cung cấp.',
      ),
      accepted: uiText('Đã chọn báo giá. Đơn mua nháp đã được tạo; các báo giá cạnh tranh được đóng.'),
      rejected: uiText('Đã từ chối báo giá nhà cung cấp.'),
      cancelled: uiText('Đã hủy RFQ nháp.'),
    };
    await run(`${row.id}:${verb}`, () => action(row, verb), messages[verb]);
  }

  return <div className="page">
    <div className="page-head"><div><h1>{uiText('RFQ và so sánh báo giá')}</h1><p className="sub">{uiText('Mỗi nhà cung cấp nhận một hồ sơ riêng cho cùng danh sách hàng. So sánh tổng giá sau thuế, hạn hiệu lực và chọn duy nhất một báo giá để chuyển thành đơn mua.')}</p></div><button className="btn btn-secondary" type="button" disabled={loading || Boolean(busy)} onClick={() => load()}>{uiText('Làm mới')}</button></div>
    {error && <div className="alert danger" role="alert">{error}</div>}{notice && <div className="alert success" role="status">{notice}</div>}
    {loading ? <div className="skeleton" data-h="row"/> : <div className="layout-split">
      <section className="card card-pad"><h2>{uiText('Đề nghị mua cạnh tranh')}</h2><div className="table-wrap"><table className="table"><thead><tr><th>{uiText('Đề nghị')}</th><th>{uiText('Kho')}</th><th>{uiText('Trạng thái')}</th></tr></thead><tbody>{requisitions.map((row) => <tr {...selectableTableRowProps} key={row.id} className={row.id === selectedId ? 'selected' : ''} onClick={() => { setSelectedId(row.id); setSupplierId(''); }} style={{ cursor: 'pointer' }}><td><strong>{row.requested_by || `PR ${String(row.id).slice(0, 8)}`}</strong><div className="small muted">{row.reason || `${row.lines?.length || 0} ${uiText('dòng hàng')}`}</div></td><td>{row.warehouse ? String(row.warehouse).slice(0, 8) : '—'}</td><td>{statusLabel(row.status)}</td></tr>)}</tbody></table></div>{!requisitions.length && <p className="small muted">{uiText('Chưa có đề nghị mua ở chế độ so sánh báo giá đã được duyệt.')}</p>}</section>
      {selected && <section className="card card-pad"><div className="row wrap"><div><h2>{selected.reason || `${uiText('Đề nghị')} ${String(selected.id).slice(0, 8)}`}</h2><p className="small muted">{selected.lines?.length || 0} {uiText('dòng')} · {uiText('kho')} {String(selected.warehouse || '').slice(0, 8)} · {statusLabel(selected.status)}</p></div><span className="grow"/>{acceptedOrder && <a className="btn btn-secondary btn-sm" href={recordHref('purchasing.purchase_order', acceptedOrder.id)}>{uiText('Mở đơn mua đã tạo')}</a>}</div>
        <div className="table-wrap"><table className="table"><thead><tr><th>{uiText('Hàng yêu cầu')}</th><th>{uiText('Số lượng')}</th></tr></thead><tbody>{(selected.lines || []).map((line, index) => <tr key={`${line.product}-${index}`}><td>{products.get(line.product)?.name || String(line.product).slice(0, 8)}</td><td>{line.qty} {line.uom_name || units.get(line.uom)?.name || ''}</td></tr>)}</tbody></table></div>
        {can('purchasing.rfq.create') && selected.status === 'approved' && !winner && <form className="row wrap" style={{ marginTop: 12 }} onSubmit={createRfq}><input className="input" aria-label={uiText('Hạn nhà cung cấp phản hồi báo giá')} type="date" min={localDate()} value={responseDue} onChange={(event) => setResponseDue(event.target.value)}/><select className="select" required value={supplierId} onChange={(event) => setSupplierId(event.target.value)}><option value="">{uiText('Thêm nhà cung cấp vào vòng báo giá…')}</option>{eligibleSuppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{recordLabel('master-data.party', supplier)}</option>)}</select><button className="btn btn-primary" disabled={Boolean(busy) || !supplierId}>{uiText('Tạo RFQ')}</button></form>}
        <div className="table-wrap" style={{ marginTop: 14 }}><table className="table"><thead><tr><th>{uiText('Nhà cung cấp / hồ sơ')}</th><th>{uiText('Báo giá từng dòng')}</th><th>{uiText('Tổng sau thuế')}</th><th>{uiText('Hiệu lực')}</th><th>{uiText('Trạng thái / thao tác')}</th></tr></thead><tbody>{quotes.map((row) => {
          const editable = row.status === 'sent' && can('purchasing.rfq.update') && can('purchasing.rfq.quoted');
          const draft = quoteLines(row);
          const meta = quoteMeta[row.id] || {};
          const total = quoteTotal({ quote_lines: draft });
          return <tr key={row.id} className={row.status === 'accepted' ? 'selected' : ''}>
            <td><strong>{recordLabel('master-data.party', suppliers.get(row.supplier))}</strong><div className="small muted"><a href={recordHref('purchasing.rfq', row.id)}>RFQ {String(row.id).slice(0, 8)}</a>{row.quote_reference ? ` · ${row.quote_reference}` : ''}</div></td>
            <td>{draft.map((line, index) => <div className="row wrap" key={`${line.product}-${index}`} style={{ marginBottom: 6 }}><span className="small grow">{products.get(line.product)?.name || uiText('Hàng hóa')} · {line.qty} {line.uom_name}</span>{editable ? <><input className="input num" aria-label={uiText('Đơn giá báo')} type="number" min="0.000001" step="any" style={{ maxWidth: 130 }} value={line.price ?? ''} onChange={(event) => setQuoteDrafts((current) => ({ ...current, [row.id]: draft.map((item, i) => i === index ? { ...item, price: event.target.value } : item) }))}/><select className="select" aria-label={uiText('Thuế báo giá')} style={{ maxWidth: 150 }} value={line.tax || ''} onChange={(event) => setQuoteDrafts((current) => ({ ...current, [row.id]: draft.map((item, i) => i === index ? { ...item, tax: event.target.value } : item) }))}><option value="">{uiText('Không thuế')}</option>{[...taxes.values()].map((tax) => <option key={tax.id} value={tax.id}>{tax.name} · {tax.rate}%</option>)}</select></> : <span className="small">{fmtMoney(number(line.price) * number(line.qty) * (1 + number(taxes.get(line.tax)?.rate) / 100))}</span>}</div>)}</td>
            <td><strong>{row.status === 'sent' ? (total > 0 ? fmtMoney(total) : uiText('Chưa báo giá')) : fmtMoney(quoteTotal(row))}</strong></td>
            <td>{row.response_due && <div className="small muted">{uiText('Phản hồi trước')} {fmtDate(row.response_due)}</div>}{editable ? <><input className="input" aria-label={uiText('Số tham chiếu báo giá')} maxLength="120" placeholder={uiText('Số báo giá')} value={meta.quote_reference ?? row.quote_reference ?? ''} onChange={(event) => setQuoteMeta((current) => ({ ...current, [row.id]: { ...meta, quote_reference: event.target.value } }))}/><input className="input" aria-label={uiText('Ngày hết hạn báo giá')} type="date" value={meta.valid_until ?? row.valid_until ?? ''} onChange={(event) => setQuoteMeta((current) => ({ ...current, [row.id]: { ...meta, valid_until: event.target.value } }))}/></> : <>{row.valid_until ? fmtDate(row.valid_until) : uiText('Không giới hạn')}<div className="small muted">{row.quote_reference || ''}</div></>}</td>
            <td><span className={`badge ${row.status === 'accepted' ? 'success' : row.status === 'rejected' || row.status === 'cancelled' ? 'danger' : 'warning'}`}>{statusLabel(row.status)}</span><div className="row wrap" style={{ marginTop: 6 }}>{row.status === 'draft' && can('purchasing.rfq.sent') && <button className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => rfqAction(row, 'sent')}>{uiText(emailQueueEnabled ? 'Gửi lời mời báo giá' : 'Ghi nhận đã gửi')}</button>}{editable && <button className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => saveQuote(row)}>{uiText('Lưu báo giá')}</button>}{row.status === 'quoted' && !winner && can('purchasing.rfq.accepted') && <button className="btn btn-primary btn-sm" disabled={Boolean(busy)} onClick={() => rfqAction(row, 'accepted')}>{uiText('Chọn báo giá')}</button>}{['sent','quoted'].includes(row.status) && can('purchasing.rfq.rejected') && <button className="btn btn-ghost btn-sm" disabled={Boolean(busy)} onClick={() => rfqAction(row, 'rejected')}>{uiText('Từ chối')}</button>}{row.status === 'draft' && can('purchasing.rfq.cancelled') && <button className="btn btn-ghost btn-sm" disabled={Boolean(busy)} onClick={() => rfqAction(row, 'cancelled')}>{uiText('Hủy')}</button>}</div></td>
          </tr>;
        })}{!quotes.length && <tr><td colSpan="5" className="muted">{uiText('Chưa có nhà cung cấp nào trong vòng báo giá.')}</td></tr>}</tbody></table></div>
        {winner && <div className="alert success" style={{ marginTop: 12 }}>{uiText('Đã chọn')} {recordLabel('master-data.party', suppliers.get(winner.supplier))} {uiText('với tổng')} {fmtMoney(quoteTotal(winner))}. {uiText('Các báo giá còn lại đã được đóng.')}</div>}
      </section>}
    </div>}
  </div>;
}
