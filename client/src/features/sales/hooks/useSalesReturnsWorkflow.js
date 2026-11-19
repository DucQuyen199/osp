import { useEffect, useMemo, useState } from 'react';
import { api, dataPath } from '../../../lib/api.js';
import { compareDecimals } from '../../../lib/decimal.js';
import { uiText } from '../../../lib/i18n.js';

const action = (entity, row, verb) => api(dataPath(entity, row.id, verb), { method: 'POST' });

export function useSalesReturnsWorkflow({ orders, returns, invoices, load, setError }) {
  const [orderId, setOrderId] = useState('');
  const [quantities, setQuantities] = useState({});
  const [returnInvoiceId, setReturnInvoiceId] = useState('');
  const [linkedInvoiceId, setLinkedInvoiceId] = useState('');
  const [reason, setReason] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const formOrder = orders.find((row) => row.id === orderId);
  const selected = returns.find((row) => row.id === selectedId);
  const selectedOrder = orders.find((row) => row.id === selected?.sales_order);
  const invoicesForOrder = (order) => order ? invoices.filter((invoice) => invoice.source === 'sales_order'
    && invoice.source_id === order.id
    && ['posted', 'partially_paid', 'partially_settled', 'paid', 'settled'].includes(invoice.status)) : [];
  const formInvoices = useMemo(() => invoicesForOrder(formOrder), [formOrder, invoices]);
  const selectedReturnInvoices = useMemo(() => invoicesForOrder(selectedOrder), [selectedOrder, invoices]);

  useEffect(() => {
    setOrderId((id) => orders.some((row) => row.id === id && ['confirmed', 'partially_delivered', 'delivered'].includes(row.status))
      ? id : orders.find((row) => ['confirmed', 'partially_delivered', 'delivered'].includes(row.status))?.id || '');
    setSelectedId((id) => returns.some((row) => row.id === id) ? id : returns[0]?.id || '');
  }, [orders, returns]);

  useEffect(() => {
    setReturnInvoiceId((current) => formInvoices.some((invoice) => invoice.id === current)
      ? current : formInvoices.length === 1 ? formInvoices[0].id : '');
  }, [orderId, formInvoices]);

  useEffect(() => {
    setLinkedInvoiceId(selected?.invoice || (selectedReturnInvoices.length === 1 ? selectedReturnInvoices[0].id : ''));
  }, [selectedId, selected?.invoice, selectedReturnInvoices]);

  async function run(key, operation, success) {
    setBusy(key); setError(''); setNotice('');
    try { await operation(); setNotice(success); await load(true); }
    catch (reason) { setError(reason.message || uiText('Thao tÃ¡c khÃ´ng thÃ nh cÃ´ng.')); await load(true); }
    finally { setBusy(''); }
  }

  async function createReturn(event, { formOrder, selectedInvoice, eligible, lotSelections = {} }) {
    event.preventDefault();
    if (!formOrder) return;
    if (!selectedInvoice) { setError(uiText('Chá»n má»™t hÃ³a Ä‘Æ¡n Ä‘Ã£ ghi sá»• cá»§a Ä‘Æ¡n bÃ¡n trÆ°á»›c khi gá»­i duyá»‡t phiáº¿u tráº£.')); return; }
    if (eligible.some((line) => isPositive(quantities[line.key]) && compareDecimals(quantities[line.key], line.remaining) > 0)) {
      setError(uiText('Sá»‘ lÆ°á»£ng tráº£ khÃ´ng Ä‘Æ°á»£c vÆ°á»£t sá»‘ lÆ°á»£ng cÃ²n Ä‘á»§ Ä‘iá»u kiá»‡n tráº£.')); return;
    }
    const lines = eligible.map((line) => ({
      product: line.product, uom: line.uom || undefined, price: String(line.price),
      qty: String(quantities[line.key] || '0'), discount_pct: String(line.discount_pct),
      tax: line.tax, tax_rate: String(line.tax_rate),
      ...(line.lotTracked ? { lot_allocations: (lotSelections[line.key] || []).map((allocation) => ({ lot: allocation.lot, qty: String(allocation.qty || '0') })) } : {}),
    })).filter((line) => isPositive(line.qty));
    if (!lines.length || !reason.trim()) { setError(uiText('Nháº­p sá»‘ lÆ°á»£ng tráº£ vÃ  lÃ½ do cho Ã­t nháº¥t má»™t máº·t hÃ ng.')); return; }
    await run('return:create', async () => {
      const row = await api(dataPath('sales.sales_return'), { method: 'POST', body: {
        sales_order: formOrder.id, invoice: selectedInvoice.id, warehouse: formOrder.warehouse || undefined,
        lines, reason: reason.trim(),
      } });
      setSelectedId(row.id); setReason(''); setQuantities({});
      await action('sales.sales_return', row, 'submitted');
    }, uiText('ÄÃ£ láº­p vÃ  gá»­i duyá»‡t phiáº¿u tráº£. Sá»‘ lÆ°á»£ng Ä‘Æ°á»£c Ä‘á»‘i chiáº¿u vá»›i hÃ ng Ä‘Ã£ giao vÃ  cÃ¡c phiáº¿u Ä‘ang xá»­ lÃ½.'));
  }

  async function transition(row, verb) {
    const messages = {
      submitted: uiText('ÄÃ£ gá»­i phiáº¿u tráº£ duyá»‡t.'),
      approved: uiText('ÄÃ£ duyá»‡t phiáº¿u tráº£; kho cÃ³ thá»ƒ tiáº¿p nháº­n hÃ ng.'),
      rejected: uiText('ÄÃ£ tá»« chá»‘i phiáº¿u tráº£.'),
      received: uiText('ÄÃ£ nháº­p láº¡i hÃ ng vÃ  táº¡o credit note Ä‘á»ƒ Ä‘iá»u chá»‰nh cÃ´ng ná»£ khÃ¡ch hÃ ng.'),
      cancelled: uiText('ÄÃ£ há»§y phiáº¿u tráº£.'),
    };
    await run(`${row.id}:${verb}`, () => action('sales.sales_return', row, verb), messages[verb]);
  }

  async function assignReturnInvoice(row) {
    if (!linkedInvoiceId) return;
    await run(`${row.id}:invoice`, () => api(dataPath('sales.sales_return', row.id), {
      method: 'PATCH', body: { invoice: linkedInvoiceId },
    }), uiText('ÄÃ£ gáº¯n hÃ³a Ä‘Æ¡n gá»‘c vÃ o phiáº¿u tráº£.'));
  }

  async function decideApproval(request, verb) {
    await run(`${request.id}:${verb}`, () => action('workflow-approval.approval_request', request, verb),
      uiText(verb === 'approved' ? 'ÄÃ£ duyá»‡t phiáº¿u tráº£.' : 'ÄÃ£ tá»« chá»‘i phiáº¿u tráº£.'));
  }

  function changeOrder(value) { setOrderId(value); setQuantities({}); }
  function changeQuantity(key, value) { setQuantities((current) => ({ ...current, [key]: value })); }

  return {
    orderId, setOrderId, quantities, setQuantities, returnInvoiceId, setReturnInvoiceId,
    linkedInvoiceId, setLinkedInvoiceId, reason, setReason, selectedId, setSelectedId,
    busy, notice, formOrder, formInvoices, selected, selectedOrder, selectedReturnInvoices,
    changeOrder, changeQuantity, createReturn, transition,
    assignReturnInvoice, decideApproval,
  };
}

function isPositive(value) {
  try { return compareDecimals(value || 0, 0) > 0; } catch { return false; }
}
