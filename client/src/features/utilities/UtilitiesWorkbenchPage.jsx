import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useDocumentTitle } from '../../lib/useDocumentTitle.js';
import { localMonth } from '../../lib/dates.js';
import { api, dataPath } from '../../lib/api.js';
import { statusLabel, fmtNumber, uiTextWith } from '../../lib/i18n.js';
import { can, loadRefs, recordLabel, loadAllResponse } from '../../lib/state.js';
import utilitiesEnglish from './utilities.en.js';
const t = (text) => uiTextWith(text, utilitiesEnglish);
const currentPeriod = localMonth;
const nextPeriod = (period) => {
  const [year, month] = String(period || '').split('-').map(Number);
  if (!year || !month) return currentPeriod();
  return month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`;
};
const money = (value) => fmtNumber(Number(value || 0), { maximumFractionDigits: 2 });
const estimateUtilityCharge = (consumption, meter) => {
  const tiers = Array.isArray(meter?.tariff_tiers) ? meter.tariff_tiers : [];
  let usageAmount = 0;
  if (!tiers.length) usageAmount = consumption * Number(meter?.rate || 0);
  else {
    let lower = 0;
    for (const tier of tiers) {
      const upper = tier.up_to == null ? consumption : Number(tier.up_to);
      const units = Math.max(0, Math.min(consumption, upper) - lower);
      usageAmount += units * Number(tier.rate || 0);
      if (tier.up_to == null || consumption <= upper) break;
      lower = upper;
    }
  }
  return usageAmount + Number(meter?.fixed_charge || 0);
};
export default function UtilitiesWorkbenchPage() {
  useDocumentTitle(t("Ghi chỉ số và hóa đơn tiện ích · OSP Suite"));
  const [meters, setMeters] = useState([]);
  const [readings, setReadings] = useState([]);
  const [bills, setBills] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [parties, setParties] = useState(new Map());
  const [selectedMeter, setSelectedMeter] = useState('');
  const [meterForm, setMeterForm] = useState({ party: '', code: '', kind: 'electric', rate: '', fixed_charge: '0', tariff_tiers: [], opening_reading: '', address: '' });
  const [rateDraft, setRateDraft] = useState('');
  const [fixedChargeDraft, setFixedChargeDraft] = useState('0');
  const [tariffTiersDraft, setTariffTiersDraft] = useState([]);
  const [period, setPeriod] = useState(currentPeriod());
  const [readingValue, setReadingValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [meterRes, readingRes, partyMap, billRes, invoiceRes] = await Promise.all([
        loadAllResponse('utilities.meter'), loadAllResponse('utilities.meter_reading'),
        loadRefs('master-data.party'),
        can('utilities.utility_bill.read') ? loadAllResponse('utilities.utility_bill') : Promise.resolve({ items: [] }),
        can('accounting.invoice.read') ? loadAllResponse('accounting.invoice') : Promise.resolve({ items: [] }),
      ]);
      const meterItems = meterRes.items || []; const readingItems = readingRes.items || [];
      setMeters(meterItems); setReadings(readingItems); setParties(partyMap);
      setBills(billRes.items || []); setInvoices(invoiceRes.items || []);
      setSelectedMeter((current) => current && meterItems.some((x) => x.id === current) ? current : meterItems[0]?.id || '');
      setMeterForm((current) => ({ ...current, party: current.party || [...partyMap.keys()][0] || '' }));
    } catch (reason) { setError(reason.message || t("Không tải được dữ liệu công tơ.")); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const meter = meters.find((item) => item.id === selectedMeter);
  useEffect(() => {
    setRateDraft(meter?.rate == null ? '' : String(meter.rate));
    setFixedChargeDraft(String(meter?.fixed_charge || 0));
    setTariffTiersDraft(Array.isArray(meter?.tariff_tiers) ? meter.tariff_tiers.map((tier) => ({ up_to: tier.up_to == null ? '' : String(tier.up_to), rate: String(tier.rate ?? '') })) : []);
  }, [meter?.id, meter?.rate, meter?.fixed_charge, meter?.tariff_tiers]);
  const meterReadings = useMemo(() => readings.filter((item) => item.meter === selectedMeter).sort((a, b) => String(b.period).localeCompare(String(a.period))), [readings, selectedMeter]);
  const latest = meterReadings[0];
  const previous = meterReadings.find((item) => item.period < period);
  const previousReading = Number(previous?.reading ?? meter?.opening_reading ?? 0);
  const consumption = Math.max(0, Number(readingValue || 0) - previousReading);
  const estimate = estimateUtilityCharge(consumption, meter);
  const readingForBill = new Map(readings.map((item) => [item.id, item]));
  const billByReading = new Map(bills.map((item) => [item.meter_reading, item]));
  const invoiceByBill = new Map(invoices.filter((item) => item.source === 'utility_bill').map((item) => [item.source_id, item]));
  const isPeriodDuplicate = meterReadings.some((item) => item.period === period);
  const isPeriodBackdated = Boolean(latest && period < latest.period);
  async function createReading(event) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      await api(dataPath('utilities.meter_reading'), { method: 'POST', body: { meter: selectedMeter, period, reading: Number(readingValue) } });
      setNotice(t("Đã ghi nhận chỉ số; mức tiêu thụ và tiền được tính theo dữ liệu công tơ.")); setReadingValue(''); await load();
    } catch (reason) { setError(reason.message || t("Không thể ghi chỉ số.")); }
    finally { setBusy(false); }
  }
  async function createMeter(event) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      const created = await api(dataPath('utilities.meter'), { method: 'POST', body: {
        party: meterForm.party, code: meterForm.code.trim(), kind: meterForm.kind, rate: Number(meterForm.rate),
        fixed_charge: Number(meterForm.fixed_charge || 0),
        tariff_tiers: meterForm.tariff_tiers.map((tier) => ({ up_to: tier.up_to === '' ? null : Number(tier.up_to), rate: Number(tier.rate) })),
        ...(meterForm.opening_reading !== '' ? { opening_reading: Number(meterForm.opening_reading) } : {}),
        ...(meterForm.address.trim() ? { address: meterForm.address.trim() } : {}),
      } });
      setMeterForm((current) => ({ ...current, code: '', rate: '', fixed_charge: '0', tariff_tiers: [], opening_reading: '', address: '' }));
      await load(); setSelectedMeter(created.id); setNotice(t("Đã tạo công-tơ/thuê bao với biểu giá ban đầu."));
    } catch (reason) { setError(reason.message || t("Không thể tạo công-tơ/thuê bao.")); }
    finally { setBusy(false); }
  }
  async function updateRate(event) {
    event.preventDefault(); if (!meter || rateDraft === '' || fixedChargeDraft === '') return;
    setBusy(true); setError(''); setNotice('');
    try {
      await api(dataPath('utilities.meter', meter.id), { method: 'PATCH', body: {
        rate: Number(rateDraft), fixed_charge: Number(fixedChargeDraft || 0),
        tariff_tiers: tariffTiersDraft.map((tier) => ({ up_to: tier.up_to === '' ? null : Number(tier.up_to), rate: Number(tier.rate) })),
      } });
      setNotice(t("Đã cập nhật đơn giá. Giá mới áp dụng cho lần ghi chỉ số tiếp theo; các kỳ đã ghi giữ nguyên đơn giá lịch sử.")); await load();
    } catch (reason) { setError(reason.message || t("Không thể cập nhật đơn giá.")); }
    finally { setBusy(false); }
  }
  async function createBill(reading) {
    setBusy(true); setError(''); setNotice('');
    try {
      await api(dataPath('utilities.utility_bill'), { method: 'POST', body: { meter_reading: reading.id, status: 'draft' } });
      setNotice(`${t('Đã lập hóa đơn nháp cho kỳ')} ${reading.period}.`); await load();
    } catch (reason) { setError(reason.message || t("Không thể lập hóa đơn.")); }
    finally { setBusy(false); }
  }
  async function transition(bill, action) {
    setBusy(true); setError(''); setNotice('');
    try {
      await api(dataPath('utilities.utility_bill', bill.id, action), { method: 'POST' });
      setNotice(action === 'issued' ? t('Đã phát hành hóa đơn và tạo hóa đơn phải thu kế toán.') : t('Đã cập nhật trạng thái đã thanh toán.')); await load();
    } catch (reason) { setError(reason.message || t("Không thể cập nhật hóa đơn.")); }
    finally { setBusy(false); }
  }
  return <div className="page">
    <div className="page-head"><div><h1>{t("Ghi chỉ số và hóa đơn tiện ích")}</h1><p className="sub">{t("Ghi lần lượt theo kỳ để giữ chính xác tiêu thụ lũy kế, sau đó phát hành và theo dõi thu tiền qua kế toán.")}</p></div><button className="btn btn-secondary" type="button" disabled={loading || busy} onClick={load}>{t("Làm mới")}</button></div>
    {error && <div className="alert danger" role="alert">{t(error)}</div>}{notice && <div className="alert success" role="status">{t(notice)}</div>}
    <section className="card card-pad"><h2>{t("Chỉ số công tơ")}</h2>
      {can('utilities.meter.create') && <form className="form-grid u-legacy-bf4a218e05"  onSubmit={createMeter}><h3 className="full">{t("Tạo công-tơ / thuê bao")}</h3>
        <label className="field"><span className="label">{t("Khách hàng *")}</span><select className="select" required value={meterForm.party} onChange={(event) => setMeterForm((current) => ({ ...current, party: event.target.value }))}><option value="">{t("Chọn khách hàng")}</option>{[...parties.values()].map((party) => <option key={party.id} value={party.id}>{recordLabel('master-data.party', party)}</option>)}</select></label>
        <label className="field"><span className="label">{t("Mã công-tơ / thuê bao *")}</span><input className="input" required maxLength="120" value={meterForm.code} onChange={(event) => setMeterForm((current) => ({ ...current, code: event.target.value }))} /></label>
        <label className="field"><span className="label">{t("Loại dịch vụ")}</span><select className="select" value={meterForm.kind} onChange={(event) => setMeterForm((current) => ({ ...current, kind: event.target.value }))}><option value="electric">{t("Điện")}</option><option value="water">{t("Nước")}</option><option value="gas">Gas</option><option value="internet">Internet</option></select></label>
        <label className="field"><span className="label">{t("Đơn giá phẳng (nếu không có bậc giá) *")}</span><input className="input num" type="number" min="0.0001" step="any" required value={meterForm.rate} onChange={(event) => setMeterForm((current) => ({ ...current, rate: event.target.value }))} /></label>
        <label className="field"><span className="label">{t("Phí cố định mỗi kỳ")}</span><input className="input num" type="number" min="0" step="any" value={meterForm.fixed_charge} onChange={(event) => setMeterForm((current) => ({ ...current, fixed_charge: event.target.value }))} /></label>
        <div className="field full"><span className="label">{t("Bậc giá lũy tiến (không bắt buộc)")}</span>{meterForm.tariff_tiers.map((tier, index) => <div className="row wrap" key={index}><label className="field"><span className="small">{t("Ngưỡng tiêu thụ lũy kế (để trống bậc cuối nếu không giới hạn)")}</span><input className="input num" type="number" min="0.000001" step="any" required={index < meterForm.tariff_tiers.length - 1} value={tier.up_to} onChange={(event) => setMeterForm((current) => ({ ...current, tariff_tiers: current.tariff_tiers.map((item, i) => i === index ? { ...item, up_to: event.target.value } : item) }))} /></label><label className="field"><span className="small">{t("Đơn giá mỗi bậc *")}</span><input className="input num" type="number" min="0" step="any" required value={tier.rate} onChange={(event) => setMeterForm((current) => ({ ...current, tariff_tiers: current.tariff_tiers.map((item, i) => i === index ? { ...item, rate: event.target.value } : item) }))} /></label><button className="btn btn-ghost" type="button" aria-label={`Xóa bậc ${index + 1}`} onClick={() => setMeterForm((current) => ({ ...current, tariff_tiers: current.tariff_tiers.filter((_, i) => i !== index) }))}>{t("Xóa bậc")}</button></div>)}<button className="btn btn-secondary btn-sm" type="button" onClick={() => setMeterForm((current) => ({ ...current, tariff_tiers: [...current.tariff_tiers, { up_to: '', rate: '' }] }))}>{t("Thêm bậc giá")}</button><p className="small muted">{t("Mỗi bậc chỉ tính giá cho phần tiêu thụ nằm trong ngưỡng lũy kế.")}</p></div>
        <label className="field"><span className="label">{t("Chỉ số mở đầu")}</span><input className="input num" type="number" min="0" step="any" value={meterForm.opening_reading} onChange={(event) => setMeterForm((current) => ({ ...current, opening_reading: event.target.value }))} /></label>
        <label className="field"><span className="label">{t("Địa chỉ lắp đặt")}</span><input className="input" maxLength="240" value={meterForm.address} onChange={(event) => setMeterForm((current) => ({ ...current, address: event.target.value }))} /></label>
        <div className="row full"><span className="grow"/><button className="btn btn-primary" disabled={busy || loading || !meterForm.party}>{t("Tạo công-tơ")}</button></div>
      </form>}
      {!meters.length && !loading ? <div className="empty">{t("Chưa có công-tơ/thuê bao. Tạo mới bằng biểu mẫu phía trên.")}</div> : <>
        <div className="form-grid"><label className="field"><span className="label">{t("Thuê bao / công tơ")}</span><select className="select" value={selectedMeter} onChange={(e) => { setSelectedMeter(e.target.value); setReadingValue(''); }}><option value="">{t("Chọn công tơ")}</option>{meters.map((item) => <option key={item.id} value={item.id}>{item.code} · {parties.get(item.party)?.name || 'Thuê bao'}{item.kind ? ` · ${statusLabel(item.kind)}` : ''}</option>)}</select></label><div className="field"><span className="label">{t("Đơn giá phẳng / tham chiếu")}</span><div className="input" aria-label={t('Đơn giá phẳng hoặc tham chiếu')}>{meter ? `${money(meter.rate)} / đơn vị` : '—'}</div></div><div className="field"><span className="label">{t("Chỉ số kỳ gần nhất")}</span><div className="input" aria-label={t('Chỉ số kỳ gần nhất')}>{latest ? `${latest.period} · ${latest.reading}` : meter ? `Mở đầu · ${meter.opening_reading || 0}` : '—'}</div></div></div>
        {meter && can('utilities.meter.update') && <form className="form-grid u-legacy-df928149c5"  onSubmit={updateRate}><label className="field"><span className="label">{t("Đơn giá phẳng / tham chiếu cho kỳ kế tiếp")}</span><input className="input num" type="number" min="0.0001" step="any" required value={rateDraft} onChange={(event) => setRateDraft(event.target.value)} /></label><label className="field"><span className="label">{t("Phí cố định mỗi kỳ")}</span><input className="input num" type="number" min="0" step="any" required value={fixedChargeDraft} onChange={(event) => setFixedChargeDraft(event.target.value)} /></label><div className="field full"><span className="label">{t("Bậc giá lũy tiến")}</span>{tariffTiersDraft.map((tier, index) => <div className="row wrap" key={index}><label className="field"><span className="small">{t("Ngưỡng tiêu thụ lũy kế (để trống bậc cuối nếu không giới hạn)")}</span><input className="input num" type="number" min="0.000001" step="any" required={index < tariffTiersDraft.length - 1} value={tier.up_to} onChange={(event) => setTariffTiersDraft((current) => current.map((item, i) => i === index ? { ...item, up_to: event.target.value } : item))} /></label><label className="field"><span className="small">{t("Đơn giá mỗi bậc *")}</span><input className="input num" type="number" min="0" step="any" required value={tier.rate} onChange={(event) => setTariffTiersDraft((current) => current.map((item, i) => i === index ? { ...item, rate: event.target.value } : item))} /></label><button className="btn btn-ghost" type="button" aria-label={`Xóa bậc ${index + 1}`} onClick={() => setTariffTiersDraft((current) => current.filter((_, i) => i !== index))}>{t("Xóa bậc")}</button></div>)}<button className="btn btn-secondary btn-sm" type="button" onClick={() => setTariffTiersDraft((current) => [...current, { up_to: '', rate: '' }])}>{t("Thêm bậc giá")}</button></div><div className="row full"><span className="grow"/><button className="btn btn-secondary" disabled={busy || loading || rateDraft === '' || fixedChargeDraft === ''}>{t("Lưu biểu giá")}</button></div></form>}
        {can('utilities.meter_reading.create') && meter && <form className="form-grid u-legacy-0ee7f66ad9"  onSubmit={createReading}>
          <label className="field"><span className="label">{t("Kỳ ghi chỉ số *")}</span><input className="input" type="month" required value={period} min={latest ? nextPeriod(latest.period) : undefined} max={currentPeriod()} onChange={(e) => setPeriod(e.target.value)} /></label>
          <label className="field"><span className="label">{t("Chỉ số mới *")}</span><input className="input num" required type="number" min={previousReading} step="any" value={readingValue} onChange={(e) => setReadingValue(e.target.value)} /></label>
          <div className="field"><span className="label">{t("Tiêu thụ dự kiến / tiền")}</span><div className="input">{money(consumption)} đơn vị · {money(estimate)}</div></div>
          <div className="row full"><span className="grow" /><button className="btn btn-primary" disabled={busy || loading || !selectedMeter || isPeriodDuplicate || isPeriodBackdated || !readingValue}>{t("Ghi chỉ số")}</button></div>
          {(isPeriodDuplicate || isPeriodBackdated) && <p className="small muted full">{t("Kỳ phải mới hơn kỳ đã ghi gần nhất; chỉ số đã ghi là lịch sử và không thể sửa.")}</p>}
        </form>}
      </>}
    </section>
    <section className="card card-pad u-legacy-eee3f850c9" ><h2>{t("Lịch sử chỉ số")}</h2>
      {!selectedMeter ? <div className="empty">{t("Chọn một công tơ để xem lịch sử.")}</div> : !meterReadings.length ? <div className="empty">{t("Chưa có chỉ số.")}</div> : <div className="table-wrap"><table className="table"><thead><tr><th>{t("Kỳ")}</th><th>{t("Chỉ số trước")}</th><th>{t("Chỉ số mới")}</th><th>{t("Tiêu thụ")}</th><th>{t("Đơn giá")}</th><th>{t("Thành tiền")}</th><th>{t("Hóa đơn")}</th></tr></thead><tbody>{meterReadings.map((item) => { const bill = billByReading.get(item.id); const invoice = bill && invoiceByBill.get(bill.id); return <tr key={item.id}><td>{item.period}</td><td>{item.previous_reading}</td><td>{item.reading}</td><td>{item.consumption}</td><td>{money(item.rate)}</td><td>{money(item.amount)}<div className="small muted">{t("Tiêu thụ {base} + phí cố định {fixed}").replace('{base}', money(item.base_amount ?? item.amount)).replace('{fixed}', money(item.fixed_charge || 0))}</div>{(item.tier_breakdown || []).map((band, index) => <div className="small muted" key={index}>{t("Bậc {number}: {units} × {rate} = {amount}").replace('{number}', String(index + 1)).replace('{units}', money(band.units)).replace('{rate}', money(band.rate)).replace('{amount}', money(band.amount))}</div>)}</td><td>{!can('utilities.utility_bill.read') ? '—' : bill ? <span>{statusLabel(bill.status)} {invoice && <a href={`#/e/accounting/invoice/${invoice.id}`}>{t("· Mở hóa đơn phải thu")}</a>}</span> : can('utilities.utility_bill.create') && <button className="btn btn-secondary btn-sm" type="button" disabled={busy} onClick={() => createBill(item)}>{t("Lập hóa đơn nháp")}</button>}</td></tr>; })}</tbody></table></div>}
    </section>
    {can('utilities.utility_bill.read') && <section className="card card-pad u-legacy-eee3f850c9" ><h2>{t("Hóa đơn tiêu thụ")}</h2>{!bills.length ? <div className="empty">{t("Chưa có hóa đơn.")}</div> : <div className="table-wrap"><table className="table"><thead><tr><th>{t("Thuê bao")}</th><th>{t("Kỳ")}</th><th>{t("Tiêu thụ")}</th><th>{t("Đơn giá")}</th><th>{t("Số tiền")}</th><th>{t("Trạng thái")}</th><th>{t("Thao tác")}</th></tr></thead><tbody>{bills.map((bill) => { const reading = readingForBill.get(bill.meter_reading); const billMeter = meters.find((item) => item.id === reading?.meter); const invoice = invoiceByBill.get(bill.id); return <tr key={bill.id}><td>{billMeter?.code || parties.get(bill.party)?.name || t('Thuê bao')}</td><td>{bill.period}</td><td>{bill.consumption}</td><td>{money(bill.unit_rate)}</td><td>{money(bill.amount)}<div className="small muted">{t("Tiêu thụ {base} + phí cố định {fixed}").replace('{base}', money(bill.base_amount ?? bill.amount)).replace('{fixed}', money(bill.fixed_charge || 0))}</div>{(bill.tier_breakdown || []).map((band, index) => <div className="small muted" key={index}>{t("Bậc {number}: {units} × {rate} = {amount}").replace('{number}', String(index + 1)).replace('{units}', money(band.units)).replace('{rate}', money(band.rate)).replace('{amount}', money(band.amount))}</div>)}</td><td>{statusLabel(bill.status)}</td><td className="row wrap">{bill.status === 'draft' && can('utilities.utility_bill.issued') && <button className="btn btn-primary btn-sm" type="button" disabled={busy} onClick={() => transition(bill, 'issued')}>{t("Phát hành")}</button>}{invoice && <a className="btn btn-secondary btn-sm" href={`#/e/accounting/invoice/${invoice.id}`}>{invoice.status === 'paid' ? t("Hóa đơn đã thu đủ") : t("Mở hóa đơn / thu tiền")}</a>}{bill.status === 'issued' && invoice?.status === 'paid' && can('utilities.utility_bill.paid') && <button className="btn btn-secondary btn-sm" type="button" disabled={busy} onClick={() => transition(bill, 'paid')}>{t("Đồng bộ đã thanh toán")}</button>}</td></tr>; })}</tbody></table></div>}
      <p className="small muted">{t("Phát hành tạo khoản phải thu kế toán. Ghi nhận hóa đơn tiện ích đã thanh toán chỉ được phép sau khi hóa đơn kế toán đã thu đủ.")}</p>
    </section>}
  </div>;
}
