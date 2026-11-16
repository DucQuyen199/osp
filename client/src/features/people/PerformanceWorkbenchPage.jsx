import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { selectableTableRowProps } from '../../lib/accessibility.js';
import { api, dataPath } from '../../lib/api.js';
import { fmtDateTime, statusLabel, uiTextWith } from '../../lib/i18n.js';
import { app, can, loadAllResponse, loadRefs, recordLabel } from '../../lib/state.js';
import performanceEnglish from './performance.en.js';
import KeyResultProgressCard from './components/KeyResultProgressCard.jsx';

const emptyObjective = { title: '', owner: '', period: '' };
const emptyKeyResult = { title: '', target: '', unit: '' };
const emptyReview = { employee: '', reviewer: '', period: '', score: '', comment: '' };
const rows = (response) => Array.isArray(response?.items) ? response.items : [];
const t = (text) => uiTextWith(text, performanceEnglish);

export default function PerformanceWorkbenchPage() {
  const [objectives, setObjectives] = useState([]);
  const [keyResults, setKeyResults] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [employees, setEmployees] = useState(new Map());
  const [selectedObjectiveId, setSelectedObjectiveId] = useState('');
  const [selectedReviewId, setSelectedReviewId] = useState('');
  const [reviewFilter, setReviewFilter] = useState('all');
  const [objectiveForm, setObjectiveForm] = useState(emptyObjective);
  const [keyResultForm, setKeyResultForm] = useState(emptyKeyResult);
  const [reviewForm, setReviewForm] = useState(emptyReview);
  const [reviewEdit, setReviewEdit] = useState({ period: '', reviewer: '', score: '', comment: '' });
  const [progress, setProgress] = useState({});
  const [revisionNote, setRevisionNote] = useState('');
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async (quiet = false) => {
    if (!quiet) { setLoading(true); setError(''); }
    try {
      const [objectiveRes, keyResultRes, reviewRes, employeeMap] = await Promise.all([
        can('performance.objective.read') ? loadAllResponse('performance.objective') : Promise.resolve({ items: [] }),
        can('performance.key_result.read') ? loadAllResponse('performance.key_result') : Promise.resolve({ items: [] }),
        can('performance.review.read') ? loadAllResponse('performance.review') : Promise.resolve({ items: [] }),
        can('hrm.employee.read') ? loadRefs('hrm.employee') : Promise.resolve(new Map()),
      ]);
      const objectiveRows = rows(objectiveRes).sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));
      const reviewRows = rows(reviewRes).sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));
      setObjectives(objectiveRows); setKeyResults(rows(keyResultRes)); setReviews(reviewRows); setEmployees(employeeMap);
      setSelectedObjectiveId((id) => objectiveRows.some((row) => row.id === id) ? id : objectiveRows[0]?.id || '');
      setSelectedReviewId((id) => reviewRows.some((row) => row.id === id) ? id : reviewRows[0]?.id || '');
      setObjectiveForm((form) => ({ ...form, owner: form.owner || [...employeeMap.keys()][0] || '' }));
      setReviewForm((form) => ({ ...form, employee: form.employee || [...employeeMap.keys()][0] || '' }));
    } catch (reason) { setError(reason.message || t('Không tải được dữ liệu đánh giá hiệu suất.')); }
    finally { if (!quiet) setLoading(false); }
  }, []);

  useEffect(() => { document.title = t('Mục tiêu và đánh giá hiệu suất · OSP Suite'); load(); }, [load]);

  const selectedObjective = objectives.find((row) => row.id === selectedObjectiveId);
  const objectiveResults = useMemo(() => keyResults.filter((row) => row.objective === selectedObjectiveId), [keyResults, selectedObjectiveId]);
  const selectedReview = reviews.find((row) => row.id === selectedReviewId);
  const visibleReviews = reviews.filter((row) => reviewFilter === 'all' || row.status === reviewFilter);
  const employeeName = (id) => {
    const employee = employees.get(id);
    return employee ? recordLabel('hrm.employee', employee) : (id ? `#${String(id).slice(0, 8)}` : t('Chưa phân công'));
  };

  useEffect(() => {
    if (!visibleReviews.some((row) => row.id === selectedReviewId)) setSelectedReviewId(visibleReviews[0]?.id || '');
  }, [reviewFilter, reviews, selectedReviewId]);

  useEffect(() => {
    setReviewEdit({ period: selectedReview?.period || '', reviewer: selectedReview?.reviewer || '', score: selectedReview?.score ?? '', comment: selectedReview?.comment || '' });
    setRevisionNote('');
  }, [selectedReviewId]);

  async function run(key, operation, success) {
    setBusy(key); setError(''); setNotice('');
    try { await operation(); await load(true); if (success) setNotice(success); }
    catch (reason) { setError(reason.message || t('Thao tác không thành công.')); await load(true); }
    finally { setBusy(''); }
  }

  async function createObjective(event) {
    event.preventDefault();
    await run('objective:create', async () => {
      const created = await api(dataPath('performance.objective'), { method: 'POST', body: {
        title: objectiveForm.title.trim(), ...(objectiveForm.owner ? { owner: objectiveForm.owner } : {}),
        ...(objectiveForm.period.trim() ? { period: objectiveForm.period.trim() } : {}),
      } });
      setObjectiveForm((form) => ({ ...emptyObjective, owner: form.owner })); setSelectedObjectiveId(created.id);
    }, t('Đã tạo mục tiêu.'));
  }

  async function createKeyResult(event) {
    event.preventDefault(); if (!selectedObjective) return;
    await run('key-result:create', async () => {
      await api(dataPath('performance.key_result'), { method: 'POST', body: {
        objective: selectedObjective.id, title: keyResultForm.title.trim(), target: Number(keyResultForm.target), current: 0,
        ...(keyResultForm.unit.trim() ? { unit: keyResultForm.unit.trim() } : {}),
      } });
      setKeyResultForm(emptyKeyResult);
    }, t('Đã thêm kết quả then chốt, tiến độ bắt đầu từ 0.'));
  }

  async function updateProgress(event, keyResult) {
    event.preventDefault();
    const value = Number(progress[keyResult.id] ?? keyResult.current ?? 0);
    await run(`${keyResult.id}:progress`, () => api(dataPath('performance.key_result', keyResult.id), { method: 'PATCH', body: { current: value } }), t('Đã cập nhật tiến độ kết quả then chốt.'));
  }

  async function createReview(event) {
    event.preventDefault();
    const created = await run('review:create', async () => {
      const review = await api(dataPath('performance.review'), { method: 'POST', body: {
        employee: reviewForm.employee, reviewer: reviewForm.reviewer || null,
        period: reviewForm.period.trim(), ...(reviewForm.score !== '' ? { score: Number(reviewForm.score) } : {}),
        ...(reviewForm.comment.trim() ? { comment: reviewForm.comment.trim() } : {}),
      } });
      setReviewForm((form) => ({ ...emptyReview, employee: form.employee })); setSelectedReviewId(review.id); setReviewFilter('all');
    }, t('Đã tạo phiếu đánh giá nháp.'));
    return created;
  }

  async function saveReview(event) {
    event.preventDefault(); if (!selectedReview) return;
    await run(`${selectedReview.id}:save`, () => api(dataPath('performance.review', selectedReview.id), { method: 'PATCH', body: {
      reviewer: reviewEdit.reviewer || null, period: reviewEdit.period.trim(),
      score: reviewEdit.score === '' ? null : Number(reviewEdit.score), comment: reviewEdit.comment.trim(),
    } }), t('Đã lưu nội dung đánh giá.'));
  }

  async function transition(review, action, message) {
    await run(`${review.id}:${action}`, () => api(dataPath('performance.review', review.id, action), { method: 'POST' }), message);
  }

  async function submitReview(review) {
    await run(`${review.id}:submitted`, () => api(dataPath('performance.review', review.id, 'submitted'), {
      method: 'POST', body: {
        period: reviewEdit.period.trim(), reviewer: reviewEdit.reviewer || null,
        score: reviewEdit.score === '' ? null : Number(reviewEdit.score), comment: reviewEdit.comment.trim(),
      },
    }), t('Đã gửi đánh giá; nội dung được khóa chờ nhân viên xác nhận.'));
  }

  async function returnReview(event) {
    event.preventDefault(); if (!selectedReview) return;
    await run(`${selectedReview.id}:returned`, () => api(dataPath('performance.review', selectedReview.id, 'returned'), {
      method: 'POST', body: { revision_note: revisionNote.trim() },
    }), t('Đã trả phiếu đánh giá kèm lý do cần chỉnh sửa.'));
  }

  const completedReviews = reviews.filter((row) => row.status === 'acknowledged').length;
  const pendingReviews = reviews.filter((row) => ['draft', 'returned', 'submitted'].includes(row.status)).length;

  return <div className="page">
    <div className="page-head"><div><h1>{t("Mục tiêu và đánh giá hiệu suất")}</h1><p className="sub">{t("Lập mục tiêu theo kỳ, theo dõi kết quả then chốt và quản lý quy trình đánh giá, chỉnh sửa, xác nhận của nhân viên.")}</p></div><button className="btn btn-secondary" type="button" disabled={loading || Boolean(busy)} onClick={() => load()}>{t("Làm mới")}</button></div>
    {error && <div className="alert danger" role="alert">{t(error)}</div>}{notice && <div className="alert success" role="status">{t(notice)}</div>}
    <div className="stats u-legacy-bf4a218e05" >
      <div className="card stat"><span className="stat-label">{t("Mục tiêu đang quản lý")}</span><strong className="stat-value">{objectives.length}</strong></div>
      <div className="card stat"><span className="stat-label">{t("Kết quả then chốt")}</span><strong className="stat-value">{keyResults.length}</strong></div>
      <div className="card stat"><span className="stat-label">{t("Đánh giá cần xử lý")}</span><strong className="stat-value">{pendingReviews}</strong></div>
      <div className="card stat"><span className="stat-label">{t("Đã xác nhận")}</span><strong className="stat-value">{completedReviews}</strong></div>
    </div>

    {(can('performance.objective.read') || can('performance.key_result.read')) && <section className="card card-pad">
      <div className="row wrap"><div><h2>{t("Mục tiêu và kết quả then chốt")}</h2><p className="small muted">{t("Theo dõi tiến độ định lượng cho từng mục tiêu và người phụ trách.")}</p></div><span className="grow"/>
        {can('performance.objective.create') && <form className="row wrap" onSubmit={createObjective}><input className="input" aria-label={t('Tên mục tiêu')} required maxLength="240" placeholder={t('Tên mục tiêu')} value={objectiveForm.title} onChange={(event) => setObjectiveForm((form) => ({ ...form, title: event.target.value }))} /><select className="select" aria-label={t('Người phụ trách mục tiêu')} value={objectiveForm.owner} onChange={(event) => setObjectiveForm((form) => ({ ...form, owner: event.target.value }))}><option value="">{t("Chưa phân công")}</option>{[...employees.values()].map((employee) => <option key={employee.id} value={employee.id}>{recordLabel('hrm.employee', employee)}</option>)}</select><input className="input" aria-label={t('Kỳ mục tiêu')} maxLength="80" placeholder={t('Kỳ, ví dụ 2026-Q4')} value={objectiveForm.period} onChange={(event) => setObjectiveForm((form) => ({ ...form, period: event.target.value }))} /><button className="btn btn-primary" disabled={Boolean(busy)}>{t("Tạo mục tiêu")}</button></form>}
      </div>
      {!can('performance.objective.read') ? <div className="empty">{t("Bạn chưa có quyền xem mục tiêu.")}</div> : loading ? <div className="skeleton" data-h="row"/> : !objectives.length ? <div className="empty">{t("Chưa có mục tiêu. Tạo mục tiêu đầu tiên để bắt đầu theo dõi OKR.")}</div> : <div className="layout-split u-legacy-0ee7f66ad9" >
        <section className="table-wrap"><table className="table"><thead><tr><th>{t("Mục tiêu")}</th><th>{t("Người phụ trách")}</th><th>{t("Kỳ")}</th></tr></thead><tbody>{objectives.map((objective) => <tr {...selectableTableRowProps} key={objective.id} aria-selected={selectedObjectiveId === objective.id} className={[selectedObjectiveId === objective.id ? 'selected' : '', 'u-legacy-9463ff4798'].filter(Boolean).join(' ')} onClick={() => setSelectedObjectiveId(objective.id)} ><td><strong>{objective.title}</strong></td><td>{employeeName(objective.owner)}</td><td>{objective.period || 'Không giới hạn kỳ'}</td></tr>)}</tbody></table></section>
        {selectedObjective && <section className="card card-pad"><div className="row wrap"><div><h3>{selectedObjective.title}</h3><div className="small muted">{employeeName(selectedObjective.owner)} · {selectedObjective.period || t('Không giới hạn kỳ')}</div></div><span className="grow"/><span className="badge plain">{objectiveResults.length} {t('kết quả')}</span></div>
          {!can('performance.key_result.read') ? <div className="empty">{t("Bạn chưa có quyền xem kết quả then chốt.")}</div> : !objectiveResults.length ? <div className="empty">{t("Mục tiêu chưa có kết quả then chốt.")}</div> : <div className="stack-sm u-legacy-0ee7f66ad9" >{objectiveResults.map((result) => {
            const target = Number(result.target); const current = Number(result.current || 0); const percent = target > 0 ? Math.max(0, Math.min(100, current / target * 100)) : 0;
            return <KeyResultProgressCard key={result.id} result={result} current={current} target={target} percent={percent}
              progressValue={progress[result.id] ?? result.current ?? 0} canUpdate={can('performance.key_result.update')} busy={busy}
              onProgressChange={(id, value) => setProgress((values) => ({ ...values, [id]: value }))} onSubmit={updateProgress} t={t} />;
          })}</div>}
          {can('performance.key_result.create') && <form className="form-grid u-legacy-c53ea1da23"  onSubmit={createKeyResult}><label className="field"><span className="label">{t("Kết quả then chốt *")}</span><input className="input" required maxLength="240" value={keyResultForm.title} onChange={(event) => setKeyResultForm((form) => ({ ...form, title: event.target.value }))} placeholder={t('Ví dụ: Rút thời gian xử lý đơn')}/></label><label className="field"><span className="label">{t("Mục tiêu đo lường *")}</span><input className="input" type="number" min="0.000001" step="any" required value={keyResultForm.target} onChange={(event) => setKeyResultForm((form) => ({ ...form, target: event.target.value }))}/></label><label className="field"><span className="label">{t("Đơn vị")}</span><input className="input" maxLength="40" placeholder={t('đơn, %, giờ, VND…')} value={keyResultForm.unit} onChange={(event) => setKeyResultForm((form) => ({ ...form, unit: event.target.value }))}/></label><div className="row full"><span className="grow"/><button className="btn btn-primary" disabled={Boolean(busy)}>{t("Thêm kết quả then chốt")}</button></div></form>}
        </section>}
      </div>}
    </section>}

    {(can('performance.review.read') || can('performance.review.create')) && <section className="card card-pad u-legacy-92c18f6bda" >
      <div className="row wrap"><div><h2>{t("Đánh giá nhân viên")}</h2><p className="small muted">{t("Nháp → gửi đánh giá → yêu cầu chỉnh sửa hoặc xác nhận đã đọc. Phiếu đã xác nhận được lưu trong lịch sử.")}</p></div><span className="grow"/>
        <div className="tabs" role="tablist" aria-label={t('Lọc phiếu đánh giá')}>{[['all','Tất cả'],['draft','Nháp'],['submitted','Chờ xác nhận'],['returned','Cần chỉnh sửa'],['acknowledged','Đã xác nhận']].map(([value,label]) => <button key={value} className="tab" type="button" role="tab" aria-selected={reviewFilter === value} onClick={() => setReviewFilter(value)}>{t(label)}</button>)}</div>
      </div>
      {can('performance.review.create') && <form className="form-grid u-legacy-0ee7f66ad9"  onSubmit={createReview}>
        <label className="field"><span className="label">{t("Nhân viên *")}</span><select className="select" required value={reviewForm.employee} onChange={(event) => setReviewForm((form) => ({ ...form, employee: event.target.value, reviewer: form.reviewer === event.target.value ? '' : form.reviewer }))}><option value="">{t("Chọn nhân viên")}</option>{[...employees.values()].map((employee) => <option key={employee.id} value={employee.id}>{recordLabel('hrm.employee', employee)}</option>)}</select></label>
        <label className="field"><span className="label">{t("Người đánh giá")}</span><select className="select" value={reviewForm.reviewer} onChange={(event) => setReviewForm((form) => ({ ...form, reviewer: event.target.value }))}><option value="">{t("Chọn sau")}</option>{[...employees.values()].map((employee) => <option key={employee.id} value={employee.id} disabled={employee.id === reviewForm.employee}>{recordLabel('hrm.employee', employee)}{employee.id === reviewForm.employee ? ` · ${t('không thể tự đánh giá')}` : ''}</option>)}</select></label>
        <label className="field"><span className="label">{t("Kỳ đánh giá *")}</span><input className="input" required maxLength="80" placeholder={t('Ví dụ 2026-Q4')} value={reviewForm.period} onChange={(event) => setReviewForm((form) => ({ ...form, period: event.target.value }))}/></label>
        <label className="field"><span className="label">{t("Điểm (0–100)")}</span><input className="input" type="number" min="0" max="100" step="any" value={reviewForm.score} onChange={(event) => setReviewForm((form) => ({ ...form, score: event.target.value }))}/></label>
        <label className="field full"><span className="label">{t("Nhận xét")}</span><textarea className="textarea" rows="2" maxLength="10000" value={reviewForm.comment} onChange={(event) => setReviewForm((form) => ({ ...form, comment: event.target.value }))}/></label>
        <div className="row full"><span className="grow"/><button className="btn btn-primary" disabled={Boolean(busy) || !employees.size}>{t("Tạo phiếu nháp")}</button></div>
      </form>}
      {!can('performance.review.read') ? <div className="empty">{t("Bạn chưa có quyền xem phiếu đánh giá.")}</div> : loading ? <div className="skeleton" data-h="row"/> : !visibleReviews.length ? <div className="empty">{t("Không có phiếu đánh giá trong bộ lọc này.")}</div> : <div className="layout-split u-legacy-0ee7f66ad9" >
        <section className="table-wrap"><table className="table"><thead><tr><th>{t("Nhân viên / kỳ")}</th><th>{t("Người đánh giá")}</th><th>{t("Trạng thái")}</th></tr></thead><tbody>{visibleReviews.map((review) => <tr {...selectableTableRowProps} key={review.id} aria-selected={selectedReviewId === review.id} className={[selectedReviewId === review.id ? 'selected' : '', 'u-legacy-9463ff4798'].filter(Boolean).join(' ')} onClick={() => setSelectedReviewId(review.id)} ><td><strong>{employeeName(review.employee)}</strong><div className="small muted">{review.period || 'Chưa có kỳ'}</div></td><td>{employeeName(review.reviewer)}</td><td><span className="badge plain">{statusLabel(review.status || 'draft')}</span></td></tr>)}</tbody></table></section>
        {selectedReview && <section className="card card-pad"><div className="row wrap"><div><h3>{t('Đánh giá')} {employeeName(selectedReview.employee)}</h3><div className="small muted">{t('Kỳ')} {selectedReview.period || t('chưa ghi')} · {t('Người đánh giá')}: {employeeName(selectedReview.reviewer)} · {t('Tạo lúc')} {fmtDateTime(selectedReview.createdAt)}</div></div><span className="grow"/><span className="badge warning">{statusLabel(selectedReview.status || 'draft')}</span></div>
          {(selectedReview.status === 'draft' || selectedReview.status === 'returned') && can('performance.review.update') ? <form className="form-grid u-legacy-0ee7f66ad9"  onSubmit={saveReview}><label className="field"><span className="label">{t("Kỳ đánh giá *")}</span><input className="input" required maxLength="80" value={reviewEdit.period} onChange={(event) => setReviewEdit((form) => ({ ...form, period: event.target.value }))}/></label><label className="field"><span className="label">{t("Người đánh giá")}</span><select className="select" value={reviewEdit.reviewer} onChange={(event) => setReviewEdit((form) => ({ ...form, reviewer: event.target.value }))}><option value="">{t("Chọn người đánh giá")}</option>{[...employees.values()].map((employee) => <option key={employee.id} value={employee.id} disabled={employee.id === selectedReview.employee}>{recordLabel('hrm.employee', employee)}{employee.id === selectedReview.employee ? ` · ${t('không thể tự đánh giá')}` : ''}</option>)}</select></label><label className="field"><span className="label">{t("Điểm (0–100) *")}</span><input className="input" type="number" min="0" max="100" step="any" required value={reviewEdit.score} onChange={(event) => setReviewEdit((form) => ({ ...form, score: event.target.value }))}/></label><label className="field full"><span className="label">{t("Nhận xét *")}</span><textarea className="textarea" rows="4" required maxLength="10000" value={reviewEdit.comment} onChange={(event) => setReviewEdit((form) => ({ ...form, comment: event.target.value }))}/></label><div className="row full"><span className="grow"/><button className="btn btn-secondary" disabled={Boolean(busy) || !can('performance.review.update')}>{t("Lưu nội dung")}</button>{can('performance.review.submitted') && <button className="btn btn-primary" type="button" disabled={Boolean(busy) || !can('performance.review.update') || !reviewEdit.period.trim() || !reviewEdit.comment.trim() || reviewEdit.score === '' || !reviewEdit.reviewer || reviewEdit.reviewer === selectedReview.employee} onClick={() => submitReview(selectedReview)}>{t("Gửi đánh giá")}</button>}</div></form> : <div className="card card-pad u-legacy-0ee7f66ad9" ><div className="row wrap"><strong>{t('Điểm')}: {selectedReview.score ?? t('Chưa chấm')}/100</strong><span className="grow"/><span className="small muted">{fmtDateTime(selectedReview.updatedAt || selectedReview.createdAt)}</span></div><p className="pre-wrap">{selectedReview.comment || t('Chưa có nhận xét.')}</p>{selectedReview.revision_note && <div className="alert warning"><strong>{t("Lý do yêu cầu chỉnh sửa")}</strong><p className="pre-wrap">{selectedReview.revision_note}</p></div>}</div>}
          {selectedReview.status === 'submitted' && can('performance.review.returned') && can('performance.review.update') && <form className="form-grid u-legacy-0ee7f66ad9"  onSubmit={returnReview}><label className="field full"><span className="label">{t("Lý do yêu cầu chỉnh sửa *")}</span><textarea className="textarea" required minLength="3" maxLength="4000" rows="3" value={revisionNote} onChange={(event) => setRevisionNote(event.target.value)} placeholder={t('Nêu rõ nội dung hoặc bằng chứng cần bổ sung')}/></label><div className="row full"><span className="grow"/><button className="btn btn-secondary" disabled={Boolean(busy)}>{t("Trả để chỉnh sửa")}</button></div></form>}
          {selectedReview.status === 'submitted' && can('performance.review.acknowledged') && <div className="row u-legacy-0ee7f66ad9" ><span className="grow"/><button className="btn btn-primary" disabled={Boolean(busy)} onClick={() => transition(selectedReview, 'acknowledged', t('Đã ghi nhận nhân viên xác nhận đã đọc đánh giá.'))}>{t("Xác nhận đã đọc")}</button></div>}
          {selectedReview.status === 'returned' && <div className="alert warning u-legacy-0ee7f66ad9" ><strong>{t("Cần chỉnh sửa trước khi gửi lại")}</strong><p className="pre-wrap">{selectedReview.revision_note || t('Chưa có lý do được lưu.')}</p></div>}
        </section>}
      </div>}
    </section>}
  </div>;
}
