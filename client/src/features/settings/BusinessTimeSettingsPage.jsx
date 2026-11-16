import React, { useState } from 'react';
import { api, tenantPath } from '../../lib/api.js';
import { toast } from '../../lib/feedback.js';
import { uiText } from '../../lib/i18n.js';
import { app, can } from '../../lib/state.js';
import { setBusinessTimezone } from '../../lib/dates.js';
import SettingsTabs from './SettingsTabs.jsx';

const FALLBACK_ZONES = [
  'UTC', 'Asia/Ho_Chi_Minh', 'Asia/Bangkok', 'Asia/Singapore', 'Asia/Tokyo',
  'Asia/Seoul', 'Asia/Kolkata', 'Australia/Sydney', 'Europe/London', 'Europe/Paris',
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
];
const timeZones = () => {
  const zones = typeof Intl.supportedValuesOf === 'function'
    ? Intl.supportedValuesOf('timeZone')
    : FALLBACK_ZONES;
  return [...new Set(['UTC', ...zones])].sort((a, b) => a.localeCompare(b));
};

export default function BusinessTimeSettingsPage() {
  const [timezone, setTimezone] = useState(app.meta.settings?.businessTimezone || 'UTC');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const settings = await api(tenantPath('/settings'), {
        method: 'PATCH', body: { businessTimezone: timezone.trim() },
      });
      app.meta.settings = settings;
      setTimezone(settings.businessTimezone || 'UTC');
      setBusinessTimezone(settings.businessTimezone || 'UTC');
      window.dispatchEvent(new Event('osp:meta'));
      toast(uiText('Đã cập nhật múi giờ nghiệp vụ.'), 'success');
    } catch (reason) {
      setError(reason.message || uiText('Không cập nhật được múi giờ nghiệp vụ.'));
    } finally { setBusy(false); }
  };

  if (!can('tenant.admin')) return <div className="page"><div className="alert danger" role="alert">{uiText('Chỉ quản trị viên mới được đổi múi giờ nghiệp vụ.')}</div></div>;

  return <div className="page">
    <div className="page-head"><div><h1>{uiText('Cài đặt')}</h1><p className="sub">{uiText('Chính sách lịch của doanh nghiệp')} “{app.meta.name}”.</p></div></div>
    <SettingsTabs active="business-time" />
    <section className="stack" aria-label={uiText('Cài đặt múi giờ nghiệp vụ')}>
      {error && <div className="alert danger" role="alert">{uiText(error)}</div>}
      <section className="card">
        <div className="card-head"><h2>{uiText('Múi giờ nghiệp vụ')}</h2></div>
        <form className="card-pad stack" onSubmit={save}>
          <label className="field" htmlFor="business-timezone"><span>{uiText('Múi giờ IANA')}</span>
            <input className="input" id="business-timezone" list="business-timezone-options" required maxLength="80" value={timezone} disabled={busy} onChange={(event) => setTimezone(event.target.value)} />
            <datalist id="business-timezone-options">{timeZones().map((zone) => <option key={zone} value={zone} />)}</datalist>
          </label>
          <p className="muted">{uiText('Múi giờ này được dùng cho quy tắc nghiệp vụ theo ngày và ngày mặc định trên lịch. Ví dụ: Asia/Ho_Chi_Minh, Europe/London, America/New_York. Đổi cài đặt không ghi lại ngày hoặc dấu thời gian đã lưu.')}</p>
          <div><button className="btn btn-primary" type="submit" disabled={busy || !timezone.trim()}>{busy ? uiText('Đang lưu…') : uiText('Lưu múi giờ')}</button></div>
        </form>
      </section>
    </section>
  </div>;
}
