import React, { useEffect, useState } from 'react';
import { useDocumentTitle } from '../../lib/useDocumentTitle.js';
import { api, tenantPath } from '../../lib/api.js';
import { fmtMoney, statusLabel, fmtNumber, uiText } from '../../lib/i18n.js';
export default function MarketingCampaignPerformancePage() {
  useDocumentTitle(`${uiText('Hiệu quả chiến dịch')} · OSP Suite`);
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [model, setModel] = useState('first_touch');
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ model });
    api(tenantPath(`/reports/marketing/campaign-performance?${params}`))
      .then((data) => { if (active) setReport(data); })
      .catch((reason) => { if (active) setError(reason.message || uiText('Không tải được hiệu quả chiến dịch.')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [model]);
  return <div className="page">
    <div className="page-head"><div><h1>{uiText('Hiệu quả chiến dịch')}</h1><p className="sub">{uiText('Đo lead, chuyển đổi và doanh thu theo mô hình quy nguồn đã chọn.')}</p></div><label className="field"><span className="field-label">{uiText('Mô hình ghi nhận')}</span><select className="input" value={model} onChange={(event) => setModel(event.target.value)}><option value="first_touch">{uiText('Chạm đầu tiên')}</option><option value="last_touch">{uiText('Chạm cuối cùng')}</option><option value="linear">{uiText('Chia đều các lần chạm')}</option></select></label><a className="btn btn-secondary" href="#/e/marketing/campaign">{uiText('Chiến dịch')}</a></div>
    {error && <div className="alert danger" role="alert">{uiText(error)}</div>}
    {loading ? <div className="card-pad"><div className="skeleton" data-h="row" /></div> : report && <div className="stack">
      <div className="stats">
        <div className="card stat"><span className="stat-label">{uiText('Chiến dịch')}</span><strong className="stat-value num">{fmtNumber(Number(report.campaignCount || 0))}</strong></div>
        <div className="card stat"><span className="stat-label">{uiText('Lead được ghi nhận')}</span><strong className="stat-value num">{fmtNumber(Number(report.leadCount || 0), { maximumFractionDigits: 2 })}</strong></div>
        <div className="card stat"><span className="stat-label">{uiText('Đã chuyển đổi')}</span><strong className="stat-value num">{fmtNumber(Number(report.conversionCount || 0))}</strong></div>
        <div className="card stat"><span className="stat-label">{uiText('Tỷ lệ chuyển đổi')}</span><strong className="stat-value num">{fmtNumber(Number(report.conversionRate || 0), { maximumFractionDigits: 1 })}%</strong></div>
        <div className="card stat"><span className="stat-label">{uiText('Chi thực tế')}</span><strong className="stat-value num">{fmtMoney(report.actualCostTotal)}</strong></div>
        <div className="card stat"><span className="stat-label">{uiText('Doanh thu cơ hội thắng')}</span><strong className="stat-value num">{fmtMoney(report.attributedRevenue)}</strong></div>
        <div className="card stat"><span className="stat-label">{uiText('Doanh thu / chi phí')}</span><strong className="stat-value num">{report.revenueToSpend == null ? '—' : `${fmtNumber(Number(report.revenueToSpend), { maximumFractionDigits: 2 })}×`}</strong></div>
      </div>
      {!report.campaigns?.length ? <div className="empty"><h2>{uiText('Chưa có chiến dịch')}</h2><p>{uiText('Tạo chiến dịch, khởi chạy rồi gắn lead để bắt đầu đo hiệu quả.')}</p></div> : <div className="card table-wrap"><table className="table">
        <thead><tr><th scope="col">{uiText('Chiến dịch')}</th><th scope="col">{uiText('Kênh')}</th><th scope="col">{uiText('Trạng thái')}</th><th scope="col" className="right">{uiText('Ngân sách kế hoạch')}</th><th scope="col" className="right">{uiText('Chi thực tế')}</th><th scope="col" className="right">{uiText('Lead được ghi nhận')}</th><th scope="col" className="right">{uiText('Chuyển đổi')}</th><th scope="col" className="right">{uiText('Tỷ lệ')}</th><th scope="col" className="right">{uiText('Cơ hội thắng')}</th><th scope="col" className="right">{uiText('Doanh thu gắn nguồn')}</th><th scope="col" className="right">{uiText('Doanh thu / chi')}</th></tr></thead>
        <tbody>{report.campaigns.map((campaign) => <tr key={campaign.id}>
          <td><a href={`#/e/marketing/campaign/${encodeURIComponent(campaign.id)}`}>{campaign.name}</a></td><td>{campaign.channel ? statusLabel(campaign.channel) : '—'}</td><td>{statusLabel(campaign.status)}</td>
          <td className="right money">{fmtMoney(campaign.budget)}</td><td className="right money">{fmtMoney(campaign.actualCost)}</td><td className="right">{fmtNumber(Number(campaign.leads || 0), { maximumFractionDigits: 2 })}</td><td className="right">{fmtNumber(Number(campaign.conversions || 0), { maximumFractionDigits: 2 })}</td><td className="right">{fmtNumber(Number(campaign.conversionRate || 0), { maximumFractionDigits: 1 })}%</td><td className="right">{fmtNumber(Number(campaign.wonDeals || 0), { maximumFractionDigits: 2 })}</td><td className="right money">{fmtMoney(campaign.attributedRevenue)}</td><td className="right">{campaign.revenueToSpend == null ? '—' : `${fmtNumber(Number(campaign.revenueToSpend), { maximumFractionDigits: 2 })}×`}</td>
        </tr>)}</tbody>
      </table></div>}
    </div>}
  </div>;
}
