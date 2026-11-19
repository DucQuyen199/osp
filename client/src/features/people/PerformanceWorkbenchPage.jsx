import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useDocumentTitle } from '../../lib/useDocumentTitle.js';
import { useLatestRequest } from '../../lib/useLatestRequest.js';
import { fmtDateTime, statusLabel, uiTextWith } from '../../lib/i18n.js';
import { app, can, loadAllResponse, loadRefs, recordLabel } from '../../lib/state.js';
import performanceEnglish from './performance.en.js';
import KeyResultProgressCard from './components/KeyResultProgressCard.jsx';
import PerformanceReviewRegister from './components/PerformanceReviewRegister.jsx';
import { usePerformanceWorkflow } from './hooks/usePerformanceWorkflow.js';
const rows = (response) => Array.isArray(response?.items) ? response.items : [];
const t = (text) => uiTextWith(text, performanceEnglish);
export default function PerformanceWorkbenchPage() {
  useDocumentTitle(t('Mục tiêu và đánh giá hiệu suất · OSP Suite'));
  const [objectives, setObjectives] = useState([]);
  const [keyResults, setKeyResults] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [employees, setEmployees] = useState(new Map());
  const [selectedObjectiveId, setSelectedObjectiveId] = useState('');
  const [selectedReviewId, setSelectedReviewId] = useState('');
  const [reviewFilter, setReviewFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const latestRequest = useLatestRequest();
  const load = useCallback(async (quiet = false) => {
    const isLatest = latestRequest();
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
      if (isLatest()) {
        setObjectives(objectiveRows); setKeyResults(rows(keyResultRes)); setReviews(reviewRows); setEmployees(employeeMap);
        setSelectedObjectiveId((id) => objectiveRows.some((row) => row.id === id) ? id : objectiveRows[0]?.id || '');
        setSelectedReviewId((id) => reviewRows.some((row) => row.id === id) ? id : reviewRows[0]?.id || '');
        setObjectiveForm((form) => ({ ...form, owner: form.owner || [...employeeMap.keys()][0] || '' }));
        setReviewForm((form) => ({ ...form, employee: form.employee || [...employeeMap.keys()][0] || '' }));
      }
    } catch (reason) { if (isLatest()) setError(reason.message || t('Không tải được dữ liệu đánh giá hiệu suất.')); }
    finally { if (isLatest()) setLoading(false); }
  }, [latestRequest]);
  useEffect(() => { load(); }, [load]);
  const selectedObjective = objectives.find((row) => row.id === selectedObjectiveId);
  const objectiveResults = useMemo(() => keyResults.filter((row) => row.objective === selectedObjectiveId), [keyResults, selectedObjectiveId]);
  const selectedReview = reviews.find((row) => row.id === selectedReviewId);
  const visibleReviews = reviews.filter((row) => reviewFilter === 'all' || row.status === reviewFilter);
  const employeeName = (id) => {
    const employee = employees.get(id);
    return employee ? recordLabel('hrm.employee', employee) : (id ? `#${String(id).slice(0, 8)}` : t('Chưa phân công'));
  };
  const reviewRows = visibleReviews.map((review) => ({
    id: review.id,
    employeeName: employeeName(review.employee),
    periodLabel: review.period || t('Chưa có kỳ'),
    reviewerName: employeeName(review.reviewer),
    statusLabel: statusLabel(review.status || 'draft'),
  }));
  useEffect(() => {
    if (!visibleReviews.some((row) => row.id === selectedReviewId)) setSelectedReviewId(visibleReviews[0]?.id || '');
  }, [reviewFilter, reviews, selectedReviewId]);
  const workflow = usePerformanceWorkflow({
    load, selectedObjective, selectedReview, selectedReviewId, setSelectedObjectiveId,
    setSelectedReviewId, setReviewFilter, setError, t,
  });
  const {
    objectiveForm, setObjectiveForm, keyResultForm, setKeyResultForm, reviewForm, setReviewForm,
    reviewEdit, setReviewEdit, progress, setProgress, revisionNote, setRevisionNote,
    busy, notice, createObjective, createKeyResult, updateProgress, createReview,
    saveReview, transition, submitReview, returnReview,
  } = workflow;
  const completedReviews = reviews.filter((row) => row.status === 'acknowledged').length;
  const pendingReviews = reviews.filter((row) => ['draft', 'returned', 'submitted'].includes(row.status)).length;
  return <div className="page">
    <div className="page-head"><div><h1>{t("Mục tiêu và đánh giá hiệu suất")}</h1><p className="sub">{t("Lập mục tiêu theo kỳ, theo dõi kết quả then chốt và quản lý quy trình đánh giá, chỉnh sửa, xác nhận của nhân viên.")}</p></div><button className="btn btn-secondary" type="button" disabled={loading || Boolean(busy)} onClick={() => load()}>{t("Làm mới")}</button></div>
    {error && <div className="alert danger" role="alert">{t(error)}</div>}{notice && <div className="alert success" role="status">{t(notice)}</div>}
    <div className="stats u-mb-16" >
      <div className="card stat"><span className="stat-label">{t("Mục tiêu đang quản lý")}</span><strong className="stat-value">{objectives.length}</strong></div>
      <div className="card stat"><span className="stat-label">{t("Kết quả then chốt")}</span><strong className="stat-value">{keyResults.length}</strong></div>
      <div className="card stat"><span className="stat-label">{t("Đánh giá cần xử lý")}</span><strong className="stat-value">{pendingReviews}</strong></div>
      <div className="card stat"><span className="stat-label">{t("Đã xác nhận")}</span><strong className="stat-value">{completedReviews}</strong></div>
    </div>
    {(can('performance.objective.read') || can('performance.key_result.read')) && <section className="card card-pad">
      <div className="row wrap"><div><h2>{t("Mục tiêu và kết quả then chốt")}</h2><p className="small muted">{t("Theo dõi tiến độ định lượng cho từng mục tiêu và người phụ trách.")}</p></div><span className="grow"/>
        {can('performance.objective.create') && <form className="row wrap" onSubmit={createObjective}><input className="input" aria-label={t('Tên mục tiêu')} required maxLength="240" placeholder={t('Tên mục tiêu')} value={objectiveForm.title} onChange={(event) => setObjectiveForm((form) => ({ ...form, title: event.target.value }))} /><select className="select" aria-label={t('Người phụ trách mục tiêu')} value={objectiveForm.owner} onChange={(event) => setObjectiveForm((form) => ({ ...form, owner: event.target.value }))}><option value="">{t("Chưa phân công")}</option>{[...employees.values()].map((employee) => <option key={employee.id} value={employee.id}>{recordLabel('hrm.employee', employee)}</option>)}</select><input className="input" aria-label={t('Kỳ mục tiêu')} maxLength="80" placeholder={t('Kỳ, ví dụ 2026-Q4')} value={objectiveForm.period} onChange={(event) => setObjectiveForm((form) => ({ ...form, period: event.target.value }))} /><button className="btn btn-primary" disabled={Boolean(busy)}>{t("Tạo mục tiêu")}</button></form>}
      </div>
      {!can('performance.objective.read') ? <div className="empty">{t("Bạn chưa có quyền xem mục tiêu.")}</div> : loading ? <div className="skeleton" data-h="row"/> : !objectives.length ? <div className="empty">{t("Chưa có mục tiêu. Tạo mục tiêu đầu tiên để bắt đầu theo dõi OKR.")}</div> : <div className="layout-split u-mt-12" >
        <section className="table-wrap"><table className="table"><thead><tr><th>{t("Mục tiêu")}</th><th>{t("Người phụ trách")}</th><th>{t("Kỳ")}</th></tr></thead><tbody>{objectives.map((objective) => <tr {...selectableTableRowProps} key={objective.id} aria-selected={selectedObjectiveId === objective.id} className={[selectedObjectiveId === objective.id ? 'selected' : '', 'u-pointer'].filter(Boolean).join(' ')} onClick={() => setSelectedObjectiveId(objective.id)} ><td><strong>{objective.title}</strong></td><td>{employeeName(objective.owner)}</td><td>{objective.period || t('Không giới hạn kỳ')}</td></tr>)}</tbody></table></section>
        {selectedObjective && <section className="card card-pad"><div className="row wrap"><div><h3>{selectedObjective.title}</h3><div className="small muted">{employeeName(selectedObjective.owner)} · {selectedObjective.period || t('Không giới hạn kỳ')}</div></div><span className="grow"/><span className="badge plain">{objectiveResults.length} {t('kết quả')}</span></div>
          {!can('performance.key_result.read') ? <div className="empty">{t("Bạn chưa có quyền xem kết quả then chốt.")}</div> : !objectiveResults.length ? <div className="empty">{t("Mục tiêu chưa có kết quả then chốt.")}</div> : <div className="stack-sm u-mt-12" >{objectiveResults.map((result) => {
            const target = Number(result.target); const current = Number(result.current || 0); const percent = target > 0 ? Math.max(0, Math.min(100, current / target * 100)) : 0;
            return <KeyResultProgressCard key={result.id} result={result} current={current} target={target} percent={percent}
              progressValue={progress[result.id] ?? result.current ?? 0} canUpdate={can('performance.key_result.update')} busy={busy}
              onProgressChange={(id, value) => setProgress((values) => ({ ...values, [id]: value }))} onSubmit={updateProgress} t={t} />;
          })}</div>}
          {can('performance.key_result.create') && <form className="form-grid u-mt-14"  onSubmit={createKeyResult}><label className="field"><span className="label">{t("Kết quả then chốt *")}</span><input className="input" required maxLength="240" value={keyResultForm.title} onChange={(event) => setKeyResultForm((form) => ({ ...form, title: event.target.value }))} placeholder={t('Ví dụ: Rút thời gian xử lý đơn')}/></label><label className="field"><span className="label">{t("Mục tiêu đo lường *")}</span><input className="input" type="number" min="0.000001" step="any" required value={keyResultForm.target} onChange={(event) => setKeyResultForm((form) => ({ ...form, target: event.target.value }))}/></label><label className="field"><span className="label">{t("Đơn vị")}</span><input className="input" maxLength="40" placeholder={t('đơn, %, giờ, VND…')} value={keyResultForm.unit} onChange={(event) => setKeyResultForm((form) => ({ ...form, unit: event.target.value }))}/></label><div className="row full"><span className="grow"/><button className="btn btn-primary" disabled={Boolean(busy)}>{t("Thêm kết quả then chốt")}</button></div></form>}
        </section>}
      </div>}
    </section>}
    {(can('performance.review.read') || can('performance.review.create')) && <section className="card card-pad u-mt-16" >
      <div className="row wrap"><div><h2>{t("Đánh giá nhân viên")}</h2><p className="small muted">{t("Nháp → gửi đánh giá → yêu cầu chỉnh sửa hoặc xác nhận đã đọc. Phiếu đã xác nhận được lưu trong lịch sử.")}</p></div><span className="grow"/>
        <div className="tabs" role="group" aria-label={t('Lọc phiếu đánh giá')}>{[['all','Tất cả'],['draft','Nháp'],['submitted','Chờ xác nhận'],['returned','Cần chỉnh sửa'],['acknowledged','Đã xác nhận']].map(([value,label]) => <button key={value} className="tab" type="button" aria-pressed={reviewFilter === value} onClick={() => setReviewFilter(value)}>{t(label)}</button>)}</div>
      </div>
      {can('performance.review.create') && <form className="form-grid u-mt-12"  onSubmit={createReview}>
        <label className="field"><span className="label">{t("Nhân viên *")}</span><select className="select" required value={reviewForm.employee} onChange={(event) => setReviewForm((form) => ({ ...form, employee: event.target.value, reviewer: form.reviewer === event.target.value ? '' : form.reviewer }))}><option value="">{t("Chọn nhân viên")}</option>{[...employees.values()].map((employee) => <option key={employee.id} value={employee.id}>{recordLabel('hrm.employee', employee)}</option>)}</select></label>
        <label className="field"><span className="label">{t("Người đánh giá")}</span><select className="select" value={reviewForm.reviewer} onChange={(event) => setReviewForm((form) => ({ ...form, reviewer: event.target.value }))}><option value="">{t("Chọn sau")}</option>{[...employees.values()].map((employee) => <option key={employee.id} value={employee.id} disabled={employee.id === reviewForm.employee}>{recordLabel('hrm.employee', employee)}{employee.id === reviewForm.employee ? ` · ${t('không thể tự đánh giá')}` : ''}</option>)}</select></label>
        <label className="field"><span className="label">{t("Kỳ đánh giá *")}</span><input className="input" required maxLength="80" placeholder={t('Ví dụ 2026-Q4')} value={reviewForm.period} onChange={(event) => setReviewForm((form) => ({ ...form, period: event.target.value }))}/></label>
        <label className="field"><span className="label">{t("Điểm (0–100)")}</span><input className="input" type="number" min="0" max="100" step="any" value={reviewForm.score} onChange={(event) => setReviewForm((form) => ({ ...form, score: event.target.value }))}/></label>
        <label className="field full"><span className="label">{t("Nhận xét")}</span><textarea className="textarea" rows="2" maxLength="10000" value={reviewForm.comment} onChange={(event) => setReviewForm((form) => ({ ...form, comment: event.target.value }))}/></label>
        <div className="row full"><span className="grow"/><button className="btn btn-primary" disabled={Boolean(busy) || !employees.size}>{t("Tạo phiếu nháp")}</button></div>
      </form>}
      {!can('performance.review.read') ? <div className="empty">{t("Bạn chưa có quyền xem phiếu đánh giá.")}</div> : loading ? <div className="skeleton" data-h="row"/> : !visibleReviews.length ? <div className="empty">{t("Không có phiếu đánh giá trong bộ lọc này.")}</div> : <div className="layout-split u-mt-12" >
        <PerformanceReviewRegister reviews={reviewRows} selectedId={selectedReviewId} onSelect={setSelectedReviewId} t={t} />
        {selectedReview && <section className="card card-pad"><div className="row wrap"><div><h3>{t('Đánh giá')} {employeeName(selectedReview.employee)}</h3><div className="small muted">{t('Kỳ')} {selectedReview.period || t('chưa ghi')} · {t('Người đánh giá')}: {employeeName(selectedReview.reviewer)} · {t('Tạo lúc')} {fmtDateTime(selectedReview.createdAt)}</div></div><span className="grow"/><span className="badge warning">{statusLabel(selectedReview.status || 'draft')}</span></div>
          {(selectedReview.status === 'draft' || selectedReview.status === 'returned') && can('performance.review.update') ? <form className="form-grid u-mt-12"  onSubmit={saveReview}><label className="field"><span className="label">{t("Kỳ đánh giá *")}</span><input className="input" required maxLength="80" value={reviewEdit.period} onChange={(event) => setReviewEdit((form) => ({ ...form, period: event.target.value }))}/></label><label className="field"><span className="label">{t("Người đánh giá")}</span><select className="select" value={reviewEdit.reviewer} onChange={(event) => setReviewEdit((form) => ({ ...form, reviewer: event.target.value }))}><option value="">{t("Chọn người đánh giá")}</option>{[...employees.values()].map((employee) => <option key={employee.id} value={employee.id} disabled={employee.id === selectedReview.employee}>{recordLabel('hrm.employee', employee)}{employee.id === selectedReview.employee ? ` · ${t('không thể tự đánh giá')}` : ''}</option>)}</select></label><label className="field"><span className="label">{t("Điểm (0–100) *")}</span><input className="input" type="number" min="0" max="100" step="any" required value={reviewEdit.score} onChange={(event) => setReviewEdit((form) => ({ ...form, score: event.target.value }))}/></label><label className="field full"><span className="label">{t("Nhận xét *")}</span><textarea className="textarea" rows="4" required maxLength="10000" value={reviewEdit.comment} onChange={(event) => setReviewEdit((form) => ({ ...form, comment: event.target.value }))}/></label><div className="row full"><span className="grow"/><button className="btn btn-secondary" disabled={Boolean(busy) || !can('performance.review.update')}>{t("Lưu nội dung")}</button>{can('performance.review.submitted') && <button className="btn btn-primary" type="button" disabled={Boolean(busy) || !can('performance.review.update') || !reviewEdit.period.trim() || !reviewEdit.comment.trim() || reviewEdit.score === '' || !reviewEdit.reviewer || reviewEdit.reviewer === selectedReview.employee} onClick={() => submitReview(selectedReview)}>{t("Gửi đánh giá")}</button>}</div></form> : <div className="card card-pad u-mt-12" ><div className="row wrap"><strong>{t('Điểm')}: {selectedReview.score ?? t('Chưa chấm')}/100</strong><span className="grow"/><span className="small muted">{fmtDateTime(selectedReview.updatedAt || selectedReview.createdAt)}</span></div><p className="pre-wrap">{selectedReview.comment || t('Chưa có nhận xét.')}</p>{selectedReview.revision_note && <div className="alert warning"><strong>{t("Lý do yêu cầu chỉnh sửa")}</strong><p className="pre-wrap">{selectedReview.revision_note}</p></div>}</div>}
          {selectedReview.status === 'submitted' && can('performance.review.returned') && can('performance.review.update') && <form className="form-grid u-mt-12"  onSubmit={returnReview}><label className="field full"><span className="label">{t("Lý do yêu cầu chỉnh sửa *")}</span><textarea className="textarea" required minLength="3" maxLength="4000" rows="3" value={revisionNote} onChange={(event) => setRevisionNote(event.target.value)} placeholder={t('Nêu rõ nội dung hoặc bằng chứng cần bổ sung')}/></label><div className="row full"><span className="grow"/><button className="btn btn-secondary" disabled={Boolean(busy)}>{t("Trả để chỉnh sửa")}</button></div></form>}
          {selectedReview.status === 'submitted' && can('performance.review.acknowledged') && <div className="row u-mt-12" ><span className="grow"/><button className="btn btn-primary" disabled={Boolean(busy)} onClick={() => transition(selectedReview, 'acknowledged', t('Đã ghi nhận nhân viên xác nhận đã đọc đánh giá.'))}>{t("Xác nhận đã đọc")}</button></div>}
          {selectedReview.status === 'returned' && <div className="alert warning u-mt-12" ><strong>{t("Cần chỉnh sửa trước khi gửi lại")}</strong><p className="pre-wrap">{selectedReview.revision_note || t('Chưa có lý do được lưu.')}</p></div>}
        </section>}
      </div>}
    </section>}
  </div>;
}
