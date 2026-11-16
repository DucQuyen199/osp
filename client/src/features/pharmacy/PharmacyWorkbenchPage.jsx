import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { localDate } from '../../lib/dates.js';
import { api, dataPath } from '../../lib/api.js';
import { fmtDateTime, statusLabel, fmtNumber, uiTextWith } from '../../lib/i18n.js';
import { can, loadRefs, recordLabel, loadAllResponse } from '../../lib/state.js';
import pharmacyEnglish from './pharmacy.en.js';

const t = (text) => uiTextWith(text, pharmacyEnglish);

const today = localDate;
const newLine = () => ({ product: '', uom: '', qty: '1', dosage: '' });

export default function PharmacyWorkbenchPage() {
  const [products, setProducts] = useState([]);
  const [units, setUnits] = useState(new Map());
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
      const [productMap, partyMap, unitMap, rxResponse, orderResponse] = await Promise.all([
        loadRefs('master-data.product'), loadRefs('master-data.party'), can('master-data.uom.read') ? loadRefs('master-data.uom') : Promise.resolve(new Map()), loadAllResponse('pharmacy.prescription'),
        can('pos.pos_order.read') ? loadAllResponse('pos.pos_order') : Promise.resolve({ items: [] }),
      ]);
      setProducts([...productMap.values()].filter((p) => p.active !== false && p.requires_prescription === true).sort((a, b) => String(a.name).localeCompare(String(b.name), 'vi')));
      setUnits(unitMap);
      setParties(partyMap);
      setPrescriptions((rxResponse.items || []).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))));
      const dispensed = new Map();
      for (const order of orderResponse.items || []) {
        if (order.status !== 'completed' || !order.prescription) continue;
        const quantities = dispensed.get(order.prescription) || new Map();
        for (const line of Array.isArray(order.lines) ? order.lines : []) {
          if (!line.product) continue;
          quantities.set(line.product, (quantities.get(line.product) || 0) + Number(line.base_qty ?? line.qty ?? 0));
        }
        dispensed.set(order.prescription, quantities);
      }
      setDispensedByPrescription(dispensed);
    } catch (reason) { setError(t(reason.message || 'Không tải được danh sách đơn thuốc.')); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { document.title = `${t('Quản lý đơn thuốc')} · OSP Suite`; load(); }, [load]);
  const activeLines = useMemo(() => lines.filter((line) => line.product), [lines]);
  const updateForm = (field, value) => setForm((current) => ({ ...current, [field]: value }));
  const updateLine = (index, field, value) => setLines((current) => current.map((line, i) => i === index ? { ...line, [field]: value, ...(field === 'product' ? { uom: products.find((product) => product.id === value)?.uom || '' } : {}) } : line));
  const unitsFor = (productId) => {
    const baseUnit = products.find((product) => product.id === productId)?.uom;
    return baseUnit ? [...units.values()].filter((unit) => unit.active !== false && (unit.id === baseUnit || unit.base_uom === baseUnit)) : [];
  };

  const createPrescription = async (event) => {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      const items = activeLines.map((line) => ({ product: line.product, qty: Number(line.qty), ...(line.uom ? { uom: line.uom } : {}), dosage: line.dosage.trim() }));
      await api(dataPath('pharmacy.prescription'), { method: 'POST', body: { ...form, items, status: 'draft' } });
      setForm({ prescription_no: '', party: '', prescriber: '', prescriber_license: '', issued_at: today(), valid_until: today(), notes: '' });
      setLines([newLine()]); setNotice(t('Đã lưu đơn thuốc ở trạng thái nháp. Hãy đối chiếu bản gốc rồi xác minh.')); await load();
    } catch (reason) { setError(t(reason.message || 'Không lưu được đơn thuốc.')); }
    finally { setBusy(false); }
  };

  const transition = async (prescription, action) => {
    setBusy(true); setError(''); setNotice('');
    try {
      await api(dataPath('pharmacy.prescription', prescription.id, action), { method: 'POST' });
      setNotice(action === 'verified' ? `${t('Đã xác minh đơn')} ${prescription.prescription_no}${t('. Có thể chọn đơn này tại quầy POS.')}` : t('Đã hủy đơn thuốc.')); await load();
    } catch (reason) { setError(t(reason.message || 'Không cập nhật được trạng thái đơn thuốc.')); }
    finally { setBusy(false); }
  };

  const productName = (id) => products.find((product) => product.id === id)?.name || `${t('Sản phẩm')} ${String(id || '').slice(0, 8)}`;
  const prescriptionLines = (prescription) => {
    const items = Array.isArray(prescription.items) ? prescription.items : [];
    const dispensed = dispensedByPrescription.get(prescription.id) || new Map();
    const prescribedByProduct = new Map();
    for (const item of items) {
      const qty = Number(item.base_qty ?? item.qty ?? 0);
      prescribedByProduct.set(item.product, (prescribedByProduct.get(item.product) || 0) + qty);
    }
    const shown = new Set();
    return items.map((item) => {
      const firstForProduct = !shown.has(item.product);
      shown.add(item.product);
      const prescribed = prescribedByProduct.get(item.product) || 0;
      const dispensedQty = dispensed.get(item.product) || 0;
      const product = products.find((row) => row.id === item.product);
      const baseUnit = item.base_uom || product?.uom;
      return {
        ...item,
        unitName: item.uom_name || units.get(item.uom)?.name || '',
        balance: firstForProduct ? {
          prescribed,
          dispensed: dispensedQty,
          remaining: Math.max(0, prescribed - dispensedQty),
          unit: units.get(baseUnit)?.name || t('đơn vị gốc'),
        } : null,
      };
    });
  };

  return <div className="page">
    <div className="page-head"><div><h1>{t('Đơn thuốc nhà thuốc')}</h1><p className="sub">{t('Ghi nhận đơn, kiểm tra thông tin và xác minh trước khi bán thuốc kê đơn tại POS.')}</p></div><button className="btn btn-secondary" type="button" disabled={loading || busy} onClick={load}>{t('Làm mới')}</button></div>
    {error && <div className="alert danger" role="alert">{error}</div>}{notice && <div className="alert success" role="status">{notice}</div>}
    <section className="card card-pad">
      <h2>{t('Ghi nhận đơn mới')}</h2>
      <form className="form-grid" onSubmit={createPrescription}>
        <label className="field"><span className="label">{t('Số đơn thuốc *')}</span><input className="input" required value={form.prescription_no} onChange={(e) => updateForm('prescription_no', e.target.value)} /></label>
        <label className="field"><span className="label">{t('Khách hàng *')}</span><select className="select" required value={form.party} onChange={(e) => updateForm('party', e.target.value)}><option value="">{t('Chọn khách hàng')}</option>{[...parties.values()].filter((party) => party.active !== false).map((party) => <option key={party.id} value={party.id}>{recordLabel('master-data.party', party)}</option>)}</select></label>
        <label className="field"><span className="label">{t('Người kê đơn *')}</span><input className="input" required value={form.prescriber} onChange={(e) => updateForm('prescriber', e.target.value)} /></label>
        <label className="field"><span className="label">{t('Số chứng chỉ hành nghề')}</span><input className="input" value={form.prescriber_license} onChange={(e) => updateForm('prescriber_license', e.target.value)} /></label>
        <label className="field"><span className="label">{t('Ngày kê *')}</span><input className="input" type="date" required value={form.issued_at} onChange={(e) => updateForm('issued_at', e.target.value)} /></label>
        <label className="field"><span className="label">{t('Có hiệu lực đến *')}</span><input className="input" type="date" min={form.issued_at} required value={form.valid_until} onChange={(e) => updateForm('valid_until', e.target.value)} /></label>
        <div className="field full"><span className="label">{t('Thuốc kê trong đơn *')}</span>
          {lines.map((line, index) => <div className="row wrap" key={index} style={{ marginBottom: 8 }}>
            <select className="select" required aria-label={`${t('Thuốc dòng')} ${index + 1}`} value={line.product} onChange={(e) => updateLine(index, 'product', e.target.value)}><option value="">{t('Chọn thuốc')}</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name}{product.sku ? ` · ${product.sku}` : ''}</option>)}</select>{unitsFor(line.product).length > 0 && <select className="select" aria-label={`${t('Đơn vị thuốc dòng')} ${index + 1}`} value={line.uom || products.find((product) => product.id === line.product)?.uom || ''} onChange={(event) => updateLine(index, 'uom', event.target.value)}>{unitsFor(line.product).map((unit) => <option key={unit.id} value={unit.id}>{unit.name}{unit.base_uom ? ` (${unit.ratio} × ${t('đơn vị gốc')})` : ` (${t('đơn vị gốc')})`}</option>)}</select>}
            <input className="input" aria-label={`${t('Hướng dẫn sử dụng dòng')} ${index + 1}`} required placeholder={t('Liều dùng / cách dùng')} value={line.dosage} onChange={(e) => updateLine(index, 'dosage', e.target.value)} />
            <button className="btn btn-ghost btn-sm" type="button" aria-label={`${t('Xóa thuốc dòng')} ${index + 1}`} disabled={lines.length === 1} onClick={() => setLines((current) => current.filter((_, i) => i !== index))}>{t('Bỏ')}</button>
          </div>)}
          <button className="btn btn-secondary btn-sm" type="button" onClick={() => setLines((current) => [...current, newLine()])}>{t('Thêm thuốc')}</button>
          {!products.length && <p className="small muted">{t('Chưa có sản phẩm nào được đánh dấu “cần đơn thuốc” trong danh mục.')}</p>}
        </div>
        <label className="field full"><span className="label">{t('Ghi chú')}</span><textarea className="textarea" value={form.notes} onChange={(e) => updateForm('notes', e.target.value)} /></label>
        <div className="row full"><span className="grow" /><button className="btn btn-primary" type="submit" disabled={busy || !can('pharmacy.prescription.create') || !products.length}>{busy ? t('Đang lưu…') : t('Lưu đơn nháp')}</button></div>
      </form>
    </section>

    <section className="card card-pad" style={{ marginTop: 20 }}><div className="row wrap"><h2>{t('Danh sách đơn thuốc')}</h2><span className="grow" /><a className="btn btn-secondary" href="#/pos">{t('Mở quầy POS')}</a></div>
      {loading ? <div className="skeleton" data-h="row" /> : prescriptions.length === 0 ? <div className="empty">{t('Chưa có đơn thuốc.')}</div> : <div className="table-wrap"><table className="table"><thead><tr><th>{t('Số đơn')}</th><th>{t('Khách hàng')}</th><th>{t('Ngày kê')}</th><th>{t('Hiệu lực đến')}</th><th>{t('Thuốc')}</th><th>{t('Trạng thái')}</th><th>{t('Thao tác')}</th></tr></thead><tbody>{prescriptions.map((rx) => <tr key={rx.id}>
        <td><strong>{rx.prescription_no}</strong><div className="small muted">{rx.prescriber}{rx.prescriber_license ? ` · ${rx.prescriber_license}` : ''}</div></td>
        <td>{parties.get(rx.party)?.name || t('Khách hàng')}</td><td>{rx.issued_at}</td><td>{rx.valid_until}</td>
        <td>{prescriptionLines(rx).map((item, index) => <div key={`${item.product}-${item.dosage}-${index}`}>{productName(item.product)} · {t('kê')} {item.qty} {item.unitName}{item.balance && <span className="small muted"> · {t('tổng kê')} {fmtNumber(item.balance.prescribed)} {item.balance.unit} · {t('đã cấp')} {fmtNumber(item.balance.dispensed)} {item.balance.unit} · {t('còn')} {fmtNumber(item.balance.remaining)} {item.balance.unit}</span>}<div className="small muted">{item.dosage}</div></div>)}</td>
        <td>{statusLabel(rx.status)}{rx.dispensed_at && <div className="small muted">{fmtDateTime(rx.dispensed_at)}</div>}</td>
        <td className="row wrap">{rx.status === 'draft' && <button className="btn btn-primary btn-sm" type="button" disabled={busy || !can('pharmacy.prescription.verified')} onClick={() => transition(rx, 'verified')}>{t('Xác minh')}</button>}{['draft', 'verified'].includes(rx.status) && <button className="btn btn-ghost btn-sm" type="button" disabled={busy || !can('pharmacy.prescription.cancelled')} onClick={() => transition(rx, 'cancelled')}>{t('Hủy')}</button>}</td>
      </tr>)}</tbody></table></div>}
      <p className="small muted">{t('Xác minh là bước nghiệp vụ nội bộ sau khi dược sĩ đối chiếu đơn gốc. Hệ thống không thay thế việc thẩm định tính hợp lệ chuyên môn.')}</p>
    </section>
  </div>;
}
