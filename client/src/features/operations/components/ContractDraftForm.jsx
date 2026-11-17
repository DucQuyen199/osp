import React from 'react';
import { uiTextWith } from '../../../lib/i18n.js';
import contractEnglish from '../contracts.en.js';

const t = (text) => uiTextWith(text, contractEnglish);

export default function ContractDraftForm({ values, parties, busy, onChange, onSubmit, partyLabel }) {
  const change = (field) => (event) => onChange(field, event.target.value);

  return <section className="card card-pad">
    <h2>{t('Lập hợp đồng nháp')}</h2>
    <form className="form-grid" onSubmit={onSubmit}>
      <label className="field">
        <span className="label">{t('Tên hợp đồng *')}</span>
        <input className="input" required maxLength="500" value={values.title} onChange={change('title')} />
      </label>
      <label className="field">
        <span className="label">{t('Đối tác *')}</span>
        <select className="select" required value={values.party} onChange={change('party')}>
          <option value="">{t('Chọn đối tác')}</option>
          {[...parties.values()].map((party) => <option key={party.id} value={party.id}>{partyLabel(party)}</option>)}
        </select>
      </label>
      <label className="field">
        <span className="label">{t('Ngày bắt đầu')}</span>
        <input className="input" type="date" value={values.start_date} onChange={change('start_date')} />
      </label>
      <label className="field">
        <span className="label">{t('Ngày kết thúc')}</span>
        <input className="input" type="date" min={values.start_date || undefined} value={values.end_date} onChange={change('end_date')} />
      </label>
      <label className="field">
        <span className="label">{t('Giá trị hợp đồng')}</span>
        <input className="input" type="number" min="0" step="any" value={values.value} onChange={change('value')} />
      </label>
      <label className="field full">
        <span className="label">{t('Điều khoản chính')}</span>
        <textarea className="textarea" rows="3" maxLength="30000" value={values.terms} onChange={change('terms')} />
      </label>
      <div className="row full"><span className="grow" />
        <button className="btn btn-primary" disabled={Boolean(busy) || !parties.size}>{t('Tạo hợp đồng nháp')}</button>
      </div>
    </form>
  </section>;
}
