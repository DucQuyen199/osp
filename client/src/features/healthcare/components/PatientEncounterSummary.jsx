import React from 'react';

export default function PatientEncounterSummary({
  patientLabel,
  patient,
  encounter,
  doctor,
  diagnosis,
  fee,
  busy,
  canCompleteEncounter,
  fmtMoney,
  statusLabel,
  onEncounterFieldChange,
  onCompleteEncounter,
  t,
  children,
}) {
  return <article className="card clinic-record">
    <header className="clinic-section-head">
      <div>
        <h2>{patientLabel}</h2>
        <p className="small muted">{patient?.dob ? `${t('Ngày sinh')} ${patient.dob}` : ''}{patient?.gender ? ` · ${{ male: 'Nam', female: t('Nữ'), other: t('Khác') }[patient.gender] || patient.gender}` : ''}{patient?.blood_type ? ` · ${t('Nhóm máu')} ${patient.blood_type}` : ''}{patient?.insurance_no ? ` · ${t('Bảo hiểm')} ${patient.insurance_no}` : ''}</p>
      </div>
      <span className={`badge ${encounter.status === 'completed' ? 'success' : 'warning'}`}>{statusLabel(encounter.status)}</span>
    </header>
    {patient?.allergies && <div className="alert warning clinic-allergy"><strong>{t('Dị ứng:')}</strong> {patient.allergies}</div>}
    {children}
    <dl className="clinic-summary">
      <div><dt>{t('Lý do khám')}</dt><dd>{encounter.complaint || t('Chưa ghi nhận')}</dd></div>
      <div><dt>{t('Chẩn đoán')}</dt><dd>{encounter.diagnosis || t('Chưa ghi nhận')}</dd></div>
      <div><dt>{t('Bác sĩ')}</dt><dd>{encounter.doctor || t('Chưa phân công')}</dd></div>
      <div><dt>{t('Phí khám')}</dt><dd>{encounter.fee != null ? fmtMoney(encounter.fee) : t('Chưa lập')}</dd></div>
    </dl>
    {encounter.status === 'open' && <form className="clinic-complete-form" onSubmit={onCompleteEncounter}>
      <h3>{t('Chẩn đoán và hoàn tất')}</h3>
      <label className="field"><span className="label">{t('Bác sĩ phụ trách *')}</span><input className="input" required value={doctor} onChange={(event) => onEncounterFieldChange('doctor', event.target.value)} /></label>
      <label className="field"><span className="label">{t('Chẩn đoán *')}</span><textarea className="textarea" required value={diagnosis} onChange={(event) => onEncounterFieldChange('diagnosis', event.target.value)} /></label>
      <label className="field"><span className="label">{t('Phí khám *')}</span><input className="input num" required type="number" min="0.01" step="any" value={fee} onChange={(event) => onEncounterFieldChange('fee', event.target.value)} /></label>
      <button className="btn btn-primary" type="submit" disabled={busy || !canCompleteEncounter}>{t('Hoàn tất lượt khám')}</button>
    </form>}
  </article>;
}
