import React from 'react';
import { recordHref } from '../../../lib/routes.js';

/** Renders the filtered NCR records and emits closure requests to the workbench. */
export default function QualityNonconformanceTable({
  records = [],
  inspections,
  products,
  severityLabels,
  busy,
  canClose,
  fmtDateTime,
  statusLabel,
  recordLabel,
  uiText,
  onClose,
}) {
  return <div className="table-wrap"><table className="table">
    <thead><tr>
      <th>{uiText('Tiêu đề / thời điểm')}</th><th>{uiText('Mức độ')}</th>
      <th>{uiText('Phiếu QC / sản phẩm')}</th><th>{uiText('Mô tả')}</th>
      <th>{uiText('Trạng thái')}</th><th>{uiText('Thao tác')}</th>
    </tr></thead>
    <tbody>{records.map((record) => {
      const inspection = inspections.get(record.inspection);
      const product = inspection && products.get(inspection.product);
      return <tr key={record.id}>
        <td><strong>{record.title}</strong><div className="small muted">{fmtDateTime(record.createdAt)}</div></td>
        <td><span className={`badge ${record.severity === 'critical' ? 'danger' : record.severity === 'major' ? 'warning' : 'plain'}`}>{severityLabels[record.severity] || statusLabel(record.severity)}</span></td>
        <td>{inspection ? <><a href={recordHref('quality.inspection', inspection.id)}>{product ? recordLabel('master-data.product', product) : uiText('Phiếu kiểm tra')}</a><div className="small muted">{statusLabel(inspection.status)} · {inspection.source || ''}</div></> : <span className="muted">{record.source ? `${record.source} · ${record.source_id || ''}` : uiText('Không liên kết')}</span>}</td>
        <td className="small u-pre-wrap">{record.description || '—'}</td>
        <td><span className={`badge ${record.status === 'open' ? 'warning' : 'success'}`}>{record.status === 'open' ? uiText('Đang mở') : uiText('Đã đóng')}</span></td>
        <td>{record.status === 'open' && canClose && <button className="btn btn-secondary btn-sm" type="button" disabled={Boolean(busy)} onClick={() => onClose(record)}>{uiText('Đóng NCR')}</button>}</td>
      </tr>;
    })}</tbody>
  </table></div>;
}
