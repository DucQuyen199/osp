import { useEffect, useState } from 'react';
import { api, dataPath, session } from '../../../lib/api.js';
import { compareDecimals } from '../../../lib/decimal.js';
import { clearPersistentIdempotencyRequest, getPersistentIdempotencyRequest } from '../../../lib/idempotency.js';
import { app, can } from '../../../lib/state.js';

const newPrescriptionItem = () => ({ rowId: crypto.randomUUID(), product: '', qty: 1, dosage: '', uom: '' });

export function useClinicWorkbenchWorkflow({ load, selected, selectedId, patient, setSelectedId, t }) {
  const [patientId, setPatientId] = useState('');
  const [patientRegistration, setPatientRegistration] = useState({ mode: can('master-data.party.create') ? 'new' : 'existing', party: '', name: '', phone: '', email: '', dob: '', gender: '', blood_type: '', allergies: '', insurance_no: '' });
  const [patientRecordForm, setPatientRecordForm] = useState({ dob: '', gender: '', blood_type: '', allergies: '', insurance_no: '' });
  const [pendingPatientParty, setPendingPatientParty] = useState(null);
  const [doctor, setDoctor] = useState(app.user?.name || '');
  const [complaint, setComplaint] = useState('');
  const [diagnosis, setDiagnosis] = useState('');
  const [fee, setFee] = useState('');
  const [noChargeReason, setNoChargeReason] = useState('');
  const [testName, setTestName] = useState('');
  const [testEncounterId, setTestEncounterId] = useState('');
  const [testResult, setTestResult] = useState({});
  const [rxWarehouse, setRxWarehouse] = useState('');
  const [rxItems, setRxItems] = useState(() => [newPrescriptionItem()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (!selected) return;
    setDoctor(selected.doctor || app.user?.name || '');
    setDiagnosis(selected.diagnosis || '');
    setFee(selected.fee ?? '');
    setNoChargeReason(selected.no_charge_reason || '');
  }, [selectedId]);

  useEffect(() => {
    setPatientRecordForm({ dob: patient?.dob || '', gender: patient?.gender || '', blood_type: patient?.blood_type || '', allergies: patient?.allergies || '', insurance_no: patient?.insurance_no || '' });
  }, [patient?.id, patient?.dob, patient?.gender, patient?.blood_type, patient?.allergies, patient?.insurance_no]);

  async function createEncounter(event) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      const created = await api(dataPath('clinic.encounter'), { method: 'POST', body: { patient: patientId, doctor: doctor.trim() || undefined, complaint: complaint.trim() || undefined } });
      await load(true); setSelectedId(created.id); setPatientId(''); setComplaint('');
      setNotice(t('Đã tiếp nhận lượt khám.'));
    } catch (reason) { setError(reason.message || t('Không tạo được lượt khám.')); }
    finally { setBusy(false); }
  }

  async function registerPatient(event) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      let partyId = pendingPatientParty?.id || (patientRegistration.mode === 'existing' ? patientRegistration.party : '');
      let partyRequest;
      let partyPayload;
      if (patientRegistration.mode === 'new') {
        partyPayload = {
          name: patientRegistration.name.trim(), kind: 'person', is_customer: true,
          phone: patientRegistration.phone.trim() || undefined, email: patientRegistration.email.trim() || undefined,
        };
        const partyScope = `${session.current()?.tenantId || ''}:clinic.patient-registration:party`;
        partyRequest = { scope: partyScope, ...getPersistentIdempotencyRequest(partyScope, JSON.stringify(partyPayload)) };
      }
      if (!partyId) {
        const party = await api(dataPath('master-data.party'), {
          method: 'POST', body: partyPayload,
          headers: { 'idempotency-key': partyRequest.key },
        });
        partyId = party.id;
        setPendingPatientParty({ id: party.id, name: party.name || patientRegistration.name.trim() });
      }
      const patientPayload = {
        party: partyId, dob: patientRegistration.dob || undefined, gender: patientRegistration.gender || undefined,
        blood_type: patientRegistration.blood_type.trim() || undefined, allergies: patientRegistration.allergies.trim() || undefined,
        insurance_no: patientRegistration.insurance_no.trim() || undefined,
      };
      const patientScope = `${session.current()?.tenantId || ''}:clinic.patient-registration:patient`;
      const patientRequest = getPersistentIdempotencyRequest(patientScope, JSON.stringify(patientPayload));
      const createdPatient = await api(dataPath('clinic.patient'), {
        method: 'POST', body: patientPayload,
        headers: { 'idempotency-key': patientRequest.key },
      });
      clearPersistentIdempotencyRequest(patientScope, patientRequest.fingerprint);
      if (partyRequest) clearPersistentIdempotencyRequest(partyRequest.scope, partyRequest.fingerprint);
      await load(true); setPatientId(createdPatient.id);
      setPatientRegistration({ mode: can('master-data.party.create') ? 'new' : 'existing', party: '', name: '', phone: '', email: '', dob: '', gender: '', blood_type: '', allergies: '', insurance_no: '' });
      setPendingPatientParty(null); setNotice(t('Đã đăng ký hồ sơ bệnh nhân. Có thể tiếp nhận lượt khám ngay.'));
    } catch (reason) {
      setError(reason.message || t('Không đăng ký được hồ sơ bệnh nhân. Nếu thông tin liên hệ đã tạo, hãy thử lại để hoàn tất hồ sơ.'));
    } finally { setBusy(false); }
  }

  async function updatePatientRecord(event) {
    event.preventDefault(); if (!patient) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await api(dataPath('clinic.patient', patient.id), { method: 'PATCH', body: {
        party: patient.party, dob: patientRecordForm.dob || null, gender: patientRecordForm.gender || null,
        blood_type: patientRecordForm.blood_type.trim() || null, allergies: patientRecordForm.allergies.trim() || null,
        insurance_no: patientRecordForm.insurance_no.trim() || null,
      } });
      await load(true); setNotice(t('Đã cập nhật thông tin y tế và bảo hiểm của bệnh nhân.'));
    } catch (reason) { setError(reason.message || t('Không thể cập nhật hồ sơ bệnh nhân.')); }
    finally { setBusy(false); }
  }

  async function completeEncounter(event) {
    event.preventDefault(); if (!selected) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const isNoCharge = compareDecimals(fee, 0) === 0;
      await api(dataPath('clinic.encounter', selected.id, 'completed'), { method: 'POST', body: { doctor: doctor.trim(), diagnosis: diagnosis.trim(), fee: String(fee).trim(), no_charge_reason: isNoCharge ? noChargeReason.trim() : null } });
      await load(true); setNotice(isNoCharge ? t('Đã hoàn tất lượt khám miễn phí và lưu lý do; không tạo khoản phải thu.') : t('Đã hoàn tất lượt khám và tạo khoản phải thu theo phí khám.'));
    } catch (reason) { setError(reason.message || t('Chưa thể hoàn tất lượt khám. Nhập bác sĩ, chẩn đoán, phí dương hoặc lý do miễn phí.')); }
    finally { setBusy(false); }
  }

  async function createPrescription(event) {
    event.preventDefault(); if (!selected) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await api(dataPath('clinic.prescription'), { method: 'POST', body: { encounter: selected.id, warehouse: rxWarehouse, items: rxItems.filter((item) => item.product && compareDecimals(item.qty || 0, 0) > 0).map((item) => ({ product: item.product, qty: String(item.qty), ...(item.uom ? { uom: item.uom } : {}), dosage: item.dosage.trim() })) } });
      await load(true); setRxItems([newPrescriptionItem()]); setNotice(t('Đã lưu đơn thuốc nháp. Chỉ có thể phát sau khi hoàn tất lượt khám.'));
    } catch (reason) { setError(reason.message || t('Không lưu được đơn thuốc.')); }
    finally { setBusy(false); }
  }

  async function dispensePrescription(prescription) {
    setBusy(true); setError(''); setNotice('');
    try { await api(dataPath('clinic.prescription', prescription.id, 'dispensed'), { method: 'POST' }); await load(true); setNotice(t('Đã phát thuốc và ghi nhận xuất kho.')); }
    catch (reason) { setError(reason.message || t('Không phát được thuốc. Kiểm tra tồn kho, lô và kho cấp phát.')); }
    finally { setBusy(false); }
  }

  async function createLabOrder(event) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      await api(dataPath('clinic.lab_order'), { method: 'POST', body: { encounter: testEncounterId || selected?.id, test: testName.trim() } });
      await load(true); setTestName(''); setNotice(t('Đã tạo chỉ định xét nghiệm.'));
    } catch (reason) { setError(reason.message || t('Không tạo được chỉ định xét nghiệm.')); }
    finally { setBusy(false); }
  }

  async function completeLab(lab) {
    setBusy(true); setError(''); setNotice('');
    try {
      await api(dataPath('clinic.lab_order', lab.id, 'resulted'), { method: 'POST', body: { result: String(testResult[lab.id] || '').trim() } });
      await load(true); setNotice(t('Đã lưu và xác nhận kết quả xét nghiệm.'));
    } catch (reason) { setError(reason.message || t('Cần nhập kết quả xét nghiệm trước khi xác nhận.')); }
    finally { setBusy(false); }
  }

  const clearFeedback = () => { setError(''); setNotice(''); };

  return {
    patientId, setPatientId, patientRegistration, setPatientRegistration, patientRecordForm, setPatientRecordForm,
    pendingPatientParty, doctor, setDoctor, complaint, setComplaint, diagnosis, setDiagnosis, fee, setFee,
    noChargeReason, setNoChargeReason, testName, setTestName, testEncounterId, setTestEncounterId,
    testResult, setTestResult, rxWarehouse, setRxWarehouse, rxItems, setRxItems, busy, error, notice,
    updateRxItem: (index, patchValue) => setRxItems((current) => current.map((item, i) => i === index ? { ...item, ...patchValue } : item)),
    addRxItem: () => setRxItems((current) => [...current, newPrescriptionItem()]),
    removeRxItem: (index) => setRxItems((current) => current.length > 1 ? current.filter((_, rowIndex) => rowIndex !== index) : current),
    updateTestResult: (labId, value) => setTestResult((current) => ({ ...current, [labId]: value })),
    clearFeedback, createEncounter, registerPatient, updatePatientRecord, completeEncounter, createPrescription,
    dispensePrescription, createLabOrder, completeLab,
  };
}
