import React, { useEffect, useRef, useState } from 'react';
import { api, tenantPath } from '../../lib/api.js';
import { uiTextWith } from '../../lib/i18n.js';
import chartTemplateEnglish from './chart-template.en.js';

const t = (text) => uiTextWith(text, chartTemplateEnglish);

export default function AccountingChartTemplateDialog({ onClose }) {
  const dialog = useRef(null);
  const [templates, setTemplates] = useState([]);
  const [current, setCurrent] = useState(null);
  const [selected, setSelected] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const node = dialog.current;
    if (node && !node.open) node.showModal();
    let active = true;
    api(tenantPath('/reports/accounting/chart-templates'))
      .then((data) => {
        if (!active) return;
        setTemplates(data.templates || []);
        setCurrent(data.current || null);
        setSelected(data.current || data.templates?.[0]?.id || '');
      })
      .catch((reason) => { if (active) setError(t(reason.message || 'Không tải được mẫu hệ thống tài khoản.')); })
      .finally(() => { if (active) setLoading(false); });
    return () => {
      active = false;
      if (node?.open) node.close();
    };
  }, []);

  const close = () => { dialog.current?.close(); onClose?.(); };
  const apply = async (event) => {
    event.preventDefault();
    if (!selected || saving) return;
    setError('');
    setSaving(true);
    try {
      const applied = await api(tenantPath(`/reports/accounting/chart-templates/${selected}/apply`), { method: 'POST' });
      setResult(applied);
      setCurrent(applied.template);
    } catch (reason) {
      setError(t(reason.message || 'Không áp dụng được mẫu hệ thống tài khoản.'));
    } finally {
      setSaving(false);
    }
  };

  const activeTemplate = templates.find((template) => template.id === current);
  const chosenTemplate = templates.find((template) => template.id === selected);
  const preserved = result?.preserved || [];
  const blocked = result?.blocked || [];
  const mismatches = preserved.filter((account) => !account.matchesTemplate);

  return <dialog ref={dialog} className="modal" aria-labelledby="chart-template-title" onCancel={(event) => { event.preventDefault(); close(); }}>
    <form onSubmit={apply}>
      <div className="modal-body stack">
        <h2 id="chart-template-title">{t('Mẫu hệ thống tài khoản')}</h2>
        {loading ? <p role="status">{t('Đang tải danh sách mẫu…')}</p> : <>
          {activeTemplate && <div className="alert success" role="status">{t('Doanh nghiệp đang dùng')} {activeTemplate.name}.</div>}
          <p className="muted small">{t('Mẫu bổ sung tài khoản cấp 1 và các mã chi tiết được liệt kê trong phụ lục, đồng thời gắn tài khoản chi tiết với tài khoản cha. Tài khoản đã có được giữ nguyên; sau khi áp dụng, doanh nghiệp không thể đổi sang chuẩn khác.')}</p>
          <label className="field">
            <span className="label">{t('Chuẩn kế toán')}</span>
            <select className="select" value={selected} onChange={(event) => { setSelected(event.target.value); setResult(null); }} disabled={Boolean(current) || saving}>
              {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
            </select>
          </label>
          {chosenTemplate && <div className="card-pad">
            <p>{chosenTemplate.description}</p>
            <p className="muted small">{chosenTemplate.accountCount} {t('tài khoản cấp 1')} · {chosenTemplate.detailAccountCount} {t('tài khoản chi tiết')} · {chosenTemplate.totalAccountCount} {t('tổng số')} · <a href={chosenTemplate.source} target="_blank" rel="noreferrer">{t('Văn bản nguồn')}</a></p>
          </div>}
          {result && <div className="alert success" role="status">
            {t('Đã áp dụng mẫu: thêm')} {result.created?.length || 0} {t('tài khoản, giữ nguyên')} {preserved.length} {t('tài khoản đã có, bỏ qua')} {blocked.length} {t('tài khoản chi tiết bị vướng nhánh không khớp.')}
          </div>}
          {blocked.length > 0 && <div className="alert warning" role="status">
            {t('Chưa thêm được các mã')} {blocked.slice(0, 8).map((account) => account.code).join(', ')}{blocked.length > 8 ? ` ${t('và')} ${blocked.length - 8} ${t('mã khác')}` : ''} {t('vì tài khoản cha hoặc nhánh cha hiện có khác loại/quan hệ mẫu. Hãy rà soát cấu trúc trước khi thêm thủ công.')}
          </div>}
          {mismatches.length > 0 && <div className="alert warning" role="status">
            {mismatches.length} {t('tài khoản có cùng mã nhưng tên, loại hoặc quan hệ tài khoản cha khác mẫu; dữ liệu hiện tại được giữ nguyên. Hãy rà soát trước khi hạch toán.')}
          </div>}
        </>}
        {error && <div className="alert danger" role="alert">{error}</div>}
      </div>
      <div className="modal-foot">
        <button className="btn" type="button" onClick={close}>{t('Đóng')}</button>
        <button className="btn btn-primary" type="submit" disabled={loading || saving || !selected || Boolean(result)}>
          {saving ? t('Đang áp dụng…') : current ? t('Đã chọn chuẩn này') : t('Áp dụng mẫu')}
        </button>
      </div>
    </form>
  </dialog>;
}
