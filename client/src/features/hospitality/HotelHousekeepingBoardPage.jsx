import React, { useCallback, useEffect, useState } from 'react';
import { api, dataPath, tenantPath } from '../../lib/api.js';
import { fmtAgo, fmtDate, fmtDateTime, uiTextWith } from '../../lib/i18n.js';
import { can } from '../../lib/state.js';
import { recordHref } from '../../lib/routes.js';
import housekeepingEnglish from './housekeeping.en.js';

const t = (text) => uiTextWith(text, housekeepingEnglish);

export default function HotelHousekeepingBoardPage() {
  const [items, setItems] = useState([]);
  const [totals, setTotals] = useState({ cleaningCount: 0, dueToday: 0, readyCount: 0, occupiedCount: 0 });
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) { setLoading(true); setError(''); }
    try {
      const result = await api(tenantPath('/reports/hotel/housekeeping-board'));
      setItems(result.items || []);
      setTotals({
        cleaningCount: result.cleaningCount || 0,
        dueToday: result.dueToday || 0,
        readyCount: result.readyCount || 0,
        occupiedCount: result.occupiedCount || 0,
      });
      setTruncated(Boolean(result.truncated));
      setLastUpdated(new Date().toISOString());
    } catch (reason) {
      setError(t(reason.message || 'Không tải được danh sách phòng cần dọn.'));
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    document.title = `${t('Buồng phòng')} · OSP Suite`;
    load();
    const timer = window.setInterval(() => load(true), 30000);
    return () => window.clearInterval(timer);
  }, [load]);

  const markReady = async (room) => {
    setBusy(room.id);
    setError('');
    try {
      await api(dataPath('hotel.room', room.id, 'ready'), { method: 'POST' });
      await load(true);
    } catch (reason) {
      setError(t(reason.message || 'Không thể chuyển phòng sang trạng thái sẵn sàng.'));
      await load(true);
    } finally {
      setBusy('');
    }
  };

  return <div className="page">
    <div className="page-head"><div><h1>{t('Bảng buồng phòng')}</h1><p className="sub">{t('Phòng vừa trả được xếp theo khách đến tiếp theo. Chỉ đánh dấu sẵn sàng sau khi hoàn tất dọn và kiểm tra phòng.')}</p></div><button className="btn btn-secondary" type="button" disabled={loading} onClick={() => load()}>{loading ? t('Đang tải…') : t('Làm mới')}</button></div>
    <div className="row wrap housekeeping-summary">
      <span className="badge warning">{t('Chờ dọn:')} {totals.cleaningCount}</span>
      <span className="badge danger">{t('Khách đến hôm nay:')} {totals.dueToday}</span>
      <span className="badge success">{t('Sẵn sàng:')} {totals.readyCount}</span>
      <span className="badge plain">{t('Đang có khách:')} {totals.occupiedCount}</span>
      {lastUpdated && <span className="small muted">{t('Cập nhật lúc')} {fmtDateTime(lastUpdated)}</span>}
    </div>
    {error && <div className="alert danger" role="alert">{t(error)}</div>}
    {truncated && <div className="alert warning" role="status">{t('Đang hiển thị tối đa 500 phòng đang chờ dọn.')}</div>}
    {loading && !lastUpdated ? <div className="card-pad"><div className="skeleton" data-h="row" /></div> : items.length ? <div className="housekeeping-grid">
      {items.map((room) => <article className={`card housekeeping-card${room.priority === 'today' ? ' due-today' : ''}`} key={room.id}>
        <header className="card-head">
          <div><a href={recordHref('hotel.room', room.id)}><strong>{t('Phòng')} {room.number}</strong></a><div className="small muted">{room.roomType || t('Chưa rõ loại phòng')}{room.floor ? ` · ${t('Tầng')} ${room.floor}` : ''}</div></div>
          {room.priority === 'today' && <span className="badge danger">{t('Ưu tiên hôm nay')}</span>}
        </header>
        <div className="housekeeping-detail">
          <div><span className="small muted">{t('Trả phòng gần nhất')}</span><strong>{room.lastCheckout ? fmtDate(room.lastCheckout) : t('Chưa có lịch sử trả phòng')}</strong><span className="small muted">{room.dirtySince ? `${t('Chờ dọn')} ${fmtAgo(room.dirtySince)}` : ''}</span></div>
          <div><span className="small muted">{t('Lượt đến tiếp theo')}</span><strong>{room.nextArrival ? fmtDate(room.nextArrival) : t('Chưa xếp khách vào phòng này')}</strong><span className="small muted">{room.priority === 'today' ? t('Khách đến hôm nay') : t('Kiểm tra lịch nhận phòng')}</span></div>
        </div>
        {can('hotel.room.ready') && <footer className="row housekeeping-footer"><span className="small muted">{t('Xác nhận sau khi đã dọn và kiểm tra')}</span><span className="grow" /><button className="btn btn-primary" type="button" disabled={Boolean(busy)} onClick={() => markReady(room)}>{busy === room.id ? t('Đang cập nhật…') : t('Đánh dấu sẵn sàng')}</button></footer>}
      </article>)}
    </div> : <div className="empty housekeeping-empty">{t('Không có phòng chờ dọn. Kiểm tra danh sách đặt phòng trong ngày trước khi nhận khách.')}</div>}
  </div>;
}
