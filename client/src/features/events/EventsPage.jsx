import React, { useEffect, useState } from 'react';
import { useDocumentTitle } from '../../lib/useDocumentTitle.js';
import { api, tenantPath } from '../../lib/api.js';
import { uiText } from '../../lib/i18n.js';
import EntityListPager from '../entities/components/EntityListPager.jsx';
import { EventTimeline } from '../entities/EntityDetailPage.jsx';

const PAGE_SIZE = 50;

export default function EventsPage() {
  useDocumentTitle(`${uiText('Dòng sự kiện')} · OSP Suite`);
  const [events, setEvents] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [rootsOnly, setRootsOnly] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String(page * PAGE_SIZE),
      rootsOnly: String(rootsOnly),
    });
    setLoading(true);
    setError('');
    api(tenantPath(`/events/page?${query}`), { signal: controller.signal })
      .then((response) => {
        if (controller.signal.aborted) return;
        setEvents(Array.isArray(response?.items) ? response.items : []);
        setTotal(Number(response?.total || 0));
      })
      .catch((reason) => {
        if (reason.name !== 'AbortError') setError(reason.message || uiText('Không tải được dòng sự kiện.'));
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [page, reloadKey, rootsOnly]);

  return <div className="page">
    <div className="page-head">
      <div>
        <h1>{uiText('Dòng sự kiện')}</h1>
        <p className="sub">{uiText('Các thay đổi và phản ứng tự động giữa các mô-đun được ghi trong cùng giao dịch nghiệp vụ.')}</p>
      </div>
      <label className="check"><input type="checkbox" checked={rootsOnly} onChange={(event) => { setRootsOnly(event.target.checked); setPage(0); }} />{uiText('Chỉ hiện sự kiện gốc')}</label>
    </div>
    {error && <div className="alert danger" role="alert">{uiText(error)}</div>}
    <section className="card" aria-label={uiText('Chuỗi sự kiện')}>
      <div className="card-pad">
        {loading ? <div className="skeleton" data-h="row" aria-label={uiText('Đang tải sự kiện')} />
          : error ? <button className="btn btn-secondary btn-sm" type="button" onClick={() => setReloadKey((key) => key + 1)}>{uiText('Thử lại')}</button>
            : <EventTimeline events={events} />}
      </div>
      <EntityListPager
        total={total}
        page={page}
        pages={Math.max(1, Math.ceil(total / PAGE_SIZE))}
        loading={loading}
        onPageChange={setPage}
      />
    </section>
  </div>;
}
