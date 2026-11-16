import React from 'react';
import { fmtNumber } from '../../../lib/i18n.js';

export default function KeyResultProgressCard({ result, current, target, percent, progressValue, canUpdate, busy, onProgressChange, onSubmit, t }) {
  return <article className="card card-pad">
    <div className="row wrap"><strong>{result.title}</strong><span className="grow"/><span className="small muted">{fmtNumber(current)} / {fmtNumber(target)} {result.unit || ''} · {fmtNumber(percent, { maximumFractionDigits: 0 })}%</span></div>
    <div role="meter" aria-label={`${t('Tiến độ')} ${result.title}`} aria-valuemin="0" aria-valuemax="100" aria-valuenow={percent} className="performance-progress-meter">
      <svg className="performance-progress-fill" viewBox="0 0 100 1" preserveAspectRatio="none" aria-hidden="true"><rect width={percent} height="1" /></svg>
    </div>
    {canUpdate && <form className="row wrap performance-progress-form" onSubmit={(event) => onSubmit(event, result)}>
      <label className="field grow"><span className="label">{t('Giá trị hiện tại')} {result.unit ? `(${result.unit})` : ''}</span>
        <input className="input" type="number" min="0" step="any" required value={progressValue} onChange={(event) => onProgressChange(result.id, event.target.value)}/>
      </label>
      <button className="btn btn-secondary btn-sm" disabled={Boolean(busy)}>{t('Cập nhật tiến độ')}</button>
    </form>}
  </article>;
}
