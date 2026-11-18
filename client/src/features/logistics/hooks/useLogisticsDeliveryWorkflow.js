import { useState } from 'react';
import { api, dataPath, tenantPath } from '../../../lib/api.js';
import { compareDecimals } from '../../../lib/decimal.js';
import { recordHref } from '../../../lib/routes.js';
import { isDeliveredShort, isDeliveredWithinLimit } from '../domain/deliveryQuantities.js';

export function useLogisticsDeliveryWorkflow({ load, setError, t }) {
  const [busy, setBusy] = useState('');
  const [deliveryProof, setDeliveryProof] = useState({});

  async function transition(shipment, action) {
    const key = `${shipment.id}:${action}`;
    setBusy(key);
    setError('');
    try {
      await api(dataPath('logistics.shipment', shipment.id, action), { method: 'POST' });
      await load(true);
    } catch (reason) {
      setError(reason.message || t('Không cập nhật được vận đơn.'));
      await load(true);
    } finally {
      setBusy('');
    }
  }

  async function confirmDelivered(shipment) {
    const proof = deliveryProof[shipment.id] || {};
    const receivedBy = proof.receivedBy?.trim() || '';
    const evidence = proof.evidence?.trim() || '';
    const lines = shipment.lines || [];
    const deliveredLines = lines.map((line, index) => {
      const receivedQty = String(proof.deliveredQuantities?.[index] ?? line.qty ?? '0');
      const shipmentLine = { ...line };
      delete shipmentLine.productName;
      return { ...shipmentLine, qty: receivedQty };
    }).filter((line) => { try { return compareDecimals(line.qty, '0') > 0; } catch { return false; } });
    const invalidQuantity = lines.some((line, index) => {
      const receivedValue = proof.deliveredQuantities?.[index] ?? line.qty ?? 0;
      try { return compareDecimals(receivedValue, '0') < 0 || !isDeliveredWithinLimit(receivedValue, line.qty || 0); } catch { return true; }
    });
    const hasShortDelivery = lines.some((line, index) => isDeliveredShort(
      proof.deliveredQuantities?.[index] ?? line.qty ?? 0,
      line.qty || 0,
    ));
    const shortReason = proof.shortDeliveryReason?.trim() || '';
    if (!receivedBy && !evidence) {
      setError(t('Nhập tên người nhận hoặc mã/bằng chứng giao hàng trước khi xác nhận.'));
      return;
    }
    if (!deliveredLines.length || invalidQuantity) {
      setError(t('Số lượng giao thực tế phải hợp lệ và không vượt số lượng trên vận đơn.'));
      return;
    }
    if (hasShortDelivery && (shortReason.length < 5 || shortReason.length > 500)) {
      setError(t('Giao thiếu cần lý do từ 5 đến 500 ký tự.'));
      return;
    }
    const key = `${shipment.id}:delivered`;
    setBusy(key);
    setError('');
    try {
      await api(dataPath('logistics.shipment', shipment.id, 'delivered'), {
        method: 'POST',
        body: {
          ...(receivedBy ? { received_by: receivedBy } : {}),
          ...(evidence ? { delivery_evidence: evidence } : {}),
          delivered_lines: deliveredLines,
          ...(hasShortDelivery ? { short_delivery_reason: shortReason } : {}),
        },
      });
      setDeliveryProof((current) => { const next = { ...current }; delete next[shipment.id]; return next; });
      await load(true);
    } catch (reason) {
      setError(reason.message || t('Không hoàn tất được giao hàng. Kiểm tra bằng chứng giao hàng và số lượng đã điều phối.'));
      await load(true);
    } finally {
      setBusy('');
    }
  }

  async function redeliver(shipment) {
    setBusy(`${shipment.id}:redeliver`);
    setError('');
    try {
      const result = await api(tenantPath(`/reports/logistics/shipments/${encodeURIComponent(shipment.id)}/redeliver`), { method: 'POST' });
      location.hash = recordHref('logistics.shipment', result.id);
    } catch (reason) {
      setError(reason.message || t('Không tạo được vận đơn giao lại.'));
      await load(true);
    } finally {
      setBusy('');
    }
  }

  const changeDeliveredQuantity = (shipmentId, index, value) => setDeliveryProof((current) => ({
    ...current,
    [shipmentId]: { ...current[shipmentId], deliveredQuantities: { ...current[shipmentId]?.deliveredQuantities, [index]: value } },
  }));
  const changeShortDeliveryReason = (shipmentId, value) => setDeliveryProof((current) => ({
    ...current,
    [shipmentId]: { ...current[shipmentId], shortDeliveryReason: value },
  }));
  const changeReceivedBy = (shipmentId, value) => setDeliveryProof((current) => ({
    ...current,
    [shipmentId]: { ...current[shipmentId], receivedBy: value },
  }));
  const changeEvidence = (shipmentId, value) => setDeliveryProof((current) => ({
    ...current,
    [shipmentId]: { ...current[shipmentId], evidence: value },
  }));

  return {
    busy, deliveryProof, transition, confirmDelivered, redeliver,
    changeDeliveredQuantity, changeShortDeliveryReason, changeReceivedBy, changeEvidence,
  };
}
