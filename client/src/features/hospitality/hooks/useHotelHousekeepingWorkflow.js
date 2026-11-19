import { useCallback, useEffect, useState } from 'react';
import { api, dataPath, tenantPath } from '../../../lib/api.js';
import { can, loadIndependentData, loadRefs } from '../../../lib/state.js';
import { useLatestRequest } from '../../../lib/useLatestRequest.js';

const PAGE_SIZE = 50;
const EMPTY_REPORT = {
  items: [], itemCount: 0, hasMore: false,
  cleaningCount: 0, dueToday: 0, readyCount: 0, occupiedCount: 0, maintenanceCount: 0,
};
const EMPTY_TOTALS = {
  cleaningCount: 0, dueToday: 0, readyCount: 0, occupiedCount: 0, maintenanceCount: 0,
};

export function useHotelHousekeepingWorkflow({ t }) {
  const [items, setItems] = useState([]);
  const [rooms, setRooms] = useState(new Map());
  const [totals, setTotals] = useState(EMPTY_TOTALS);
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
      const { data: reads, errors } = await loadIndependentData({
        report: api(tenantPath(`/reports/hotel/housekeeping-board?limit=${PAGE_SIZE}&offset=${offset}`)),
        rooms: can('hotel.room.read') ? loadRefs('hotel.room') : Promise.resolve(new Map()),
      }, { report: EMPTY_REPORT, rooms: new Map() });
      if (!isCurrent()) return;
      const { report, rooms: roomMap } = reads;
      setItems(report.items || []);
      setItemCount(Number(report.itemCount || 0));
      setHasMore(Boolean(report.hasMore));
      setRooms(roomMap);
      setTotals({
        cleaningCount: report.cleaningCount || 0,
        dueToday: report.dueToday || 0,
        readyCount: report.readyCount || 0,
        occupiedCount: report.occupiedCount || 0,
        maintenanceCount: report.maintenanceCount || 0,
      });
      setLastUpdated(new Date().toISOString());
      if (errors.length) setError(errors.map((reason) => reason?.message || t('Không tải được danh sách phòng cần dọn.')).join(' · '));
      if (offset > 0 && offset >= Number(report.itemCount || 0)) {
        const lastOffset = report.itemCount > 0 ? Math.floor((report.itemCount - 1) / PAGE_SIZE) * PAGE_SIZE : 0;
        setOffset(lastOffset);
      }
    } catch (reason) {
      if (isCurrent()) setError(t(reason.message || 'Không tải được danh sách phòng cần dọn.'));
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [offset, beginRequest, t]);

  useEffect(() => {
    load();
    const timer = window.setInterval(() => load(true), 30000);
    return () => window.clearInterval(timer);
  }, [load]);

  const roomAction = async (room, action, reasonOverride) => {
    const reason = (reasonOverride ?? maintenanceReasons[room.id] ?? '').trim();
    if (action === 'maintenance' && !reason) return false;
    setBusy(room.id);
    setError('');
    try {
      await api(dataPath('hotel.room', room.id, action), {
        method: 'POST', body: action === 'maintenance' ? { maintenance_reason: reason } : undefined,
      });
      if (action === 'maintenance') setMaintenanceReasons((current) => ({ ...current, [room.id]: '' }));
      await load(true);
      return true;
    } catch (reason) {
      setError(t(reason.message || (action === 'maintenance'
        ? 'Không thể chuyển phòng sang bảo trì.'
        : 'Không thể chuyển phòng sang trạng thái sẵn sàng.')));
      await load(true);
      return false;
    } finally { setBusy(''); }
  };

  const vacantRooms = [...rooms.values()].filter((room) => room.status === 'vacant');
  const submitMaintenance = async (event) => {
    event.preventDefault();
    const room = rooms.get(maintenanceRoom);
    if (!room) return;
    const saved = await roomAction(room, 'maintenance', maintenanceReason);
    if (saved) { setMaintenanceRoom(''); setMaintenanceReason(''); }
  };

  return {
    items, rooms, totals, itemCount, offset, setOffset, hasMore, error, loading, busy,
    maintenanceReasons, setMaintenanceReasons, maintenanceRoom, setMaintenanceRoom,
    maintenanceReason, setMaintenanceReason, lastUpdated, load, roomAction,
    vacantRooms, submitMaintenance,
  };
}
