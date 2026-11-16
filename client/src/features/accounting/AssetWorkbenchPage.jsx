import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { localDate, localMonth } from '../../lib/dates.js';
import { api, dataPath } from '../../lib/api.js';
import { fmtDate, fmtDateTime, fmtMoney, statusLabel, uiText } from '../../lib/i18n.js';
import { can, loadAllResponse } from '../../lib/state.js';
import { recordHref } from '../../lib/routes.js';

const rows = (response) => Array.isArray(response?.items) ? response.items : [];
const statuses = { draft: 'Bản nháp', active: 'Đang sử dụng', disposed: 'Đã thanh lý' };
const methods = { straight_line: 'Đường thẳng', declining_balance: 'Số dư giảm dần' };
const acquisitionMethods = { cash: 'Tiền mặt', bank: 'Ngân hàng', opening_balance: 'Số dư đầu kỳ' };
const currentMonth = localMonth();

export default function AssetWorkbenchPage() {
  const [assets, setAssets] = useState([]);
  const [depreciations, setDepreciations] = useState([]);
  const [form, setForm] = useState({ name: '', code: '', category: '', purchase_date: '', in_service_date: localDate(), cost: '', salvage_value: '0', useful_life_months: '60', depreciation_method: 'straight_line', declining_balance_factor: '2', acquisition_method: 'bank', opening_accumulated_depreciation: '0', location: '' });
  const [depreciationForm, setDepreciationForm] = useState({ asset: '', period: currentMonth });
  const [disposals, setDisposals] = useState({});
  const [filter, setFilter] = useState('all');
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async (quiet = false) => {
    if (!quiet) { setLoading(true); setError(''); }
    try {
      const [assetRes, depreciationRes] = await Promise.all([
        can('asset.asset.read') ? loadAllResponse('asset.asset') : Promise.resolve({ items: [] }),
        can('asset.depreciation.read') ? loadAllResponse('asset.depreciation') : Promise.resolve({ items: [] }),
      ]);
      const assetRows = rows(assetRes).sort((a, b) => String(a.code || '').localeCompare(String(b.code || '')));
      const depreciationRows = rows(depreciationRes).sort((a, b) => String(b.period || '').localeCompare(String(a.period || '')));
      setAssets(assetRows); setDepreciations(depreciationRows);
      setDepreciationForm((current) => ({ ...current, asset: current.asset && assetRows.some((asset) => asset.id === current.asset && asset.status === 'active') ? current.asset : assetRows.find((asset) => asset.status === 'active')?.id || '' }));
    } catch (reason) { setError(reason.message || uiText('Không tải được sổ tài sản.')); }
    finally { if (!quiet) setLoading(false); }
  }, []);

  useEffect(() => { document.title = `${uiText('Sổ tài sản cố định')} · OSP Suite`; load(); }, [load]);

  const visibleAssets = useMemo(() => assets.filter((asset) => filter === 'all' || asset.status === filter), [assets, filter]);
  const activeAssets = assets.filter((asset) => asset.status === 'active');
  const activeBookValue = activeAssets.reduce((sum, asset) => sum + Number(asset.book_value ?? asset.cost ?? 0), 0);
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
    if (Number(form.salvage_value) > Number(form.cost)) { setError(uiText('Giá trị thu hồi không thể lớn hơn nguyên giá.')); return; }
    if (form.acquisition_method === 'opening_balance' && Number(form.opening_accumulated_depreciation || 0) > Number(form.cost) - Number(form.salvage_value || 0)) { setError(uiText('Hao mòn lũy kế đầu kỳ không thể vượt quá nguyên giá sau khi trừ giá trị thu hồi.')); return; }
    const payload = { name: form.name.trim(), code: form.code.trim(), in_service_date: form.in_service_date, cost: Number(form.cost), salvage_value: Number(form.salvage_value || 0), useful_life_months: Number(form.useful_life_months), depreciation_method: form.depreciation_method, acquisition_method: form.acquisition_method, location: form.location.trim() || undefined, category: form.category.trim() || undefined };
    if (form.purchase_date) payload.purchase_date = form.purchase_date;
    if (form.depreciation_method === 'declining_balance') payload.declining_balance_factor = Number(form.declining_balance_factor || 2);
    if (form.acquisition_method === 'opening_balance') payload.opening_accumulated_depreciation = Number(form.opening_accumulated_depreciation || 0);
    await run('asset:create', async () => {
      await api(dataPath('asset.asset'), { method: 'POST', body: payload });
      setForm((current) => ({ ...current, name: '', code: '', category: '', purchase_date: '', cost: '', location: '' }));
    }, uiText('Đã tạo tài sản nháp. Vốn hóa để bắt đầu theo dõi tài sản và khấu hao.'));
  }

  const activate = (asset) => run(`${asset.id}:activated`, () => api(dataPath('asset.asset', asset.id, 'activated'), { method: 'POST' }), uiText(asset.acquisition_method === 'opening_balance' ? 'Đã ghi sổ tài sản đầu kỳ.' : 'Đã vốn hóa tài sản và ghi nhận bút toán.'));

  async function dispose(asset) {
    const draft = disposals[asset.id] || {};
    const proceeds = Number(draft.proceeds || 0);
    if (proceeds > 0 && !draft.method) { setError(uiText('Chọn phương thức nhận tiền thanh lý.')); return; }
    await run(`${asset.id}:disposed`, async () => {
      await api(dataPath('asset.asset', asset.id), { method: 'PATCH', body: { disposal_proceeds: proceeds, ...(proceeds > 0 ? { disposal_method: draft.method } : {}) } });
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
    <div className="stats" data-inline-style="inline-bf4a218e05"><div className="card stat"><span className="stat-label">{uiText("Tổng tài sản")}</span><strong className="stat-value">{assets.length}</strong></div><div className="card stat"><span className="stat-label">{uiText("Đang hoạt động")}</span><strong className="stat-value">{activeAssets.length}</strong></div><div className="card stat"><span className="stat-label">{uiText("Giá trị sổ sách")}</span><strong className="stat-value">{fmtMoney(activeBookValue)}</strong></div><div className="card stat"><span className="stat-label">{uiText("Phiếu khấu hao nháp")}</span><strong className="stat-value">{draftDepreciations}</strong></div></div>
    {can('asset.asset.create') && <section className="card card-pad"><h2>{uiText("Đăng ký tài sản")}</h2><form className="form-grid" onSubmit={createAsset}>
      <label className="field"><span className="label">{uiText("Tên tài sản *")}</span><input className="input" required maxLength="240" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })}/></label>
      <label className="field"><span className="label">{uiText("Mã tài sản *")}</span><input className="input" required maxLength="120" value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })}/></label>
      <label className="field"><span className="label">{uiText("Nhóm tài sản")}</span><input className="input" maxLength="120" value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}/></label>
      <label className="field"><span className="label">{uiText("Vị trí")}</span><input className="input" maxLength="240" value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })}/></label>
      <label className="field"><span className="label">{uiText("Ngày mua")}</span><input className="input" type="date" value={form.purchase_date} onChange={(event) => setForm({ ...form, purchase_date: event.target.value })}/></label>
      <label className="field"><span className="label">{uiText("Ngày đưa vào sử dụng *")}</span><input className="input" type="date" required value={form.in_service_date} onChange={(event) => setForm({ ...form, in_service_date: event.target.value })}/></label>
      <label className="field"><span className="label">{uiText("Nguyên giá *")}</span><input className="input num" type="number" min="0.01" step="0.01" required value={form.cost} onChange={(event) => setForm({ ...form, cost: event.target.value })}/></label>
      <label className="field"><span className="label">{uiText("Giá trị thu hồi")}</span><input className="input num" type="number" min="0" step="0.01" value={form.salvage_value} onChange={(event) => setForm({ ...form, salvage_value: event.target.value })}/></label>
      <label className="field"><span className="label">{uiText("Thời gian sử dụng (tháng) *")}</span><input className="input num" type="number" min="1" step="1" required value={form.useful_life_months} onChange={(event) => setForm({ ...form, useful_life_months: event.target.value })}/></label>
      <label className="field"><span className="label">{uiText("Phương pháp khấu hao")}</span><select className="select" value={form.depreciation_method} onChange={(event) => setForm({ ...form, depreciation_method: event.target.value })}><option value="straight_line">{uiText("Đường thẳng")}</option><option value="declining_balance">{uiText("Số dư giảm dần")}</option></select></label>
      {form.depreciation_method === 'declining_balance' && <label className="field"><span className="label">{uiText("Hệ số điều chỉnh (≤ 2)")}</span><input className="input num" type="number" min="0.01" max="2" step="0.01" value={form.declining_balance_factor} onChange={(event) => setForm({ ...form, declining_balance_factor: event.target.value })}/></label>}
      <label className="field"><span className="label">{uiText("Cách hình thành tài sản")}</span><select className="select" value={form.acquisition_method} onChange={(event) => setForm({ ...form, acquisition_method: event.target.value })}><option value="cash">{uiText("Chi tiền mặt")}</option><option value="bank">{uiText("Chi qua ngân hàng")}</option><option value="opening_balance">{uiText("Số dư đầu kỳ")}</option></select></label>
      {form.acquisition_method === 'opening_balance' && <label className="field"><span className="label">{uiText("Hao mòn lũy kế đầu kỳ")}</span><input className="input num" type="number" min="0" max={Math.max(0, Number(form.cost || 0) - Number(form.salvage_value || 0))} step="0.01" value={form.opening_accumulated_depreciation} onChange={(event) => setForm({ ...form, opening_accumulated_depreciation: event.target.value })}/></label>}
      <div className="row full"><span className="grow small muted">{uiText("Khi vốn hóa, hệ thống tạo bút toán Nợ 211 và Có 111/112/411; số dư đầu kỳ sẽ ghi thêm hao mòn Có 214.")}</span><button className="btn btn-primary" disabled={Boolean(busy)}>{uiText("Tạo tài sản nháp")}</button></div>
    </form></section>}
    {can('asset.asset.read') && <section className="card card-pad" data-inline-style="inline-92c18f6bda"><div className="row wrap"><div><h2>{uiText("Danh mục tài sản")}</h2><p className="small muted">{uiText("Tài sản đã vốn hóa được giữ trong sổ kiểm toán, kể cả sau thanh lý.")}</p></div><span className="grow"/><label className="field"><span className="label">{uiText("Trạng thái")}</span><select className="select" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">{uiText("Tất cả")}</option><option value="draft">{uiText("Bản nháp")}</option><option value="active">{uiText("Đang sử dụng")}</option><option value="disposed">{uiText("Đã thanh lý")}</option></select></label></div>
      {loading ? <div className="skeleton" data-h="row"/> : !visibleAssets.length ? <div className="empty">{uiText("Chưa có tài sản trong bộ lọc này.")}</div> : <div className="table-wrap"><table className="table"><thead><tr><th>{uiText("Mã / tài sản")}</th><th>{uiText("Ngày sử dụng")}</th><th>{uiText("Nguyên giá")}</th><th>{uiText("Hao mòn")}</th><th>{uiText("Giá trị còn lại")}</th><th>{uiText("Khấu hao / nguồn")}</th><th>{uiText("Trạng thái / thao tác")}</th></tr></thead><tbody>{visibleAssets.map((asset) => <tr key={asset.id}><td><a href={recordHref('asset.asset', asset.id)}><strong>{asset.code}</strong></a><div>{asset.name}</div><div className="small muted">{asset.category || asset.location || '—'}</div></td><td>{fmtDate(asset.in_service_date)}</td><td className="money">{fmtMoney(asset.cost)}</td><td className="money">{fmtMoney(asset.accumulated_depreciation || 0)}</td><td className="money">{fmtMoney(asset.book_value ?? asset.cost)}</td><td>{uiText(methods[asset.depreciation_method] || methods.straight_line)}<div className="small muted">{uiText(acquisitionMethods[asset.acquisition_method])}</div></td><td><span className={`badge ${asset.status === 'active' ? 'success' : asset.status === 'disposed' ? 'plain' : 'warning'}`}>{uiText(statuses[asset.status]) || statusLabel(asset.status)}</span>{asset.status === 'draft' && can('asset.asset.activated') && <div><button className="btn btn-primary btn-sm" data-inline-style="inline-301647f506" disabled={Boolean(busy)} onClick={() => activate(asset)}>{uiText(asset.acquisition_method === 'opening_balance' ? 'Ghi sổ đầu kỳ' : 'Vốn hóa & kích hoạt')}</button></div>}{asset.status === 'active' && can('asset.asset.disposed') && <div className="stack-sm" data-inline-style="inline-301647f506"><input className="input num" type="number" min="0" step="0.01" aria-label={uiText("Tiền thu khi thanh lý") + ' ' + asset.code} placeholder={uiText("Tiền thu thanh lý")} value={disposals[asset.id]?.proceeds || ''} onChange={(event) => setDisposals((current) => ({ ...current, [asset.id]: { ...current[asset.id], proceeds: event.target.value } }))}/>{Number(disposals[asset.id]?.proceeds || 0) > 0 && <select className="select" aria-label={uiText("Phương thức nhận tiền") + ' ' + asset.code} value={disposals[asset.id]?.method || ''} onChange={(event) => setDisposals((current) => ({ ...current, [asset.id]: { ...current[asset.id], method: event.target.value } }))}><option value="">{uiText("Chọn phương thức")}</option><option value="cash">{uiText("Tiền mặt")}</option><option value="bank">{uiText("Ngân hàng")}</option></select>}<button className="btn btn-ghost btn-sm" disabled={Boolean(busy) || (Number(disposals[asset.id]?.proceeds || 0) > 0 && !disposals[asset.id]?.method)} onClick={() => dispose(asset)}>{uiText("Thanh lý")}</button></div>}</td></tr>)}</tbody></table></div>}
    </section>}
    {can('asset.depreciation.read') && <section className="card card-pad" data-inline-style="inline-92c18f6bda"><h2>{uiText("Khấu hao định kỳ")}</h2><p className="small muted">{uiText("Tạo phiếu nháp để hệ thống tính theo kỳ, phương pháp và hao mòn đã ghi sổ; chỉ ghi bút toán sau khi kế toán xác nhận.")}</p>{can('asset.depreciation.create') && <form className="row wrap" onSubmit={prepareDepreciation}><label className="field grow"><span className="label">{uiText("Tài sản đang hoạt động")}</span><select className="select" required value={depreciationForm.asset} onChange={(event) => setDepreciationForm({ ...depreciationForm, asset: event.target.value })}><option value="">{uiText("Chọn tài sản")}</option>{activeAssets.map((asset) => <option key={asset.id} value={asset.id}>{asset.code} · {asset.name}</option>)}</select></label><label className="field"><span className="label">{uiText("Kỳ khấu hao")}</span><input className="input" type="month" required value={depreciationForm.period} onChange={(event) => setDepreciationForm({ ...depreciationForm, period: event.target.value })}/></label><button className="btn btn-secondary" disabled={Boolean(busy) || !depreciationForm.asset || !depreciationForm.period || depreciationExists(depreciationForm.asset, depreciationForm.period)}>{uiText("Tính và tạo nháp")}</button></form>}
      {!depreciations.length ? <div className="empty">{uiText("Chưa có phiếu khấu hao.")}</div> : <div className="table-wrap" data-inline-style="inline-0ee7f66ad9"><table className="table"><thead><tr><th>{uiText("Kỳ")}</th><th>{uiText("Tài sản")}</th><th>{uiText("Số tiền")}</th><th>{uiText("Trạng thái")}</th><th>{uiText("Thao tác")}</th></tr></thead><tbody>{depreciations.map((row) => { const asset = assets.find((item) => item.id === row.asset); return <tr key={row.id}><td>{fmtDate(row.period)}</td><td>{asset ? <a href={recordHref('asset.asset', asset.id)}>{asset.code} · {asset.name}</a> : String(row.asset || '').slice(0, 8)}</td><td className="money">{fmtMoney(row.amount)}</td><td><span className={`badge ${row.status === 'posted' ? 'success' : 'warning'}`}>{uiText(row.status === 'posted' ? 'Đã ghi sổ' : 'Bản nháp')}</span></td><td>{row.status === 'draft' && <div className="row wrap">{can('asset.depreciation.posted') && <button className="btn btn-primary btn-sm" disabled={Boolean(busy)} onClick={() => postDepreciation(row)}>{uiText("Ghi sổ")}</button>}{can('asset.depreciation.delete') && <button className="btn btn-ghost btn-sm" disabled={Boolean(busy)} onClick={() => removeDepreciation(row)}>{uiText("Xóa nháp")}</button>}</div>}</td></tr>; })}</tbody></table></div>}
    </section>}
  </div>;
}
