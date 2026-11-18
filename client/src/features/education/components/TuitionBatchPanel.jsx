import React from 'react';

/** Controlled tuition batch form and draft/generation register. */
export default function TuitionBatchPanel({
  classes = [],
  enrollments = [],
  tuitionBatches = [],
  classById,
  form,
  canCreate = false,
  canRead = false,
  canGenerate = false,
  busy = false,
  loading = false,
  onFormChange,
  onSubmit,
  onGenerate,
  fmtDate,
  fmtMoney,
  statusLabel,
  t,
}) {
  return <section className="card card-pad u-mt-14">
    <h3>{t('Lập đợt học phí theo lớp')}</h3>
    <p className="small muted">{t('Tạo khoản thu nháp cho toàn bộ học viên đang ghi danh. Học phí hiện tại của lớp được lưu thành số tiền từng khoản; có thể rà soát và phát hành hóa đơn riêng sau đó.')}</p>
    {canCreate && <form className="form-grid" onSubmit={onSubmit}>
      <label className="field">
        <span className="label">{t('Lớp *')}</span>
        <select className="select" required value={form.class} onChange={(event) => onFormChange('class', event.target.value)}>
          <option value="">{t('Chọn lớp có học phí')}</option>
          {classes.map((item) => <option key={item.id} value={item.id}>
            {item.name} · {fmtMoney(item.tuition)} · {enrollments.filter((row) => row.class === item.id && row.status === 'active').length} {t('học viên')}
          </option>)}
        </select>
      </label>
      <label className="field">
        <span className="label">{t('Kỳ học phí *')}</span>
        <input className="input" required maxLength="80" value={form.period} onChange={(event) => onFormChange('period', event.target.value)} placeholder={t('Ví dụ: 2026-HK1 hoặc 2026-11')} />
      </label>
      <label className="field">
        <span className="label">{t('Hạn thanh toán *')}</span>
        <input className="input" required type="date" value={form.due_date} onChange={(event) => onFormChange('due_date', event.target.value)} />
      </label>
      <div className="row full"><span className="grow"/><button className="btn btn-secondary" disabled={busy || loading || !form.class || !form.period.trim()}>{t('Tạo đợt nháp')}</button></div>
    </form>}
    {canRead && <div className="stack-sm u-mt-12">
      {tuitionBatches.length === 0 ? <div className="small muted">{t('Chưa có đợt tạo học phí.')}</div> : [...tuitionBatches]
        .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
        .map((batch) => <div className="row wrap card card-pad" key={batch.id}>
          <div>
            <strong>{classById.get(batch.class)?.name || t('Lớp')} · {batch.period}</strong>
            <div className="small muted">{batch.status === 'generated'
              ? t('Hạn {date} · Tạo {generated} khoản · Bỏ qua {skipped} khoản đã có').replace('{date}', fmtDate(batch.due_date)).replace('{generated}', String(batch.generated_count || 0)).replace('{skipped}', String(batch.skipped_count || 0))
              : t('Hạn {date} · Chưa chạy').replace('{date}', fmtDate(batch.due_date))}</div>
          </div>
          <span className="grow"/>
          <span className={`badge ${batch.status === 'generated' ? 'success' : 'warning'}`}>{statusLabel(batch.status)}</span>
          {batch.status === 'draft' && canGenerate && <button className="btn btn-primary btn-sm" disabled={Boolean(busy) || loading} onClick={() => onGenerate(batch)}>{t('Tạo khoản thu')}</button>}
        </div>)}
    </div>}
  </section>;
}
