import React, { useEffect, useState } from 'react';
import { api, dataPath, tenantPath } from '../../lib/api.js';
import { toast } from '../../lib/feedback.js';
import { app, can } from '../../lib/state.js';
import { setBaseCurrency } from '../../lib/i18n.js';
import SettingsTabs from './SettingsTabs.jsx';

export default function CurrencySettingsPage() {
  const [currencies, setCurrencies] = useState([]);
  const [baseCurrency, setBaseCurrency] = useState(app.meta.settings?.baseCurrency || 'VND');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    document.title = 'Currency · Settings · OSP Suite';
    let active = true;
    api(`${dataPath('master-data.currency')}?limit=200&sort=code&dir=asc`)
      .then((result) => { if (active) setCurrencies(result.items || []); })
      .catch((reason) => { if (active) setError(reason.message || 'Could not load currencies.'); });
    return () => { active = false; };
  }, []);

  const save = async (event) => {
    const next = event.target.value;
    setBusy(true);
    setError('');
    try {
      const settings = await api(tenantPath('/settings'), {
        method: 'PATCH', body: { baseCurrency: next },
      });
      app.meta.settings = settings;
      setBaseCurrency(next);
      setBaseCurrency(next);
      window.dispatchEvent(new Event('osp:meta'));
      toast(`Base currency set to ${next}.`, 'success');
    } catch (reason) {
      setError(reason.message || 'Could not update base currency.');
    } finally { setBusy(false); }
  };

  if (!can('tenant.admin')) return <div className="page"><div className="alert danger" role="alert">Only tenant administrators can change base currency.</div></div>;

  return <div className="page">
    <div className="page-head"><div><h1>Settings</h1><p className="sub">Currency policy for “{app.meta.name}”.</p></div></div>
    <SettingsTabs active="currency" />
    <section className="stack" aria-label="Currency settings">
      {error && <div className="alert danger" role="alert">{error}</div>}
      <section className="card">
        <div className="card-head"><h2>Base currency</h2></div>
        <div className="card-pad stack">
          <label className="field" htmlFor="base-currency"><span>Ledger currency</span>
            <select className="input" id="base-currency" value={baseCurrency} disabled={busy || !currencies.length} onChange={save}>
              {currencies.map((currency) => <option key={currency.id} value={currency.code}>{currency.code}{currency.name ? ` · ${currency.name}` : ''}</option>)}
            </select>
          </label>
          <p className="muted">Choose this before recording invoices or journals. The server locks the choice after the first financial document to preserve ledger consistency.</p>
        </div>
      </section>
    </section>
  </div>;
}
