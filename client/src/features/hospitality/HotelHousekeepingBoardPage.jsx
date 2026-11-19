import React from 'react';
import { useDocumentTitle } from '../../lib/useDocumentTitle.js';
import { fmtAgo, fmtDate, fmtDateTime, uiTextWith } from '../../lib/i18n.js';
import { can } from '../../lib/state.js';
import { recordHref } from '../../lib/routes.js';
import housekeepingEnglish from './housekeeping.en.js';
import HousekeepingRoomCard from './components/HousekeepingRoomCard.jsx';
import HousekeepingMaintenanceForm from './components/HousekeepingMaintenanceForm.jsx';
import { useHotelHousekeepingWorkflow } from './hooks/useHotelHousekeepingWorkflow.js';

const t = (text) => uiTextWith(text, housekeepingEnglish);

export default function HotelHousekeepingBoardPage() {
  useDocumentTitle(`${t('Buồng phòng')} · OSP Suite`);
  const {
    items, rooms, totals, itemCount, offset, setOffset, hasMore, error, loading, busy,
    maintenanceReasons, setMaintenanceReasons, maintenanceRoom, setMaintenanceRoom,
    maintenanceReason, setMaintenanceReason, lastUpdated, load, roomAction,
    vacantRooms, submitMaintenance,
  } = useHotelHousekeepingWorkflow({ t });

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
