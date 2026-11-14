import React, { useCallback, useEffect, useState } from 'react';
import { api, tenantPath } from './lib/api.js';
import { fmtMoney, statusLabel } from './lib/i18n.js';
import { can, loadRefs } from './lib/state.js';

const today = () => new Date().toISOString().slice(0, 10);
const qty = (value) => Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 3 });

export default function ManufacturingWipPage() {
  const [asOf, setAsOf] = useState(today());
  const [report, setReport] = useState(null);
  const [accounts, setAccounts] = useState(new Map());
  const [offsetAccountId, setOffsetAccountId] = useState('');
  const [memo, setMemo] = useState('Điều chỉnh đối chiếu WIP');
  const [adjustment, setAdjustment] = useState(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (asOf) params.set('asOf', asOf);
      setReport(await api(`${tenantPath('/reports/manufacturing/wip')}?${params}`));
    } catch (reason) {
      setReport(null);
      setError(reason.message || 'Không tải được báo cáo WIP.');
    } finally {
      setLoading(false);
    }
  }, [asOf]);

  useEffect(() => { document.title = 'WIP sản xuất · OSP Suite'; load(); }, [load]);
  useEffect(() => {
    if (can('accounting.account.read')) loadRefs('accounting.account').then(setAccounts);
  }, []);

  const createDraft = async () => {
    setCreating(true);
    setError('');
    setAdjustment(null);
    try {
      const result = await api(tenantPath('/reports/manufacturing/wip/reconciliation-journals'), {
        method: 'POST', body: { asOf, offsetAccountId, memo },
      });
      const journal = result.journal || null;
      const id = journal?.id || result.journalId;
      setAdjustment({ id, status: journal?.status || result.status || 'draft', existing: result.existing });
      await load();
    } catch (reason) {
      setError(reason.message || 'Không tạo được bút toán nháp đối chiếu WIP.');
    } finally {
      setCreating(false);
    }
  };

  return <div className="page">
    <div className="page-head"><div><h1>WIP sản xuất</h1><p className="sub">Đối chiếu giá trị vật tư theo lệnh sản xuất với số dư tài khoản 154 trên sổ cái.</p></div></div>
    <section className="card">
      <form className="toolbar" onSubmit={(event) => { event.preventDefault(); load(); }}>
        <label className="field"><span className="label">Chốt phát sinh đến ngày</span><input className="input" type="date" value={asOf} onChange={(event) => setAsOf(event.target.value)} /></label>
        <button className="btn btn-primary" type="submit" disabled={loading}>{loading ? 'Đang tải…' : 'Xem báo cáo'}</button>
      </form>
    </section>
    {error && <div className="alert danger" role="alert">{error}</div>}
    {report && <div className="stack">
      <div className="stats">
        <div className="card stat"><span className="stat-label">Lệnh có số dư WIP</span><strong className="stat-value num">{Number(report.orderCount || 0).toLocaleString()}</strong></div>
        <div className="card stat"><span className="stat-label">Tổng giá trị WIP</span><strong className="stat-value num">{fmtMoney(report.totalWipValue)}</strong></div>
        {report.ledgerComparisonAvailable && <div className="card stat"><span className="stat-label">Số dư TK 154 trên sổ cái</span><strong className="stat-value num">{fmtMoney(report.ledgerWipBalance)}</strong></div>}
        {report.ledgerComparisonAvailable && <div className="card stat"><span className="stat-label">Chênh lệch WIP - TK 154</span><strong className="stat-value num">{fmtMoney(report.wipVariance)}</strong><span className={`badge ${report.reconciled ? 'success' : 'danger'}`}>{report.reconciled ? 'Khớp' : 'Cần đối chiếu'}</span></div>}
      </div>
      {!report.ledgerComparisonAvailable && <div className="alert info" role="status">Bật kế toán và quyền đọc sổ cái để đối chiếu chi tiết với tài khoản 154.</div>}
      {report.ledgerComparisonAvailable && !report.reconciled && can('accounting.journal_entry.create') && can('accounting.account.read') && <section className="card card-pad">
        <div className="card-head"><h2>Tạo bút toán điều chỉnh nháp</h2><span className="faint">Kế toán chọn tài khoản đối ứng và duyệt trước khi ghi sổ</span></div>
        <div className="toolbar">
          <label className="field"><span className="label">Tài khoản đối ứng</span><select className="select" value={offsetAccountId} onChange={(event) => setOffsetAccountId(event.target.value)}>
            <option value="">Chọn tài khoản</option>
            {[...accounts.values()].filter((account) => account.code !== '154').map((account) => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}
          </select></label>
          <label className="field"><span className="label">Diễn giải</span><input className="input" maxLength={300} value={memo} onChange={(event) => setMemo(event.target.value)} /></label>
          <button className="btn btn-primary" type="button" disabled={creating || !offsetAccountId || !memo.trim()} onClick={createDraft}>{creating ? 'Đang tạo…' : 'Tạo bút toán nháp'}</button>
        </div>
      </section>}
      {adjustment && <div className="alert success" role="status">{adjustment.existing ? 'Đã có bút toán đối chiếu cho chênh lệch này.' : 'Đã tạo bút toán nháp.'} {adjustment.id && <a href={`#/e/accounting/journal_entry/${encodeURIComponent(adjustment.id)}`}>Mở bút toán</a>} <span>Trạng thái: {adjustment.status}</span></div>}
      {!report.orders?.length ? <div className="empty"><h3>Không có số dư WIP theo lệnh</h3><p>Chưa có vật tư được xuất cho lệnh đang chạy, hoặc thành phẩm đạt QC đã được nhập kho.</p></div> : <div className="card table-wrap"><table className="table">
        <thead><tr><th scope="col">Lệnh sản xuất</th><th scope="col">Thành phẩm</th><th scope="col">Trạng thái</th><th scope="col">QC</th><th scope="col" className="right">Kế hoạch</th><th scope="col" className="right">Đạt</th><th scope="col" className="right">Phế phẩm</th><th scope="col" className="right">Giá trị NVL</th><th scope="col" className="right">Đã nhập</th><th scope="col" className="right">Còn WIP</th></tr></thead>
        <tbody>{report.orders.map((order) => <tr key={order.id}>
          <td>{order.id}</td><td>{order.product}</td><td>{statusLabel(order.status)}</td><td>{order.qualityStatus ? statusLabel(order.qualityStatus) : 'Chưa tạo QC'}</td>
          <td className="right">{qty(order.plannedQty)}</td><td className="right">{qty(order.goodQty)}</td><td className="right" title={order.scrapReason || undefined}>{qty(order.scrapQty)}</td>
          <td className="right money">{fmtMoney(order.materialCost)}</td><td className="right money">{fmtMoney(order.finishedCost)}</td><td className="right money"><strong>{fmtMoney(order.wipValue)}</strong></td>
        </tr>)}</tbody>
      </table></div>}
      <p className="faint">Giá trị tính theo phiếu kho phát sinh đến {report.asOf}. Trạng thái QC phản ánh trạng thái hiện tại; số dư âm theo lệnh vẫn được hiển thị để phục vụ đối chiếu.</p>
    </div>}
  </div>;
}
