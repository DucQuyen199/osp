import { useEffect, useState } from 'react';
import { api, dataPath } from '../../../lib/api.js';
import { localDate } from '../../../lib/dates.js';
import { fmtMoney } from '../../../lib/i18n.js';

const today = localDate;

export function useHotelFrontDeskWorkflow({ data, setDataError, t }) {
  const { reservations, rooms, load: loadData } = data;
  const [selectedId, setSelectedId] = useState('');
  const [noShowReasons, setNoShowReasons] = useState({});
  const [filter, setFilter] = useState('all');
  const [party, setParty] = useState('');
  const [roomType, setRoomType] = useState('');
  const [checkIn, setCheckIn] = useState(today());
  const [checkOut, setCheckOut] = useState('');
  const [guestCount, setGuestCount] = useState('1');
  const [assignment, setAssignment] = useState('');
  const [chargeDescription, setChargeDescription] = useState('');
  const [chargeAmount, setChargeAmount] = useState('');
  const [extendedCheckout, setExtendedCheckout] = useState({});
  const [reservationEdit, setReservationEdit] = useState(null);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const selected = reservations.find((item) => item.id === selectedId) || null;

  const load = async (preserveNotice = false) => {
    if (!preserveNotice) setNotice('');
    await loadData();
  };
  useEffect(() => {
    setSelectedId((current) => reservations.some((item) => item.id === current)
      ? current
      : reservations.find((item) => item.check_in === today() && ['booked', 'checked_in'].includes(item.status))?.id || reservations[0]?.id || '');
  }, [reservations]);

  const createReservation = async (event) => {
    event.preventDefault(); setBusy('create'); setDataError(''); setNotice('');
    try {
      const created = await api(dataPath('hotel.reservation'), { method: 'POST', body: { party, room_type: roomType, check_in: checkIn, check_out: checkOut, guest_count: Number(guestCount) } });
      await load(true); setSelectedId(created.id); setNotice(t('Đã tạo đặt phòng. Giá phòng và số đêm được hệ thống tính theo loại phòng.'));
    } catch (reason) { setDataError(t(reason.message || 'Không tạo được đặt phòng. Kiểm tra sức chứa và lịch phòng.')); }
    finally { setBusy(''); }
  };
  const assignRoom = async (reservation) => {
    if (!assignment) return;
    setBusy(`${reservation.id}:assign`); setDataError(''); setNotice('');
    try { await api(dataPath('hotel.reservation', reservation.id), { method: 'PATCH', body: { room: assignment } }); await load(true); setNotice(t('Đã phân phòng cho đặt phòng.')); }
    catch (reason) { setDataError(t(reason.message || 'Không phân được phòng. Hệ thống kiểm tra trùng lịch và loại phòng.')); }
    finally { setBusy(''); }
  };
  const transition = async (reservation, action) => {
    setBusy(`${reservation.id}:${action}`); setDataError(''); setNotice('');
    try {
      if (action === 'no_show') {
        const reason = (noShowReasons[reservation.id] ?? reservation.no_show_reason ?? '').trim();
        if (!reason) throw new Error(t('Nhập lý do trước khi ghi nhận khách vắng mặt.'));
        await api(dataPath('hotel.reservation', reservation.id, action), { method: 'POST', body: { no_show_reason: reason } });
        await load(true);
        setNotice(t('Đã ghi nhận khách vắng mặt và giải phóng lịch phòng.'));
        return;
      }
      const result = await api(dataPath('hotel.reservation', reservation.id, action), { method: 'POST' });
      await load(true);
      setNotice(action === 'checked_in' ? t('Đã nhận phòng.') : action === 'checked_out' ? `${t('Đã trả phòng và chốt folio')} ${fmtMoney(result.total || reservation.total || 0)}.` : t('Đã hủy đặt phòng.'));
    } catch (reason) { setDataError(t(reason.message || (action === 'checked_in' ? 'Chưa thể nhận phòng. Cần phòng trống và đúng ngày nhận.' : 'Không cập nhật được đặt phòng.'))); }
    finally { setBusy(''); }
  };
  const addCharge = async (event) => {
    event.preventDefault(); if (!selected) return;
    setBusy('charge'); setDataError(''); setNotice('');
    try {
      await api(dataPath('hotel.folio_charge'), { method: 'POST', body: { reservation: selected.id, description: chargeDescription.trim(), amount: String(chargeAmount) } });
      setChargeDescription(''); setChargeAmount(''); await load(true); setNotice(t('Đã ghi phí phát sinh vào folio.'));
    } catch (reason) { setDataError(t(reason.message || 'Không ghi được khoản phí. Chỉ thêm phí trước khi trả phòng.')); }
    finally { setBusy(''); }
  };
  const extendStay = async (event) => {
    event.preventDefault(); if (!selected) return;
    const newCheckout = extendedCheckout[selected.id] || '';
    if (!newCheckout || newCheckout <= selected.check_out) return;
    setBusy(`${selected.id}:extend`); setDataError(''); setNotice('');
    try {
      await api(dataPath('hotel.reservation', selected.id), { method: 'PATCH', body: { check_out: newCheckout } });
      setExtendedCheckout((current) => { const next = { ...current }; delete next[selected.id]; return next; });
      await load(true);
      setNotice(t('Đã gia hạn lưu trú. Hệ thống đã kiểm tra lịch phòng và tính lại số đêm, tổng tiền theo giá phòng đã chốt khi đặt.'));
    } catch (reason) { setDataError(t(reason.message || 'Không gia hạn được. Phòng có thể đã được đặt cho khoảng thời gian mới.')); }
    finally { setBusy(''); }
  };
  const startReservationEdit = (reservation) => {
    setReservationEdit({ reservationId: reservation.id, check_in: reservation.check_in, check_out: reservation.check_out, guest_count: String(reservation.guest_count || 1) });
  };
  const updateReservationEdit = (field, value) => {
    setReservationEdit((current) => ({
      ...current,
      [field]: value,
      ...(field === 'check_in' && current.check_out <= value ? { check_out: '' } : {}),
    }));
  };
  const saveReservationEdit = async (event) => {
    event.preventDefault();
    if (!selected || reservationEdit?.reservationId !== selected.id || reservationEdit.check_out <= reservationEdit.check_in) return;
    setBusy(`${selected.id}:edit`); setDataError(''); setNotice('');
    try {
      await api(dataPath('hotel.reservation', selected.id), {
        method: 'PATCH',
        body: { check_in: reservationEdit.check_in, check_out: reservationEdit.check_out, guest_count: Number(reservationEdit.guest_count) },
      });
      setReservationEdit(null);
      await load(true);
      setNotice(t('Đã cập nhật đặt phòng. Hệ thống đã kiểm tra sức chứa và lịch phòng.'));
    } catch (reason) {
      setDataError(t(reason.message || 'Không cập nhật được đặt phòng. Kiểm tra sức chứa và lịch phòng.'));
    } finally { setBusy(''); }
  };

  return {
    selected, selectedId, setSelectedId, noShowReasons, setNoShowReasons, filter, setFilter,
    party, setParty, roomType, setRoomType, checkIn, setCheckIn, checkOut, setCheckOut,
    guestCount, setGuestCount, assignment, setAssignment, chargeDescription, setChargeDescription,
    chargeAmount, setChargeAmount, extendedCheckout, setExtendedCheckout, reservationEdit,
    setReservationEdit, busy, notice, setNotice, load, createReservation, assignRoom, transition,
    addCharge, extendStay, startReservationEdit, updateReservationEdit, saveReservationEdit,
  };
}
