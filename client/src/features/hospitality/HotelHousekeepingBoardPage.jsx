import React, { useCallback, useEffect, useState } from 'react';
import { useDocumentTitle } from '../../lib/useDocumentTitle.js';
import { api, dataPath, tenantPath } from '../../lib/api.js';
import { fmtAgo, fmtDate, fmtDateTime, uiTextWith } from '../../lib/i18n.js';
import { can, loadIndependentData, loadRefs } from '../../lib/state.js';
import { recordHref } from '../../lib/routes.js';
import { useLatestRequest } from '../../lib/useLatestRequest.js';
import housekeepingEnglish from './housekeeping.en.js';
import HousekeepingRoomCard from './components/HousekeepingRoomCard.jsx';
import HousekeepingMaintenanceForm from './components/HousekeepingMaintenanceForm.jsx';

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
  const beginRequest = useLatestRequest();

  const load = useCallback(async (quiet = false) => {
    const isCurrent = beginRequest();
    if (!quiet) { setLoading(true); setError(''); }
    try {
      const emptyReport = { items: [], itemCount: 0, hasMore: false, cleaningCount: 0, dueToday: 0, readyCount: 0, occupiedCount: 0, maintenanceCount: 0 };
      const { data: reads, errors } = await loadIndependentData({
        report: api(tenantPath(`/reports/hotel/housekeeping-board?limit=${PAGE_SIZE}&offset=${offset}`)),
        rooms: can('hotel.room.read') ? loadRefs('hotel.room') : Promise.resolve(new Map()),
      }, { report: emptyReport, rooms: new Map() });
      if (!isCurrent()) return;
      const { report: result, rooms: roomMap } = reads;
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
      if (errors.length) setError(errors.map((reason) => reason?.message || t('Không tải được danh sách phòng cần dọn.')).join(' · '));
      if (offset > 0 && offset >= Number(result.itemCount || 0)) {
        const lastOffset = result.itemCount > 0 ? Math.floor((result.itemCount - 1) / PAGE_SIZE) * PAGE_SIZE : 0;
        setOffset(lastOffset);
      }
    } catch (reason) {
      if (isCurrent()) setError(t(reason.message || 'Không tải được danh sách phòng cần dọn.'));
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [offset, beginRequest]);

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
  const submitMaintenance = async (event) => {
    event.preventDefault();
    const room = rooms.get(maintenanceRoom);
    if (!room) return;
    const saved = await roomAction(room, 'maintenance', maintenanceReason);
    if (saved) { setMaintenanceRoom(''); setMaintenanceReason(''); }
  };

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
    {can('hotel.room.maintenance') && <HousekeepingMaintenanceForm
      vacantRooms={vacantRooms} roomId={maintenanceRoom} reason={maintenanceReason} busy={busy}
      onRoomChange={setMaintenanceRoom} onReasonChange={setMaintenanceReason}
      onSubmit={submitMaintenance} t={t}
    />}
    {error && <div className="alert danger" role="alert">{t(error)}</div>}
    {loading && !lastUpdated ? <div className="card-pad"><div className="skeleton" data-h="row" /></div> : items.length ? <div className="housekeeping-grid">
      {items.map((room) => <HousekeepingRoomCard key={room.id} room={room} roomHref={recordHref('hotel.room', room.id)} busy={busy} maintenanceReason={maintenanceReasons[room.id] || ''} canMaintenance={can('hotel.room.maintenance')} canReady={can('hotel.room.ready')} canSubmitMaintenance={Boolean(maintenanceReasons[room.id]?.trim())} fmtAgo={fmtAgo} fmtDate={fmtDate} t={t} onMaintenanceReasonChange={(value) => setMaintenanceReasons((current) => ({ ...current, [room.id]: value }))} onSetMaintenance={() => roomAction(room, 'maintenance')} onMarkReady={() => roomAction(room, 'ready')} />)}
    </div> : <div className="empty housekeeping-empty">{itemCount > 0 ? t('Phòng ở trang khác') : t('Không có phòng chờ dọn. Kiểm tra danh sách đặt phòng trong ngày trước khi nhận khách.')}</div>}
    <nav className="row wrap" aria-label={t('Phân trang phòng cần xử lý')}>
      <span className="small muted" aria-live="polite">{t('Đang hiển thị {from}–{to} trên {total} phòng').replace('{from}', String(itemCount ? offset + 1 : 0)).replace('{to}', String(Math.min(offset + items.length, itemCount))).replace('{total}', String(itemCount))}{loading ? ` · ${t('Đang tải…')}` : ''}</span>
      <span className="grow" />
      <button className="btn btn-secondary btn-sm" type="button" disabled={loading || offset === 0} onClick={() => setOffset((current) => Math.max(0, current - PAGE_SIZE))}>{t('Trang trước')}</button>
      <button className="btn btn-secondary btn-sm" type="button" disabled={loading || !hasMore} onClick={() => setOffset((current) => current + PAGE_SIZE)}>{t('Trang sau')}</button>
    </nav>
  </div>;
}
