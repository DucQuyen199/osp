import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api, dataPath } from './lib/api.js';
import { statusLabel } from './lib/i18n.js';
import { can, loadRefs, recordLabel } from './lib/state.js';

const currentPeriod = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};
const nextPeriod = (period) => {
  const [year, month] = String(period || '').split('-').map(Number);
  if (!year || !month) return currentPeriod();
  return month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`;
};
const money = (value) => Number(value || 0).toLocaleString('vi-VN', { maximumFractionDigits: 2 });

export default function UtilitiesWorkbenchPage() {
  const [meters, setMeters] = useState([]);
  const [readings, setReadings] = useState([]);
  const [bills, setBills] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [parties, setParties] = useState(new Map());
  const [selectedMeter, setSelectedMeter] = useState('');
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
        api(`${dataPath('utilities.meter')}?limit=1000`), api(`${dataPath('utilities.meter_reading')}?limit=1000`),
        loadRefs('master-data.party'),
        can('utilities.utility_bill.read') ? api(`${dataPath('utilities.utility_bill')}?limit=1000`) : Promise.resolve({ items: [] }),
        can('accounting.invoice.read') ? api(`${dataPath('accounting.invoice')}?limit=1000`) : Promise.resolve({ items: [] }),
      ]);
      const meterItems = meterRes.items || []; const readingItems = readingRes.items || [];
      setMeters(meterItems); setReadings(readingItems); setParties(partyMap);
      setBills(billRes.items || []); setInvoices(invoiceRes.items || []);
      setSelectedMeter((current) => current && meterItems.some((x) => x.id === current) ? current : meterItems[0]?.id || '');
    } catch (reason) { setError(reason.message || 'Không tải được dữ liệu công tơ.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { document.title = 'Ghi chỉ số và hóa đơn tiện ích · OSP Suite'; load(); }, [load]);
  const meter = meters.find((item) => item.id === selectedMeter);
  const meterReadings = useMemo(() => readings.filter((item) => item.meter === selectedMeter).sort((a, b) => String(b.period).localeCompare(String(a.period))), [readings, selectedMeter]);
  const latest = meterReadings[0];
  const previous = meterReadings.find((item) => item.period < period);
  const previousReading = Number(previous?.reading ?? meter?.opening_reading ?? 0);
  const consumption = Math.max(0, Number(readingValue || 0) - previousReading);
  const estimate = consumption * Number(meter?.rate || 0);
  const readingForBill = new Map(readings.map((item) => [item.id, item]));
  const billByReading = new Map(bills.map((item) => [item.meter_reading, item]));
  const invoiceByBill = new Map(invoices.filter((item) => item.source === 'utility_bill').map((item) => [item.source_id, item]));
  const isPeriodDuplicate = meterReadings.some((item) => item.period === period);
  const isPeriodBackdated = Boolean(latest && period < latest.period);

  async function createReading(event) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      await api(dataPath('utilities.meter_reading'), { method: 'POST', body: { meter: selectedMeter, period, reading: Number(readingValue) } });
      setNotice('Đã ghi nhận chỉ số; mức tiêu thụ và tiền được tính theo dữ liệu công tơ.'); setReadingValue(''); await load();
    } catch (reason) { setError(reason.message || 'Không thể ghi chỉ số.'); }
    finally { setBusy(false); }
  }

  async function createBill(reading) {
    setBusy(true); setError(''); setNotice('');
    try {
      await api(dataPath('utilities.utility_bill'), { method: 'POST', body: { meter_reading: reading.id, status: 'draft' } });
      setNotice(`Đã lập hóa đơn nháp cho kỳ ${reading.period}.`); await load();
    } catch (reason) { setError(reason.message || 'Không thể lập hóa đơn.'); }
    finally { setBusy(false); }
  }

  async function transition(bill, action) {
    setBusy(true); setError(''); setNotice('');
    try {
      await api(dataPath('utilities.utility_bill', bill.id, action), { method: 'POST' });
      setNotice(action === 'issued' ? 'Đã phát hành hóa đơn và tạo hóa đơn phải thu kế toán.' : 'Đã cập nhật trạng thái đã thanh toán.'); await load();
    } catch (reason) { setError(reason.message || 'Không thể cập nhật hóa đơn.'); }
    finally { setBusy(false); }
  }

  return <div className="page">
    <div className="page-head"><div><h1>Ghi chỉ số và hóa đơn tiện ích</h1><p className="sub">Ghi lần lượt theo kỳ để giữ chính xác tiêu thụ lũy kế, sau đó phát hành và theo dõi thu tiền qua kế toán.</p></div><button className="btn btn-secondary" type="button" disabled={loading || busy} onClick={load}>Làm mới</button></div>
    {error && <div className="alert danger" role="alert">{error}</div>}{notice && <div className="alert success" role="status">{notice}</div>}
    <section className="card card-pad"><h2>Chỉ số công tơ</h2>
      {!meters.length && !loading ? <div className="empty">Chưa có công tơ. Hãy tạo công tơ trong mục Điện nước / Viễn thông trước.</div> : <>
        <div className="form-grid"><label className="field"><span className="label">Thuê bao / công tơ</span><select className="select" value={selectedMeter} onChange={(e) => { setSelectedMeter(e.target.value); setReadingValue(''); }}><option value="">Chọn công tơ</option>{meters.map((item) => <option key={item.id} value={item.id}>{item.code} · {parties.get(item.party)?.name || 'Thuê bao'}{item.kind ? ` · ${statusLabel(item.kind)}` : ''}</option>)}</select></label><div className="field"><span className="label">Đơn giá hiện hành</span><div className="input" aria-label="Đơn giá">{meter ? `${money(meter.rate)} / đơn vị` : '—'}</div></div><div className="field"><span className="label">Chỉ số kỳ gần nhất</span><div className="input" aria-label="Chỉ số kỳ gần nhất">{latest ? `${latest.period} · ${latest.reading}` : meter ? `Mở đầu · ${meter.opening_reading || 0}` : '—'}</div></div></div>
        {can('utilities.meter_reading.create') && meter && <form className="form-grid" style={{ marginTop: 12 }} onSubmit={createReading}>
          <label className="field"><span className="label">Kỳ ghi chỉ số *</span><input className="input" type="month" required value={period} min={latest ? nextPeriod(latest.period) : undefined} max={currentPeriod()} onChange={(e) => setPeriod(e.target.value)} /></label>
          <label className="field"><span className="label">Chỉ số mới *</span><input className="input num" required type="number" min={previousReading} step="any" value={readingValue} onChange={(e) => setReadingValue(e.target.value)} /></label>
          <div className="field"><span className="label">Tiêu thụ dự kiến / tiền</span><div className="input">{money(consumption)} đơn vị · {money(estimate)}</div></div>
          <div className="row full"><span className="grow" /><button className="btn btn-primary" disabled={busy || loading || !selectedMeter || isPeriodDuplicate || isPeriodBackdated || !readingValue}>Ghi chỉ số</button></div>
          {(isPeriodDuplicate || isPeriodBackdated) && <p className="small muted full">Kỳ phải mới hơn kỳ đã ghi gần nhất; chỉ số đã ghi là lịch sử và không thể sửa.</p>}
        </form>}
      </>}
    </section>
    <section className="card card-pad" style={{ marginTop: 20 }}><h2>Lịch sử chỉ số</h2>
      {!selectedMeter ? <div className="empty">Chọn một công tơ để xem lịch sử.</div> : !meterReadings.length ? <div className="empty">Chưa có chỉ số.</div> : <div className="table-wrap"><table className="table"><thead><tr><th>Kỳ</th><th>Chỉ số trước</th><th>Chỉ số mới</th><th>Tiêu thụ</th><th>Đơn giá</th><th>Thành tiền</th><th>Hóa đơn</th></tr></thead><tbody>{meterReadings.map((item) => { const bill = billByReading.get(item.id); const invoice = bill && invoiceByBill.get(bill.id); return <tr key={item.id}><td>{item.period}</td><td>{item.previous_reading}</td><td>{item.reading}</td><td>{item.consumption}</td><td>{money(item.rate)}</td><td>{money(item.amount)}</td><td>{!can('utilities.utility_bill.read') ? '—' : bill ? <span>{statusLabel(bill.status)} {invoice && <a href={`#/e/accounting/invoice/${invoice.id}`}>· Mở hóa đơn phải thu</a>}</span> : can('utilities.utility_bill.create') && <button className="btn btn-secondary btn-sm" type="button" disabled={busy} onClick={() => createBill(item)}>Lập hóa đơn nháp</button>}</td></tr>; })}</tbody></table></div>}
    </section>
    {can('utilities.utility_bill.read') && <section className="card card-pad" style={{ marginTop: 20 }}><h2>Hóa đơn tiêu thụ</h2>{!bills.length ? <div className="empty">Chưa có hóa đơn.</div> : <div className="table-wrap"><table className="table"><thead><tr><th>Thuê bao</th><th>Kỳ</th><th>Tiêu thụ</th><th>Số tiền</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>{bills.map((bill) => { const reading = readingForBill.get(bill.meter_reading); const billMeter = meters.find((item) => item.id === reading?.meter); const invoice = invoiceByBill.get(bill.id); return <tr key={bill.id}><td>{billMeter?.code || parties.get(bill.party)?.name || 'Thuê bao'}</td><td>{bill.period}</td><td>{bill.consumption}</td><td>{money(bill.amount)}</td><td>{statusLabel(bill.status)}</td><td className="row wrap">{bill.status === 'draft' && can('utilities.utility_bill.issued') && <button className="btn btn-primary btn-sm" type="button" disabled={busy} onClick={() => transition(bill, 'issued')}>Phát hành</button>}{invoice && <a className="btn btn-secondary btn-sm" href={`#/e/accounting/invoice/${invoice.id}`}>{invoice.status === 'paid' ? 'Hóa đơn đã thu đủ' : 'Mở hóa đơn / thu tiền'}</a>}{bill.status === 'issued' && invoice?.status === 'paid' && can('utilities.utility_bill.paid') && <button className="btn btn-secondary btn-sm" type="button" disabled={busy} onClick={() => transition(bill, 'paid')}>Đồng bộ đã thanh toán</button>}</td></tr>; })}</tbody></table></div>}
      <p className="small muted">Phát hành tạo khoản phải thu kế toán. Ghi nhận hóa đơn tiện ích đã thanh toán chỉ được phép sau khi hóa đơn kế toán đã thu đủ.</p>
    </section>}
  </div>;
}
