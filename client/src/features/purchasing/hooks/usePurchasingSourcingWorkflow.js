import { useEffect, useState } from 'react';
import { api, dataPath } from '../../../lib/api.js';
import { compareDecimals } from '../../../lib/decimal.js';
import { uiText } from '../../../lib/i18n.js';

const decimalInput = (value) => String(value ?? '0').trim().replace(/^([+-]?)\./, (_, sign) => `${sign}0.`);
const isPositiveDecimal = (value) => {
  try { return compareDecimals(value, '0') > 0; } catch { return false; }
};

export function usePurchasingSourcingWorkflow({ requisitions, load, setError, emailQueueEnabled }) {
  const [selectedId, setSelectedId] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [responseDue, setResponseDue] = useState('');
  const [quoteDrafts, setQuoteDrafts] = useState({});
  const [quoteMeta, setQuoteMeta] = useState({});
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    setSelectedId((current) => current && requisitions.some((row) => row.id === current) ? current : requisitions[0]?.id || '');
  }, [requisitions]);

  async function run(key, operation, success) {
    setBusy(key); setError(''); setNotice('');
    try { await operation(); setNotice(success); await load(true); }
    catch (reason) { setError(reason.message || uiText('KhÃ´ng cáº­p nháº­t Ä‘Æ°á»£c há»“ sÆ¡ bÃ¡o giÃ¡.')); await load(true); }
    finally { setBusy(''); }
  }

  async function createRfq(event, selected, winner) {
    event.preventDefault();
    if (!selected || !supplierId || winner) return;
    await run('rfq:create', async () => {
      await api(dataPath('purchasing.rfq'), { method: 'POST', body: {
        purchase_requisition: selected.id, supplier: supplierId, warehouse: selected.warehouse,
        department: selected.department || undefined, lines: selected.lines || [], quote_lines: [],
        response_due: responseDue || undefined,
      } });
      setSupplierId('');
    }, uiText('ÄÃ£ láº­p há»“ sÆ¡ RFQ cho nhÃ  cung cáº¥p. Gá»­i yÃªu cáº§u, sau Ä‘Ã³ ghi bÃ¡o giÃ¡ nháº­n Ä‘Æ°á»£c vÃ o Ä‘Ãºng há»“ sÆ¡.'));
  }

  async function saveQuote(row, lines) {
    const normalizedLines = lines.map((line) => ({
      product: line.product, qty: decimalInput(line.qty), price: decimalInput(line.price),
      ...(line.uom ? { uom: line.uom } : {}), ...(line.tax ? { tax: line.tax } : {}),
    }));
    if (!normalizedLines.length || normalizedLines.some((line) => !isPositiveDecimal(line.price))) {
      setError(uiText('Nháº­p Ä‘Æ¡n giÃ¡ lá»›n hÆ¡n 0 cho má»i dÃ²ng bÃ¡o giÃ¡.')); return;
    }
    const meta = quoteMeta[row.id] || {};
    await run(`${row.id}:quoted`, async () => {
      const body = { quote_lines: normalizedLines };
      const quoteReference = meta.quote_reference ?? row.quote_reference;
      const validUntil = meta.valid_until ?? row.valid_until;
      if (quoteReference != null) body.quote_reference = String(quoteReference).trim() || null;
      if (validUntil != null) body.valid_until = validUntil || null;
      await api(dataPath('purchasing.rfq', row.id, 'quoted'), { method: 'POST', body });
    }, uiText('ÄÃ£ lÆ°u bÃ¡o giÃ¡ vÃ  Ä‘Æ°a vÃ o báº£ng so sÃ¡nh.'));
  }

  async function rfqAction(row, verb) {
    const messages = {
      sent: uiText(emailQueueEnabled
        ? 'RFQ Ä‘Ã£ Ä‘Æ°á»£c Ä‘Ã¡nh dáº¥u gá»­i vÃ  email má»i bÃ¡o giÃ¡ Ä‘Ã£ xáº¿p vÃ o hÃ ng Ä‘á»£i gá»­i.'
        : 'ÄÃ£ ghi nháº­n yÃªu cáº§u bÃ¡o giÃ¡ Ä‘Ã£ gá»­i cho nhÃ  cung cáº¥p.'),
      accepted: uiText('ÄÃ£ chá»n bÃ¡o giÃ¡. ÄÆ¡n mua nhÃ¡p Ä‘Ã£ Ä‘Æ°á»£c táº¡o; cÃ¡c bÃ¡o giÃ¡ cáº¡nh tranh Ä‘Æ°á»£c Ä‘Ã³ng.'),
      rejected: uiText('ÄÃ£ tá»« chá»‘i bÃ¡o giÃ¡ nhÃ  cung cáº¥p.'),
      cancelled: uiText('ÄÃ£ há»§y RFQ nhÃ¡p.'),
    };
    await run(`${row.id}:${verb}`, () => api(dataPath('purchasing.rfq', row.id, verb), { method: 'POST' }), messages[verb]);
  }

  function selectRequisition(row) {
    setSelectedId(row.id);
    setSupplierId('');
  }

  return {
    selectedId, setSelectedId, supplierId, setSupplierId, responseDue, setResponseDue,
    quoteDrafts, setQuoteDrafts, quoteMeta, setQuoteMeta, busy, notice,
    createRfq, saveQuote, rfqAction, selectRequisition,
  };
}
