import React, { useCallback, useEffect, useState } from 'react';
import { api, tenantPath } from '../../lib/api.js';
import { fmtMoney, fmtNumber, uiText } from '../../lib/i18n.js';

export default function AssetDepreciationSchedulePage() {
  const [months, setMonths] = useState('12');
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ months });
      setReport(await api(`${tenantPath('/reports/asset/depreciation-schedule')}?${params}`));
    } catch (reason) {
      setReport(null);
      setError(reason.message || uiText('Không tải được lịch khấu hao tài sản.'));
    } finally {
      setLoading(false);
    }
  }, [months]);

  useEffect(() => { document.title = `${uiText('Lịch khấu hao tài sản')} · OSP Suite`; load(); }, [load]);

  const rows = (report?.assets || []).flatMap((asset) => (asset.schedule || []).map((period) => ({
    assetId: asset.assetId,
    code: asset.code,
    name: asset.name,
    ...period,
  })));

  return <div className="page">
    <div className="page-head"><div><h1>{uiText('Lịch khấu hao tài sản')}</h1><p className="sub">{uiText('Dự báo theo phương pháp khấu hao đã cấu hình và hao mòn lũy kế hiện tại.')}</p></div></div>
    <section className="card">
      <form className="toolbar" onSubmit={(event) => { event.preventDefault(); load(); }}>
        <label className="field"><span className="label">{uiText('Số tháng dự báo')}</span><select className="select" value={months} onChange={(event) => setMonths(event.target.value)}>
          <option value="6">{uiText('6 tháng')}</option><option value="12">{uiText('12 tháng')}</option><option value="24">{uiText('24 tháng')}</option><option value="36">{uiText('36 tháng')}</option>
        </select></label>
        <button className="btn btn-primary" type="submit" disabled={loading}>{loading ? uiText('Đang tính…') : uiText('Cập nhật dự báo')}</button>
      </form>
    </section>
    {error && <div className="alert danger" role="alert">{uiText(error)}</div>}
    {loading && !report ? <div className="card-pad"><div className="skeleton" data-h="row" /></div> : report && <div className="stack">
      <div className="stats">
        <div className="card stat"><span className="stat-label">{uiText('Tài sản đang hoạt động')}</span><strong className="stat-value num">{fmtNumber(Number(report.assetCount || 0))}</strong></div>
        <div className="card stat"><span className="stat-label">{uiText('Kỳ dự báo')}</span><strong className="stat-value">{report.from} – {report.to}</strong></div>
        <div className="card stat"><span className="stat-label">{uiText('Tổng khấu hao dự kiến')}</span><strong className="stat-value num">{fmtMoney(report.totalProjected)}</strong></div>
      </div>
      <div className="alert info" role="status">{uiText('Dự báo được tính từ hao mòn đã ghi sổ tại {date}. Kỳ đã có phiếu nháp được đánh dấu; báo cáo không tạo phiếu khấu hao hoặc bút toán.').replace('{date}', report.asOf)}</div>
      <section className="card report-section">
        <div className="card-head"><h2>{uiText('Chi tiết theo kỳ')}</h2><span className="faint">{uiText('{count} dòng').replace('{count}', fmtNumber(Number(report.scheduleRows || 0)))}</span></div>
        {rows.length ? <div className="table-wrap"><table className="table">
          <thead><tr><th scope="col">{uiText('Mã tài sản')}</th><th scope="col">{uiText('Tài sản')}</th><th scope="col">{uiText('Kỳ')}</th><th scope="col">{uiText('Phiếu')}</th><th scope="col" className="right">{uiText('Khấu hao kỳ')}</th><th scope="col" className="right">{uiText('Hao mòn lũy kế dự kiến')}</th><th scope="col" className="right">{uiText('Giá trị còn lại')}</th></tr></thead>
          <tbody>{rows.map((row) => <tr key={`${row.assetId}:${row.period}`}>
            <td className="mono">{row.code}</td><td>{row.name}</td><td className="mono">{row.period}</td>
            <td>{row.draftExists ? <span className="badge warning">{uiText('Đã có nháp')}</span> : <span className="muted">{uiText('Chưa tạo')}</span>}</td>
            <td className="right money">{fmtMoney(row.amount)}</td><td className="right money">{fmtMoney(row.accumulatedDepreciation)}</td><td className="right money">{fmtMoney(row.bookValue)}</td>
          </tr>)}</tbody>
        </table></div> : <div className="empty"><h3>{uiText('Chưa có khấu hao dự kiến')}</h3><p>{uiText('Không có tài sản hoạt động còn thời gian khấu hao trong kỳ đã chọn.')}</p></div>}
      </section>
    </div>}
  </div>;
}
