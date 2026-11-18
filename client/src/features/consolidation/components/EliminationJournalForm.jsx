import React from 'react';

export default function EliminationJournalForm({ form, accounts, busy, onFieldChange, onSubmit, t }) {
  return <form className="form-grid" onSubmit={onSubmit}>
    <label className="field"><span className="label">{t('Ngày hạch toán')} *</span><input className="input" type="date" required value={form.posting_date} onChange={(event) => onFieldChange('posting_date', event.target.value)}/></label>
    <label className="field full"><span className="label">{t('Lý do loại trừ')} *</span><input className="input" required maxLength={500} value={form.memo} onChange={(event) => onFieldChange('memo', event.target.value)}/></label>
    <label className="field"><span className="label">{t('Tài khoản ghi nợ')} *</span><select className="input" required value={form.account_debit} onChange={(event) => onFieldChange('account_debit', event.target.value)}><option value="">{t('Chọn tài khoản')}</option>{accounts.map((account) => <option key={account.id} value={account.code}>{account.code} · {account.name}</option>)}</select></label>
    <label className="field"><span className="label">{t('Số tiền ghi nợ')} *</span><input className="input" type="number" min="0.01" step="0.01" required value={form.debit} onChange={(event) => onFieldChange('debit', event.target.value)}/></label>
    <label className="field"><span className="label">{t('Tài khoản ghi có')} *</span><select className="input" required value={form.account_credit} onChange={(event) => onFieldChange('account_credit', event.target.value)}><option value="">{t('Chọn tài khoản')}</option>{accounts.map((account) => <option key={account.id} value={account.code}>{account.code} · {account.name}</option>)}</select></label>
    <label className="field"><span className="label">{t('Số tiền ghi có')} *</span><input className="input" type="number" min="0.01" step="0.01" required value={form.credit} onChange={(event) => onFieldChange('credit', event.target.value)}/></label>
    <label className="field full"><span className="label">{t('Chứng từ hoặc nội dung đối chiếu')} *</span><textarea className="input" required rows="3" value={form.evidence} onChange={(event) => onFieldChange('evidence', event.target.value)}/></label>
    <div className="row full"><span className="sub">{t('Hai vế phải cân bằng; đơn vị tiền là tiền tệ báo cáo của nhóm.')}</span><span className="grow"/><button className="btn btn-primary" disabled={Boolean(busy) || !accounts.length}>{t('Gửi duyệt độc lập')}</button></div>
  </form>;
}
