import React from 'react';
import { fmtDate, uiText } from '../../../lib/i18n.js';

export default function SupplierInvoiceAdjustmentsEditor({ lines, onChange, receipts, taxes, currencyCode }) {
  const update = (index, patch) => onChange(lines.map((line, i) => i === index ? { ...line, ...patch } : line));
  return <section className="field full">
    <span className="label">{uiText('Phí và chiết khấu')}</span>
    <p className="small muted">{uiText('Phí có thể hạch toán vào chi phí mua (632) hoặc vốn hóa vào giá trị hàng nhận; thuế của phí được hạch toán riêng.')}</p>
    {lines.map((line, index) => <div className="row wrap u-legacy-43a97fe494" key={line.rowId} >
      <select className="input" aria-label={`${uiText('Loại điều chỉnh hóa đơn')} ${index + 1}`} value={line.kind} onChange={(event) => update(index, { kind: event.target.value })}>
        <option value="charge">{uiText('Phí cộng thêm')}</option><option value="discount">{uiText('Chiết khấu')}</option>
      </select>
      <select className="input" aria-label={`${uiText('Cách hạch toán phí')} ${index + 1}`} value={line.allocation || 'expense'} onChange={(event) => update(index, { allocation: event.target.value, receipt_ids: [] })}>
        <option value="expense">{uiText('Chi phí 632')}</option><option value="landed_cost">{uiText('Vốn hóa vào hàng tồn')}</option>
      </select>
      {line.allocation === 'landed_cost' && <>
        <select className="input" aria-label={`${uiText('Căn cứ phân bổ phí')} ${index + 1}`} value={line.allocation_basis || 'value'} onChange={(event) => update(index, { allocation_basis: event.target.value })}>
          <option value="value">{uiText('Theo giá trị nhận')}</option><option value="quantity">{uiText('Theo số lượng nhận')}</option>
        </select>
        <select className="input" multiple size="2" aria-label={`${uiText('Phiếu nhận hàng chịu phí')} ${index + 1}`} value={line.receipt_ids || []} onChange={(event) => update(index, { receipt_ids: [...event.target.selectedOptions].map((option) => option.value) })}>
          {receipts.filter((receipt) => receipt.status === 'received').map((receipt) => <option key={receipt.id} value={receipt.id}>{fmtDate(receipt.created_at)} · {receipt.id.slice(0, 8)}</option>)}
        </select>
      </>}
      <input className="input grow" aria-label={`${uiText('Mô tả điều chỉnh hóa đơn')} ${index + 1}`} placeholder={uiText('Mô tả: vận chuyển, giảm giá...')} value={line.description} onChange={(event) => update(index, { description: event.target.value })} />
      <input className="input num u-legacy-5e96948257" aria-label={`${uiText('Số tiền điều chỉnh hóa đơn')} ${index + 1}`} type="number" min="0" step="any" placeholder={`${uiText('Số tiền')} (${currencyCode})`} value={line.amount} onChange={(event) => update(index, { amount: event.target.value })}  />
      <select className="input" aria-label={`${uiText('Thuế điều chỉnh hóa đơn')} ${index + 1}`} value={line.tax || ''} onChange={(event) => update(index, { tax: event.target.value })}>
        <option value="">{uiText('Không chịu thuế')}</option>{taxes.map((tax) => <option key={tax.id} value={tax.id}>{tax.name} · {tax.rate}%</option>)}
      </select>
      <button className="btn btn-ghost btn-sm" type="button" aria-label={`${uiText('Xóa điều chỉnh hóa đơn')} ${index + 1}`} onClick={() => onChange(lines.filter((_, i) => i !== index))}>{uiText('Xóa')}</button>
    </div>)}
    <button className="btn btn-ghost btn-sm u-legacy-43a97fe494" type="button"  onClick={() => onChange([...lines, { kind: 'charge', description: '', amount: '', tax: '', account_code: '632', allocation: 'expense', allocation_basis: 'value', receipt_ids: [] }])}>{uiText('Thêm phí/chiết khấu')}</button>
  </section>;
}
