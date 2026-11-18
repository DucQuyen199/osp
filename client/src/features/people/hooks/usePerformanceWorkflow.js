import { useEffect, useState } from 'react';
import { api, dataPath } from '../../../lib/api.js';

const emptyObjective = { title: '', owner: '', period: '' };
const emptyKeyResult = { title: '', target: '', unit: '' };
const emptyReview = { employee: '', reviewer: '', period: '', score: '', comment: '' };
const emptyReviewEdit = { period: '', reviewer: '', score: '', comment: '' };

export function usePerformanceWorkflow({
  load, selectedObjective, selectedReview, selectedReviewId, setSelectedObjectiveId, setSelectedReviewId,
  setReviewFilter, setError, t,
}) {
  const [objectiveForm, setObjectiveForm] = useState(emptyObjective);
  const [keyResultForm, setKeyResultForm] = useState(emptyKeyResult);
  const [reviewForm, setReviewForm] = useState(emptyReview);
  const [reviewEdit, setReviewEdit] = useState(emptyReviewEdit);
  const [progress, setProgress] = useState({});
  const [revisionNote, setRevisionNote] = useState('');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    setReviewEdit({
      period: selectedReview?.period || '', reviewer: selectedReview?.reviewer || '',
      score: selectedReview?.score ?? '', comment: selectedReview?.comment || '',
    });
    setRevisionNote('');
  }, [selectedReviewId]);

  async function run(key, operation, success) {
    setBusy(key); setError(''); setNotice('');
    try {
      const result = await operation();
      await load(true);
      if (success) setNotice(success);
      return result;
    } catch (reason) {
      setError(reason.message || t('Thao tác không thành công.'));
      await load(true);
      return undefined;
    } finally { setBusy(''); }
  }

  async function createObjective(event) {
    event.preventDefault();
    await run('objective:create', async () => {
      const created = await api(dataPath('performance.objective'), { method: 'POST', body: {
        title: objectiveForm.title.trim(), ...(objectiveForm.owner ? { owner: objectiveForm.owner } : {}),
        ...(objectiveForm.period.trim() ? { period: objectiveForm.period.trim() } : {}),
      } });
      setObjectiveForm((form) => ({ ...emptyObjective, owner: form.owner })); setSelectedObjectiveId(created.id);
      return created;
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
    return run('review:create', async () => {
      const review = await api(dataPath('performance.review'), { method: 'POST', body: {
        employee: reviewForm.employee, reviewer: reviewForm.reviewer || null,
        period: reviewForm.period.trim(), ...(reviewForm.score !== '' ? { score: Number(reviewForm.score) } : {}),
        ...(reviewForm.comment.trim() ? { comment: reviewForm.comment.trim() } : {}),
      } });
      setReviewForm((form) => ({ ...emptyReview, employee: form.employee }));
      setSelectedReviewId(review.id); setReviewFilter('all');
      return review;
    }, t('Đã tạo phiếu đánh giá nháp.'));
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

  return {
    objectiveForm, setObjectiveForm, keyResultForm, setKeyResultForm, reviewForm, setReviewForm,
    reviewEdit, setReviewEdit, progress, setProgress, revisionNote, setRevisionNote,
    busy, notice, createObjective, createKeyResult, updateProgress, createReview,
    saveReview, transition, submitReview, returnReview,
  };
}
