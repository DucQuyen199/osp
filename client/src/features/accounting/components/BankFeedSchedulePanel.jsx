import React, { useEffect, useState } from 'react';
import { api, dataPath } from '../../../lib/api.js';
import { can } from '../../../lib/state.js';

const t = (value) => value;
export default function BankFeedSchedulePanel({ statement, connectors, translate = (value) => value }) {
  const [schedule, setSchedule] = useState(null);
  const [interval, setInterval] = useState('60');
  const [connector, setConnector] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const t = translate;
  useEffect(() => {
    let active = true;
    if (!statement?.id || !can('accounting.bank_feed_schedule.read')) return () => { active = false; };
    api(`${dataPath('accounting.bank_feed_schedule')}?statement=${encodeURIComponent(statement.id)}&limit=10`)
      .then((result) => {
        if (active) {
          const next = result.items?.[0] || null;
          setSchedule(next);
          if (next) { setInterval(String(next.interval_minutes)); setConnector(next.connector); }
        }
      })
      .catch((reason) => { if (active) setError(reason.message); });
    return () => { active = false; };
  }, [statement?.id, refresh]);
  useEffect(() => {
    setConnector((current) => connectors.some((item) => item.id === current) ? current : connectors.find((item) => item.enabled)?.id || connectors[0]?.id || '');
  }, [connectors]);
  if (!can('accounting.bank_feed_schedule.read') || !statement) return null;
  const save = async (enabled) => {
    setBusy(true); setError('');
    try {
      const body = { statement: statement.id, connector, interval_minutes: Number(interval || schedule?.interval_minutes || 60), enabled };
      if (schedule) await api(dataPath('accounting.bank_feed_schedule', schedule.id), { method: 'PATCH', body });
      else await api(dataPath('accounting.bank_feed_schedule'), { method: 'POST', body });
      setRefresh((value) => value + 1);
    } catch (reason) { setError(reason.message || 'Could not save periodic sync schedule.'); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    setBusy(true); setError('');
    try { await api(dataPath('accounting.bank_feed_schedule', schedule.id), { method: 'DELETE' }); setSchedule(null); }
    catch (reason) { setError(reason.message || 'Could not remove schedule.'); }
    finally { setBusy(false); }
  };
  return <section className="card card-pad u-mt-12" aria-label={t('Lịch đồng bộ bank feed')}>
    <h3>{t('Đồng bộ định kỳ')}</h3>
    <p className="small muted">{t('Lịch chỉ nhập vào sao kê nháp. Tần suất từ 15 phút đến 24 giờ; thông tin xác thực vẫn được giữ trong connector.')}</p>
    {error && <div className="alert danger" role="alert">{error}</div>}
    {!schedule ? <div className="row wrap">
      <label className="field"><span className="label">{t('Bank feed connector')}</span><select className="select" value={connector} onChange={(event) => setConnector(event.target.value)}>{connectors.map((item) => <option key={item.id} value={item.id} disabled={!item.enabled}>{item.name}</option>)}</select></label>
      <label className="field"><span className="label">{t('Khoảng đồng bộ (phút)')}</span><input className="input" type="number" min="15" max="1440" step="1" value={interval} onChange={(event) => setInterval(event.target.value)}/></label>
      {can('accounting.bank_feed_schedule.create') && <button className="btn btn-secondary" disabled={busy || !connectors.some((item) => item.id === connector && item.enabled)} onClick={() => save(true)}>{t('Bật đồng bộ định kỳ')}</button>}
    </div> : <div className="stack">
      {can('accounting.bank_feed_schedule.update') && <div className="row wrap">
        <label className="field"><span className="label">{t('Bank feed connector')}</span><select className="select" value={connector} onChange={(event) => setConnector(event.target.value)}>{connectors.map((item) => <option key={item.id} value={item.id} disabled={!item.enabled && item.id !== schedule.connector}>{item.name}{!item.enabled ? ` (${t('Disabled')})` : ''}</option>)}</select></label>
        <label className="field"><span className="label">{t('Khoảng đồng bộ (phút)')}</span><input className="input" type="number" min="15" max="1440" step="1" value={interval} onChange={(event) => setInterval(event.target.value)}/></label>
        <span>{schedule.enabled ? t('Đang bật') : t('Đang tạm dừng')}</span>
        <button className="btn btn-secondary" disabled={busy || !connectors.some((item) => item.id === connector && item.enabled)} onClick={() => save(Boolean(schedule.enabled))}>{t('Lưu lịch')}</button>
        <button className="btn btn-secondary" disabled={busy} onClick={() => save(false)}>{t('Tạm dừng')}</button>
        {!schedule.enabled && <button className="btn btn-secondary" disabled={busy || !connectors.some((item) => item.id === connector && item.enabled)} onClick={() => save(true)}>{t('Tiếp tục')}</button>}
        {can('accounting.bank_feed_schedule.delete') && <button className="btn btn-ghost" disabled={busy} onClick={remove}>{t('Xóa lịch')}</button>}
      </div>}
      {schedule.last_attempt_at && <div className="small muted">{t('Lần thử cuối')}: {new Date(schedule.last_attempt_at).toLocaleString()} {schedule.last_error && <span className="danger">· {schedule.last_error}</span>}</div>}
    </div>}
  </section>;
}
