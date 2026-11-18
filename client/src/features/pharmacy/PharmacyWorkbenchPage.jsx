import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useDocumentTitle } from '../../lib/useDocumentTitle.js';
import { localDate } from '../../lib/dates.js';
import { api, dataPath } from '../../lib/api.js';
import { textDialog } from '../../lib/feedback.js';
import { statusLabel, fmtNumber, uiTextWith } from '../../lib/i18n.js';
import { addDecimals, compareDecimals, subtractDecimals } from '../../lib/decimal.js';
import { can, loadRefs, recordLabel, loadAllResponse, loadIndependentData } from '../../lib/state.js';
import { useLatestRequest } from '../../lib/useLatestRequest.js';
import pharmacyEnglish from './pharmacy.en.js';
import PrescriptionForm from './components/PrescriptionForm.jsx';
import PrescriptionRegister from './components/PrescriptionRegister.jsx';
import ReturnedMedicineInspectionCard from './components/ReturnedMedicineInspectionCard.jsx';
const t = (text) => uiTextWith(text, pharmacyEnglish);
const today = localDate;
const newLine = () => ({ rowId: crypto.randomUUID(), product: '', uom: '', qty: '1', dosage: '' });
export default function PharmacyWorkbenchPage() {
  useDocumentTitle(`${t('Quản lý đơn thuốc')} · OSP Suite`);
  const [products, setProducts] = useState([]);
  const [units, setUnits] = useState(new Map());
  const [parties, setParties] = useState(new Map());
  const [prescriptions, setPrescriptions] = useState([]);
  const [returnInspections, setReturnInspections] = useState([]);
  const [returnDispositions, setReturnDispositions] = useState([]);
  const [disposalDrafts, setDisposalDrafts] = useState({});
  const [dispensedByPrescription, setDispensedByPrescription] = useState(new Map());
  const [dispensedDataAvailable, setDispensedDataAvailable] = useState(false);
  const [editingId, setEditingId] = useState('');
  const [form, setForm] = useState({ prescription_no: '', party: '', prescriber: '', prescriber_license: '', issued_at: today(), valid_until: today(), notes: '' });
  const [lines, setLines] = useState([newLine()]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const beginRequest = useLatestRequest();
  const load = useCallback(async () => {
    const isCurrent = beginRequest();
    setLoading(true); setError('');
    try {
      const { data, errors } = await loadIndependentData({
        products: can('master-data.product.read') ? loadRefs('master-data.product') : Promise.resolve(new Map()),
        parties: can('master-data.party.read') ? loadRefs('master-data.party') : Promise.resolve(new Map()),
        units: can('master-data.uom.read') ? loadRefs('master-data.uom') : Promise.resolve(new Map()),
        prescriptions: can('pharmacy.prescription.read') ? loadAllResponse('pharmacy.prescription') : Promise.resolve({ items: [] }),
        orders: can('pos.pos_order.read') ? loadAllResponse('pos.pos_order').then((response) => ({ ...response, sourceLoaded: true })) : Promise.resolve({ items: [], sourceLoaded: false }),
        inspections: can('quality.inspection.read') ? loadAllResponse('quality.inspection') : Promise.resolve({ items: [] }),
        dispositions: can('pharmacy.return_disposition.read') ? loadAllResponse('pharmacy.return_disposition') : Promise.resolve({ items: [] }),
      }, {
        products: new Map(), parties: new Map(), units: new Map(), prescriptions: { items: [] },
        orders: { items: [], sourceLoaded: false }, inspections: { items: [] }, dispositions: { items: [] },
      });
      if (!isCurrent()) return;
      const { products: productMap, parties: partyMap, units: unitMap, prescriptions: rxResponse, orders: orderResponse, inspections: inspectionResponse, dispositions: dispositionResponse } = data;
      setProducts([...productMap.values()].filter((p) => p.active !== false && (p.kind || 'goods') === 'goods' && p.tracked !== false && p.requires_prescription === true).sort((a, b) => String(a.name).localeCompare(String(b.name), 'vi')));
      setUnits(unitMap);
      setParties(partyMap);
      setPrescriptions((rxResponse.items || []).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))));
      setReturnInspections((inspectionResponse.items || []).filter((item) => item.source === 'pharmacy_return').sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))));
      setReturnDispositions(dispositionResponse.items || []);
      setDispensedDataAvailable(orderResponse.sourceLoaded === true);
      const dispensed = new Map();
      for (const order of orderResponse.items || []) {
        if (order.status !== 'completed' || !order.prescription) continue;
        const quantities = dispensed.get(order.prescription) || new Map();
        for (const line of Array.isArray(order.lines) ? order.lines : []) {
          if (!line.product) continue;
          quantities.set(line.product, addDecimals([quantities.get(line.product) || '0', line.base_qty ?? line.qty ?? 0]));
        }
        dispensed.set(order.prescription, quantities);
      }
      setDispensedByPrescription(dispensed);
      if (errors.length) setError(errors.map((reason) => reason?.message || t('Không tải được một phần dữ liệu nhà thuốc.')).join(' · '));
    } catch (reason) { if (isCurrent()) setError(t(reason.message || 'Không tải được danh sách đơn thuốc.')); }
    finally { if (isCurrent()) setLoading(false); }
  }, [beginRequest]);
  useEffect(() => { load(); }, [load]);
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
      const items = activeLines.map((line) => ({ product: line.product, qty: String(line.qty), ...(line.uom ? { uom: line.uom } : {}), dosage: line.dosage.trim() }));
      const payload = { ...form, prescription_no: form.prescription_no.trim(), items };
      if (editingId) {
        await api(dataPath('pharmacy.prescription', editingId), { method: 'PATCH', body: payload });
      } else {
        await api(dataPath('pharmacy.prescription'), { method: 'POST', body: { ...payload, status: 'draft' } });
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
    setLines((prescription.items || []).map((item) => ({ rowId: crypto.randomUUID(), product: item.product || '', uom: item.uom || '', qty: String(item.qty ?? ''), dosage: item.dosage || '' })));
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
  const failReturnedMedicine = async (inspection) => {
    const note = await textDialog({ title: t('Xác nhận thuốc trả không đạt'), message: t('Ghi rõ đánh giá tình trạng thuốc. Thuốc khách trả không được giải phóng để bán lại.'), label: t('Lý do không đạt'), minLength: 5, maxLength: 500, confirmLabel: t('Cách ly') });
    if (!note) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await api(dataPath('quality.inspection', inspection.id), { method: 'PATCH', body: { note } });
      await api(dataPath('quality.inspection', inspection.id, 'failed'), { method: 'POST' });
      setNotice(t('Thuốc trả đã được ghi nhận không đạt và tiếp tục nằm trong khu cách ly.'));
      await load();
    } catch (reason) { setError(t(reason.message || 'Không thể ghi nhận kết quả kiểm tra thuốc trả.')); }
    finally { setBusy(false); }
  };
  const disposeReturnedMedicine = async (event, inspection) => {
    event.preventDefault();
    const draft = disposalDrafts[inspection.id] || {};
    const qtyText = String(draft.qty ?? '').trim();
    const note = String(draft.note || '').trim();
    const disposed = addDecimals(returnDispositions.filter((item) => item.inspection === inspection.id && item.status === 'posted').map((item) => item.qty || 0));
    const remaining = compareDecimals(subtractDecimals(inspection.qty || 0, disposed), '0') < 0 ? '0' : subtractDecimals(inspection.qty || 0, disposed);
    let quantityValid = false;
    try { quantityValid = compareDecimals(qtyText || 0, '0') > 0 && compareDecimals(qtyText, remaining) <= 0; } catch { quantityValid = false; }
    if (!quantityValid || note.length < 5 || note.length > 500) {
      setError(t('Nhập số lượng hủy hợp lệ trong giới hạn còn cách ly và ghi lý do từ 5 đến 500 ký tự.'));
      return;
    }
    setBusy(true); setError(''); setNotice('');
    try {
      let disposition = returnDispositions.find((item) => item.inspection === inspection.id && item.status === 'draft');
      if (!disposition) {
        disposition = await api(dataPath('pharmacy.return_disposition'), { method: 'POST', body: { inspection: inspection.id, qty: qtyText, note } });
        setReturnDispositions((items) => [...items, disposition]);
      } else if (compareDecimals(disposition.qty || 0, qtyText) !== 0 || disposition.note !== note) {
        disposition = await api(dataPath('pharmacy.return_disposition', disposition.id), { method: 'PATCH', body: { qty: qtyText, note } });
        setReturnDispositions((items) => items.map((item) => item.id === disposition.id ? disposition : item));
      }
      await api(dataPath('pharmacy.return_disposition', disposition.id, 'posted'), { method: 'POST' });
      setDisposalDrafts((items) => ({ ...items, [inspection.id]: { qty: '', note: '' } }));
      setNotice(t('Đã ghi sổ hủy thuốc và xuất khỏi tồn kho cách ly.'));
      await load();
    } catch (reason) { setError(t(reason.message || 'Không thể ghi sổ hủy thuốc. Phiếu nháp được giữ để thử lại.')); }
    finally { setBusy(false); }
  };
  const productName = (id) => products.find((product) => product.id === id)?.name || `${t('Sản phẩm')} ${String(id || '').slice(0, 8)}`;
  const prescriptionLines = (prescription) => {
    const items = Array.isArray(prescription.items) ? prescription.items : [];
    const dispensed = dispensedByPrescription.get(prescription.id) || new Map();
    const prescribedByProduct = new Map();
    for (const item of items) {
      const quantity = item.base_qty ?? item.qty ?? 0;
      prescribedByProduct.set(item.product, addDecimals([prescribedByProduct.get(item.product) || '0', quantity]));
    }
    const shown = new Set();
    return items.map((item) => {
      const firstForProduct = !shown.has(item.product);
      shown.add(item.product);
      const prescribed = prescribedByProduct.get(item.product) || '0';
      const dispensedQty = dispensed.get(item.product) || '0';
      const product = products.find((row) => row.id === item.product);
      const baseUnit = item.base_uom || product?.uom;
      return {
        ...item,
        unitName: item.uom_name || units.get(item.uom)?.name || '',
        balance: firstForProduct ? {
          prescribed,
          dispensed: dispensedDataAvailable ? dispensedQty : null,
          remaining: dispensedDataAvailable ? (compareDecimals(subtractDecimals(prescribed, dispensedQty), '0') < 0 ? '0' : subtractDecimals(prescribed, dispensedQty)) : null,
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
    <section className="card card-pad stack">
      <div className="row wrap"><div><h2>{t('Thuốc khách trả đang cách ly')}</h2><p className="small muted">{t('Thuốc trả từ đơn thuốc được giữ ngoài tồn bán. Dược sĩ ghi nhận không đạt, sau đó ghi sổ hủy có lý do.')}</p></div><span className="grow" /><button className="btn btn-secondary" type="button" disabled={loading || busy} onClick={load}>{t('Làm mới')}</button></div>
      {!can('quality.inspection.read') ? <div className="empty">{t('Cần quyền đọc phiếu chất lượng để xem thuốc trả đang cách ly.')}</div> : loading ? <div className="skeleton" data-h="row" /> : returnInspections.length === 0 ? <div className="empty">{t('Chưa có thuốc khách trả đang cách ly.')}</div> : returnInspections.map((inspection) => {
        const disposed = addDecimals(returnDispositions.filter((item) => item.inspection === inspection.id && item.status === 'posted').map((item) => item.qty || 0));
        const remaining = compareDecimals(subtractDecimals(inspection.qty || 0, disposed), '0') < 0 ? '0' : subtractDecimals(inspection.qty || 0, disposed);
        const draft = disposalDrafts[inspection.id] || {};
        return <ReturnedMedicineInspectionCard
          key={inspection.id}
          productLabel={productName(inspection.product)}
          remaining={remaining}
          canDispose={compareDecimals(remaining, '0') > 0}
          remainingLabel={fmtNumber(remaining)}
          statusLabel={statusLabel(inspection.status)}
          sourceId={String(inspection.source_id || '').slice(0, 8)}
          lot={inspection.lot ? String(inspection.lot).slice(0, 12) : ''}
          note={inspection.note}
          draft={draft}
          busy={busy}
          showFailAction={inspection.status === 'pending' && can('quality.inspection.update') && can('quality.inspection.failed')}
          showDispositionForm={inspection.status === 'failed' && compareDecimals(remaining, '0') > 0 && can('pharmacy.return_disposition.create') && can('pharmacy.return_disposition.posted')}
          fullyDisposed={compareDecimals(remaining, '0') <= 0}
          t={t}
          onFail={() => failReturnedMedicine(inspection)}
          onSubmit={(event) => disposeReturnedMedicine(event, inspection)}
          onQuantityChange={(value) => setDisposalDrafts((items) => ({ ...items, [inspection.id]: { ...items[inspection.id], qty: value } }))}
          onNoteChange={(value) => setDisposalDrafts((items) => ({ ...items, [inspection.id]: { ...items[inspection.id], note: value } }))}
        />;
      })}
    </section>
    <PrescriptionRegister
      loading={loading}
      prescriptions={prescriptions}
      parties={parties}
      busy={busy}
      canUpdate={can('pharmacy.prescription.update')}
      canVerify={can('pharmacy.prescription.verified')}
      canCancel={can('pharmacy.prescription.cancelled')}
      prescriptionLines={prescriptionLines}
      dispensedDataAvailable={dispensedDataAvailable}
      productName={productName}
      onEdit={editPrescription}
      onTransition={transition}
      t={t}
    />
  </div>;
}
