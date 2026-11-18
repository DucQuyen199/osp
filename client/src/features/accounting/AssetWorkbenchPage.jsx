import React, { useEffect, useMemo, useState } from 'react';
import { useDocumentTitle } from '../../lib/useDocumentTitle.js';
import { localDate, localMonth } from '../../lib/dates.js';
import { api, dataPath } from '../../lib/api.js';
import { fmtDate, fmtMoney, uiText } from '../../lib/i18n.js';
import { addDecimals, compareDecimals, subtractDecimals } from '../../lib/decimal.js';
import { can } from '../../lib/state.js';
import { recordHref } from '../../lib/routes.js';
import { useAssetWorkbenchData } from './hooks/useAssetWorkbenchData.js';
import AssetRegistryPanel from './components/AssetRegistryPanel.jsx';
const currentMonth = localMonth();
export default function AssetWorkbenchPage() {
  useDocumentTitle(`${uiText('Sổ tài sản cố định')} · OSP Suite`);
  const { assets, depreciations, loading, error, setError, load } = useAssetWorkbenchData();
  const [form, setForm] = useState({ name: '', code: '', category: '', purchase_date: '', in_service_date: localDate(), cost: '', salvage_value: '0', useful_life_months: '60', depreciation_method: 'straight_line', declining_balance_factor: '2', acquisition_method: 'bank', opening_accumulated_depreciation: '0', location: '' });
  const [depreciationForm, setDepreciationForm] = useState({ asset: '', period: currentMonth });
  const [disposals, setDisposals] = useState({});
  const [filter, setFilter] = useState('all');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => { setDepreciationForm((current) => ({ ...current, asset: current.asset && assets.some((asset) => asset.id === current.asset && asset.status === 'active') ? current.asset : assets.find((asset) => asset.status === 'active')?.id || '' })); }, [assets]);
  const visibleAssets = useMemo(() => assets.filter((asset) => filter === 'all' || asset.status === filter), [assets, filter]);
  const openingDepreciationMax = compareDecimals(subtractDecimals(form.cost || 0, form.salvage_value || 0), '0') < 0 ? '0' : subtractDecimals(form.cost || 0, form.salvage_value || 0);
  const hasDisposalProceeds = (assetId) => compareDecimals(disposals[assetId]?.proceeds || 0, '0') > 0;
  const activeAssets = assets.filter((asset) => asset.status === 'active');
  const activeBookValue = addDecimals(activeAssets.map((asset) => asset.book_value ?? asset.cost ?? 0));
  const draftDepreciations = depreciations.filter((row) => row.status === 'draft').length;
  const depreciationExists = (assetId, period) => depreciations.some((row) => row.asset === assetId && String(row.period || '').slice(0, 7) === period);
  async function run(key, operation, message) {
    setBusy(key); setError(''); setNotice('');
    try { await operation(); await load(true); setNotice(message); }
    catch (reason) { setError(reason.message || uiText('Thao tác không thành công.')); }
    finally { setBusy(''); }
  }
  async function createAsset(event) {
    event.preventDefault();
    if (compareDecimals(form.salvage_value || 0, form.cost || 0) > 0) { setError(uiText('Giá trị thu hồi không thể lớn hơn nguyên giá.')); return; }
    if (form.acquisition_method === 'opening_balance' && compareDecimals(form.opening_accumulated_depreciation || 0, subtractDecimals(form.cost || 0, form.salvage_value || 0)) > 0) { setError(uiText('Hao mòn lũy kế đầu kỳ không thể vượt quá nguyên giá sau khi trừ giá trị thu hồi.')); return; }
    const payload = { name: form.name.trim(), code: form.code.trim(), in_service_date: form.in_service_date, cost: String(form.cost), salvage_value: String(form.salvage_value || 0), useful_life_months: Number(form.useful_life_months), depreciation_method: form.depreciation_method, acquisition_method: form.acquisition_method, location: form.location.trim() || undefined, category: form.category.trim() || undefined };
    if (form.purchase_date) payload.purchase_date = form.purchase_date;
    if (form.depreciation_method === 'declining_balance') payload.declining_balance_factor = String(form.declining_balance_factor || 2);
    if (form.acquisition_method === 'opening_balance') payload.opening_accumulated_depreciation = String(form.opening_accumulated_depreciation || 0);
    await run('asset:create', async () => {
      await api(dataPath('asset.asset'), { method: 'POST', body: payload });
      setForm((current) => ({ ...current, name: '', code: '', category: '', purchase_date: '', cost: '', location: '' }));
    }, uiText('Đã tạo tài sản nháp. Vốn hóa để bắt đầu theo dõi tài sản và khấu hao.'));
  }
  const activate = (asset) => run(`${asset.id}:activated`, () => api(dataPath('asset.asset', asset.id, 'activated'), { method: 'POST' }), uiText(asset.acquisition_method === 'opening_balance' ? 'Đã ghi sổ tài sản đầu kỳ.' : 'Đã vốn hóa tài sản và ghi nhận bút toán.'));
  async function dispose(asset) {
    const draft = disposals[asset.id] || {};
    const proceeds = String(draft.proceeds || 0);
    const hasProceeds = compareDecimals(proceeds, '0') > 0;
    if (hasProceeds && !draft.method) { setError(uiText('Chọn phương thức nhận tiền thanh lý.')); return; }
    await run(`${asset.id}:disposed`, async () => {
      await api(dataPath('asset.asset', asset.id), { method: 'PATCH', body: { disposal_proceeds: proceeds, ...(hasProceeds ? { disposal_method: draft.method } : {}) } });
      await api(dataPath('asset.asset', asset.id, 'disposed'), { method: 'POST' });
    }, uiText('Đã thanh lý tài sản và ghi nhận lãi/lỗ.'));
  }
  async function prepareDepreciation(event) {
    event.preventDefault();
    if (!depreciationForm.asset || !depreciationForm.period) return;
    if (depreciationExists(depreciationForm.asset, depreciationForm.period)) { setError(uiText('Tài sản đã có phiếu khấu hao cho kỳ này.')); return; }
    await run('depreciation:create', () => api(dataPath('asset.depreciation'), { method: 'POST', body: { asset: depreciationForm.asset, period: `${depreciationForm.period}-01` } }), uiText('Đã tính khấu hao theo phương pháp và giá trị còn lại của tài sản.'));
  }
  const postDepreciation = (row) => run(`${row.id}:posted`, () => api(dataPath('asset.depreciation', row.id, 'posted'), { method: 'POST' }), uiText('Đã ghi sổ khấu hao, cập nhật hao mòn và tạo bút toán kế toán.'));
  const removeDepreciation = (row) => run(`${row.id}:delete`, () => api(dataPath('asset.depreciation', row.id), { method: 'DELETE' }), uiText('Đã xóa phiếu khấu hao nháp.'));
  return <div className="page">
    <div className="page-head"><div><h1>{uiText("Sổ tài sản cố định")}</h1><p className="sub">{uiText("Đăng ký, vốn hóa, theo dõi hao mòn, ghi khấu hao và thanh lý tài sản có liên kết sổ cái.")}</p></div><div className="row"><a className="btn btn-ghost" href="#/reports/asset/depreciation-schedule">{uiText("Lịch khấu hao")}</a><button className="btn btn-secondary" type="button" disabled={loading || Boolean(busy)} onClick={() => load()}>{uiText("Làm mới")}</button></div></div>
    {error && <div className="alert danger" role="alert">{uiText(error)}</div>}{notice && <div className="alert success" role="status">{uiText(notice)}</div>}
    <div className="stats u-mb-16" ><div className="card stat"><span className="stat-label">{uiText("Tổng tài sản")}</span><strong className="stat-value">{assets.length}</strong></div><div className="card stat"><span className="stat-label">{uiText("Đang hoạt động")}</span><strong className="stat-value">{activeAssets.length}</strong></div><div className="card stat"><span className="stat-label">{uiText("Giá trị sổ sách")}</span><strong className="stat-value">{fmtMoney(activeBookValue)}</strong></div><div className="card stat"><span className="stat-label">{uiText("Phiếu khấu hao nháp")}</span><strong className="stat-value">{draftDepreciations}</strong></div></div>
    <AssetRegistryPanel
      form={form}
      setForm={setForm}
      canCreate={can('asset.asset.create')}
      canRead={can('asset.asset.read')}
      canActivate={can('asset.asset.activated')}
      canDispose={can('asset.asset.disposed')}
      onCreate={createAsset}
      openingDepreciationMax={openingDepreciationMax}
      filter={filter}
      onFilterChange={setFilter}
      loading={loading}
      assets={visibleAssets}
      busy={busy}
      disposals={disposals}
      hasDisposalProceeds={hasDisposalProceeds}
      onDisposalChange={(assetId, field, value) => setDisposals((current) => ({ ...current, [assetId]: { ...current[assetId], [field]: value } }))}
      onActivate={activate}
      onDispose={dispose}
      t={uiText}
    />
    {can('asset.depreciation.read') && <section className="card card-pad u-mt-16" ><h2>{uiText("Khấu hao định kỳ")}</h2><p className="small muted">{uiText("Tạo phiếu nháp để hệ thống tính theo kỳ, phương pháp và hao mòn đã ghi sổ; chỉ ghi bút toán sau khi kế toán xác nhận.")}</p>{can('asset.depreciation.create') && <form className="row wrap" onSubmit={prepareDepreciation}><label className="field grow"><span className="label">{uiText("Tài sản đang hoạt động")}</span><select className="select" required value={depreciationForm.asset} onChange={(event) => setDepreciationForm({ ...depreciationForm, asset: event.target.value })}><option value="">{uiText("Chọn tài sản")}</option>{activeAssets.map((asset) => <option key={asset.id} value={asset.id}>{asset.code} · {asset.name}</option>)}</select></label><label className="field"><span className="label">{uiText("Kỳ khấu hao")}</span><input className="input" type="month" required value={depreciationForm.period} onChange={(event) => setDepreciationForm({ ...depreciationForm, period: event.target.value })}/></label><button className="btn btn-secondary" disabled={Boolean(busy) || !depreciationForm.asset || !depreciationForm.period || depreciationExists(depreciationForm.asset, depreciationForm.period)}>{uiText("Tính và tạo nháp")}</button></form>}
      {!depreciations.length ? <div className="empty">{uiText("Chưa có phiếu khấu hao.")}</div> : <div className="table-wrap u-mt-12" ><table className="table"><thead><tr><th>{uiText("Kỳ")}</th><th>{uiText("Tài sản")}</th><th>{uiText("Số tiền")}</th><th>{uiText("Trạng thái")}</th><th>{uiText("Thao tác")}</th></tr></thead><tbody>{depreciations.map((row) => { const asset = assets.find((item) => item.id === row.asset); return <tr key={row.id}><td>{fmtDate(row.period)}</td><td>{asset ? <a href={recordHref('asset.asset', asset.id)}>{asset.code} · {asset.name}</a> : String(row.asset || '').slice(0, 8)}</td><td className="money">{fmtMoney(row.amount)}</td><td><span className={`badge ${row.status === 'posted' ? 'success' : 'warning'}`}>{uiText(row.status === 'posted' ? 'Đã ghi sổ' : 'Bản nháp')}</span></td><td>{row.status === 'draft' && <div className="row wrap">{can('asset.depreciation.posted') && <button className="btn btn-primary btn-sm" disabled={Boolean(busy)} onClick={() => postDepreciation(row)}>{uiText("Ghi sổ")}</button>}{can('asset.depreciation.delete') && <button className="btn btn-ghost btn-sm" disabled={Boolean(busy)} onClick={() => removeDepreciation(row)}>{uiText("Xóa nháp")}</button>}</div>}</td></tr>; })}</tbody></table></div>}
    </section>}
  </div>;
}
