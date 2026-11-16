import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { localDate } from '../../lib/dates.js';
import { api, dataPath } from '../../lib/api.js';
import { fmtDateTime, statusLabel, fmtNumber, uiTextWith } from '../../lib/i18n.js';
import { can, loadRefs, recordLabel, loadAllResponse } from '../../lib/state.js';
import pharmacyEnglish from './pharmacy.en.js';
import PrescriptionForm from './components/PrescriptionForm.jsx';

const t = (text) => uiTextWith(text, pharmacyEnglish);

const today = localDate;
const newLine = () => ({ product: '', uom: '', qty: '1', dosage: '' });

export default function PharmacyWorkbenchPage() {
  const [products, setProducts] = useState([]);
  const [units, setUnits] = useState(new Map());
  const [parties, setParties] = useState(new Map());
  const [prescriptions, setPrescriptions] = useState([]);
  const [dispensedByPrescription, setDispensedByPrescription] = useState(new Map());
  const [editingId, setEditingId] = useState('');
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
      setProducts([...productMap.values()].filter((p) => p.active !== false && (p.kind || 'goods') === 'goods' && p.tracked !== false && p.requires_prescription === true).sort((a, b) => String(a.name).localeCompare(String(b.name), 'vi')));
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
      if (editingId) {
        await api(dataPath('pharmacy.prescription', editingId), { method: 'PATCH', body: { ...form, items } });
      } else {
        await api(dataPath('pharmacy.prescription'), { method: 'POST', body: { ...form, items, status: 'draft' } });
      }
      const wasEditing = Boolean(editingId);
      setEditingId('');
      setForm({ prescription_no: '', party: '', prescriber: '', prescriber_license: '', issued_at: today(), valid_until: today(), notes: '' });
      setLines([newLine()]);
      setNotice(t(wasEditing ? 'Đã cập nhật đơn thuốc nháp. Hãy đối chiếu lại bản gốc trước khi xác minh.' : 'Đã lưu đơn thuốc ở trạng thái nháp. Hãy đối chiếu bản gốc rồi xác minh.'));
      await load();
    } catch (reason) { setError(t(reason.message || 'Không lưu được đơn thuốc.')); }
    finally { setBusy(false); }
  };

  const editPrescription = (prescription) => {
    setEditingId(prescription.id);
    setForm({
      prescription_no: prescription.prescription_no || '', party: prescription.party || '', prescriber: prescription.prescriber || '',
      prescriber_license: prescription.prescriber_license || '', issued_at: prescription.issued_at || today(),
      valid_until: prescription.valid_until || today(), notes: prescription.notes || '',
    });
    setLines((prescription.items || []).map((item) => ({ product: item.product || '', uom: item.uom || '', qty: String(item.qty ?? ''), dosage: item.dosage || '' })));
    setError(''); setNotice('');
    document.getElementById('pharmacy-prescription-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    document.getElementById('pharmacy-prescription-number')?.focus({ preventScroll: true });
  };
  const cancelEdit = () => {
    setEditingId('');
    setForm({ prescription_no: '', party: '', prescriber: '', prescriber_license: '', issued_at: today(), valid_until: today(), notes: '' });
    setLines([newLine()]); setError(''); setNotice('');
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
    {error && <div className="alert danger" role="alert">{t(error)}</div>}{notice && <div className="alert success" role="status">{t(notice)}</div>}
    <PrescriptionForm
      form={form}
      parties={parties}
      lines={lines}
      products={products}
      unitsFor={unitsFor}
      recordLabel={recordLabel}
      busy={busy}
      editing={Boolean(editingId)}
      canSubmit={editingId ? can('pharmacy.prescription.update') : can('pharmacy.prescription.create')}
      today={today()}
      t={t}
      onFormChange={updateForm}
      onLineChange={updateLine}
      onAddLine={() => setLines((current) => [...current, newLine()])}
      onRemoveLine={(index) => setLines((current) => current.filter((_, row) => row !== index))}
      onSubmit={createPrescription}
      onCancel={cancelEdit}
    />

    <section className="card card-pad u-legacy-eee3f850c9" ><div className="row wrap"><h2>{t('Danh sách đơn thuốc')}</h2><span className="grow" /><a className="btn btn-secondary" href="#/pos">{t('Mở quầy POS')}</a></div>
      {loading ? <div className="skeleton" data-h="row" /> : prescriptions.length === 0 ? <div className="empty">{t('Chưa có đơn thuốc.')}</div> : <div className="table-wrap"><table className="table"><thead><tr><th>{t('Số đơn')}</th><th>{t('Khách hàng')}</th><th>{t('Ngày kê')}</th><th>{t('Hiệu lực đến')}</th><th>{t('Thuốc')}</th><th>{t('Trạng thái')}</th><th>{t('Thao tác')}</th></tr></thead><tbody>{prescriptions.map((rx) => <tr key={rx.id}>
        <td><strong>{rx.prescription_no}</strong><div className="small muted">{rx.prescriber}{rx.prescriber_license ? ` · ${rx.prescriber_license}` : ''}</div></td>
        <td>{parties.get(rx.party)?.name || t('Khách hàng')}</td><td>{rx.issued_at}</td><td>{rx.valid_until}</td>
        <td>{prescriptionLines(rx).map((item, index) => <div key={`${item.product}-${item.dosage}-${index}`}>{productName(item.product)} · {t('kê')} {item.qty} {item.unitName}{item.balance && <span className="small muted"> · {t('tổng kê')} {fmtNumber(item.balance.prescribed)} {item.balance.unit} · {t('đã cấp')} {fmtNumber(item.balance.dispensed)} {item.balance.unit} · {t('còn')} {fmtNumber(item.balance.remaining)} {item.balance.unit}</span>}<div className="small muted">{item.dosage}</div></div>)}</td>
        <td>{statusLabel(rx.status)}{rx.dispensed_at && <div className="small muted">{fmtDateTime(rx.dispensed_at)}</div>}</td>
        <td className="row wrap">{rx.status === 'draft' && can('pharmacy.prescription.update') && <button className="btn btn-secondary btn-sm" type="button" disabled={busy} onClick={() => editPrescription(rx)}>{t('S\u1eeda nh\u00e1p')}</button>}{rx.status === 'draft' && <button className="btn btn-primary btn-sm" type="button" disabled={busy || !can('pharmacy.prescription.verified')} onClick={() => transition(rx, 'verified')}>{t('Xác minh')}</button>}{['draft', 'verified'].includes(rx.status) && <button className="btn btn-ghost btn-sm" type="button" disabled={busy || !can('pharmacy.prescription.cancelled')} onClick={() => transition(rx, 'cancelled')}>{t('Hủy')}</button>}</td>
      </tr>)}</tbody></table></div>}
      <p className="small muted">{t('Xác minh là bước nghiệp vụ nội bộ sau khi dược sĩ đối chiếu đơn gốc. Hệ thống không thay thế việc thẩm định tính hợp lệ chuyên môn.')}</p>
    </section>
  </div>;
}
