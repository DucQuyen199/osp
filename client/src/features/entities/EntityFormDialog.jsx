import React, { useEffect, useMemo, useRef, useState } from 'react';
import { localDateTime as businessDateTime, localDateTimeToIso } from '../../lib/dates.js';
import { ApiError, api, dataPath } from '../../lib/api.js';
import { toast } from '../../lib/feedback.js';
import { uiText } from '../../lib/i18n.js';
import {
  can, entity, entityLabel, fieldLabelOf, invalidateRefs, loadRefs,
} from '../../lib/state.js';
import EntityFieldControl from './components/EntityFieldControl.jsx';
import EntityFormView from './components/EntityFormView.jsx';

const SYSTEM_MANAGED_FIELDS = {
  'events.event': ['ticket_tax_rate', 'ticket_tax_name'],
  'events.ticket': ['price', 'tax_rate', 'tax_name', 'tax_amount', 'net_amount'],
  'accounting.payment': ['tax_rate', 'tax_name', 'tax_amount'],
};

function toLocalInput(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return businessDateTime(date);
}

export default function EntityFormDialog({ qname, record, onClose, onSaved }) {
  const definition = entity(qname);
  const editing = Boolean(record);
  const dialog = useRef(null);
  const inputRefs = useRef({});
  const fields = useMemo(() => definition?.fields.filter((field) => field.name !== definition.states?.field && !definition.computed[field.name] && !field.system) || [], [definition]);
  const computed = definition?.fields.filter((field) => definition.computed[field.name]) || [];
  const [values, setValues] = useState(() => Object.fromEntries(fields.map((field) => [field.name, record?.[field.name]])));
  const [references, setReferences] = useState({});
  const [errors, setErrors] = useState({});
  const [generalErrors, setGeneralErrors] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const node = dialog.current;
    if (node && !node.open) node.showModal();
    node?.querySelector('input:not([type=checkbox]), select, textarea')?.focus();
    return () => { if (node?.open) node.close(); };
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([...new Set(fields.filter((field) => field.type === 'ref').map((field) => field.ref))]
      .filter((ref) => can(`${ref}.read`))
      .map(async (ref) => [ref, await loadRefs(ref).catch(() => new Map())]))
      .then((entries) => { if (active) setReferences(Object.fromEntries(entries)); });
    return () => { active = false; };
  }, [fields]);

  const close = () => { dialog.current?.close(); onClose?.(); };
  const setValue = (name, value) => setValues((current) => ({ ...current, [name]: value }));
  const clearErrors = () => { setErrors({}); setGeneralErrors([]); };
  const showErrors = (messages) => {
    const fieldErrors = {};
    const otherErrors = [];
    for (const message of messages) {
      const field = fields.find((candidate) => new RegExp(`(^|[:;\\s])${candidate.name}(\\s|:|$)`).test(message));
      if (field) fieldErrors[field.name] = message.replace(new RegExp(`\\b${field.name}\\b`), fieldLabelOf(qname, field.name));
      else otherErrors.push(message);
    }
    setErrors(fieldErrors);
    setGeneralErrors(otherErrors.length ? otherErrors : (messages.length && !Object.keys(fieldErrors).length ? messages : []));
    const first = fields.find((field) => fieldErrors[field.name]);
    if (first) inputRefs.current[first.name]?.focus();
  };

  const fieldValue = (field) => {
    if (field.type === 'datetime') return toLocalInput(values[field.name]);
    if (field.type === 'json' && !(field.name === 'lines'
      || field.name === 'adjustment_lines'
      || (field.name === 'lines' && qname === 'inventory.stock_transfer'))) {
      const value = values[field.name];
      return value == null ? '' : typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    }
    return values[field.name] ?? (field.type === 'bool' ? false : '');
  };

  const readField = (field) => {
    const value = values[field.name];
    if (field.type === 'money') return value === '' || value == null ? undefined : String(value);
    if (field.type === 'number') return value === '' || value == null ? undefined : Number(value);
    if (field.type === 'datetime') {
      if (!value) return undefined;
      const instant = localDateTimeToIso(value);
      if (!instant) throw new Error(`${fieldLabelOf(qname, field.name)}: giờ không hợp lệ trong múi giờ kinh doanh`);
      return instant;
    }
    if (field.type === 'json') {
      if (field.name === 'lines') {
        const rows = Array.isArray(value) ? value : [];
        if (qname === 'accounting.journal_entry') {
          const populated = rows.filter((row) => row.account || row.debit || row.credit);
          return populated.length ? populated : undefined;
        }
        const populated = rows.filter((row) => row.product || row.qty || row.price);
        return populated.length ? populated : undefined;
      }
      if (field.name === 'adjustment_lines') {
        const rows = Array.isArray(value) ? value : [];
        const populated = rows.filter((row) => row.product || row.counted_qty || row.qty || row.lot || row.location || row.direction);
        return populated.length ? populated : undefined;
      }
      if (value == null || value === '') return undefined;
      try { return typeof value === 'string' ? JSON.parse(value) : value; }
      catch { throw new Error(`${fieldLabelOf(qname, field.name)}: không phải JSON hợp lệ`); }
    }
    if (field.type === 'bool') return Boolean(value);
    if (field.type === 'string' || field.type === 'text') return String(value || '').trim() || undefined;
    return value === '' || value == null ? undefined : value;
  };

  const save = async (event) => {
    event.preventDefault();
    clearErrors();
    const payload = {};
    try {
      for (const field of fields) {
        if (SYSTEM_MANAGED_FIELDS[qname]?.includes(field.name)) continue;
        const value = readField(field);
        if (editing) payload[field.name] = value === undefined ? null : value;
        else if (value !== undefined) payload[field.name] = value;
      }
    } catch (reason) {
      showErrors([reason.message]);
      return;
    }
    setSaving(true);
    try {
      const saved = editing
        ? await api(dataPath(qname, record.id), { method: 'PATCH', body: payload })
        : await api(dataPath(qname), { method: 'POST', body: payload });
      invalidateRefs(qname);
      toast(editing ? uiText('Đã lưu thay đổi.') : uiText('Đã tạo {entity}.').replace('{entity}', uiText(entityLabel(qname).toLowerCase())), 'success');
      dialog.current?.close();
      onSaved?.(saved);
    } catch (reason) {
      if (reason instanceof ApiError && Array.isArray(reason.details)) showErrors(reason.details);
      else showErrors([reason.message || 'Không lưu được dữ liệu.']);
    } finally {
      setSaving(false);
    }
  };

  const title = `${uiText(editing ? 'Sửa' : 'Tạo')} ${uiText(entityLabel(qname)).toLowerCase()}`;
  return <dialog ref={dialog} className="drawer" aria-labelledby="entity-form-title" onCancel={(event) => { event.preventDefault(); close(); }}>
    <EntityFormView
      qname={qname}
      definition={definition}
      fields={fields.filter((field) => !SYSTEM_MANAGED_FIELDS[qname]?.includes(field.name))}
      computed={computed}
      title={title}
      editing={editing}
      saving={saving}
      errors={errors}
      generalErrors={generalErrors}
      renderControl={(field) => <EntityFieldControl
        qname={qname}
        field={field}
        displayValue={fieldValue(field)}
        references={references}
        values={values}
        error={errors[field.name]}
        inputRef={(node) => { inputRefs.current[field.name] = node; }}
        onChange={setValue}
      />}
      onSubmit={save}
      onClose={close}
    />
  </dialog>;
}




