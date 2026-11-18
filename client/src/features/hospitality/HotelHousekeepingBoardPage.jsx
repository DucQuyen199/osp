import React, { useCallback, useEffect, useState } from 'react';
import { useDocumentTitle } from '../../lib/useDocumentTitle.js';
import { api, dataPath, tenantPath } from '../../lib/api.js';
import { fmtAgo, fmtDate, fmtDateTime, uiTextWith } from '../../lib/i18n.js';
import { can, loadRefs } from '../../lib/state.js';
import { recordHref } from '../../lib/routes.js';
import housekeepingEnglish from './housekeeping.en.js';

const t = (text) => uiTextWith(text, housekeepingEnglish);
const PAGE_SIZE = 50;

export default function HotelHousekeepingBoardPage() {
  useDocumentTitle(`${t('Buồng phòng')} · OSP Suite`);
  const [items, setItems] = useState([]);
  const [rooms, setRooms] = useState(new Map());
  const [totals, setTotals] = useState({ cleaningCount: 0, dueToday: 0, readyCount: 0, occupiedCount: 0, maintenanceCount: 0 });
  const [itemCount, setItemCount] = useState(0);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState('');
  const [maintenanceReasons, setMaintenanceReasons] = useState({});
  const [maintenanceRoom, setMaintenanceRoom] = useState('');
  const [maintenanceReason, setMaintenanceReason] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) { setLoading(true); setError(''); }
    try {
      const [result, roomMap] = await Promise.all([
        api(tenantPath(`/reports/hotel/housekeeping-board?limit=${PAGE_SIZE}&offset=${offset}`)),
        loadRefs('hotel.room'),
      ]);
      setItems(result.items || []);
      setItemCount(Number(result.itemCount || 0));
      setHasMore(Boolean(result.hasMore));
      setRooms(roomMap);
      setTotals({
        cleaningCount: result.cleaningCount || 0,
        dueToday: result.dueToday || 0,
        readyCount: result.readyCount || 0,
        occupiedCount: result.occupiedCount || 0,
        maintenanceCount: result.maintenanceCount || 0,
      });
      setLastUpdated(new Date().toISOString());
      if (offset > 0 && offset >= Number(result.itemCount || 0)) {
        const lastOffset = result.itemCount > 0 ? Math.floor((result.itemCount - 1) / PAGE_SIZE) * PAGE_SIZE : 0;
        setOffset(lastOffset);
      }
    } catch (reason) {
      setError(t(reason.message || 'Không tải được danh sách phòng cần dọn.'));
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [offset]);

  useEffect(() => { load();
    const timer = window.setInterval(() => load(true), 30000);
    return () => window.clearInterval(timer);
  }, [load]);

  const roomAction = async (room, action, reasonOverride) => {
    const reason = (reasonOverride ?? maintenanceReasons[room.id] ?? '').trim();
    if (action === 'maintenance' && !reason) return false;
    setBusy(room.id);
    setError('');
    try {
      await api(dataPath('hotel.room', room.id, action), { method: 'POST', body: action === 'maintenance' ? { maintenance_reason: reason } : undefined });
      if (action === 'maintenance') setMaintenanceReasons((current) => ({ ...current, [room.id]: '' }));
      await load(true);
      return true;
    } catch (reason) {
      setError(t(reason.message || (action === 'maintenance' ? 'Không thể chuyển phòng sang bảo trì.' : 'Không thể chuyển phòng sang trạng thái sẵn sàng.')));
      await load(true);
      return false;
    } finally {
      setBusy('');
    }
  };
  const vacantRooms = [...rooms.values()].filter((room) => room.status === 'vacant');

  return <div className="page">
    <div className="page-head"><div><h1>{t('Bảng buồng phòng')}</h1><p className="sub">{t('Phòng vừa trả được xếp theo khách đến tiếp theo. Chỉ đánh dấu sẵn sàng sau khi hoàn tất dọn và kiểm tra phòng.')}</p></div><button className="btn btn-secondary" type="button" disabled={loading} onClick={() => load()}>{loading ? t('Đang tải…') : t('Làm mới')}</button></div>
    <div className="row wrap housekeeping-summary">
      <span className="badge warning">{t('Chờ dọn:')} {totals.cleaningCount}</span>
      <span className="badge danger">{t('Khách đến hôm nay:')} {totals.dueToday}</span>
      <span className="badge danger">{t('\u0110ang b\u1ea3o tr\u00ec:')} {totals.maintenanceCount}</span>
      <span className="badge success">{t('Sẵn sàng:')} {totals.readyCount}</span>
      <span className="badge plain">{t('Đang có khách:')} {totals.occupiedCount}</span>
      {lastUpdated && <span className="small muted">{t('Cập nhật lúc')} {fmtDateTime(lastUpdated)}</span>}
    </div>
    {can('hotel.room.maintenance') && <section className="card card-pad housekeeping-maintenance-form">
      <h2>{t('\u0110\u01b0a ph\u00f2ng tr\u1ed1ng v\u00e0o b\u1ea3o tr\u00ec')}</h2>
      {vacantRooms.length ? <form className="row wrap" onSubmit={async (event) => {
        event.preventDefault(); const room = rooms.get(maintenanceRoom); if (!room) return;
        const saved = await roomAction(room, 'maintenance', maintenanceReason);
        if (saved) { setMaintenanceRoom(''); setMaintenanceReason(''); }
      }}>
        <label className="field"><span className="label">{t('Ph\u00f2ng tr\u1ed1ng')}</span><select className="select" required value={maintenanceRoom} onChange={(event) => setMaintenanceRoom(event.target.value)}><option value="">{t('Ch\u1ecdn ph\u00f2ng c\u1ea7n b\u1ea3o tr\u00ec')}</option>{vacantRooms.map((room) => <option key={room.id} value={room.id}>{room.number}{room.floor ? ` \u00b7 ${t('T\u1ea7ng')} ${room.floor}` : ''}</option>)}</select></label>
        <label className="field grow"><span className="label">{t('L\u00fd do b\u1ea3o tr\u00ec *')}</span><input className="input" required maxLength="500" value={maintenanceReason} onChange={(event) => setMaintenanceReason(event.target.value)} placeholder={t('M\u00f4 t\u1ea3 v\u1ea5n \u0111\u1ec1 c\u1ea7n x\u1eed l\u00fd')} /></label>
        <button className="btn btn-secondary" type="submit" disabled={Boolean(busy) || !maintenanceRoom || !maintenanceReason.trim()}>{t('\u0110\u01b0a v\u00e0o b\u1ea3o tr\u00ec')}</button>
      </form> : <p className="small muted">{t('Kh\u00f4ng c\u00f3 ph\u00f2ng tr\u1ed1ng \u0111\u1ec3 \u0111\u01b0a v\u00e0o b\u1ea3o tr\u00ec.')}</p>}
    </section>}
    {error && <div className="alert danger" role="alert">{t(error)}</div>}
    {loading && !lastUpdated ? <div className="card-pad"><div className="skeleton" data-h="row" /></div> : items.length ? <div className="housekeeping-grid">
      {items.map((room) => <article className={`card housekeeping-card${room.priority === 'today' ? ' due-today' : ''}`} key={room.id}>
        <header className="card-head">
          <div><a href={recordHref('hotel.room', room.id)}><strong>{t('Phòng')} {room.number}</strong></a><div className="small muted">{room.roomType || t('Chưa rõ loại phòng')}{room.floor ? ` · ${t('Tầng')} ${room.floor}` : ''}</div></div>
          {room.status === 'maintenance' ? <span className="badge danger">{t('B\u1ea3o tr\u00ec')}</span> : room.priority === 'today' && <span className="badge danger">{t('\u01afu ti\u00ean h\u00f4m nay')}</span>}
        </header>
        <div className="housekeeping-detail">
          <div><span className="small muted">{room.status === 'maintenance' ? t('L\u00fd do b\u1ea3o tr\u00ec') : t('Tr\u1ea3 ph\u00f2ng g\u1ea7n nh\u1ea5t')}</span><strong>{room.status === 'maintenance' ? room.maintenanceReason : room.lastCheckout ? fmtDate(room.lastCheckout) : t('Ch\u01b0a c\u00f3 l\u1ecbch s\u1eed tr\u1ea3 ph\u00f2ng')}</strong><span className="small muted">{room.dirtySince && room.status === 'cleaning' ? `${t('Ch\u1edd d\u1ecdn')} ${fmtAgo(room.dirtySince)}` : ''}</span></div>
          <div><span className="small muted">{t('Lượt đến tiếp theo')}</span><strong>{room.nextArrival ? fmtDate(room.nextArrival) : t('Chưa xếp khách vào phòng này')}</strong><span className="small muted">{room.priority === 'today' ? t('Khách đến hôm nay') : t('Kiểm tra lịch nhận phòng')}</span></div>
        </div>
        {room.status === 'cleaning' && can('hotel.room.maintenance') && <div className="row wrap housekeeping-footer"><label className="field"><span className="label">{t('Ghi nh\u1eadn h\u01b0 h\u1ecfng / c\u1ea7n b\u1ea3o tr\u00ec')}</span><input className="input" maxLength="500" value={maintenanceReasons[room.id] || ''} onChange={(event) => setMaintenanceReasons((current) => ({ ...current, [room.id]: event.target.value }))} placeholder={t('M\u00f4 t\u1ea3 v\u1ea5n \u0111\u1ec1 c\u1ea7n x\u1eed l\u00fd')} /></label><button className="btn btn-secondary" type="button" disabled={Boolean(busy) || !maintenanceReasons[room.id]?.trim()} onClick={() => roomAction(room, 'maintenance')}>{t('\u0110\u01b0a v\u00e0o b\u1ea3o tr\u00ec')}</button></div>}
        {can('hotel.room.ready') && <footer className="row housekeeping-footer"><span className="small muted">{room.status === 'maintenance' ? t('Ch\u1ec9 \u0111\u00e1nh d\u1ea5u s\u1eb5n s\u00e0ng sau khi s\u1eeda ch\u1eefa v\u00e0 ki\u1ec3m tra') : t('X\u00e1c nh\u1eadn sau khi \u0111\u00e3 d\u1ecdn v\u00e0 ki\u1ec3m tra')}</span><span className="grow" /><button className="btn btn-primary" type="button" disabled={Boolean(busy)} onClick={() => roomAction(room, 'ready')}>{busy === room.id ? t('\u0110ang c\u1eadp nh\u1eadt\u2026') : t('\u0110\u00e1nh d\u1ea5u s\u1eb5n s\u00e0ng')}</button></footer>}
      </article>)}
    </div> : <div className="empty housekeeping-empty">{itemCount > 0 ? t('Phòng ở trang khác') : t('Không có phòng chờ dọn. Kiểm tra danh sách đặt phòng trong ngày trước khi nhận khách.')}</div>}
    <nav className="row wrap" aria-label={t('Phân trang phòng cần xử lý')}>
      <span className="small muted" aria-live="polite">{t('Đang hiển thị {from}–{to} trên {total} phòng').replace('{from}', String(itemCount ? offset + 1 : 0)).replace('{to}', String(Math.min(offset + items.length, itemCount))).replace('{total}', String(itemCount))}{loading ? ` · ${t('Đang tải…')}` : ''}</span>
      <span className="grow" />
      <button className="btn btn-secondary btn-sm" type="button" disabled={loading || offset === 0} onClick={() => setOffset((current) => Math.max(0, current - PAGE_SIZE))}>{t('Trang trước')}</button>
      <button className="btn btn-secondary btn-sm" type="button" disabled={loading || !hasMore} onClick={() => setOffset((current) => current + PAGE_SIZE)}>{t('Trang sau')}</button>
    </nav>
  </div>;
}
