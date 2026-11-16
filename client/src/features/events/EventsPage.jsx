import React, { useEffect, useMemo, useState } from 'react';
import { fetchEvents } from '../../lib/events.js';
import { uiText } from '../../lib/i18n.js';
import { EventTimeline } from '../entities/EntityDetailPage.jsx';

export default function EventsPage() {
  const [events, setEvents] = useState(null);
  const [error, setError] = useState('');
  const [rootsOnly, setRootsOnly] = useState(true);

  useEffect(() => {
    document.title = `${uiText('Dòng sự kiện')} · OSP Suite`;
    let active = true;
    fetchEvents(300).then((items) => { if (active) setEvents(items); })
      .catch((reason) => { if (active) setError(reason.message || uiText('Không tải được dòng sự kiện.')); });
    return () => { active = false; };
  }, []);

  const displayed = useMemo(() => {
    if (!events) return [];
    return [...events].reverse().filter((event) => !rootsOnly || event.depth === 0).slice(0, 200);
  }, [events, rootsOnly]);

  return <div className="page">
    <div className="page-head">
      <div>
        <h1>{uiText('Dòng sự kiện')}</h1>
        <p className="sub">{uiText('Các thay đổi và phản ứng tự động giữa các mô-đun được ghi trong cùng giao dịch nghiệp vụ.')}</p>
      </div>
      <label className="check"><input type="checkbox" checked={rootsOnly} onChange={(event) => setRootsOnly(event.target.checked)} />{uiText('Chỉ hiện sự kiện gốc')}</label>
    </div>
    {error && <div className="alert danger" role="alert">{error}</div>}
    <section className="card" aria-label={uiText('Chuỗi sự kiện')}>
      <div className="card-pad">
        {events ? <EventTimeline events={displayed} /> : <div className="skeleton" data-h="row" aria-label={uiText('Đang tải sự kiện')} />}
      </div>
    </section>
  </div>;
}
