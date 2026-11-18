import { useCallback, useEffect, useState } from 'react';
import { uiTextWith } from '../../../lib/i18n.js';
import { can, loadAllResponse, loadIndependentData, loadRefs } from '../../../lib/state.js';
import { useLatestRequest } from '../../../lib/useLatestRequest.js';
import lmsEnglish from '../lms.en.js';

const t = (text) => uiTextWith(text, lmsEnglish);
const rows = (response) => Array.isArray(response?.items) ? response.items : [];
const emptyResponse = () => ({ items: [] });
const emptyMap = () => new Map();
const emptyData = () => ({ courses: [], lessons: [], enrollments: [], progress: [], certificates: [], parties: new Map() });

export function useLmsWorkbenchData() {
  const [data, setData] = useState(emptyData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const beginRequest = useLatestRequest();

  const load = useCallback(async (quiet = false) => {
    const isCurrent = beginRequest();
    if (!quiet) { setLoading(true); setError(''); }
    try {
      const { data: reads, errors } = await loadIndependentData({
        courses: can('lms.course.read') ? loadAllResponse('lms.course') : Promise.resolve(emptyResponse()),
        lessons: can('lms.lesson.read') ? loadAllResponse('lms.lesson') : Promise.resolve(emptyResponse()),
        enrollments: can('lms.enrollment.read') ? loadAllResponse('lms.enrollment') : Promise.resolve(emptyResponse()),
        progress: can('lms.lesson_progress.read') ? loadAllResponse('lms.lesson_progress') : Promise.resolve(emptyResponse()),
        certificates: can('lms.certificate.read') ? loadAllResponse('lms.certificate') : Promise.resolve(emptyResponse()),
        parties: can('master-data.party.read') ? loadRefs('master-data.party') : Promise.resolve(emptyMap()),
      }, {
        courses: emptyResponse(), lessons: emptyResponse(), enrollments: emptyResponse(), progress: emptyResponse(),
        certificates: emptyResponse(), parties: emptyMap(),
      });
      if (!isCurrent()) return;
      setData({
        courses: rows(reads.courses).sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || ''))),
        lessons: rows(reads.lessons),
        enrollments: rows(reads.enrollments),
        progress: rows(reads.progress),
        certificates: rows(reads.certificates),
        parties: reads.parties,
      });
      if (errors.length) setError(errors.map((reason) => reason?.message || t('Không tải được dữ liệu đào tạo.')).join(' · '));
    } catch (reason) {
      if (isCurrent()) setError(t(reason.message || 'Không tải được dữ liệu đào tạo.'));
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [beginRequest]);

  useEffect(() => { load(); }, [load]);
  return { ...data, loading, error, setError, load };
}
