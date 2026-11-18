import { useEffect, useState } from 'react';
import { localDate, localMonth } from '../../../lib/dates.js';
import { api, dataPath } from '../../../lib/api.js';
import { compareDecimals, subtractDecimals } from '../../../lib/decimal.js';
import { uiText } from '../../../lib/i18n.js';

const currentMonth = localMonth();

export function useAssetWorkbenchWorkflow({ assets, depreciations, load, setError }) {
  const [form, setForm] = useState({ name: '', code: '', category: '', purchase_date: '', in_service_date: localDate(), cost: '', salvage_value: '0', useful_life_months: '60', depreciation_method: 'straight_line', declining_balance_factor: '2', acquisition_method: 'bank', opening_accumulated_depreciation: '0', location: '' });
  const [depreciationForm, setDepreciationForm] = useState({ asset: '', period: currentMonth });
  const [disposals, setDisposals] = useState({});
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    setDepreciationForm((current) => ({
      ...current,
      asset: current.asset && assets.some((asset) => asset.id === current.asset && asset.status === 'active')
        ? current.asset
        : assets.find((asset) => asset.status === 'active')?.id || '',
    }));
  }, [assets]);

  function hasDisposalProceeds(assetId) {
    return compareDecimals(disposals[assetId]?.proceeds || 0, '0') > 0;
  }

  function depreciationExists(assetId, period) {
    return depreciations.some((row) => row.asset === assetId && String(row.period || '').slice(0, 7) === period);
  }

  async function run(key, operation, message) {
    setBusy(key); setError(''); setNotice('');
    try { await operation(); await load(true); setNotice(message); }
    catch (reason) { setError(reason.message || uiText('Thao tác không thành công.')); }
    finally { setBusy(''); }
  }

  async function createAsset(event) {
    event.preventDefault();
    if (compareDecimals(form.salvage_value || 0, form.cost || 0) > 0) {
      setError(uiText('Giá trị thu hồi không thể lớn hơn nguyên giá.')); return;
    }
    if (form.acquisition_method === 'opening_balance'
      && compareDecimals(form.opening_accumulated_depreciation || 0, subtractDecimals(form.cost || 0, form.salvage_value || 0)) > 0) {
      setError(uiText('Hao mòn lũy kế đầu kỳ không thể vượt quá nguyên giá sau khi trừ giá trị thu hồi.')); return;
    }
    const payload = {
      name: form.name.trim(), code: form.code.trim(), in_service_date: form.in_service_date,
      cost: String(form.cost), salvage_value: String(form.salvage_value || 0),
      useful_life_months: Number(form.useful_life_months), depreciation_method: form.depreciation_method,
      acquisition_method: form.acquisition_method, location: form.location.trim() || undefined,
      category: form.category.trim() || undefined,
    };
    if (form.purchase_date) payload.purchase_date = form.purchase_date;
    if (form.depreciation_method === 'declining_balance') payload.declining_balance_factor = String(form.declining_balance_factor || 2);
    if (form.acquisition_method === 'opening_balance') payload.opening_accumulated_depreciation = String(form.opening_accumulated_depreciation || 0);
    await run('asset:create', async () => {
      await api(dataPath('asset.asset'), { method: 'POST', body: payload });
      setForm((current) => ({ ...current, name: '', code: '', category: '', purchase_date: '', cost: '', location: '' }));
    }, uiText('Đã tạo tài sản nháp. Vốn hóa để bắt đầu theo dõi tài sản và khấu hao.'));
  }

  function activate(asset) {
    return run(`${asset.id}:activated`, () => api(dataPath('asset.asset', asset.id, 'activated'), { method: 'POST' }),
      uiText(asset.acquisition_method === 'opening_balance' ? 'Đã ghi sổ tài sản đầu kỳ.' : 'Đã vốn hóa tài sản và ghi nhận bút toán.'));
  }

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
    if (depreciationExists(depreciationForm.asset, depreciationForm.period)) {
      setError(uiText('Tài sản đã có phiếu khấu hao cho kỳ này.')); return;
    }
    await run('depreciation:create', () => api(dataPath('asset.depreciation'), {
      method: 'POST', body: { asset: depreciationForm.asset, period: `${depreciationForm.period}-01` },
    }), uiText('Đã tính khấu hao theo phương pháp và giá trị còn lại của tài sản.'));
  }

  const postDepreciation = (row) => run(`${row.id}:posted`, () => api(dataPath('asset.depreciation', row.id, 'posted'), { method: 'POST' }),
    uiText('Đã ghi sổ khấu hao, cập nhật hao mòn và tạo bút toán kế toán.'));
  const removeDepreciation = (row) => run(`${row.id}:delete`, () => api(dataPath('asset.depreciation', row.id), { method: 'DELETE' }),
    uiText('Đã xóa phiếu khấu hao nháp.'));

  const openingDepreciationBasis = subtractDecimals(form.cost || 0, form.salvage_value || 0);
  const openingDepreciationMax = compareDecimals(openingDepreciationBasis, '0') < 0 ? '0' : openingDepreciationBasis;

  return {
    form, setForm, depreciationForm, setDepreciationForm, disposals, setDisposals,
    busy, notice, hasDisposalProceeds, depreciationExists, openingDepreciationMax,
    createAsset, activate, dispose, prepareDepreciation, postDepreciation, removeDepreciation,
  };
}
