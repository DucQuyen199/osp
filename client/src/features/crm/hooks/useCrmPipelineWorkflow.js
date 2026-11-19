import { useCallback, useState } from 'react';
import { api, dataPath, tenantPath } from '../../../lib/api.js';
import { confirmDialog, textDialog, toast } from '../../../lib/feedback.js';
import { useLatestRequest } from '../../../lib/useLatestRequest.js';

export function useCrmPipelineWorkflow({ t }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [workingDeal, setWorkingDeal] = useState('');
  const latestRequest = useLatestRequest();

  const load = useCallback(async () => {
    const isLatest = latestRequest();
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      const nextReport = await api(`${tenantPath('/reports/crm/pipeline')}?${params}`);
      if (isLatest()) setReport(nextReport);
    } catch (reason) {
      if (isLatest()) {
        setReport(null);
        setError(t(reason.message || 'Không tải được pipeline bán hàng.'));
      }
    } finally {
      if (isLatest()) setLoading(false);
    }
  }, [from, to, latestRequest, t]);

  const moveDeal = useCallback(async (deal, stage) => {
    setError('');
    try {
      await api(dataPath('crm.deal', deal.id), { method: 'PATCH', body: { pipeline_stage: stage } });
      await load();
    } catch (reason) {
      setError(t(reason.message || 'Không cập nhật được giai đoạn cơ hội.'));
    }
  }, [load, t]);

  const closeDeal = useCallback(async (deal, outcome) => {
    let body;
    if (outcome === 'lost') {
      const lostReason = await textDialog({
        title: t('Ghi nhận cơ hội thua'),
        message: t('Ghi lý do để nhóm bán hàng phân tích và cải thiện quy trình chốt đơn.'),
        label: t('Lý do thua (5–1000 ký tự)'), minLength: 5, maxLength: 1000,
        confirmLabel: t('Tiếp tục'), danger: true,
      });
      if (!lostReason) return;
      body = { lost_reason: lostReason };
    }
    const won = outcome === 'won';
    const confirmed = await confirmDialog({
      title: t(won ? 'Xác nhận thắng cơ hội?' : 'Xác nhận thua cơ hội?'),
      message: t(won
        ? 'Cơ hội sẽ được khóa lịch sử và hệ thống tạo đơn bán nháp theo khách hàng, dòng hàng, kho và giá trị để bạn rà soát trước khi xác nhận.'
        : 'Cơ hội sẽ được đóng và chuyển khỏi pipeline đang mở.'),
      confirmLabel: t(won ? 'Thắng · tạo đơn bán' : 'Đóng cơ hội thua'), danger: !won,
    });
    if (!confirmed) return;
    setWorkingDeal(`${deal.id}:${outcome}`);
    setError('');
    try {
      await api(dataPath('crm.deal', deal.id, outcome), { method: 'POST', ...(body ? { body } : {}) });
      toast(t(won ? 'Đã thắng cơ hội và tạo đơn bán hàng.' : 'Đã đóng cơ hội với lý do thua.'), 'success');
      await load();
    } catch (reason) {
      setError(t(reason.message || 'Không thể đóng cơ hội.'));
    } finally {
      setWorkingDeal('');
    }
  }, [load, t]);

  return { from, setFrom, to, setTo, report, error, loading, workingDeal, load, moveDeal, closeDeal };
}
