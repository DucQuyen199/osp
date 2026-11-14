import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { localDate } from './lib/dates.js';
import { api, dataPath } from './lib/api.js';
import { fmtDateTime, statusLabel } from './lib/i18n.js';
import { can, loadRefs, recordLabel } from './lib/state.js';

const today = localDate;
const newLine = () => ({ product: '', qty: '1', dosage: '' });

export default function PharmacyWorkbenchPage() {
  const [products, setProducts] = useState([]);
  const [parties, setParties] = useState(new Map());
  const [prescriptions, setPrescriptions] = useState([]);
  const [dispensedByPrescription, setDispensedByPrescription] = useState(new Map());
  const [form, setForm] = useState({ prescription_no: '', party: '', prescriber: '', prescriber_license: '', issued_at: today(), valid_until: today(), notes: '' });
  const [lines, setLines] = useState([newLine()]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [productMap, partyMap, rxResponse, orderResponse] = await Promise.all([
        loadRefs('master-data.product'), loadRefs('master-data.party'), api(`${dataPath('pharmacy.prescription')}?limit=1000`),
        can('pos.pos_order.read') ? api(`${dataPath('pos.pos_order')}?limit=1000`) : Promise.resolve({ items: [] }),
      ]);
      setProducts([...productMap.values()].filter((p) => p.active !== false && p.requires_prescription === true).sort((a, b) => String(a.name).localeCompare(String(b.name), 'vi')));
      setParties(partyMap);
      setPrescriptions((rxResponse.items || []).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))));
      const dispensed = new Map();
      for (const order of orderResponse.items || []) {
        if (order.status !== 'completed' || !order.prescription) continue;
        const quantities = dispensed.get(order.prescription) || new Map();
        for (const line of Array.isArray(order.lines) ? order.lines : []) {
          if (!line.product) continue;
          quantities.set(line.product, (quantities.get(line.product) || 0) + Number(line.qty || 0));
        }
        dispensed.set(order.prescription, quantities);
      }
      setDispensedByPrescription(dispensed);
    } catch (reason) { setError(reason.message || 'Không tải được danh sách đơn thuốc.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { document.title = 'Quản lý đơn thuốc · OSP Suite'; load(); }, [load]);
  const activeLines = useMemo(() => lines.filter((line) => line.product), [lines]);
  const updateForm = (field, value) => setForm((current) => ({ ...current, [field]: value }));
  const updateLine = (index, field, value) => setLines((current) => current.map((line, i) => i === index ? { ...line, [field]: value } : line));

  const createPrescription = async (event) => {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      const items = activeLines.map((line) => ({ product: line.product, qty: Number(line.qty), dosage: line.dosage.trim() }));
      await api(dataPath('pharmacy.prescription'), { method: 'POST', body: { ...form, items, status: 'draft' } });
      setForm({ prescription_no: '', party: '', prescriber: '', prescriber_license: '', issued_at: today(), valid_until: today(), notes: '' });
      setLines([newLine()]); setNotice('Đã lưu đơn thuốc ở trạng thái nháp. Hãy đối chiếu bản gốc rồi xác minh.'); await load();
    } catch (reason) { setError(reason.message || 'Không lưu được đơn thuốc.'); }
    finally { setBusy(false); }
  };

  const transition = async (prescription, action) => {
    setBusy(true); setError(''); setNotice('');
    try {
      await api(dataPath('pharmacy.prescription', prescription.id, action), { method: 'POST' });
      setNotice(action === 'verified' ? `Đã xác minh đơn ${prescription.prescription_no}. Có thể chọn đơn này tại quầy POS.` : 'Đã hủy đơn thuốc.'); await load();
    } catch (reason) { setError(reason.message || 'Không cập nhật được trạng thái đơn thuốc.'); }
    finally { setBusy(false); }
  };

  const productName = (id) => products.find((product) => product.id === id)?.name || `Sản phẩm ${String(id || '').slice(0, 8)}`;

  return <div className="page">
    <div className="page-head"><div><h1>Đơn thuốc nhà thuốc</h1><p className="sub">Ghi nhận đơn, kiểm tra thông tin và xác minh trước khi bán thuốc kê đơn tại POS.</p></div><button className="btn btn-secondary" type="button" disabled={loading || busy} onClick={load}>Làm mới</button></div>
    {error && <div className="alert danger" role="alert">{error}</div>}{notice && <div className="alert success" role="status">{notice}</div>}
    <section className="card card-pad">
      <h2>Ghi nhận đơn mới</h2>
      <form className="form-grid" onSubmit={createPrescription}>
        <label className="field"><span className="label">Số đơn thuốc *</span><input className="input" required value={form.prescription_no} onChange={(e) => updateForm('prescription_no', e.target.value)} /></label>
        <label className="field"><span className="label">Khách hàng *</span><select className="select" required value={form.party} onChange={(e) => updateForm('party', e.target.value)}><option value="">Chọn khách hàng</option>{[...parties.values()].filter((party) => party.active !== false).map((party) => <option key={party.id} value={party.id}>{recordLabel('master-data.party', party)}</option>)}</select></label>
        <label className="field"><span className="label">Người kê đơn *</span><input className="input" required value={form.prescriber} onChange={(e) => updateForm('prescriber', e.target.value)} /></label>
        <label className="field"><span className="label">Số chứng chỉ hành nghề</span><input className="input" value={form.prescriber_license} onChange={(e) => updateForm('prescriber_license', e.target.value)} /></label>
        <label className="field"><span className="label">Ngày kê *</span><input className="input" type="date" required value={form.issued_at} onChange={(e) => updateForm('issued_at', e.target.value)} /></label>
        <label className="field"><span className="label">Có hiệu lực đến *</span><input className="input" type="date" min={form.issued_at} required value={form.valid_until} onChange={(e) => updateForm('valid_until', e.target.value)} /></label>
        <div className="field full"><span className="label">Thuốc kê trong đơn *</span>
          {lines.map((line, index) => <div className="row wrap" key={index} style={{ marginBottom: 8 }}>
            <select className="select" required value={line.product} onChange={(e) => updateLine(index, 'product', e.target.value)}><option value="">Chọn thuốc</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name}{product.sku ? ` · ${product.sku}` : ''}</option>)}</select>
            <input className="input num" aria-label="Số lượng" required type="number" min="0.001" step="any" value={line.qty} onChange={(e) => updateLine(index, 'qty', e.target.value)} style={{ maxWidth: 120 }} />
            <input className="input" aria-label="Hướng dẫn sử dụng" required placeholder="Liều dùng / cách dùng" value={line.dosage} onChange={(e) => updateLine(index, 'dosage', e.target.value)} />
            <button className="btn btn-ghost btn-sm" type="button" disabled={lines.length === 1} onClick={() => setLines((current) => current.filter((_, i) => i !== index))}>Bỏ</button>
          </div>)}
          <button className="btn btn-secondary btn-sm" type="button" onClick={() => setLines((current) => [...current, newLine()])}>Thêm thuốc</button>
          {!products.length && <p className="small muted">Chưa có sản phẩm nào được đánh dấu “cần đơn thuốc” trong danh mục.</p>}
        </div>
        <label className="field full"><span className="label">Ghi chú</span><textarea className="textarea" value={form.notes} onChange={(e) => updateForm('notes', e.target.value)} /></label>
        <div className="row full"><span className="grow" /><button className="btn btn-primary" type="submit" disabled={busy || !can('pharmacy.prescription.create') || !products.length}>{busy ? 'Đang lưu…' : 'Lưu đơn nháp'}</button></div>
      </form>
    </section>

    <section className="card card-pad" style={{ marginTop: 20 }}><div className="row wrap"><h2>Danh sách đơn thuốc</h2><span className="grow" /><a className="btn btn-secondary" href="#/pos">Mở quầy POS</a></div>
      {loading ? <div className="skeleton" data-h="row" /> : prescriptions.length === 0 ? <div className="empty">Chưa có đơn thuốc.</div> : <div className="table-wrap"><table className="table"><thead><tr><th>Số đơn</th><th>Khách hàng</th><th>Ngày kê</th><th>Hiệu lực đến</th><th>Thuốc</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>{prescriptions.map((rx) => <tr key={rx.id}>
        <td><strong>{rx.prescription_no}</strong><div className="small muted">{rx.prescriber}{rx.prescriber_license ? ` · ${rx.prescriber_license}` : ''}</div></td>
        <td>{parties.get(rx.party)?.name || 'Khách hàng'}</td><td>{rx.issued_at}</td><td>{rx.valid_until}</td>
        <td>{(Array.isArray(rx.items) ? rx.items : []).map((item) => { const dispensed = dispensedByPrescription.get(rx.id)?.get(item.product) || 0; const remaining = Math.max(0, Number(item.qty || 0) - dispensed); return <div key={`${item.product}-${item.dosage}`}>{productName(item.product)} · kê {item.qty}{dispensed > 0 && <span className="small muted"> · đã cấp {dispensed} · còn {remaining}</span>}<div className="small muted">{item.dosage}</div></div>; })}</td>
        <td>{statusLabel(rx.status)}{rx.dispensed_at && <div className="small muted">{fmtDateTime(rx.dispensed_at)}</div>}</td>
        <td className="row wrap">{rx.status === 'draft' && <button className="btn btn-primary btn-sm" type="button" disabled={busy || !can('pharmacy.prescription.verified')} onClick={() => transition(rx, 'verified')}>Xác minh</button>}{['draft', 'verified'].includes(rx.status) && <button className="btn btn-ghost btn-sm" type="button" disabled={busy || !can('pharmacy.prescription.cancelled')} onClick={() => transition(rx, 'cancelled')}>Hủy</button>}</td>
      </tr>)}</tbody></table></div>}
      <p className="small muted">Xác minh là bước nghiệp vụ nội bộ sau khi dược sĩ đối chiếu đơn gốc. Hệ thống không thay thế việc thẩm định tính hợp lệ chuyên môn.</p>
    </section>
  </div>;
}
