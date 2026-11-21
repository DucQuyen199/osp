import React, { useMemo } from 'react';
import { useDocumentTitle } from '../../lib/useDocumentTitle.js';
import { localDate } from '../../lib/dates.js';
import { statusLabel, fmtNumber, uiTextWith } from '../../lib/i18n.js';
import { addDecimals, compareDecimals, subtractDecimals } from '../../lib/decimal.js';
import { can, recordLabel } from '../../lib/state.js';
import pharmacyEnglish from './pharmacy.en.js';
import PrescriptionForm from './components/PrescriptionForm.jsx';
import PrescriptionRegister from './components/PrescriptionRegister.jsx';
import ReturnedMedicineInspectionCard from './components/ReturnedMedicineInspectionCard.jsx';
import { usePharmacyWorkbenchData } from './hooks/usePharmacyWorkbenchData.js';
import { usePharmacyWorkbenchWorkflow } from './hooks/usePharmacyWorkbenchWorkflow.js';
const t = (text) => uiTextWith(text, pharmacyEnglish);
const today = localDate;
export default function PharmacyWorkbenchPage() {
  useDocumentTitle(`${t('Quản lý đơn thuốc')} · OSP Suite`);
  const {
    products, units, parties, prescriptions, returnInspections, returnDispositions,
    setReturnDispositions, dispensedByPrescription, dispensedDataAvailable,
    loading, error, setError, load,
  } = usePharmacyWorkbenchData({ t });
  const {
    disposalDrafts, updateDisposalDraft, editingId, form, lines, busy, notice,
    updateForm, updateLine, addLine, removeLine, createPrescription, editPrescription, cancelEdit,
    transition, failReturnedMedicine, disposeReturnedMedicine,
  } = usePharmacyWorkbenchWorkflow({ products, returnDispositions, setReturnDispositions, load, setError, t });
  const activeLines = useMemo(() => lines.filter((line) => line.product), [lines]);
  const unitsFor = (productId) => {
    const baseUnit = products.find((product) => product.id === productId)?.uom;
    return baseUnit ? [...units.values()].filter((unit) => unit.active !== false && (unit.id === baseUnit || unit.base_uom === baseUnit)) : [];
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
      onAddLine={addLine}
      onRemoveLine={removeLine}
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
          onQuantityChange={(value) => updateDisposalDraft(inspection.id, 'qty', value)}
          onNoteChange={(value) => updateDisposalDraft(inspection.id, 'note', value)}
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
