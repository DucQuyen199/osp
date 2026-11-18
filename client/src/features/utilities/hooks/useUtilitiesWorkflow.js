import { useState } from 'react';
import { api, dataPath } from '../../../lib/api.js';

export function useUtilitiesWorkflow({
  load, meter, selectedMeter, setSelectedMeter, period, readingValue, setReadingValue,
  meterForm, setMeterForm, rateDraft, fixedChargeDraft, tariffTiersDraft,
  setError, serializeTariffTier, t,
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  async function createReading(event) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      await api(dataPath('utilities.meter_reading'), { method: 'POST', body: { meter: selectedMeter, period, reading: String(readingValue) } });
      setNotice(t('Đã ghi nhận chỉ số; mức tiêu thụ và tiền được tính theo dữ liệu công tơ.')); setReadingValue(''); await load();
    } catch (reason) { setError(reason.message || t('Không thể ghi chỉ số.')); }
    finally { setBusy(false); }
  }

  async function createMeter(event) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      const created = await api(dataPath('utilities.meter'), { method: 'POST', body: {
        party: meterForm.party, code: meterForm.code.trim(), kind: meterForm.kind, rate: String(meterForm.rate),
        fixed_charge: String(meterForm.fixed_charge || 0),
        tariff_tiers: meterForm.tariff_tiers.map(serializeTariffTier),
        ...(meterForm.opening_reading !== '' ? { opening_reading: String(meterForm.opening_reading) } : {}),
        ...(meterForm.address.trim() ? { address: meterForm.address.trim() } : {}),
      } });
      setMeterForm((current) => ({ ...current, code: '', rate: '', fixed_charge: '0', tariff_tiers: [], opening_reading: '', address: '' }));
      await load(); setSelectedMeter(created.id); setNotice(t('Đã tạo công-tơ/thuê bao với biểu giá ban đầu.'));
    } catch (reason) { setError(reason.message || t('Không thể tạo công-tơ/thuê bao.')); }
    finally { setBusy(false); }
  }

  async function updateRate(event) {
    event.preventDefault(); if (!meter || rateDraft === '' || fixedChargeDraft === '') return;
    setBusy(true); setError(''); setNotice('');
    try {
      await api(dataPath('utilities.meter', meter.id), { method: 'PATCH', body: {
        rate: String(rateDraft), fixed_charge: String(fixedChargeDraft || 0),
        tariff_tiers: tariffTiersDraft.map(serializeTariffTier),
      } });
      setNotice(t('Đã cập nhật đơn giá. Giá mới áp dụng cho lần ghi chỉ số tiếp theo; các kỳ đã ghi giữ nguyên đơn giá lịch sử.')); await load();
    } catch (reason) { setError(reason.message || t('Không thể cập nhật đơn giá.')); }
    finally { setBusy(false); }
  }

  async function createBill(reading) {
    setBusy(true); setError(''); setNotice('');
    try {
      await api(dataPath('utilities.utility_bill'), { method: 'POST', body: { meter_reading: reading.id, status: 'draft' } });
      setNotice(`${t('Đã lập hóa đơn nháp cho kỳ')} ${reading.period}.`); await load();
    } catch (reason) { setError(reason.message || t('Không thể lập hóa đơn.')); }
    finally { setBusy(false); }
  }

  async function transition(bill, action) {
    setBusy(true); setError(''); setNotice('');
    try {
      await api(dataPath('utilities.utility_bill', bill.id, action), { method: 'POST' });
      setNotice(action === 'issued' ? t('Đã phát hành hóa đơn và tạo hóa đơn phải thu kế toán.') : t('Đã cập nhật trạng thái đã thanh toán.')); await load();
    } catch (reason) { setError(reason.message || t('Không thể cập nhật hóa đơn.')); }
    finally { setBusy(false); }
  }

  return { busy, notice, createReading, createMeter, updateRate, createBill, transition };
}
