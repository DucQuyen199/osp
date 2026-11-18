import React, { useMemo, useState } from 'react';
import { useDocumentTitle } from '../../lib/useDocumentTitle.js';
import { fmtDate, fmtMoney, uiText } from '../../lib/i18n.js';
import { addDecimals } from '../../lib/decimal.js';
import { can } from '../../lib/state.js';
import { recordHref } from '../../lib/routes.js';
import { useAssetWorkbenchData } from './hooks/useAssetWorkbenchData.js';
import { useAssetWorkbenchWorkflow } from './hooks/useAssetWorkbenchWorkflow.js';
import AssetRegistryPanel from './components/AssetRegistryPanel.jsx';
export default function AssetWorkbenchPage() {
  useDocumentTitle(`${uiText('Sổ tài sản cố định')} · OSP Suite`);
  const { assets, depreciations, loading, error, setError, load } = useAssetWorkbenchData();
  const [filter, setFilter] = useState('all');
  const workflow = useAssetWorkbenchWorkflow({ assets, depreciations, load, setError });
  const {
    form, setForm, depreciationForm, setDepreciationForm, disposals, setDisposals,
    busy, notice, hasDisposalProceeds, depreciationExists, openingDepreciationMax,
    createAsset, activate, dispose, prepareDepreciation, postDepreciation, removeDepreciation,
  } = workflow;
  const visibleAssets = useMemo(() => assets.filter((asset) => filter === 'all' || asset.status === filter), [assets, filter]);
  const activeAssets = assets.filter((asset) => asset.status === 'active');
  const activeBookValue = addDecimals(activeAssets.map((asset) => asset.book_value ?? asset.cost ?? 0));
  const draftDepreciations = depreciations.filter((row) => row.status === 'draft').length;
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
