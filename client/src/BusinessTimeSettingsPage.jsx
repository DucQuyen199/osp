import React, { useState } from 'react';
import { api, tenantPath } from './lib/api.js';
import { toast } from './lib/feedback.js';
import { app, can } from './lib/state.js';
import { setBusinessTimezone } from './lib/dates.js';
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
      toast('Business time zone updated.', 'success');
    } catch (reason) {
      setError(reason.message || 'Could not update business time zone.');
    } finally { setBusy(false); }
  };

  if (!can('tenant.admin')) return <div className="page"><div className="alert danger" role="alert">Only tenant administrators can change the business time zone.</div></div>;

  return <div className="page">
    <div className="page-head"><div><h1>Settings</h1><p className="sub">Calendar policy for “{app.meta.name}”.</p></div></div>
    <SettingsTabs active="business-time" />
    <section className="stack" aria-label="Business time zone settings">
      {error && <div className="alert danger" role="alert">{error}</div>}
      <section className="card">
        <div className="card-head"><h2>Business time zone</h2></div>
        <form className="card-pad stack" onSubmit={save}>
          <label className="field" htmlFor="business-timezone"><span>IANA time zone</span>
            <input className="input" id="business-timezone" list="business-timezone-options" required maxLength="80" value={timezone} disabled={busy} onChange={(event) => setTimezone(event.target.value)} />
            <datalist id="business-timezone-options">{timeZones().map((zone) => <option key={zone} value={zone} />)}</datalist>
          </label>
          <p className="muted">Used for date-only business rules and default calendar dates. Examples: Asia/Ho_Chi_Minh, Europe/London, America/New_York. Changing this setting does not rewrite stored dates or timestamps.</p>
          <div><button className="btn btn-primary" type="submit" disabled={busy || !timezone.trim()}>{busy ? 'Saving…' : 'Save time zone'}</button></div>
        </form>
      </section>
    </section>
  </div>;
}
