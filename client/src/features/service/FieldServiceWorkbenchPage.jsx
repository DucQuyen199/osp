import React, { useMemo } from 'react';
import { useDocumentTitle } from '../../lib/useDocumentTitle.js';
import { fmtDateTime, fmtMoney, statusLabel, uiTextWith } from '../../lib/i18n.js';
import { can, recordLabel } from '../../lib/state.js';
import { compareDecimals } from '../../lib/decimal.js';
import fieldServiceEnglish from './field-service.en.js';
import FieldServiceWorkOrderQueue from './components/FieldServiceWorkOrderQueue.jsx';
import { fieldServiceLineTotal, fieldServiceStoredLineTotal, fieldServiceTotal } from './domain/fieldServiceTotals.js';
import { useFieldServiceData } from './hooks/useFieldServiceData.js';
import { useFieldServiceWorkflow } from './hooks/useFieldServiceWorkflow.js';
const t = (text) => uiTextWith(text, fieldServiceEnglish);
const lineTotal = fieldServiceLineTotal;
export default function FieldServiceWorkbenchPage() {
  useDocumentTitle(`${t('Điều phối dịch vụ hiện trường')} · OSP Suite`);
  const { orders, parties, products, units, warehouses, employees, invoices, tickets, loading, error, setError, load } = useFieldServiceData();
  const productChoices = [...products.values()].filter((item) => item.active !== false && ['goods', 'service', undefined].includes(item.kind)).sort((a, b) => String(a.name).localeCompare(String(b.name), 'vi'));
  const workflow = useFieldServiceWorkflow({ orders, parties, productChoices, load, setError, t });
  const {
    selectedId, setSelectedId, selected, form, setForm, editForm, setEditForm, newLines, editLines,
    busy, notice, updateForm, updateEditForm, updateNewLine, updateEditLine, removeNewLine, removeEditLine,
    addNewLine, addEditLine, createOrder, saveOpenOrder, transition,
  } = workflow;
  const unitsFor = (productId) => {
    const baseUnit = products.get(productId)?.uom;
    return baseUnit ? [...units.values()].filter((unit) => unit.id === baseUnit || unit.base_uom === baseUnit) : [];
  };
  const selectedInvoice = selected && invoices.find((item) => item.source === 'work_order' && item.source_id === selected.id);
  const hasTrackedNewLine = newLines.some((line) => {
    const product = products.get(line.product);
    return product && (product.tracked ?? product.kind === 'goods');
  });
  const newTotal = fieldServiceTotal(newLines, products, units);
  const editTotal = fieldServiceTotal(editLines, products, units);
  const hasTrackedEditLine = editLines.some((line) => {
    const product = products.get(line.product);
    return product && (product.tracked ?? product.kind === 'goods');
  });
  const openCount = orders.filter((order) => ['open', 'dispatched'].includes(order.status)).length;
  const selectedTicket = selected?.source_ticket && tickets.get(selected.source_ticket);
  const canManage = can('field-service.work_order.update');
  const assignedTechnician = (order) => {
    const employee = order?.technician_employee && employees.get(order.technician_employee);
    return employee ? recordLabel('hrm.employee', employee) : order?.technician || t('Chưa phân công');
  };
  const orderRows = orders.map((order) => ({
    id: order.id,
    title: order.title,
    customerLabel: parties.get(order.party) ? recordLabel('master-data.party', parties.get(order.party)) : t('Khách hàng'),
    address: order.address,
    scheduleLabel: order.scheduled_at ? fmtDateTime(order.scheduled_at) : t('Chưa xếp lịch'),
    technicianLabel: assignedTechnician(order),
    statusLabel: statusLabel(order.status),
  }));
  return <div className="page">
    <div className="page-head"><div><h1>{t('Điều phối dịch vụ hiện trường')}</h1><p className="sub">{t('Tiếp nhận việc, chốt vật tư và giá theo danh mục, xếp lịch kỹ thuật viên, xuất kho và lập hóa đơn khi hoàn tất.')}</p></div><button className="btn btn-secondary" type="button" disabled={loading || Boolean(busy)} onClick={() => load()}>{t('Làm mới')}</button></div>
    {error && <div className="alert danger" role="alert">{t(error)}</div>}{notice && <div className="alert success" role="status">{t(notice)}</div>}
    {can('field-service.work_order.create') && <section className="card card-pad"><h2>{t('Tạo lệnh công việc')}</h2><form className="form-grid" onSubmit={createOrder}>
      <label className="field"><span className="label">{t('Khách hàng *')}</span><select className="select" required value={form.party} onChange={(e) => updateForm('party', e.target.value)}><option value="">{t('Chọn khách hàng')}</option>{[...parties.values()].map((party) => <option key={party.id} value={party.id}>{recordLabel('master-data.party', party)}</option>)}</select></label>
      <label className="field"><span className="label">{t('Công việc *')}</span><input className="input" required value={form.title} onChange={(e) => updateForm('title', e.target.value)} /></label>
      <label className="field"><span className="label">{t('Địa chỉ thực hiện')}</span><input className="input" value={form.address} onChange={(e) => updateForm('address', e.target.value)} /></label>
      {can('hrm.employee.read') && <label className="field"><span className="label">{t('Nhân viên nội bộ')}</span><select className="select" value={form.technician_employee} onChange={(e) => setForm((current) => ({ ...current, technician_employee: e.target.value, technician: e.target.value ? '' : current.technician }))}><option value="">{t('Chọn nhân viên (hoặc nhà thầu)')}</option>{[...employees.values()].filter((employee) => employee.status === 'active').map((employee) => <option key={employee.id} value={employee.id}>{recordLabel('hrm.employee', employee)}</option>)}</select></label>}
      <label className="field"><span className="label">{t('Kỹ thuật viên / nhà thầu')} {!form.technician_employee && '*'}</span><input className="input" required={!form.technician_employee} disabled={Boolean(form.technician_employee)} value={form.technician} onChange={(e) => setForm((current) => ({ ...current, technician: e.target.value, technician_employee: e.target.value ? '' : current.technician_employee }))} /></label>
      <label className="field"><span className="label">{t('Bắt đầu *')}</span><input className="input" required type="datetime-local" value={form.scheduled_at} onChange={(e) => updateForm('scheduled_at', e.target.value)} /></label>
      <label className="field"><span className="label">{t('Kết thúc dự kiến *')}</span><input className="input" required type="datetime-local" min={form.scheduled_at} value={form.scheduled_end} onChange={(e) => updateForm('scheduled_end', e.target.value)} /></label>
      <label className="field"><span className="label">{t('Kho vật tư')}</span><select className="select" value={form.warehouse} onChange={(e) => updateForm('warehouse', e.target.value)}><option value="">{t('Chọn kho nếu có vật tư theo dõi tồn')}</option>{[...warehouses.values()].filter((item) => item.active !== false).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <div className="field full"><div className="row wrap"><strong>{t('Vật tư và dịch vụ')}</strong><span className="grow" /><button className="btn btn-secondary btn-sm" type="button" disabled={!productChoices.length} onClick={addNewLine}>{t('Thêm dòng')}</button></div>
        {newLines.map((line, index) => <div className="row wrap u-mt-8" key={line.rowId} ><select className="select" required value={line.product} onChange={(e) => updateNewLine(index, 'product', e.target.value)}><option value="">{t('Chọn vật tư / dịch vụ')}</option>{productChoices.map((item) => <option key={item.id} value={item.id}>{item.name} · {fmtMoney(item.price || 0)}</option>)}</select>{unitsFor(line.product).length > 0 && <select className="select" aria-label={t('Unit')} value={line.uom || products.get(line.product)?.uom || ''} onChange={(event) => updateNewLine(index, 'uom', event.target.value)}>{unitsFor(line.product).map((unit) => <option key={unit.id} value={unit.id}>{unit.name}{unit.base_uom ? ` (${unit.ratio} × ${t('base')})` : ` (${t('base')})`}</option>)}</select>}<input className="input num u-max-w-140" aria-label={t('Số lượng')} type="number" min="0.001" step="any" required value={line.qty} onChange={(e) => updateNewLine(index, 'qty', e.target.value)}  /><strong>{fmtMoney(lineTotal(line, products, units))}</strong><button className="btn btn-ghost btn-sm" type="button" aria-label={t('Xóa dòng')} onClick={() => removeNewLine(index)}>{t('Bỏ')}</button></div>)}
        <div className="row u-mt-10" ><span className="grow" /><strong>{t('Tổng dự kiến:')} {fmtMoney(newTotal)}</strong></div>
        {hasTrackedNewLine && !form.warehouse && <p className="small muted">{t('Cần chọn kho trước khi lưu lệnh có vật tư theo dõi tồn.')}</p>}
      </div>
      <div className="row full"><span className="grow" /><button className="btn btn-primary" disabled={Boolean(busy) || loading || !newLines.length || compareDecimals(newTotal, '0') <= 0 || (hasTrackedNewLine && !form.warehouse)}>{t('Tạo lệnh và báo giá')}</button></div>
    </form></section>}
    <div className="row wrap u-margin-18-0-10" ><h2>{t('Lệnh công việc')}</h2><span className="badge warning">{openCount} {t('đang xử lý')}</span></div>
    {loading ? <div className="skeleton" data-h="row" /> : !orders.length ? <div className="card card-pad empty">{t('Chưa có lệnh công việc.')}</div> : <div className="layout-split">
      <FieldServiceWorkOrderQueue orders={orderRows} selectedId={selectedId} onSelect={setSelectedId} t={t} />
      {selected && <section className="card card-pad"><div className="row wrap"><div><h2>{selected.title}</h2><div className="small muted">{parties.get(selected.party) ? recordLabel('master-data.party', parties.get(selected.party)) : t('Khách hàng')} · {selected.address || t('Chưa có địa chỉ')}</div></div><span className="grow" /><span className="badge warning">{statusLabel(selected.status)}</span></div>
        {selectedTicket && <p className="small muted">{t('Ticket nguồn:')} {selectedTicket.subject || selectedTicket.id}</p>}
        {selected.status === 'open' && canManage ? <>
          <div className="form-grid u-mt-12" >
            <label className="field"><span className="label">{t('Công việc')}</span><input className="input" value={editForm.title} onChange={(e) => updateEditForm('title', e.target.value)} /></label>
            <label className="field"><span className="label">{t('Địa chỉ')}</span><input className="input" value={editForm.address} onChange={(e) => updateEditForm('address', e.target.value)} /></label>
            {can('hrm.employee.read') && <label className="field"><span className="label">{t('Nhân viên nội bộ')}</span><select className="select" value={editForm.technician_employee} onChange={(e) => setEditForm((current) => ({ ...current, technician_employee: e.target.value, technician: e.target.value ? '' : current.technician }))}><option value="">{t('Chọn nhân viên (hoặc nhà thầu)')}</option>{[...employees.values()].filter((employee) => employee.status === 'active').map((employee) => <option key={employee.id} value={employee.id}>{recordLabel('hrm.employee', employee)}</option>)}</select></label>}
            <label className="field"><span className="label">{t('Kỹ thuật viên / nhà thầu')} {!editForm.technician_employee && '*'}</span><input className="input" required={!editForm.technician_employee} disabled={Boolean(editForm.technician_employee)} value={editForm.technician} onChange={(e) => setEditForm((current) => ({ ...current, technician: e.target.value, technician_employee: e.target.value ? '' : current.technician_employee }))} /></label>
            <label className="field"><span className="label">{t('Kho vật tư')}</span><select className="select" value={editForm.warehouse} onChange={(e) => updateEditForm('warehouse', e.target.value)}><option value="">{t('Chọn kho')}</option>{[...warehouses.values()].filter((item) => item.active !== false).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label className="field"><span className="label">{t('Bắt đầu *')}</span><input className="input" type="datetime-local" value={editForm.scheduled_at} onChange={(e) => updateEditForm('scheduled_at', e.target.value)} /></label>
            <label className="field"><span className="label">{t('Kết thúc *')}</span><input className="input" type="datetime-local" min={editForm.scheduled_at} value={editForm.scheduled_end} onChange={(e) => updateEditForm('scheduled_end', e.target.value)} /></label>
          </div>
          <div className="row wrap u-mt-14" ><h3>{t('Vật tư / dịch vụ')}</h3><span className="grow" /><button className="btn btn-secondary btn-sm" type="button" disabled={!productChoices.length} onClick={addEditLine}>{t('Thêm dòng')}</button></div>
          {editLines.map((line, index) => <div className="row wrap u-mt-8" key={line.rowId} ><select className="select" value={line.product} onChange={(e) => updateEditLine(index, 'product', e.target.value)}><option value="">{t('Chọn vật tư / dịch vụ')}</option>{productChoices.map((item) => <option key={item.id} value={item.id}>{item.name} · {fmtMoney(item.price || 0)}</option>)}</select>{unitsFor(line.product).length > 0 && <select className="select" aria-label={t('Unit')} value={line.uom || products.get(line.product)?.uom || ''} onChange={(event) => updateEditLine(index, 'uom', event.target.value)}>{unitsFor(line.product).map((unit) => <option key={unit.id} value={unit.id}>{unit.name}{unit.base_uom ? ` (${unit.ratio} × ${t('base')})` : ` (${t('base')})`}</option>)}</select>}<input className="input num u-max-w-140" aria-label={t('Số lượng')} type="number" min="0.001" step="any" value={line.qty} onChange={(e) => updateEditLine(index, 'qty', e.target.value)}  /><strong>{fmtMoney(lineTotal(line, products, units))}</strong><button className="btn btn-ghost btn-sm" type="button" aria-label={t('Xóa dòng')} onClick={() => removeEditLine(index)}>{t('Bỏ')}</button></div>)}
          <div className="row wrap u-mt-10" ><span className="grow" /><strong>{t('Tổng theo danh mục:')} {fmtMoney(editTotal)}</strong><button className="btn btn-secondary" type="button" disabled={Boolean(busy) || (hasTrackedEditLine && !editForm.warehouse)} onClick={() => saveOpenOrder(selected)}>{t('Lưu thay đổi')}</button></div>
        </> : <><p className="small muted">{assignedTechnician(selected)} · {selected.scheduled_at ? `${fmtDateTime(selected.scheduled_at)} – ${fmtDateTime(selected.scheduled_end)}` : t('Chưa có lịch')} · {t('Kho')} {warehouses.get(selected.warehouse)?.name || '—'}</p><div className="table-wrap"><table className="table"><thead><tr><th>{t('Vật tư / dịch vụ')}</th><th>{t('Số lượng')}</th><th>{t('Đơn giá đã chụp')}</th><th>{t('Thành tiền')}</th></tr></thead><tbody>{(selected.lines || []).map((line, index) => <tr key={`${line.product}-${index}`}><td>{line.product_name || products.get(line.product)?.name || t('Mục dịch vụ')}</td><td>{line.qty} {line.uom_name || units.get(line.uom)?.name || ''}</td><td>{fmtMoney(line.price || 0)}</td><td>{fmtMoney(fieldServiceStoredLineTotal(line))}</td></tr>)}</tbody><tfoot><tr><th colSpan="3">{t('Tổng cộng')}</th><th>{fmtMoney(selected.total || 0)}</th></tr></tfoot></table></div></>}
        {selectedInvoice && <p className="u-mt-12"><a className="btn btn-secondary btn-sm" href={`#/e/accounting/invoice/${selectedInvoice.id}`}>{t('Mở hóa đơn')} {statusLabel(selectedInvoice.status)}</a></p>}
        <div className="row wrap u-mt-14" >{selected.status === 'open' && can('field-service.work_order.dispatched') && <button className="btn btn-primary" disabled={Boolean(busy) || (!selected.technician_employee && !selected.technician?.trim()) || !selected.scheduled_at || !selected.scheduled_end || compareDecimals(selected.total || 0, '0') <= 0} onClick={() => transition(selected, 'dispatched')}>{t('Điều phối')}</button>}{selected.status === 'dispatched' && can('field-service.work_order.done') && <button className="btn btn-primary" disabled={Boolean(busy)} onClick={() => transition(selected, 'done')}>{t('Hoàn tất · xuất kho và lập hóa đơn')}</button>}{['open', 'dispatched'].includes(selected.status) && can('field-service.work_order.cancelled') && <button className="btn btn-ghost" disabled={Boolean(busy)} onClick={() => transition(selected, 'cancelled')}>{t('Hủy lệnh')}</button>}</div>
      </section>}
    </div>}
  </div>;
}
