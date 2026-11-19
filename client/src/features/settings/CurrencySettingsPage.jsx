import React, { useEffect, useState } from 'react';
import { useDocumentTitle } from '../../lib/useDocumentTitle.js';
import { api, dataPath, tenantPath } from '../../lib/api.js';
import { toast } from '../../lib/feedback.js';
import { app, can } from '../../lib/state.js';
import { setBaseCurrency as setDisplayBaseCurrency, uiText } from '../../lib/i18n.js';
import SettingsTabs from './SettingsTabs.jsx';
export default function CurrencySettingsPage() {
  useDocumentTitle(`${uiText('Tiền tệ')} · ${uiText('Cài đặt')} · OSP Suite`);
  const [currencies, setCurrencies] = useState([]);
  const [baseCurrency, setBaseCurrencyState] = useState(app.meta.settings?.baseCurrency || 'VND');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    api(`${dataPath('master-data.currency')}?limit=200&sort=code&dir=asc`)
      .then((result) => { if (active) setCurrencies(result.items || []); })
      .catch((reason) => { if (active) setError(reason.message || uiText('Không tải được danh sách tiền tệ.')); });
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
      setBaseCurrencyState(next);
      setDisplayBaseCurrency(next);
      window.dispatchEvent(new Event('osp:meta'));
      toast(`${uiText('Đã đặt tiền tệ cơ sở thành')} ${next}.`, 'success');
    } catch (reason) {
      setError(reason.message || uiText('Không cập nhật được tiền tệ cơ sở.'));
    } finally { setBusy(false); }
  };
  if (!can('tenant.admin')) return <div className="page"><div className="alert danger" role="alert">{uiText('Chỉ quản trị viên mới được đổi tiền tệ cơ sở.')}</div></div>;
  return <div className="page">
    <div className="page-head"><div><h1>{uiText('Cài đặt')}</h1><p className="sub">{uiText('Chính sách tiền tệ của doanh nghiệp')} “{app.meta.name}”.</p></div></div>
    <SettingsTabs active="currency" />
    <section className="stack" aria-label={uiText('Cài đặt tiền tệ')}>
      {error && <div className="alert danger" role="alert">{uiText(error)}</div>}
      <section className="card">
        <div className="card-head"><h2>{uiText('Tiền tệ cơ sở')}</h2></div>
        <div className="card-pad stack">
          <label className="field" htmlFor="base-currency"><span>{uiText('Tiền tệ sổ cái')}</span>
            <select className="input" id="base-currency" value={baseCurrency} disabled={busy || !currencies.length} onChange={save}>
              {currencies.map((currency) => <option key={currency.id} value={currency.code}>{currency.code}{currency.name ? ` · ${currency.name}` : ''}</option>)}
            </select>
          </label>
          <p className="muted">{uiText('Chọn đơn vị này trước khi ghi nhận hóa đơn hoặc bút toán. Máy chủ sẽ khóa lựa chọn sau chứng từ tài chính đầu tiên để bảo đảm sổ cái nhất quán.')}</p>
        </div>
      </section>
    </section>
  </div>;
}
