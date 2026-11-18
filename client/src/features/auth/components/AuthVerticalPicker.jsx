import React from 'react';

/** Controlled industry selection for tenant signup. */
export default function AuthVerticalPicker({ verticals = [], value = '', onChange, t }) {
  const selected = verticals.find((item) => item.id === value);
  return <fieldset className="field">
    <legend className="label">{t('1. Chọn ngành của bạn')}</legend>
    <div className="vertical-grid" role="group" aria-label={t('Chọn ngành')}>
      <button className="vertical-card" type="button" aria-pressed={!value} onClick={() => onChange('')}>
        <strong>{t('Tự chọn module')}</strong><span>{t('Bắt đầu gọn, bật thêm sau')}</span>
      </button>
      {verticals.map((item) => <button className="vertical-card" key={item.id} type="button"
        aria-pressed={value === item.id} title={t(item.description)} onClick={() => onChange(item.id)}>
        <strong>{t(item.name)}</strong><span>{item.modules.length} {t('module')}</span>
      </button>)}
    </div>
    <p className="hint" aria-live="polite">{t(selected?.description || 'Chỉ có dữ liệu gốc. Bạn bật thêm module trong Cài đặt.')}</p>
  </fieldset>;
}
