import React from 'react';
import { fieldLabelOf } from '../../../lib/state.js';
import { uiText } from '../../../lib/i18n.js';

export default function EntityFormView({
  qname,
  definition,
  fields,
  computed,
  title,
  editing,
  saving,
  errors,
  generalErrors,
  renderControl,
  onSubmit,
  onClose,
}) {
  return <form className="drawer-form" noValidate onSubmit={onSubmit}>
    <header className="drawer-head">
      <div><h2 id="entity-form-title">{title}</h2><p className="faint">{uiText(definition.label)}</p></div>
      <button className="btn btn-ghost btn-icon" type="button" aria-label={uiText('Đóng')} onClick={onClose}>×</button>
    </header>
    <div className="drawer-body stack">
      {generalErrors.length > 0 && <div className="alert danger" role="alert"><strong>{uiText('Chưa lưu được')}</strong><ul>{generalErrors.map((message, index) => <li key={index}>{uiText(message)}</li>)}</ul></div>}
      <div className="form-grid">
        {fields.map((field) => <div key={field.name} className={`field${['text', 'json'].includes(field.type) ? ' full' : ''}`}>
          {field.type === 'bool' ? renderControl(field) : <>
            <label htmlFor={`entity-field-${field.name}`}>{uiText(fieldLabelOf(qname, field.name))}{field.required && <><span className="req" aria-hidden="true">*</span><span className="sr-only"> ({uiText('bắt buộc')})</span></>}</label>
            {renderControl(field)}
          </>}
          {errors[field.name] && <div className="error-text" id={`entity-field-${field.name}-error`}>{uiText(errors[field.name])}</div>}
        </div>)}
      </div>
      {computed.length > 0 && <p className="hint">{uiText('Tự tính')}: {computed.map((field) => uiText(fieldLabelOf(qname, field.name))).join(', ')}.</p>}
    </div>
    <footer className="drawer-foot">
      <button className="btn" type="button" disabled={saving} onClick={onClose}>{uiText('Hủy')}</button>
      <button className="btn btn-primary" type="submit" disabled={saving}>{saving ? uiText('Đang lưu…') : editing ? uiText('Lưu thay đổi') : uiText('Tạo mới')}</button>
    </footer>
  </form>;
}
