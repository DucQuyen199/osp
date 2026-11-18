import React from 'react';

export default function EncounterLabResultsPanel({
  labs,
  results,
  busy,
  canUpdateResults,
  statusLabel,
  onResultChange,
  onCompleteLab,
  t,
}) {
  return <article className="card clinic-record">
    <h3>{t('Xét nghiệm')}</h3>
    {labs.map((lab) => <div className="clinic-linked-record" key={lab.id}>
      <div className="grow">
        <strong>{lab.test} · {statusLabel(lab.status)}</strong>
        {lab.status === 'ordered'
          ? <textarea
            className="textarea clinic-result"
            aria-label={`${t('Kết quả')}: ${lab.test}`}
            placeholder={t('Nhập kết quả xét nghiệm')}
            value={results[lab.id] ?? lab.result ?? ''}
            onChange={(event) => onResultChange(lab.id, event.target.value)}
          />
          : <div className="small muted">{lab.result}</div>}
      </div>
      {lab.status === 'ordered' && <button
        className="btn btn-primary btn-sm"
        type="button"
        disabled={busy || !canUpdateResults}
        onClick={() => onCompleteLab(lab)}
      >{t('Xác nhận kết quả')}</button>}
    </div>)}
  </article>;
}
