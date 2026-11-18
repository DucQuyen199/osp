import React, { useEffect, useMemo, useState } from 'react';
import { useDocumentTitle } from '../../lib/useDocumentTitle.js';
import { selectableTableRowProps } from '../../lib/accessibility.js';
import { localDateTime as businessDateTime, localDateTimeToIso } from '../../lib/dates.js';
import { api, dataPath } from '../../lib/api.js';
import { fmtDateTime, fmtMoney, statusLabel, uiTextWith } from '../../lib/i18n.js';
import { can, recordLabel } from '../../lib/state.js';
import { compareDecimals } from '../../lib/decimal.js';
import fieldServiceEnglish from './field-service.en.js';
import { fieldServiceLineTotal, fieldServiceStoredLineTotal, fieldServiceTotal } from './domain/fieldServiceTotals.js';
import { useFieldServiceData } from './hooks/useFieldServiceData.js';
const t = (text) => uiTextWith(text, fieldServiceEnglish);
const localDateTime = (value) => value ? businessDateTime(new Date(value)) : '';
const futureSlot = (hours) => businessDateTime(new Date(Date.now() + hours * 3600000));
const lineTotal = fieldServiceLineTotal;
export default function FieldServiceWorkbenchPage() {
  useDocumentTitle(`${t('Điều phối dịch vụ hiện trường')} · OSP Suite`);
  const { orders, parties, products, units, warehouses, employees, invoices, tickets, loading, error, setError, load } = useFieldServiceData();
  const [selectedId, setSelectedId] = useState('');
  const [form, setForm] = useState({ party: '', title: '', address: '', technician: '', technician_employee: '', scheduled_at: futureSlot(2), scheduled_end: futureSlot(3), warehouse: '' });
  const [editForm, setEditForm] = useState({ party: '', title: '', address: '', technician: '', technician_employee: '', scheduled_at: '', scheduled_end: '', warehouse: '' });
  const [newLines, setNewLines] = useState([]);
  const [editLines, setEditLines] = useState([]);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => { setSelectedId((current) => orders.some((item) => item.id === current) ? current : orders[0]?.id || ''); }, [orders]);
  useEffect(() => { setForm((current) => ({ ...current, party: current.party || [...parties.keys()][0] || '' })); }, [parties]);
  const selected = orders.find((order) => order.id === selectedId);
  const productChoices = [...products.values()].filter((item) => item.active !== false && ['goods', 'service', undefined].includes(item.kind)).sort((a, b) => String(a.name).localeCompare(String(b.name), 'vi'));
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
  useEffect(() => {
    if (!selected) return;
    setEditLines((selected.lines || []).map((line) => ({ rowId: crypto.randomUUID(), product: line.product || '', uom: line.uom || '', qty: String(line.qty || 1), price: line.price })));
    setEditForm((current) => ({
      ...current,
      party: selected.party || '', title: selected.title || '', address: selected.address || '', technician: selected.technician || '', technician_employee: selected.technician_employee || '',
      scheduled_at: localDateTime(selected.scheduled_at), scheduled_end: localDateTime(selected.scheduled_end), warehouse: selected.warehouse || '',
    }));
  }, [selectedId]);
  function updateForm(field, value) { setForm((current) => ({ ...current, [field]: value })); }
  function updateEditForm(field, value) { setEditForm((current) => ({ ...current, [field]: value })); }
  function updateNewLine(index, field, value) { setNewLines((current) => current.map((line, i) => i === index ? { ...line, [field]: value, ...(field === 'product' ? { uom: '' } : {}) } : line)); }
  function updateEditLine(index, field, value) { setEditLines((current) => current.map((line, i) => i === index ? { ...line, [field]: value, ...(field === 'product' ? { uom: '' } : {}) } : line)); }
  async function createOrder(event) {
    event.preventDefault(); setBusy('create'); setError(''); setNotice('');
    try {
      const scheduledAt = form.scheduled_at ? localDateTimeToIso(form.scheduled_at) : undefined;
      const scheduledEnd = form.scheduled_end ? localDateTimeToIso(form.scheduled_end) : undefined;
      if ((form.scheduled_at && !scheduledAt) || (form.scheduled_end && !scheduledEnd)) throw new Error(t('Giờ hẹn không hợp lệ trong múi giờ kinh doanh.'));
      const created = await api(dataPath('field-service.work_order'), { method: 'POST', body: {
        party: form.party, title: form.title.trim(), address: form.address.trim() || undefined,
        technician: form.technician_employee ? undefined : form.technician.trim() || undefined,
        technician_employee: form.technician_employee || undefined,
        scheduled_at: scheduledAt,
        scheduled_end: scheduledEnd,
        warehouse: form.warehouse || undefined,
        lines: newLines.map((line) => ({ product: line.product, qty: String(line.qty), ...(line.uom ? { uom: line.uom } : {}) })),
      } });
      setNotice(`${t('Đã tạo lệnh')} ${String(created.id).slice(0, 8)}${t('. Giá và trạng thái tồn được chụp từ danh mục.')}`);
      setForm((current) => ({ ...current, title: '', address: '', technician: '', technician_employee: '', warehouse: '' })); setNewLines([]); await load(true); setSelectedId(created.id);
    } catch (reason) { setError(reason.message || t('Không thể tạo lệnh công việc.')); }
    finally { setBusy(''); }
  }
  async function saveOpenOrder(order) {
    setBusy(`${order.id}:save`); setError(''); setNotice('');
    try {
      const scheduledAt = editForm.scheduled_at ? localDateTimeToIso(editForm.scheduled_at) : null;
      const scheduledEnd = editForm.scheduled_end ? localDateTimeToIso(editForm.scheduled_end) : null;
      if ((editForm.scheduled_at && !scheduledAt) || (editForm.scheduled_end && !scheduledEnd)) throw new Error(t('Giờ hẹn không hợp lệ trong múi giờ kinh doanh.'));
      const body = {
        title: editForm.title.trim(), address: editForm.address.trim() || null,
        technician: editForm.technician_employee ? null : editForm.technician.trim() || null,
        technician_employee: editForm.technician_employee || null,
        scheduled_at: scheduledAt,
        scheduled_end: scheduledEnd,
        warehouse: editForm.warehouse || null,
        lines: editLines.map((line) => ({ product: line.product, qty: String(line.qty), ...(line.uom ? { uom: line.uom } : {}) })),
      };
      await api(dataPath('field-service.work_order', order.id), { method: 'PATCH', body });
      setNotice(t('Đã lưu phân công, lịch hẹn và báo giá theo danh mục.')); await load(true);
    } catch (reason) { setError(reason.message || t('Không thể cập nhật lệnh.')); }
    finally { setBusy(''); }
  }
  async function transition(order, action) {
    setBusy(`${order.id}:${action}`); setError(''); setNotice('');
    try {
      await api(dataPath('field-service.work_order', order.id, action), { method: 'POST' });
      await load(true);
      const messages = { dispatched: 'Đã điều phối lệnh; lịch và người phụ trách đã được khóa.', done: 'Đã hoàn tất; hệ thống xuất vật tư và tạo hóa đơn.', cancelled: 'Đã hủy lệnh công việc.' };
      setNotice(t(messages[action]));
    } catch (reason) { setError(reason.message || t('Không thể cập nhật lệnh. Kiểm tra lịch, kho và tồn vật tư.')); await load(true); }
    finally { setBusy(''); }
  }
  const addNewLine = () => setNewLines((current) => [...current, { rowId: crypto.randomUUID(), product: productChoices[0]?.id || '', qty: '1', uom: '' }]);
  const addEditLine = () => setEditLines((current) => [...current, { rowId: crypto.randomUUID(), product: productChoices[0]?.id || '', qty: '1', uom: '' }]);
  const selectedTicket = selected?.source_ticket && tickets.get(selected.source_ticket);
  const canManage = can('field-service.work_order.update');
  const assignedTechnician = (order) => {
    const employee = order?.technician_employee && employees.get(order.technician_employee);
    return employee ? recordLabel('hrm.employee', employee) : order?.technician || t('Chưa phân công');
  };
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
        {newLines.map((line, index) => <div className="row wrap u-mt-8" key={line.rowId} ><select className="select" required value={line.product} onChange={(e) => updateNewLine(index, 'product', e.target.value)}><option value="">{t('Chọn vật tư / dịch vụ')}</option>{productChoices.map((item) => <option key={item.id} value={item.id}>{item.name} · {fmtMoney(item.price || 0)}</option>)}</select>{unitsFor(line.product).length > 0 && <select className="select" aria-label={t('Unit')} value={line.uom || products.get(line.product)?.uom || ''} onChange={(event) => updateNewLine(index, 'uom', event.target.value)}>{unitsFor(line.product).map((unit) => <option key={unit.id} value={unit.id}>{unit.name}{unit.base_uom ? ` (${unit.ratio} × ${t('base')})` : ` (${t('base')})`}</option>)}</select>}<input className="input num u-max-w-140" aria-label={t('Số lượng')} type="number" min="0.001" step="any" required value={line.qty} onChange={(e) => updateNewLine(index, 'qty', e.target.value)}  /><strong>{fmtMoney(lineTotal(line, products, units))}</strong><button className="btn btn-ghost btn-sm" type="button" aria-label={t('Xóa dòng')} onClick={() => setNewLines((current) => current.filter((_, i) => i !== index))}>{t('Bỏ')}</button></div>)}
        <div className="row u-mt-10" ><span className="grow" /><strong>{t('Tổng dự kiến:')} {fmtMoney(newTotal)}</strong></div>
        {hasTrackedNewLine && !form.warehouse && <p className="small muted">{t('Cần chọn kho trước khi lưu lệnh có vật tư theo dõi tồn.')}</p>}
      </div>
      <div className="row full"><span className="grow" /><button className="btn btn-primary" disabled={Boolean(busy) || loading || !newLines.length || compareDecimals(newTotal, '0') <= 0 || (hasTrackedNewLine && !form.warehouse)}>{t('Tạo lệnh và báo giá')}</button></div>
    </form></section>}
    <div className="row wrap u-margin-18-0-10" ><h2>{t('Lệnh công việc')}</h2><span className="badge warning">{openCount} {t('đang xử lý')}</span></div>
    {loading ? <div className="skeleton" data-h="row" /> : !orders.length ? <div className="card card-pad empty">{t('Chưa có lệnh công việc.')}</div> : <div className="layout-split">
      <section className="card card-pad"><div className="table-wrap"><table className="table"><thead><tr><th>{t('Công việc')}</th><th>{t('Lịch')}</th><th>{t('Kỹ thuật viên')}</th><th>{t('Trạng thái')}</th></tr></thead><tbody>{orders.map((order) => <tr {...selectableTableRowProps} key={order.id} aria-selected={selectedId === order.id} className={[selectedId === order.id ? 'selected' : '', 'u-pointer'].filter(Boolean).join(' ')} onClick={() => setSelectedId(order.id)} ><td><strong>{order.title}</strong><div className="small muted">{parties.get(order.party) ? recordLabel('master-data.party', parties.get(order.party)) : t('Khách hàng')}{order.address ? ` · ${order.address}` : ''}</div></td><td>{order.scheduled_at ? fmtDateTime(order.scheduled_at) : t('Chưa xếp lịch')}</td><td>{assignedTechnician(order)}</td><td>{statusLabel(order.status)}</td></tr>)}</tbody></table></div></section>
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
          {editLines.map((line, index) => <div className="row wrap u-mt-8" key={line.rowId} ><select className="select" value={line.product} onChange={(e) => updateEditLine(index, 'product', e.target.value)}><option value="">{t('Chọn vật tư / dịch vụ')}</option>{productChoices.map((item) => <option key={item.id} value={item.id}>{item.name} · {fmtMoney(item.price || 0)}</option>)}</select>{unitsFor(line.product).length > 0 && <select className="select" aria-label={t('Unit')} value={line.uom || products.get(line.product)?.uom || ''} onChange={(event) => updateEditLine(index, 'uom', event.target.value)}>{unitsFor(line.product).map((unit) => <option key={unit.id} value={unit.id}>{unit.name}{unit.base_uom ? ` (${unit.ratio} × ${t('base')})` : ` (${t('base')})`}</option>)}</select>}<input className="input num u-max-w-140" aria-label={t('Số lượng')} type="number" min="0.001" step="any" value={line.qty} onChange={(e) => updateEditLine(index, 'qty', e.target.value)}  /><strong>{fmtMoney(lineTotal(line, products, units))}</strong><button className="btn btn-ghost btn-sm" type="button" aria-label={t('Xóa dòng')} onClick={() => setEditLines((current) => current.filter((_, i) => i !== index))}>{t('Bỏ')}</button></div>)}
          <div className="row wrap u-mt-10" ><span className="grow" /><strong>{t('Tổng theo danh mục:')} {fmtMoney(editTotal)}</strong><button className="btn btn-secondary" type="button" disabled={Boolean(busy) || (hasTrackedEditLine && !editForm.warehouse)} onClick={() => saveOpenOrder(selected)}>{t('Lưu thay đổi')}</button></div>
        </> : <><p className="small muted">{assignedTechnician(selected)} · {selected.scheduled_at ? `${fmtDateTime(selected.scheduled_at)} – ${fmtDateTime(selected.scheduled_end)}` : t('Chưa có lịch')} · {t('Kho')} {warehouses.get(selected.warehouse)?.name || '—'}</p><div className="table-wrap"><table className="table"><thead><tr><th>{t('Vật tư / dịch vụ')}</th><th>{t('Số lượng')}</th><th>{t('Đơn giá đã chụp')}</th><th>{t('Thành tiền')}</th></tr></thead><tbody>{(selected.lines || []).map((line, index) => <tr key={`${line.product}-${index}`}><td>{line.product_name || products.get(line.product)?.name || t('Mục dịch vụ')}</td><td>{line.qty} {line.uom_name || units.get(line.uom)?.name || ''}</td><td>{fmtMoney(line.price || 0)}</td><td>{fmtMoney(fieldServiceStoredLineTotal(line))}</td></tr>)}</tbody><tfoot><tr><th colSpan="3">{t('Tổng cộng')}</th><th>{fmtMoney(selected.total || 0)}</th></tr></tfoot></table></div></>}
        {selectedInvoice && <p className="u-mt-12"><a className="btn btn-secondary btn-sm" href={`#/e/accounting/invoice/${selectedInvoice.id}`}>{t('Mở hóa đơn')} {statusLabel(selectedInvoice.status)}</a></p>}
        <div className="row wrap u-mt-14" >{selected.status === 'open' && can('field-service.work_order.dispatched') && <button className="btn btn-primary" disabled={Boolean(busy) || (!selected.technician_employee && !selected.technician?.trim()) || !selected.scheduled_at || !selected.scheduled_end || compareDecimals(selected.total || 0, '0') <= 0} onClick={() => transition(selected, 'dispatched')}>{t('Điều phối')}</button>}{selected.status === 'dispatched' && can('field-service.work_order.done') && <button className="btn btn-primary" disabled={Boolean(busy)} onClick={() => transition(selected, 'done')}>{t('Hoàn tất · xuất kho và lập hóa đơn')}</button>}{['open', 'dispatched'].includes(selected.status) && can('field-service.work_order.cancelled') && <button className="btn btn-ghost" disabled={Boolean(busy)} onClick={() => transition(selected, 'cancelled')}>{t('Hủy lệnh')}</button>}</div>
      </section>}
    </div>}
  </div>;
}
