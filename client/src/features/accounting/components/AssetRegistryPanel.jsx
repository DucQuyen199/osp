import React from 'react';
import { fmtDate, fmtMoney, statusLabel } from '../../../lib/i18n.js';
import { recordHref } from '../../../lib/routes.js';

const statuses = { draft: 'Bản nháp', active: 'Đang sử dụng', disposed: 'Đã thanh lý' };
const methods = { straight_line: 'Đường thẳng', declining_balance: 'Số dư giảm dần' };
const acquisitionMethods = { cash: 'Tiền mặt', bank: 'Ngân hàng', opening_balance: 'Số dư đầu kỳ' };

export default function AssetRegistryPanel({
  form,
  setForm,
  canCreate,
  canRead,
  canActivate,
  canDispose,
  onCreate,
  openingDepreciationMax,
  filter,
  onFilterChange,
  loading,
  assets,
  busy,
  disposals,
  hasDisposalProceeds,
  onDisposalChange,
  onActivate,
  onDispose,
  t,
}) {
  return <>
    {canCreate && <section className="card card-pad">
      <h2>{t('Đăng ký tài sản')}</h2>
      <form className="form-grid" onSubmit={onCreate}>
        <label className="field"><span className="label">{t('Tên tài sản *')}</span><input className="input" required maxLength="240" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })}/></label>
        <label className="field"><span className="label">{t('Mã tài sản *')}</span><input className="input" required maxLength="120" value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })}/></label>
        <label className="field"><span className="label">{t('Nhóm tài sản')}</span><input className="input" maxLength="120" value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}/></label>
        <label className="field"><span className="label">{t('Vị trí')}</span><input className="input" maxLength="240" value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })}/></label>
        <label className="field"><span className="label">{t('Ngày mua')}</span><input className="input" type="date" value={form.purchase_date} onChange={(event) => setForm({ ...form, purchase_date: event.target.value })}/></label>
        <label className="field"><span className="label">{t('Ngày đưa vào sử dụng *')}</span><input className="input" type="date" required value={form.in_service_date} onChange={(event) => setForm({ ...form, in_service_date: event.target.value })}/></label>
        <label className="field"><span className="label">{t('Nguyên giá *')}</span><input className="input num" type="number" min="0.01" step="0.01" required value={form.cost} onChange={(event) => setForm({ ...form, cost: event.target.value })}/></label>
        <label className="field"><span className="label">{t('Giá trị thu hồi')}</span><input className="input num" type="number" min="0" step="0.01" value={form.salvage_value} onChange={(event) => setForm({ ...form, salvage_value: event.target.value })}/></label>
        <label className="field"><span className="label">{t('Thời gian sử dụng (tháng) *')}</span><input className="input num" type="number" min="1" step="1" required value={form.useful_life_months} onChange={(event) => setForm({ ...form, useful_life_months: event.target.value })}/></label>
        <label className="field"><span className="label">{t('Phương pháp khấu hao')}</span><select className="select" value={form.depreciation_method} onChange={(event) => setForm({ ...form, depreciation_method: event.target.value })}><option value="straight_line">{t('Đường thẳng')}</option><option value="declining_balance">{t('Số dư giảm dần')}</option></select></label>
        {form.depreciation_method === 'declining_balance' && <label className="field"><span className="label">{t('Hệ số điều chỉnh (≤ 2)')}</span><input className="input num" type="number" min="0.01" max="2" step="0.01" value={form.declining_balance_factor} onChange={(event) => setForm({ ...form, declining_balance_factor: event.target.value })}/></label>}
        <label className="field"><span className="label">{t('Cách hình thành tài sản')}</span><select className="select" value={form.acquisition_method} onChange={(event) => setForm({ ...form, acquisition_method: event.target.value })}><option value="cash">{t('Chi tiền mặt')}</option><option value="bank">{t('Chi qua ngân hàng')}</option><option value="opening_balance">{t('Số dư đầu kỳ')}</option></select></label>
        {form.acquisition_method === 'opening_balance' && <label className="field"><span className="label">{t('Hao mòn lũy kế đầu kỳ')}</span><input className="input num" type="number" min="0" max={openingDepreciationMax} step="0.01" value={form.opening_accumulated_depreciation} onChange={(event) => setForm({ ...form, opening_accumulated_depreciation: event.target.value })}/></label>}
        <div className="row full"><span className="grow small muted">{t('Khi vốn hóa, hệ thống tạo bút toán Nợ 211 và Có 111/112/411; số dư đầu kỳ sẽ ghi thêm hao mòn Có 214.')}</span><button className="btn btn-primary" disabled={Boolean(busy)}>{t('Tạo tài sản nháp')}</button></div>
      </form>
    </section>}
    {canRead && <section className="card card-pad u-mt-16">
      <div className="row wrap"><div><h2>{t('Danh mục tài sản')}</h2><p className="small muted">{t('Tài sản đã vốn hóa được giữ trong sổ kiểm toán, kể cả sau thanh lý.')}</p></div><span className="grow"/><label className="field"><span className="label">{t('Trạng thái')}</span><select className="select" value={filter} onChange={(event) => onFilterChange(event.target.value)}><option value="all">{t('Tất cả')}</option><option value="draft">{t('Bản nháp')}</option><option value="active">{t('Đang sử dụng')}</option><option value="disposed">{t('Đã thanh lý')}</option></select></label></div>
      {loading ? <div className="skeleton" data-h="row"/> : !assets.length ? <div className="empty">{t('Chưa có tài sản trong bộ lọc này.')}</div> : <div className="table-wrap"><table className="table"><thead><tr><th>{t('Mã / tài sản')}</th><th>{t('Ngày sử dụng')}</th><th>{t('Nguyên giá')}</th><th>{t('Hao mòn')}</th><th>{t('Giá trị còn lại')}</th><th>{t('Khấu hao / nguồn')}</th><th>{t('Trạng thái / thao tác')}</th></tr></thead><tbody>{assets.map((asset) => {
        const disposal = disposals[asset.id] || {};
        const hasProceeds = hasDisposalProceeds(asset.id);
        return <tr key={asset.id}>
          <td><a href={recordHref('asset.asset', asset.id)}><strong>{asset.code}</strong></a><div>{asset.name}</div><div className="small muted">{asset.category || asset.location || '—'}</div></td>
          <td>{fmtDate(asset.in_service_date)}</td><td className="money">{fmtMoney(asset.cost)}</td><td className="money">{fmtMoney(asset.accumulated_depreciation || 0)}</td><td className="money">{fmtMoney(asset.book_value ?? asset.cost)}</td>
          <td>{t(methods[asset.depreciation_method] || methods.straight_line)}<div className="small muted">{t(acquisitionMethods[asset.acquisition_method])}</div></td>
          <td><span className={`badge ${asset.status === 'active' ? 'success' : asset.status === 'disposed' ? 'plain' : 'warning'}`}>{t(statuses[asset.status]) || statusLabel(asset.status)}</span>
            {asset.status === 'draft' && canActivate && <div><button className="btn btn-primary btn-sm u-mt-6" disabled={Boolean(busy)} onClick={() => onActivate(asset)}>{t(asset.acquisition_method === 'opening_balance' ? 'Ghi sổ đầu kỳ' : 'Vốn hóa & kích hoạt')}</button></div>}
            {asset.status === 'active' && canDispose && <div className="stack-sm u-mt-6"><input className="input num" type="number" min="0" step="0.01" aria-label={`${t('Tiền thu khi thanh lý')} ${asset.code}`} placeholder={t('Tiền thu thanh lý')} value={disposal.proceeds || ''} onChange={(event) => onDisposalChange(asset.id, 'proceeds', event.target.value)}/>{hasProceeds && <select className="select" aria-label={`${t('Phương thức nhận tiền')} ${asset.code}`} value={disposal.method || ''} onChange={(event) => onDisposalChange(asset.id, 'method', event.target.value)}><option value="">{t('Chọn phương thức')}</option><option value="cash">{t('Tiền mặt')}</option><option value="bank">{t('Ngân hàng')}</option></select>}<button className="btn btn-ghost btn-sm" disabled={Boolean(busy) || (hasProceeds && !disposal.method)} onClick={() => onDispose(asset)}>{t('Thanh lý')}</button></div>}
          </td>
        </tr>;
      })}</tbody></table></div>}
    </section>}
  </>;
}
