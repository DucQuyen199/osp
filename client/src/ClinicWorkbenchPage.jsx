import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api, dataPath } from './lib/api.js';
import { fmtDateTime, fmtMoney, statusLabel } from './lib/i18n.js';
import { app, can, loadRefs, recordLabel } from './lib/state.js';

const itemsOf = (response) => Array.isArray(response?.items) ? response.items : [];

export default function ClinicWorkbenchPage() {
  const [patients, setPatients] = useState([]);
  const [parties, setParties] = useState(new Map());
  const [encounters, setEncounters] = useState([]);
  const [prescriptions, setPrescriptions] = useState([]);
  const [labOrders, setLabOrders] = useState([]);
  const [products, setProducts] = useState(new Map());
  const [warehouses, setWarehouses] = useState(new Map());
  const [selectedId, setSelectedId] = useState('');
  const [patientId, setPatientId] = useState('');
  const [doctor, setDoctor] = useState(app.user?.name || '');
  const [complaint, setComplaint] = useState('');
  const [diagnosis, setDiagnosis] = useState('');
  const [fee, setFee] = useState('');
  const [testName, setTestName] = useState('');
  const [testEncounterId, setTestEncounterId] = useState('');
  const [testResult, setTestResult] = useState({});
  const [rxWarehouse, setRxWarehouse] = useState('');
  const [rxItems, setRxItems] = useState([{ product: '', qty: 1, dosage: '' }]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async (preserveNotice = false) => {
    setLoading(true); setError(''); if (!preserveNotice) setNotice('');
    try {
      const [patientResponse, partyMap, encounterResponse, prescriptionResponse, labResponse, productMap, warehouseMap] = await Promise.all([
        api(`${dataPath('clinic.patient')}?limit=1000`), loadRefs('master-data.party'),
        api(`${dataPath('clinic.encounter')}?limit=1000`), api(`${dataPath('clinic.prescription')}?limit=1000`),
        api(`${dataPath('clinic.lab_order')}?limit=1000`), loadRefs('master-data.product'), loadRefs('inventory.warehouse'),
      ]);
      const encounterItems = itemsOf(encounterResponse).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
      setPatients(itemsOf(patientResponse)); setParties(partyMap); setEncounters(encounterItems);
      setPrescriptions(itemsOf(prescriptionResponse)); setLabOrders(itemsOf(labResponse));
      setProducts(productMap); setWarehouses(warehouseMap);
      setSelectedId((current) => encounterItems.some((item) => item.id === current) ? current : encounterItems.find((item) => item.status === 'open')?.id || encounterItems[0]?.id || '');
    } catch (reason) { setError(reason.message || 'Không tải được dữ liệu phòng khám.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { document.title = 'Điều phối phòng khám · OSP Suite'; load(); }, [load]);

  const selected = encounters.find((item) => item.id === selectedId) || null;
  const patient = selected ? patients.find((item) => item.id === selected.patient) : null;
  const patientParty = patient ? parties.get(patient.party) : null;
  const encounterPrescriptions = useMemo(() => prescriptions.filter((item) => item.encounter === selectedId), [prescriptions, selectedId]);
  const encounterLabs = useMemo(() => labOrders.filter((item) => item.encounter === selectedId), [labOrders, selectedId]);
  const openEncounters = encounters.filter((item) => item.status === 'open');
  const updateRxItem = (index, patchValue) => setRxItems((current) => current.map((item, i) => i === index ? { ...item, ...patchValue } : item));

  useEffect(() => {
    if (!selected) return;
    setDoctor(selected.doctor || app.user?.name || '');
    setDiagnosis(selected.diagnosis || '');
    setFee(selected.fee ?? '');
  }, [selectedId]);

  const createEncounter = async (event) => {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      const created = await api(dataPath('clinic.encounter'), { method: 'POST', body: { patient: patientId, doctor: doctor.trim() || undefined, complaint: complaint.trim() || undefined } });
      await load(true); setSelectedId(created.id); setPatientId(''); setComplaint('');
      setNotice('Đã tiếp nhận lượt khám.');
    } catch (reason) { setError(reason.message || 'Không tạo được lượt khám.'); }
    finally { setBusy(false); }
  };

  const completeEncounter = async (event) => {
    event.preventDefault(); if (!selected) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await api(dataPath('clinic.encounter', selected.id), { method: 'PATCH', body: { doctor: doctor.trim(), diagnosis: diagnosis.trim(), fee: Number(fee) } });
      await api(dataPath('clinic.encounter', selected.id, 'completed'), { method: 'POST' });
      await load(true); setNotice('Đã hoàn tất lượt khám và tạo khoản phải thu theo phí khám.');
    } catch (reason) { setError(reason.message || 'Chưa thể hoàn tất lượt khám. Hãy nhập bác sĩ, chẩn đoán và phí khám.'); }
    finally { setBusy(false); }
  };

  const createPrescription = async (event) => {
    event.preventDefault(); if (!selected) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await api(dataPath('clinic.prescription'), { method: 'POST', body: { encounter: selected.id, warehouse: rxWarehouse, items: rxItems.filter((item) => item.product && Number(item.qty) > 0).map((item) => ({ product: item.product, qty: Number(item.qty), dosage: item.dosage.trim() })) } });
      await load(true); setRxItems([{ product: '', qty: 1, dosage: '' }]); setNotice('Đã lưu đơn thuốc nháp. Chỉ có thể phát sau khi hoàn tất lượt khám.');
    } catch (reason) { setError(reason.message || 'Không lưu được đơn thuốc.'); }
    finally { setBusy(false); }
  };

  const dispensePrescription = async (prescription) => {
    setBusy(true); setError(''); setNotice('');
    try { await api(dataPath('clinic.prescription', prescription.id, 'dispensed'), { method: 'POST' }); await load(true); setNotice('Đã phát thuốc và ghi nhận xuất kho.'); }
    catch (reason) { setError(reason.message || 'Không phát được thuốc. Kiểm tra tồn kho, lô và kho cấp phát.'); }
    finally { setBusy(false); }
  };

  const createLabOrder = async (event) => {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try { await api(dataPath('clinic.lab_order'), { method: 'POST', body: { encounter: testEncounterId || selected?.id, test: testName.trim() } }); await load(true); setTestName(''); setNotice('Đã tạo chỉ định xét nghiệm.'); }
    catch (reason) { setError(reason.message || 'Không tạo được chỉ định xét nghiệm.'); }
    finally { setBusy(false); }
  };

  const completeLab = async (lab) => {
    setBusy(true); setError(''); setNotice('');
    try {
      await api(dataPath('clinic.lab_order', lab.id), { method: 'PATCH', body: { result: String(testResult[lab.id] || '').trim() } });
      await api(dataPath('clinic.lab_order', lab.id, 'resulted'), { method: 'POST' });
      await load(true); setNotice('Đã lưu và xác nhận kết quả xét nghiệm.');
    } catch (reason) { setError(reason.message || 'Cần nhập kết quả xét nghiệm trước khi xác nhận.'); }
    finally { setBusy(false); }
  };

  return <div className="page clinic-page">
    <div className="page-head"><div><h1>Điều phối phòng khám</h1><p className="sub">Tiếp nhận bệnh nhân, hoàn tất lượt khám, theo dõi xét nghiệm và phát thuốc theo kho. Hồ sơ được hiển thị theo quyền clinic của tài khoản.</p></div><button className="btn btn-secondary" type="button" disabled={loading || busy} onClick={() => load()}>Làm mới</button></div>
    {error && <div className="alert danger" role="alert">{error}</div>}{notice && <div className="alert success" role="status">{notice}</div>}
    {loading ? <div className="card-pad"><div className="skeleton" data-h="row" /></div> : <>
      <section className="card clinic-intake"><div><h2>Tiếp nhận lượt khám</h2><p className="small muted">Chỉ chọn hồ sơ bệnh nhân đã đăng ký; lượt khám tự liên kết đúng khách hàng của hồ sơ.</p></div><form className="clinic-intake-form" onSubmit={createEncounter}>
        <label className="field"><span className="label">Bệnh nhân *</span><select className="select" required value={patientId} onChange={(event) => setPatientId(event.target.value)}><option value="">Chọn hồ sơ</option>{patients.map((item) => <option key={item.id} value={item.id}>{recordLabel('master-data.party', parties.get(item.party))}</option>)}</select></label>
        <label className="field"><span className="label">Bác sĩ</span><input className="input" value={doctor} onChange={(event) => setDoctor(event.target.value)} /></label>
        <label className="field"><span className="label">Lý do khám</span><input className="input" value={complaint} onChange={(event) => setComplaint(event.target.value)} /></label>
        <button className="btn btn-primary" type="submit" disabled={busy || !can('clinic.encounter.create')}>Tiếp nhận</button>
      </form></section>
      <div className="clinic-layout"><section className="clinic-queue"><header className="clinic-section-head"><h2>Hàng đợi / lượt khám</h2><span className="badge plain">{openEncounters.length} đang mở</span></header>
        {encounters.length ? <div className="clinic-encounters">{encounters.map((item) => { const p = patients.find((patientRecord) => patientRecord.id === item.patient); const party = p && parties.get(p.party); return <button type="button" className={`card clinic-encounter${selectedId === item.id ? ' active' : ''}`} key={item.id} onClick={() => { setSelectedId(item.id); setDiagnosis(item.diagnosis || ''); setFee(item.fee ?? ''); }}><strong>{recordLabel('master-data.party', party)}</strong><span className="small muted">{item.doctor || 'Chưa phân bác sĩ'} · {fmtDateTime(item.created_at)}</span><span className={`badge ${item.status === 'completed' ? 'success' : 'warning'}`}>{statusLabel(item.status)}</span><span className="small">{item.complaint || item.diagnosis || 'Chưa ghi nhận nội dung'}</span></button>; })}</div> : <div className="empty">Chưa có lượt khám.</div>}
      </section>
      <section className="clinic-records">{selected ? <>
        <article className="card clinic-record"><header className="clinic-section-head"><div><h2>{recordLabel('master-data.party', patientParty)}</h2><p className="small muted">{patient?.dob ? `Ngày sinh ${patient.dob}` : ''}{patient?.blood_type ? ` · Nhóm máu ${patient.blood_type}` : ''}</p></div><span className={`badge ${selected.status === 'completed' ? 'success' : 'warning'}`}>{statusLabel(selected.status)}</span></header>
          {patient?.allergies && <div className="alert warning clinic-allergy"><strong>Dị ứng:</strong> {patient.allergies}</div>}
          <dl className="clinic-summary"><div><dt>Lý do khám</dt><dd>{selected.complaint || 'Chưa ghi nhận'}</dd></div><div><dt>Chẩn đoán</dt><dd>{selected.diagnosis || 'Chưa ghi nhận'}</dd></div><div><dt>Bác sĩ</dt><dd>{selected.doctor || 'Chưa phân công'}</dd></div><div><dt>Phí khám</dt><dd>{selected.fee != null ? fmtMoney(selected.fee) : 'Chưa lập'}</dd></div></dl>
          {selected.status === 'open' && <form className="clinic-complete-form" onSubmit={completeEncounter}><h3>Chẩn đoán và hoàn tất</h3><label className="field"><span className="label">Bác sĩ phụ trách *</span><input className="input" required value={doctor} onChange={(event) => setDoctor(event.target.value)} /></label><label className="field"><span className="label">Chẩn đoán *</span><textarea className="textarea" required value={diagnosis} onChange={(event) => setDiagnosis(event.target.value)} /></label><label className="field"><span className="label">Phí khám *</span><input className="input num" required type="number" min="0.01" step="any" value={fee} onChange={(event) => setFee(event.target.value)} /></label><button className="btn btn-primary" type="submit" disabled={busy || !can('clinic.encounter.completed')}>Hoàn tất lượt khám</button></form>}
        </article>
        <article className="card clinic-record"><h3>Đơn thuốc</h3>{encounterPrescriptions.map((rx) => <div className="clinic-linked-record" key={rx.id}><div><strong>{rx.items?.length || 0} loại thuốc · {statusLabel(rx.status)}</strong><div className="small muted">{rx.items?.map((item) => `${products.get(item.product)?.name || 'Thuốc'} × ${item.qty}${item.dosage ? ` · ${item.dosage}` : ''}`).join('; ')}</div></div>{rx.status === 'draft' && <button className="btn btn-primary btn-sm" type="button" disabled={busy || selected.status !== 'completed' || !can('clinic.prescription.dispensed')} onClick={() => dispensePrescription(rx)}>Phát thuốc</button>}</div>)}
          {selected.status === 'open' && can('clinic.prescription.create') && <form className="clinic-rx-form" onSubmit={createPrescription}><div className="clinic-inline-fields"><label className="field"><span className="label">Kho cấp phát *</span><select className="select" required value={rxWarehouse} onChange={(event) => setRxWarehouse(event.target.value)}><option value="">Chọn kho</option>{[...warehouses.values()].filter((item) => item.active !== false).map((item) => <option key={item.id} value={item.id}>{recordLabel('inventory.warehouse', item)}</option>)}</select></label></div>{rxItems.map((item, index) => <div className="clinic-rx-line" key={index}><select className="select" required aria-label={`Thuốc dòng ${index + 1}`} value={item.product} onChange={(event) => updateRxItem(index, { product: event.target.value })}><option value="">Chọn thuốc</option>{[...products.values()].filter((product) => product.active !== false && product.kind !== 'service').map((product) => <option key={product.id} value={product.id}>{product.name}{product.sku ? ` · ${product.sku}` : ''}</option>)}</select><input className="input num" required min="0.001" step="any" type="number" aria-label="Số lượng" value={item.qty} onChange={(event) => updateRxItem(index, { qty: event.target.value })} /><input className="input" required aria-label="Liều dùng" placeholder="Liều dùng / hướng dẫn" value={item.dosage} onChange={(event) => updateRxItem(index, { dosage: event.target.value })} /><button className="btn btn-ghost btn-sm" type="button" aria-label="Xóa thuốc" disabled={rxItems.length === 1} onClick={() => setRxItems((current) => current.length > 1 ? current.filter((_, row) => row !== index) : current)}>×</button></div>)}<div className="row wrap"><button className="btn btn-secondary btn-sm" type="button" onClick={() => setRxItems((current) => [...current, { product: '', qty: 1, dosage: '' }])}>Thêm thuốc</button><button className="btn btn-primary btn-sm" type="submit" disabled={busy || !rxWarehouse || !can('clinic.prescription.create')}>Lưu đơn thuốc nháp</button></div></form>}
        </article>
        <article className="card clinic-record"><h3>Xét nghiệm</h3>{encounterLabs.map((lab) => <div className="clinic-linked-record" key={lab.id}><div className="grow"><strong>{lab.test} · {statusLabel(lab.status)}</strong>{lab.status === 'ordered' ? <textarea className="textarea clinic-result" aria-label={`Kết quả ${lab.test}`} placeholder="Nhập kết quả xét nghiệm" value={testResult[lab.id] ?? lab.result ?? ''} onChange={(event) => setTestResult((current) => ({ ...current, [lab.id]: event.target.value }))} /> : <div className="small muted">{lab.result}</div>}</div>{lab.status === 'ordered' && <button className="btn btn-primary btn-sm" type="button" disabled={busy || !can('clinic.lab_order.resulted')} onClick={() => completeLab(lab)}>Xác nhận kết quả</button>}</div>)}
        </article>
      </> : <div className="empty card-pad">Chọn lượt khám trong hàng đợi để xem hồ sơ và xử lý.</div>}</section></div>
      <section className="card clinic-lab-queue"><header className="clinic-section-head"><h2>Chỉ định xét nghiệm đang chờ</h2><span className="badge plain">{labOrders.filter((lab) => lab.status === 'ordered').length}</span></header><form className="clinic-lab-form" onSubmit={createLabOrder}><label className="field"><span className="label">Lượt khám đang mở</span><select className="select" required value={testEncounterId || (selected?.status === 'open' ? selected.id : '')} onChange={(event) => setTestEncounterId(event.target.value)}><option value="">Chọn lượt khám</option>{openEncounters.map((item) => { const p = patients.find((record) => record.id === item.patient); return <option key={item.id} value={item.id}>{recordLabel('master-data.party', p && parties.get(p.party))} · {fmtDateTime(item.created_at)}</option>; })}</select></label><label className="field"><span className="label">Xét nghiệm</span><input className="input" required value={testName} onChange={(event) => setTestName(event.target.value)} /></label><button className="btn btn-secondary" type="submit" disabled={busy || !can('clinic.lab_order.create')}>Tạo chỉ định</button></form></section>
    </>}
  </div>;
}
