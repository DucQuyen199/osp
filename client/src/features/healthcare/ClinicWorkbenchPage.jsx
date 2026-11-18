import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useDocumentTitle } from '../../lib/useDocumentTitle.js';
import { localDate } from '../../lib/dates.js';
import { api, dataPath } from '../../lib/api.js';
import { fmtDateTime, fmtMoney, statusLabel, uiTextWith } from '../../lib/i18n.js';
import { compareDecimals } from '../../lib/decimal.js';
import { app, can, loadAll, loadIndependentData, loadRefs, recordLabel } from '../../lib/state.js';
import { useLatestRequest } from '../../lib/useLatestRequest.js';
import clinicEnglish from './clinic.en.js';
import EncounterPrescriptionsPanel from './components/EncounterPrescriptionsPanel.jsx';
import PatientEncounterSummary from './components/PatientEncounterSummary.jsx';
const t = (text) => uiTextWith(text, clinicEnglish);
const newPrescriptionItem = () => ({ rowId: crypto.randomUUID(), product: '', qty: 1, dosage: '', uom: '' });
export default function ClinicWorkbenchPage() {
  useDocumentTitle(t("Điều phối phòng khám · OSP Suite"));
  const [patients, setPatients] = useState([]);
  const [parties, setParties] = useState(new Map());
  const [encounters, setEncounters] = useState([]);
  const [prescriptions, setPrescriptions] = useState([]);
  const [labOrders, setLabOrders] = useState([]);
  const [products, setProducts] = useState(new Map());
  const [units, setUnits] = useState(new Map());
  const [warehouses, setWarehouses] = useState(new Map());
  const [selectedId, setSelectedId] = useState('');
  const [patientId, setPatientId] = useState('');
  const [patientRegistration, setPatientRegistration] = useState({ mode: can('master-data.party.create') ? 'new' : 'existing', party: '', name: '', phone: '', email: '', dob: '', gender: '', blood_type: '', allergies: '', insurance_no: '' });
  const [patientRecordForm, setPatientRecordForm] = useState({ dob: '', gender: '', blood_type: '', allergies: '', insurance_no: '' });
  const [pendingPatientParty, setPendingPatientParty] = useState(null);
  const [doctor, setDoctor] = useState(app.user?.name || '');
  const [complaint, setComplaint] = useState('');
  const [diagnosis, setDiagnosis] = useState('');
  const [fee, setFee] = useState('');
  const [testName, setTestName] = useState('');
  const [testEncounterId, setTestEncounterId] = useState('');
  const [testResult, setTestResult] = useState({});
  const [rxWarehouse, setRxWarehouse] = useState('');
  const [rxItems, setRxItems] = useState(() => [newPrescriptionItem()]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const beginRequest = useLatestRequest();
  const load = useCallback(async (preserveNotice = false) => {
    const isCurrent = beginRequest();
    setLoading(true); setError(''); if (!preserveNotice) setNotice('');
    try {
      const { data, errors } = await loadIndependentData({
        patients: can('clinic.patient.read') ? loadAll('clinic.patient') : Promise.resolve([]),
        parties: can('master-data.party.read') ? loadRefs('master-data.party') : Promise.resolve(new Map()),
        encounters: can('clinic.encounter.read') ? loadAll('clinic.encounter') : Promise.resolve([]),
        prescriptions: can('clinic.prescription.read') ? loadAll('clinic.prescription') : Promise.resolve([]),
        labOrders: can('clinic.lab_order.read') ? loadAll('clinic.lab_order') : Promise.resolve([]),
        products: can('master-data.product.read') ? loadRefs('master-data.product') : Promise.resolve(new Map()),
        units: can('master-data.uom.read') ? loadRefs('master-data.uom') : Promise.resolve(new Map()),
        warehouses: can('inventory.warehouse.read') ? loadRefs('inventory.warehouse') : Promise.resolve(new Map()),
      }, {
        patients: [], parties: new Map(), encounters: [], prescriptions: [], labOrders: [],
        products: new Map(), units: new Map(), warehouses: new Map(),
      });
      if (!isCurrent()) return;
      const encounterItems = data.encounters.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
      setPatients(data.patients); setParties(data.parties); setEncounters(encounterItems);
      setPrescriptions(data.prescriptions); setLabOrders(data.labOrders);
      setProducts(data.products); setUnits(data.units); setWarehouses(data.warehouses);
      setSelectedId((current) => encounterItems.some((item) => item.id === current) ? current : encounterItems.find((item) => item.status === 'open')?.id || encounterItems[0]?.id || '');
      if (errors.length) setError(errors.map((reason) => reason?.message || t("Không tải được một phần dữ liệu phòng khám.")).join(' · '));
    } catch (reason) { if (isCurrent()) setError(reason.message || t("Không tải được dữ liệu phòng khám.")); }
    finally { if (isCurrent()) setLoading(false); }
  }, [beginRequest]);
  useEffect(() => { load(); }, [load]);
  const selected = encounters.find((item) => item.id === selectedId) || null;
  const availablePatientParties = useMemo(() => {
    const registered = new Set(patients.map((item) => item.party));
    return [...parties.values()].filter((party) => party.kind !== 'company' && !registered.has(party.id));
  }, [parties, patients]);
  const patient = selected ? patients.find((item) => item.id === selected.patient) : null;
  const patientParty = patient ? parties.get(patient.party) : null;
  const encounterPrescriptions = useMemo(() => prescriptions.filter((item) => item.encounter === selectedId), [prescriptions, selectedId]);
  const encounterLabs = useMemo(() => labOrders.filter((item) => item.encounter === selectedId), [labOrders, selectedId]);
  const openEncounters = encounters.filter((item) => item.status === 'open');
  const updateRxItem = (index, patchValue) => setRxItems((current) => current.map((item, i) => i === index ? { ...item, ...patchValue } : item));
  const unitsFor = (productId) => {
    const baseUnit = products.get(productId)?.uom;
    return baseUnit ? [...units.values()].filter((unit) => unit.id === baseUnit || unit.base_uom === baseUnit) : [];
  };
  useEffect(() => {
    if (!selected) return;
    setDoctor(selected.doctor || app.user?.name || '');
    setDiagnosis(selected.diagnosis || '');
    setFee(selected.fee ?? '');
  }, [selectedId]);
  useEffect(() => {
    setPatientRecordForm({ dob: patient?.dob || '', gender: patient?.gender || '', blood_type: patient?.blood_type || '', allergies: patient?.allergies || '', insurance_no: patient?.insurance_no || '' });
  }, [patient?.id, patient?.dob, patient?.gender, patient?.blood_type, patient?.allergies, patient?.insurance_no]);
  const createEncounter = async (event) => {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      const created = await api(dataPath('clinic.encounter'), { method: 'POST', body: { patient: patientId, doctor: doctor.trim() || undefined, complaint: complaint.trim() || undefined } });
      await load(true); setSelectedId(created.id); setPatientId(''); setComplaint('');
      setNotice(t("Đã tiếp nhận lượt khám."));
    } catch (reason) { setError(reason.message || t("Không tạo được lượt khám.")); }
    finally { setBusy(false); }
  };
  const registerPatient = async (event) => {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      let partyId = pendingPatientParty?.id || (patientRegistration.mode === 'existing' ? patientRegistration.party : '');
      if (!partyId) {
        const party = await api(dataPath('master-data.party'), { method: 'POST', body: {
          name: patientRegistration.name.trim(), kind: 'person', is_customer: true,
          phone: patientRegistration.phone.trim() || undefined, email: patientRegistration.email.trim() || undefined,
        } });
        partyId = party.id;
        setPendingPatientParty({ id: party.id, name: party.name || patientRegistration.name.trim() });
      }
      const patient = await api(dataPath('clinic.patient'), { method: 'POST', body: {
        party: partyId, dob: patientRegistration.dob || undefined, gender: patientRegistration.gender || undefined,
        blood_type: patientRegistration.blood_type.trim() || undefined, allergies: patientRegistration.allergies.trim() || undefined,
        insurance_no: patientRegistration.insurance_no.trim() || undefined,
      } });
      await load(true); setPatientId(patient.id);
      setPatientRegistration({ mode: can('master-data.party.create') ? 'new' : 'existing', party: '', name: '', phone: '', email: '', dob: '', gender: '', blood_type: '', allergies: '', insurance_no: '' });
      setPendingPatientParty(null); setNotice(t("Đã đăng ký hồ sơ bệnh nhân. Có thể tiếp nhận lượt khám ngay."));
    } catch (reason) {
      setError(reason.message || t("Không đăng ký được hồ sơ bệnh nhân. Nếu thông tin liên hệ đã tạo, hãy thử lại để hoàn tất hồ sơ."));
    } finally { setBusy(false); }
  };
  const updatePatientRecord = async (event) => {
    event.preventDefault(); if (!patient) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await api(dataPath('clinic.patient', patient.id), { method: 'PATCH', body: {
        party: patient.party, dob: patientRecordForm.dob || null, gender: patientRecordForm.gender || null,
        blood_type: patientRecordForm.blood_type.trim() || null, allergies: patientRecordForm.allergies.trim() || null,
        insurance_no: patientRecordForm.insurance_no.trim() || null,
      } });
      await load(true); setNotice(t("Đã cập nhật thông tin y tế và bảo hiểm của bệnh nhân."));
    } catch (reason) { setError(reason.message || t("Không thể cập nhật hồ sơ bệnh nhân.")); }
    finally { setBusy(false); }
  };
  const completeEncounter = async (event) => {
    event.preventDefault(); if (!selected) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await api(dataPath('clinic.encounter', selected.id, 'completed'), { method: 'POST', body: { doctor: doctor.trim(), diagnosis: diagnosis.trim(), fee: String(fee).trim() } });
      await load(true); setNotice(t("Đã hoàn tất lượt khám và tạo khoản phải thu theo phí khám."));
    } catch (reason) { setError(reason.message || t("Chưa thể hoàn tất lượt khám. Hãy nhập bác sĩ, chẩn đoán và phí khám.")); }
    finally { setBusy(false); }
  };
  const createPrescription = async (event) => {
    event.preventDefault(); if (!selected) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await api(dataPath('clinic.prescription'), { method: 'POST', body: { encounter: selected.id, warehouse: rxWarehouse, items: rxItems.filter((item) => item.product && compareDecimals(item.qty || 0, 0) > 0).map((item) => ({ product: item.product, qty: String(item.qty), ...(item.uom ? { uom: item.uom } : {}), dosage: item.dosage.trim() })) } });
      await load(true); setRxItems([newPrescriptionItem()]); setNotice(t("Đã lưu đơn thuốc nháp. Chỉ có thể phát sau khi hoàn tất lượt khám."));
    } catch (reason) { setError(reason.message || t("Không lưu được đơn thuốc.")); }
    finally { setBusy(false); }
  };
  const dispensePrescription = async (prescription) => {
    setBusy(true); setError(''); setNotice('');
    try { await api(dataPath('clinic.prescription', prescription.id, 'dispensed'), { method: 'POST' }); await load(true); setNotice(t("Đã phát thuốc và ghi nhận xuất kho.")); }
    catch (reason) { setError(reason.message || t("Không phát được thuốc. Kiểm tra tồn kho, lô và kho cấp phát.")); }
    finally { setBusy(false); }
  };
  const createLabOrder = async (event) => {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try { await api(dataPath('clinic.lab_order'), { method: 'POST', body: { encounter: testEncounterId || selected?.id, test: testName.trim() } }); await load(true); setTestName(''); setNotice(t("Đã tạo chỉ định xét nghiệm.")); }
    catch (reason) { setError(reason.message || t("Không tạo được chỉ định xét nghiệm.")); }
    finally { setBusy(false); }
  };
  const completeLab = async (lab) => {
    setBusy(true); setError(''); setNotice('');
    try {
      await api(dataPath('clinic.lab_order', lab.id, 'resulted'), { method: 'POST', body: { result: String(testResult[lab.id] || '').trim() } });
      await load(true); setNotice(t("Đã lưu và xác nhận kết quả xét nghiệm."));
    } catch (reason) { setError(reason.message || t("Cần nhập kết quả xét nghiệm trước khi xác nhận.")); }
    finally { setBusy(false); }
  };
  return <div className="page clinic-page">
    <div className="page-head"><div><h1>{t("Điều phối phòng khám")}</h1><p className="sub">{t("Tiếp nhận bệnh nhân, hoàn tất lượt khám, theo dõi xét nghiệm và phát thuốc theo kho. Hồ sơ được hiển thị theo quyền clinic của tài khoản.")}</p></div><button className="btn btn-secondary" type="button" disabled={loading || busy} onClick={() => load()}>{t("Làm mới")}</button></div>
    {error && <div className="alert danger" role="alert">{t(error)}</div>}{notice && <div className="alert success" role="status">{t(notice)}</div>}
    {loading ? <div className="card-pad"><div className="skeleton" data-h="row" /></div> : <>
      {can('clinic.patient.create') && (can('master-data.party.create') || can('master-data.party.read')) && <section className="card clinic-intake"><div><h2>{t("Đăng ký bệnh nhân")}</h2><p className="small muted">{t("Tạo hồ sơ bệnh nhân và thông tin liên hệ; dị ứng, nhóm máu và bảo hiểm sẽ gắn với hồ sơ y tế.")}</p></div><form className="clinic-intake-form" onSubmit={registerPatient}>
        {!pendingPatientParty && can('master-data.party.create') && <label className="field"><span className="label">{t("Thông tin liên hệ *")}</span><select className="select" value={patientRegistration.mode} onChange={(event) => setPatientRegistration({ ...patientRegistration, mode: event.target.value, party: '' })}><option value="new">{t("Tạo người liên hệ mới")}</option><option value="existing">{t("Dùng người liên hệ có sẵn")}</option></select></label>}
        {patientRegistration.mode === 'existing' && !pendingPatientParty ? <><label className="field"><span className="label">{t("Người liên hệ *")}</span><select className="select" required value={patientRegistration.party} onChange={(event) => setPatientRegistration({ ...patientRegistration, party: event.target.value })}><option value="">{t("Chọn người liên hệ")}</option>{availablePatientParties.map((party) => <option key={party.id} value={party.id}>{recordLabel('master-data.party', party)}</option>)}</select></label>{!availablePatientParties.length && <p className="small muted">{t("Không còn người liên hệ cá nhân chưa có hồ sơ bệnh nhân.")}</p>}</> : <>
          <label className="field"><span className="label">{t("Họ tên *")}</span><input className="input" required disabled={!!pendingPatientParty} value={patientRegistration.name} onChange={(event) => setPatientRegistration({ ...patientRegistration, name: event.target.value })} /></label>
          <label className="field"><span className="label">{t("Điện thoại")}</span><input className="input" disabled={!!pendingPatientParty} value={patientRegistration.phone} onChange={(event) => setPatientRegistration({ ...patientRegistration, phone: event.target.value })} /></label>
          <label className="field"><span className="label">Email</span><input className="input" type="email" disabled={!!pendingPatientParty} value={patientRegistration.email} onChange={(event) => setPatientRegistration({ ...patientRegistration, email: event.target.value })} /></label>
        </>}
        <label className="field"><span className="label">{t("Ngày sinh")}</span><input className="input" type="date" value={patientRegistration.dob} onChange={(event) => setPatientRegistration({ ...patientRegistration, dob: event.target.value })} /></label>
        <label className="field"><span className="label">{t("Giới tính")}</span><select className="select" value={patientRegistration.gender} onChange={(event) => setPatientRegistration({ ...patientRegistration, gender: event.target.value })}><option value="">{t("Chưa khai báo")}</option><option value="male">{t("Nam")}</option><option value="female">{t("Nữ")}</option><option value="other">{t("Khác")}</option></select></label>
        <label className="field"><span className="label">{t("Nhóm máu")}</span><input className="input" value={patientRegistration.blood_type} onChange={(event) => setPatientRegistration({ ...patientRegistration, blood_type: event.target.value })} /></label>
        <label className="field"><span className="label">{t("Số bảo hiểm")}</span><input className="input" value={patientRegistration.insurance_no} onChange={(event) => setPatientRegistration({ ...patientRegistration, insurance_no: event.target.value })} /></label>
        <label className="field"><span className="label">{t("Dị ứng cần lưu ý")}</span><input className="input" value={patientRegistration.allergies} onChange={(event) => setPatientRegistration({ ...patientRegistration, allergies: event.target.value })} /></label>
        {pendingPatientParty && <p className="small muted">{t('Đã tạo liên hệ “{name}”; gửi lại để hoàn tất hồ sơ bệnh nhân.').replace('{name}', pendingPatientParty.name)}</p>}
        <button className="btn btn-primary" type="submit" disabled={busy || (patientRegistration.mode === 'existing' && !pendingPatientParty && !patientRegistration.party) || (patientRegistration.mode === 'new' && !patientRegistration.name.trim())}>{t("Đăng ký hồ sơ")}</button>
      </form></section>}
      <section className="card clinic-intake"><div><h2>{t("Tiếp nhận lượt khám")}</h2><p className="small muted">{t("Chỉ chọn hồ sơ bệnh nhân đã đăng ký; lượt khám tự liên kết đúng khách hàng của hồ sơ.")}</p></div><form className="clinic-intake-form" onSubmit={createEncounter}>
        <label className="field"><span className="label">{t("Bệnh nhân *")}</span><select className="select" required value={patientId} onChange={(event) => setPatientId(event.target.value)}><option value="">{t("Chọn hồ sơ")}</option>{patients.map((item) => <option key={item.id} value={item.id}>{recordLabel('master-data.party', parties.get(item.party))}</option>)}</select></label>
        <label className="field"><span className="label">{t("Bác sĩ")}</span><input className="input" value={doctor} onChange={(event) => setDoctor(event.target.value)} /></label>
        <label className="field"><span className="label">{t("Lý do khám")}</span><input className="input" value={complaint} onChange={(event) => setComplaint(event.target.value)} /></label>
        <button className="btn btn-primary" type="submit" disabled={busy || !can('clinic.encounter.create')}>{t("Tiếp nhận")}</button>
      </form></section>
      <div className="clinic-layout"><section className="clinic-queue"><header className="clinic-section-head"><h2>{t("Hàng đợi / lượt khám")}</h2><span className="badge plain">{openEncounters.length} đang mở</span></header>
        {encounters.length ? <div className="clinic-encounters">{encounters.map((item) => { const p = patients.find((patientRecord) => patientRecord.id === item.patient); const party = p && parties.get(p.party); return <button type="button" className={`card clinic-encounter${selectedId === item.id ? ' active' : ''}`} key={item.id} onClick={() => { setSelectedId(item.id); setDiagnosis(item.diagnosis || ''); setFee(item.fee ?? ''); }}><strong>{recordLabel('master-data.party', party)}</strong><span className="small muted">{item.doctor || t('Chưa phân bác sĩ')} · {fmtDateTime(item.created_at)}</span><span className={`badge ${item.status === 'completed' ? 'success' : 'warning'}`}>{statusLabel(item.status)}</span><span className="small">{item.complaint || item.diagnosis || t('Chưa ghi nhận nội dung')}</span></button>; })}</div> : <div className="empty">{t("Chưa có lượt khám.")}</div>}
      </section>
      <section className="clinic-records">{selected ? <>
        <PatientEncounterSummary
          patientLabel={recordLabel('master-data.party', patientParty)} patient={patient} encounter={selected}
          doctor={doctor} diagnosis={diagnosis} fee={fee} busy={busy}
          canCompleteEncounter={can('clinic.encounter.update') && can('clinic.encounter.completed')}
          fmtMoney={fmtMoney} statusLabel={statusLabel}
          onEncounterFieldChange={(field, value) => ({ doctor: setDoctor, diagnosis: setDiagnosis, fee: setFee }[field](value))}
          onCompleteEncounter={completeEncounter} t={t}
        >{patient && can('clinic.patient.update') && <details className="u-margin-12-0"><summary className="btn btn-ghost btn-sm u-inline-pointer" >{t("Cập nhật hồ sơ y tế")}</summary><form className="form-grid u-mt-12"  onSubmit={updatePatientRecord}>
            <label className="field"><span className="label">{t("Ngày sinh")}</span><input className="input" type="date" max={localDate()} value={patientRecordForm.dob} onChange={(event) => setPatientRecordForm((current) => ({ ...current, dob: event.target.value }))} /></label>
            <label className="field"><span className="label">{t("Giới tính")}</span><select className="select" value={patientRecordForm.gender} onChange={(event) => setPatientRecordForm((current) => ({ ...current, gender: event.target.value }))}><option value="">{t("Chưa khai báo")}</option><option value="male">{t("Nam")}</option><option value="female">{t("Nữ")}</option><option value="other">{t("Khác")}</option></select></label>
            <label className="field"><span className="label">{t("Nhóm máu")}</span><input className="input" maxLength="8" value={patientRecordForm.blood_type} onChange={(event) => setPatientRecordForm((current) => ({ ...current, blood_type: event.target.value }))} /></label>
            <label className="field"><span className="label">{t("Số bảo hiểm")}</span><input className="input" maxLength="80" value={patientRecordForm.insurance_no} onChange={(event) => setPatientRecordForm((current) => ({ ...current, insurance_no: event.target.value }))} /></label>
            <label className="field full"><span className="label">{t("Dị ứng cần lưu ý")}</span><textarea className="textarea" maxLength="2000" value={patientRecordForm.allergies} onChange={(event) => setPatientRecordForm((current) => ({ ...current, allergies: event.target.value }))} /></label>
            <div className="row full"><span className="grow"/><button className="btn btn-secondary" type="submit" disabled={busy}>{t("Lưu hồ sơ")}</button></div>
          </form></details>}</PatientEncounterSummary>
        <EncounterPrescriptionsPanel
          prescriptions={encounterPrescriptions} products={products} units={units} warehouses={warehouses}
          unitsFor={unitsFor} encounterOpen={selected.status === 'open'} encounterCompleted={selected.status === 'completed'}
          warehouseId={rxWarehouse} items={rxItems} busy={busy}
          canCreate={can('clinic.prescription.create')} canDispense={can('clinic.prescription.dispensed')}
          onDispense={dispensePrescription} onWarehouseChange={setRxWarehouse}
          onItemChange={updateRxItem}
          onAddItem={() => setRxItems((current) => [...current, newPrescriptionItem()])}
          onRemoveItem={(index) => setRxItems((current) => current.length > 1 ? current.filter((_, rowIndex) => rowIndex !== index) : current)}
          onSubmit={createPrescription} recordLabel={recordLabel} statusLabel={statusLabel} t={t}
        />
        <article className="card clinic-record"><h3>{t("Xét nghiệm")}</h3>{encounterLabs.map((lab) => <div className="clinic-linked-record" key={lab.id}><div className="grow"><strong>{lab.test} · {statusLabel(lab.status)}</strong>{lab.status === 'ordered' ? <textarea className="textarea clinic-result" aria-label={`${t('Kết quả')}: ${lab.test}`} placeholder={t('Nhập kết quả xét nghiệm')} value={testResult[lab.id] ?? lab.result ?? ''} onChange={(event) => setTestResult((current) => ({ ...current, [lab.id]: event.target.value }))} /> : <div className="small muted">{lab.result}</div>}</div>{lab.status === 'ordered' && <button className="btn btn-primary btn-sm" type="button" disabled={busy || !can('clinic.lab_order.update') || !can('clinic.lab_order.resulted')} onClick={() => completeLab(lab)}>{t("Xác nhận kết quả")}</button>}</div>)}
        </article>
      </> : <div className="empty card-pad">{t("Chọn lượt khám trong hàng đợi để xem hồ sơ và xử lý.")}</div>}</section></div>
      <section className="card clinic-lab-queue"><header className="clinic-section-head"><h2>{t("Chỉ định xét nghiệm đang chờ")}</h2><span className="badge plain">{labOrders.filter((lab) => lab.status === 'ordered').length}</span></header><form className="clinic-lab-form" onSubmit={createLabOrder}><label className="field"><span className="label">{t("Lượt khám đang mở")}</span><select className="select" required value={testEncounterId || (selected?.status === 'open' ? selected.id : '')} onChange={(event) => setTestEncounterId(event.target.value)}><option value="">{t("Chọn lượt khám")}</option>{openEncounters.map((item) => { const p = patients.find((record) => record.id === item.patient); return <option key={item.id} value={item.id}>{recordLabel('master-data.party', p && parties.get(p.party))} · {fmtDateTime(item.created_at)}</option>; })}</select></label><label className="field"><span className="label">{t("Xét nghiệm")}</span><input className="input" required value={testName} onChange={(event) => setTestName(event.target.value)} /></label><button className="btn btn-secondary" type="submit" disabled={busy || !can('clinic.lab_order.create')}>{t("Tạo chỉ định")}</button></form></section>
    </>}
  </div>;
}
