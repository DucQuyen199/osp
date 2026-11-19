import { useEffect, useState } from 'react';
import { api, dataPath } from '../../../lib/api.js';
import { compareDecimals } from '../../../lib/decimal.js';

export function useLoyaltyWorkbenchWorkflow({ members, parties, selected, setSelectedId, load, t }) {
  const [form, setForm] = useState({ party: '', tier: 'bronze' });
  const [voucherForm, setVoucherForm] = useState({ code: '', kind: 'percent', value: '', valid_until: '' });
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const registered = new Set(members.map((member) => member.party));
    setForm((current) => ({
      ...current,
      party: parties.has(current.party) && !registered.has(current.party)
        ? current.party : [...parties.keys()].find((party) => !registered.has(party)) || '',
    }));
  }, [members, parties]);

  async function run(key, operation, message) {
    setBusy(key); setError(''); setNotice('');
    try { await operation(); await load(true); setNotice(t(message)); }
    catch (reason) { setError(t(reason.message || 'Thao tác không thành công.')); }
    finally { setBusy(''); }
  }

  async function enroll(event) {
    event.preventDefault();
    await run('member:create', async () => {
      const created = await api(dataPath('loyalty.member'), { method: 'POST', body: { party: form.party, tier: form.tier } });
      setSelectedId(created.id); setForm((current) => ({ ...current, party: '' }));
    }, 'Đã đăng ký thành viên. Điểm sẽ được cộng tự động từ đơn hàng đủ điều kiện.');
  }

  async function changeTier(tier) {
    if (!selected || tier === selected.tier) return;
    await run(`${selected.id}:tier`, () => api(dataPath('loyalty.member', selected.id), { method: 'PATCH', body: { tier } }), 'Đã cập nhật hạng thành viên.');
  }

  async function createVoucher(event) {
    event.preventDefault();
    const value = String(voucherForm.value ?? '').trim().replace(/^([+-]?)\./, (_, sign) => `${sign}0.`);
    let validValue = false;
    try { validValue = compareDecimals(value, '0') > 0 && (voucherForm.kind !== 'percent' || compareDecimals(value, '100') < 0); } catch { /* Invalid decimal input is reported below. */ }
    if (!validValue) { setError(t('Giá trị voucher không hợp lệ.')); return; }
    const body = { code: voucherForm.code.trim().toUpperCase(), ...(voucherForm.kind === 'percent' ? { percent: value } : { amount: value }), ...(voucherForm.valid_until ? { valid_until: voucherForm.valid_until } : {}) };
    await run('voucher:create', async () => {
      await api(dataPath('loyalty.voucher'), { method: 'POST', body });
      setVoucherForm({ code: '', kind: 'percent', value: '', valid_until: '' });
    }, 'Đã phát hành voucher đơn lẻ. Mã được đánh dấu đã dùng khi đơn bán hoặc POS hoàn tất.');
  }

  return { form, setForm, voucherForm, setVoucherForm, busy, error, notice, enroll, changeTier, createVoucher };
}
