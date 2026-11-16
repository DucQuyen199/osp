import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { selectableTableRowProps } from '../../lib/accessibility.js';
import { localDateTime as businessDateTime, localDateTimeToIso } from '../../lib/dates.js';
import { api, dataPath } from '../../lib/api.js';
import { fmtDateTime, fmtMoney, statusLabel } from '../../lib/i18n.js';
import { can, loadRefs, recordLabel, loadAllResponse } from '../../lib/state.js';

const localDateTime = (value) => value ? businessDateTime(new Date(value)) : '';
const futureSlot = (hours) => businessDateTime(new Date(Date.now() + hours * 3600000));
const itemsOf = (response) => Array.isArray(response?.items) ? response.items : [];
const lineTotal = (line, products, units) => (Number(line.qty) || 0) * (Number(products.get(line.product)?.price) || Number(line.price) || 0) * (units.get(line.uom || products.get(line.product)?.uom)?.ratio ?? line.uom_ratio ?? 1);

export default function FieldServiceWorkbenchPage() {
  const [orders, setOrders] = useState([]);
  const [parties, setParties] = useState(new Map());
  const [products, setProducts] = useState(new Map());
  const [units, setUnits] = useState(new Map());
  const [warehouses, setWarehouses] = useState(new Map());
  const [employees, setEmployees] = useState(new Map());
  const [invoices, setInvoices] = useState([]);
  const [tickets, setTickets] = useState(new Map());
  const [selectedId, setSelectedId] = useState('');
  const [form, setForm] = useState({ party: '', title: '', address: '', technician: '', technician_employee: '', scheduled_at: futureSlot(2), scheduled_end: futureSlot(3), warehouse: '' });
  const [editForm, setEditForm] = useState({ party: '', title: '', address: '', technician: '', technician_employee: '', scheduled_at: '', scheduled_end: '', warehouse: '' });
  const [newLines, setNewLines] = useState([]);
  const [editLines, setEditLines] = useState([]);
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async (quiet = false) => {
    if (!quiet) { setLoading(true); setError(''); }
    try {
      const showInvoices = can('accounting.invoice.read');
      const showTickets = can('helpdesk.ticket.read');
      const [orderResponse, partyMap, productMap, unitMap, warehouseMap, invoiceResponse, ticketResponse, employeeMap] = await Promise.all([
        loadAllResponse('field-service.work_order'), loadRefs('master-data.party'), loadRefs('master-data.product'),
        can('master-data.uom.read') ? loadRefs('master-data.uom') : Promise.resolve(new Map()),
        loadRefs('inventory.warehouse'),
        showInvoices ? loadAllResponse('accounting.invoice') : Promise.resolve({ items: [] }),
        showTickets ? loadAllResponse('helpdesk.ticket') : Promise.resolve({ items: [] }),
        can('hrm.employee.read') ? loadRefs('hrm.employee') : Promise.resolve(new Map()),
      ]);
      const nextOrders = itemsOf(orderResponse).sort((a, b) => String(b.scheduled_at || b.created_at || '').localeCompare(String(a.scheduled_at || a.created_at || '')));
      setOrders(nextOrders); setParties(partyMap); setProducts(productMap); setUnits(unitMap); setWarehouses(warehouseMap);
      setInvoices(itemsOf(invoiceResponse)); setTickets(new Map(itemsOf(ticketResponse).map((item) => [item.id, item]))); setEmployees(employeeMap);
      setSelectedId((current) => nextOrders.some((item) => item.id === current) ? current : nextOrders[0]?.id || '');
      setForm((current) => ({ ...current, party: current.party || [...partyMap.keys()][0] || '' }));
    } catch (reason) { setError(reason.message || 'Không tải được lệnh công việc.'); }
    finally { if (!quiet) setLoading(false); }
  }, []);

  useEffect(() => { document.title = 'Điều phối dịch vụ hiện trường · OSP Suite'; load(); }, [load]);
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
  const newTotal = newLines.reduce((sum, line) => sum + lineTotal(line, products, units), 0);
  const editTotal = editLines.reduce((sum, line) => sum + lineTotal(line, products, units), 0);
  const hasTrackedEditLine = editLines.some((line) => {
    const product = products.get(line.product);
    return product && (product.tracked ?? product.kind === 'goods');
  });
  const openCount = orders.filter((order) => ['open', 'dispatched'].includes(order.status)).length;

  useEffect(() => {
    if (!selected) return;
    setEditLines((selected.lines || []).map((line) => ({ product: line.product || '', uom: line.uom || '', qty: String(line.qty || 1), price: line.price })));
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
      if ((form.scheduled_at && !scheduledAt) || (form.scheduled_end && !scheduledEnd)) throw new Error('Giờ hẹn không hợp lệ trong múi giờ kinh doanh.');
      const created = await api(dataPath('field-service.work_order'), { method: 'POST', body: {
        party: form.party, title: form.title.trim(), address: form.address.trim() || undefined,
        technician: form.technician_employee ? undefined : form.technician.trim() || undefined,
        technician_employee: form.technician_employee || undefined,
        scheduled_at: scheduledAt,
        scheduled_end: scheduledEnd,
        warehouse: form.warehouse || undefined,
        lines: newLines.map((line) => ({ product: line.product, qty: Number(line.qty), ...(line.uom ? { uom: line.uom } : {}) })),
      } });
      setNotice(`Đã tạo lệnh ${String(created.id).slice(0, 8)}. Giá và trạng thái tồn được chụp từ danh mục.`);
      setForm((current) => ({ ...current, title: '', address: '', technician: '', technician_employee: '', warehouse: '' })); setNewLines([]); await load(true); setSelectedId(created.id);
    } catch (reason) { setError(reason.message || 'Không thể tạo lệnh công việc.'); }
    finally { setBusy(''); }
  }

  async function saveOpenOrder(order) {
    setBusy(`${order.id}:save`); setError(''); setNotice('');
    try {
      const scheduledAt = editForm.scheduled_at ? localDateTimeToIso(editForm.scheduled_at) : null;
      const scheduledEnd = editForm.scheduled_end ? localDateTimeToIso(editForm.scheduled_end) : null;
      if ((editForm.scheduled_at && !scheduledAt) || (editForm.scheduled_end && !scheduledEnd)) throw new Error('Giờ hẹn không hợp lệ trong múi giờ kinh doanh.');
      const body = {
        title: editForm.title.trim(), address: editForm.address.trim() || null,
        technician: editForm.technician_employee ? null : editForm.technician.trim() || null,
        technician_employee: editForm.technician_employee || null,
        scheduled_at: scheduledAt,
        scheduled_end: scheduledEnd,
        warehouse: editForm.warehouse || null,
        lines: editLines.map((line) => ({ product: line.product, qty: Number(line.qty), ...(line.uom ? { uom: line.uom } : {}) })),
      };
      await api(dataPath('field-service.work_order', order.id), { method: 'PATCH', body });
      setNotice('Đã lưu phân công, lịch hẹn và báo giá theo danh mục.'); await load(true);
    } catch (reason) { setError(reason.message || 'Không thể cập nhật lệnh.'); }
    finally { setBusy(''); }
  }

  async function transition(order, action) {
    setBusy(`${order.id}:${action}`); setError(''); setNotice('');
    try {
      await api(dataPath('field-service.work_order', order.id, action), { method: 'POST' });
      await load(true);
      const messages = { dispatched: 'Đã điều phối lệnh; lịch và người phụ trách đã được khóa.', done: 'Đã hoàn tất; hệ thống xuất vật tư và tạo hóa đơn.', cancelled: 'Đã hủy lệnh công việc.' };
      setNotice(messages[action]);
    } catch (reason) { setError(reason.message || 'Không thể cập nhật lệnh. Kiểm tra lịch, kho và tồn vật tư.'); await load(true); }
    finally { setBusy(''); }
  }

  const addNewLine = () => setNewLines((current) => [...current, { product: productChoices[0]?.id || '', qty: '1', uom: '' }]);
  const addEditLine = () => setEditLines((current) => [...current, { product: productChoices[0]?.id || '', qty: '1', uom: '' }]);
  const selectedTicket = selected?.source_ticket && tickets.get(selected.source_ticket);
  const canManage = can('field-service.work_order.update');
  const assignedTechnician = (order) => {
    const employee = order?.technician_employee && employees.get(order.technician_employee);
    return employee ? recordLabel('hrm.employee', employee) : order?.technician || 'Chưa phân công';
  };

  return <div className="page">
    <div className="page-head"><div><h1>Điều phối dịch vụ hiện trường</h1><p className="sub">Tiếp nhận việc, chốt vật tư và giá theo danh mục, xếp lịch kỹ thuật viên, xuất kho và lập hóa đơn khi hoàn tất.</p></div><button className="btn btn-secondary" type="button" disabled={loading || Boolean(busy)} onClick={() => load()}>Làm mới</button></div>
    {error && <div className="alert danger" role="alert">{error}</div>}{notice && <div className="alert success" role="status">{notice}</div>}

    {can('field-service.work_order.create') && <section className="card card-pad"><h2>Tạo lệnh công việc</h2><form className="form-grid" onSubmit={createOrder}>
      <label className="field"><span className="label">Khách hàng *</span><select className="select" required value={form.party} onChange={(e) => updateForm('party', e.target.value)}><option value="">Chọn khách hàng</option>{[...parties.values()].map((party) => <option key={party.id} value={party.id}>{recordLabel('master-data.party', party)}</option>)}</select></label>
      <label className="field"><span className="label">Công việc *</span><input className="input" required value={form.title} onChange={(e) => updateForm('title', e.target.value)} /></label>
      <label className="field"><span className="label">Địa chỉ thực hiện</span><input className="input" value={form.address} onChange={(e) => updateForm('address', e.target.value)} /></label>
      {can('hrm.employee.read') && <label className="field"><span className="label">Nhân viên nội bộ</span><select className="select" value={form.technician_employee} onChange={(e) => setForm((current) => ({ ...current, technician_employee: e.target.value, technician: e.target.value ? '' : current.technician }))}><option value="">Chọn nhân viên (hoặc nhà thầu)</option>{[...employees.values()].filter((employee) => employee.status === 'active').map((employee) => <option key={employee.id} value={employee.id}>{recordLabel('hrm.employee', employee)}</option>)}</select></label>}
      <label className="field"><span className="label">Kỹ thuật viên / nhà thầu {!form.technician_employee && '*'}</span><input className="input" required={!form.technician_employee} disabled={Boolean(form.technician_employee)} value={form.technician} onChange={(e) => setForm((current) => ({ ...current, technician: e.target.value, technician_employee: e.target.value ? '' : current.technician_employee }))} /></label>
      <label className="field"><span className="label">Bắt đầu *</span><input className="input" required type="datetime-local" value={form.scheduled_at} onChange={(e) => updateForm('scheduled_at', e.target.value)} /></label>
      <label className="field"><span className="label">Kết thúc dự kiến *</span><input className="input" required type="datetime-local" min={form.scheduled_at} value={form.scheduled_end} onChange={(e) => updateForm('scheduled_end', e.target.value)} /></label>
      <label className="field"><span className="label">Kho vật tư</span><select className="select" value={form.warehouse} onChange={(e) => updateForm('warehouse', e.target.value)}><option value="">Chọn kho nếu có vật tư theo dõi tồn</option>{[...warehouses.values()].filter((item) => item.active !== false).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <div className="field full"><div className="row wrap"><strong>Vật tư và dịch vụ</strong><span className="grow" /><button className="btn btn-secondary btn-sm" type="button" disabled={!productChoices.length} onClick={addNewLine}>Thêm dòng</button></div>
        {newLines.map((line, index) => <div className="row wrap" key={index} style={{ marginTop: 8 }}><select className="select" required value={line.product} onChange={(e) => updateNewLine(index, 'product', e.target.value)}><option value="">Chọn vật tư / dịch vụ</option>{productChoices.map((item) => <option key={item.id} value={item.id}>{item.name} · {fmtMoney(item.price || 0)}</option>)}</select>{unitsFor(line.product).length > 0 && <select className="select" aria-label="Unit" value={line.uom || products.get(line.product)?.uom || ''} onChange={(event) => updateNewLine(index, 'uom', event.target.value)}>{unitsFor(line.product).map((unit) => <option key={unit.id} value={unit.id}>{unit.name}{unit.base_uom ? ' (' + unit.ratio + ' x base)' : ' (base)'}</option>)}</select>}<input className="input num" aria-label="Số lượng" type="number" min="0.001" step="any" required value={line.qty} onChange={(e) => updateNewLine(index, 'qty', e.target.value)} style={{ maxWidth: 140 }} /><strong>{fmtMoney(lineTotal(line, products, units))}</strong><button className="btn btn-ghost btn-sm" type="button" aria-label="Xóa dòng" onClick={() => setNewLines((current) => current.filter((_, i) => i !== index))}>Bỏ</button></div>)}
        <div className="row" style={{ marginTop: 10 }}><span className="grow" /><strong>Tổng dự kiến: {fmtMoney(newTotal)}</strong></div>
        {hasTrackedNewLine && !form.warehouse && <p className="small muted">Cần chọn kho trước khi lưu lệnh có vật tư theo dõi tồn.</p>}
      </div>
      <div className="row full"><span className="grow" /><button className="btn btn-primary" disabled={Boolean(busy) || loading || !newLines.length || newTotal <= 0 || (hasTrackedNewLine && !form.warehouse)}>Tạo lệnh và báo giá</button></div>
    </form></section>}

    <div className="row wrap" style={{ margin: '18px 0 10px' }}><h2>Lệnh công việc</h2><span className="badge warning">{openCount} đang xử lý</span></div>
    {loading ? <div className="skeleton" data-h="row" /> : !orders.length ? <div className="card card-pad empty">Chưa có lệnh công việc.</div> : <div className="layout-split">
      <section className="card card-pad"><div className="table-wrap"><table className="table"><thead><tr><th>Công việc</th><th>Lịch</th><th>Kỹ thuật viên</th><th>Trạng thái</th></tr></thead><tbody>{orders.map((order) => <tr {...selectableTableRowProps} key={order.id} className={selectedId === order.id ? 'selected' : ''} onClick={() => setSelectedId(order.id)} style={{ cursor: 'pointer' }}><td><strong>{order.title}</strong><div className="small muted">{parties.get(order.party) ? recordLabel('master-data.party', parties.get(order.party)) : 'Khách hàng'}{order.address ? ` · ${order.address}` : ''}</div></td><td>{order.scheduled_at ? fmtDateTime(order.scheduled_at) : 'Chưa xếp lịch'}</td><td>{assignedTechnician(order)}</td><td>{statusLabel(order.status)}</td></tr>)}</tbody></table></div></section>
      {selected && <section className="card card-pad"><div className="row wrap"><div><h2>{selected.title}</h2><div className="small muted">{parties.get(selected.party) ? recordLabel('master-data.party', parties.get(selected.party)) : 'Khách hàng'} · {selected.address || 'Chưa có địa chỉ'}</div></div><span className="grow" /><span className="badge warning">{statusLabel(selected.status)}</span></div>
        {selectedTicket && <p className="small muted">Ticket nguồn: {selectedTicket.subject || selectedTicket.id}</p>}
        {selected.status === 'open' && canManage ? <>
          <div className="form-grid" style={{ marginTop: 12 }}>
            <label className="field"><span className="label">Công việc</span><input className="input" value={editForm.title} onChange={(e) => updateEditForm('title', e.target.value)} /></label>
            <label className="field"><span className="label">Địa chỉ</span><input className="input" value={editForm.address} onChange={(e) => updateEditForm('address', e.target.value)} /></label>
            {can('hrm.employee.read') && <label className="field"><span className="label">Nhân viên nội bộ</span><select className="select" value={editForm.technician_employee} onChange={(e) => setEditForm((current) => ({ ...current, technician_employee: e.target.value, technician: e.target.value ? '' : current.technician }))}><option value="">Chọn nhân viên (hoặc nhà thầu)</option>{[...employees.values()].filter((employee) => employee.status === 'active').map((employee) => <option key={employee.id} value={employee.id}>{recordLabel('hrm.employee', employee)}</option>)}</select></label>}
            <label className="field"><span className="label">Kỹ thuật viên / nhà thầu {!editForm.technician_employee && '*'}</span><input className="input" required={!editForm.technician_employee} disabled={Boolean(editForm.technician_employee)} value={editForm.technician} onChange={(e) => setEditForm((current) => ({ ...current, technician: e.target.value, technician_employee: e.target.value ? '' : current.technician_employee }))} /></label>
            <label className="field"><span className="label">Kho vật tư</span><select className="select" value={editForm.warehouse} onChange={(e) => updateEditForm('warehouse', e.target.value)}><option value="">Chọn kho</option>{[...warehouses.values()].filter((item) => item.active !== false).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label className="field"><span className="label">Bắt đầu *</span><input className="input" type="datetime-local" value={editForm.scheduled_at} onChange={(e) => updateEditForm('scheduled_at', e.target.value)} /></label>
            <label className="field"><span className="label">Kết thúc *</span><input className="input" type="datetime-local" min={editForm.scheduled_at} value={editForm.scheduled_end} onChange={(e) => updateEditForm('scheduled_end', e.target.value)} /></label>
          </div>
          <div className="row wrap" style={{ marginTop: 14 }}><h3>Vật tư / dịch vụ</h3><span className="grow" /><button className="btn btn-secondary btn-sm" type="button" disabled={!productChoices.length} onClick={addEditLine}>Thêm dòng</button></div>
          {editLines.map((line, index) => <div className="row wrap" key={index} style={{ marginTop: 8 }}><select className="select" value={line.product} onChange={(e) => updateEditLine(index, 'product', e.target.value)}><option value="">Chọn vật tư / dịch vụ</option>{productChoices.map((item) => <option key={item.id} value={item.id}>{item.name} · {fmtMoney(item.price || 0)}</option>)}</select>{unitsFor(line.product).length > 0 && <select className="select" aria-label="Unit" value={line.uom || products.get(line.product)?.uom || ''} onChange={(event) => updateEditLine(index, 'uom', event.target.value)}>{unitsFor(line.product).map((unit) => <option key={unit.id} value={unit.id}>{unit.name}{unit.base_uom ? ' (' + unit.ratio + ' x base)' : ' (base)'}</option>)}</select>}<input className="input num" aria-label="Số lượng" type="number" min="0.001" step="any" value={line.qty} onChange={(e) => updateEditLine(index, 'qty', e.target.value)} style={{ maxWidth: 140 }} /><strong>{fmtMoney(lineTotal(line, products, units))}</strong><button className="btn btn-ghost btn-sm" type="button" aria-label="Xóa dòng" onClick={() => setEditLines((current) => current.filter((_, i) => i !== index))}>Bỏ</button></div>)}
          <div className="row wrap" style={{ marginTop: 10 }}><span className="grow" /><strong>Tổng theo danh mục: {fmtMoney(editTotal)}</strong><button className="btn btn-secondary" type="button" disabled={Boolean(busy) || (hasTrackedEditLine && !editForm.warehouse)} onClick={() => saveOpenOrder(selected)}>Lưu thay đổi</button></div>
        </> : <><p className="small muted">{assignedTechnician(selected)} · {selected.scheduled_at ? `${fmtDateTime(selected.scheduled_at)} – ${fmtDateTime(selected.scheduled_end)}` : 'Chưa có lịch'} · Kho {warehouses.get(selected.warehouse)?.name || '—'}</p><div className="table-wrap"><table className="table"><thead><tr><th>Vật tư / dịch vụ</th><th>Số lượng</th><th>Đơn giá đã chụp</th><th>Thành tiền</th></tr></thead><tbody>{(selected.lines || []).map((line, index) => <tr key={`${line.product}-${index}`}><td>{line.product_name || products.get(line.product)?.name || 'Mục dịch vụ'}</td><td>{line.qty} {line.uom_name || units.get(line.uom)?.name || ''}</td><td>{fmtMoney(line.price || 0)}</td><td>{fmtMoney(Number(line.qty || 0) * Number(line.price || 0))}</td></tr>)}</tbody><tfoot><tr><th colSpan="3">Tổng cộng</th><th>{fmtMoney(selected.total || 0)}</th></tr></tfoot></table></div></>}
        {selectedInvoice && <p style={{ marginTop: 12 }}><a className="btn btn-secondary btn-sm" href={`#/e/accounting/invoice/${selectedInvoice.id}`}>Mở hóa đơn {statusLabel(selectedInvoice.status)}</a></p>}
        <div className="row wrap" style={{ marginTop: 14 }}>{selected.status === 'open' && can('field-service.work_order.dispatched') && <button className="btn btn-primary" disabled={Boolean(busy) || (!selected.technician_employee && !selected.technician?.trim()) || !selected.scheduled_at || !selected.scheduled_end || Number(selected.total) <= 0} onClick={() => transition(selected, 'dispatched')}>Điều phối</button>}{selected.status === 'dispatched' && can('field-service.work_order.done') && <button className="btn btn-primary" disabled={Boolean(busy)} onClick={() => transition(selected, 'done')}>Hoàn tất · xuất kho và lập hóa đơn</button>}{['open', 'dispatched'].includes(selected.status) && can('field-service.work_order.cancelled') && <button className="btn btn-ghost" disabled={Boolean(busy)} onClick={() => transition(selected, 'cancelled')}>Hủy lệnh</button>}</div>
      </section>}
    </div>}
  </div>;
}
