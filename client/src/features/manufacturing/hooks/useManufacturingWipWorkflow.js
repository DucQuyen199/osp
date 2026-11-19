import { useState } from 'react';
import { localDate } from '../../../lib/dates.js';
import { api, dataPath, tenantPath } from '../../../lib/api.js';
import { compareDecimals } from '../../../lib/decimal.js';
import { isWithinFailedQty, productionOutputMatchesPlan, productionOutputQuantities, remainingFailedQty as getRemainingFailedQty } from '../domain/inspectionQuantities.js';

const newComponent = () => ({ rowId: crypto.randomUUID(), product: '', qty: '1', uom: '' });

export function useManufacturingWipWorkflow({ boms, reworkOrders, productionDispositions, conditionalAcceptances, inspections, products, load, canPostDisposition, t }) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [offsetAccountId, setOffsetAccountId] = useState('');
  const [memo, setMemo] = useState(t('Điều chỉnh đối chiếu WIP'));
  const [adjustment, setAdjustment] = useState(null);
  const [creatingAdjustment, setCreatingAdjustment] = useState(false);
  const [editingBom, setEditingBom] = useState('');
  const [bomProduct, setBomProduct] = useState('');
  const [bomOutputQty, setBomOutputQty] = useState('1');
  const [components, setComponents] = useState(() => [newComponent()]);
  const [orderBom, setOrderBom] = useState('');
  const [orderQty, setOrderQty] = useState('1');
  const [orderWarehouse, setOrderWarehouse] = useState('');
  const [orderCenter, setOrderCenter] = useState('');
  const [orderDate, setOrderDate] = useState(localDate());
  const [outputLot, setOutputLot] = useState('');
  const [outputExpiry, setOutputExpiry] = useState('');
  const [scrapMethod, setScrapMethod] = useState('absorb');
  const [scrapAccount, setScrapAccount] = useState('');
  const [outputs, setOutputs] = useState({});
  const [qcNotes, setQcNotes] = useState({});
  const [reworkInspection, setReworkInspection] = useState('');
  const [reworkQty, setReworkQty] = useState('');
  const [reworkReason, setReworkReason] = useState('');
  const [dispositionInspection, setDispositionInspection] = useState('');
  const [dispositionQty, setDispositionQty] = useState('');
  const [dispositionNote, setDispositionNote] = useState('');
  const [dispositionAccount, setDispositionAccount] = useState('');
  const [acceptanceInspection, setAcceptanceInspection] = useState('');
  const [acceptanceQty, setAcceptanceQty] = useState('');
  const [acceptanceCondition, setAcceptanceCondition] = useState('');
  const [acceptanceJustification, setAcceptanceJustification] = useState('');

  const remainingFailedQty = (inspection) => getRemainingFailedQty(inspection, reworkOrders, productionDispositions, conditionalAcceptances);
  const remainingFailedProductionInspections = inspections.filter((inspection) =>
    ['production_order', 'production_rework'].includes(inspection.source)
    && inspection.status === 'failed'
    && compareDecimals(remainingFailedQty(inspection), '0.000001') > 0
  );
  const selectedBom = boms.find((bom) => bom.id === orderBom);

  const resetBom = () => { setEditingBom(''); setBomProduct(''); setBomOutputQty('1'); setComponents([newComponent()]); };
  const editBom = (bom) => {
    setEditingBom(bom.id); setBomProduct(bom.product); setBomOutputQty(String(bom.output_qty || 1));
    setComponents(Array.isArray(bom.components) && bom.components.length ? bom.components.map((row) => ({ rowId: crypto.randomUUID(), product: row.product || '', qty: String(row.qty || ''), uom: row.uom || '' })) : [newComponent()]);
  };
  const saveBom = async (event) => {
    event.preventDefault(); setBusy('bom'); setError('');
    try {
      const body = { product: bomProduct, output_qty: String(bomOutputQty), components: components.map((row) => ({ product: row.product, qty: String(row.qty), ...(row.uom ? { uom: row.uom } : {}) })) };
      await api(editingBom ? dataPath('manufacturing.bom', editingBom) : dataPath('manufacturing.bom'), { method: editingBom ? 'PATCH' : 'POST', body });
      resetBom(); await load();
    } catch (reason) { setError(reason.message || t('Không lưu được BOM.')); }
    finally { setBusy(''); }
  };
  const setOrderField = (field, value) => {
    const setters = { bom: setOrderBom, qty: setOrderQty, warehouse: setOrderWarehouse, center: setOrderCenter, date: setOrderDate, outputLot: setOutputLot, outputExpiry: setOutputExpiry, scrapMethod: setScrapMethod, scrapAccount: setScrapAccount };
    setters[field]?.(value);
  };
  const createProductionOrder = async (event) => {
    event.preventDefault(); if (!selectedBom) return;
    setBusy('order'); setError('');
    try {
      await api(dataPath('manufacturing.production_order'), { method: 'POST', body: {
        product: selectedBom.product, bom: selectedBom.id, qty: String(orderQty), warehouse: orderWarehouse,
        ...(orderCenter ? { work_center: orderCenter, planned_start: orderDate } : {}),
        ...(outputLot ? { output_lot_code: outputLot } : {}), ...(outputExpiry ? { output_expiry: outputExpiry } : {}),
        scrap_cost_method: scrapMethod, ...(scrapMethod === 'expense' && scrapAccount ? { scrap_expense_account: scrapAccount } : {}),
      } });
      setOrderQty('1'); setOutputLot(''); setOutputExpiry(''); await load();
    } catch (reason) { setError(reason.message || t('Không tạo được lệnh sản xuất.')); }
    finally { setBusy(''); }
  };
  const operateOrder = async (order, action) => {
    setBusy(`${order.id}:${action}`); setError('');
    try {
      if (action === 'done') {
        const draft = outputs[order.id] || {};
        const { goodQty, scrapQty } = productionOutputQuantities(order.qty, draft.good_qty ?? order.qty, draft.scrap_qty);
        if (compareDecimals(goodQty, '0') < 0 || compareDecimals(scrapQty, '0') < 0) throw new Error('Số lượng đạt và phế phẩm không được âm.');
        if (!productionOutputMatchesPlan(order.qty, goodQty, scrapQty)) throw new Error('Tổng số lượng đạt và phế phẩm phải bằng số lượng kế hoạch (sai số tối đa 0,0001).');
        await api(dataPath('manufacturing.production_order', order.id), { method: 'PATCH', body: { good_qty: goodQty, scrap_qty: scrapQty, ...(draft.scrap_reason ? { scrap_reason: draft.scrap_reason } : {}) } });
      }
      await api(dataPath('manufacturing.production_order', order.id, action), { method: 'POST' }); await load();
    } catch (reason) { setError(reason.message || t('Không thể thực hiện thao tác cho lệnh.')); }
    finally { setBusy(''); }
  };
  const decideInspection = async (inspection, action) => {
    setBusy(`${inspection.id}:${action}`); setError('');
    try {
      if (action === 'failed') {
        const note = qcNotes[inspection.id]?.trim() || '';
        if (note.length < 5) throw new Error('Nhập mô tả lỗi QC từ 5 ký tự trở lên.');
        await api(dataPath('quality.inspection', inspection.id), { method: 'PATCH', body: { note } });
      }
      await api(dataPath('quality.inspection', inspection.id, action), { method: 'POST' }); await load();
    } catch (reason) { setError(reason.message || t('Không lưu được kết quả QC.')); }
    finally { setBusy(''); }
  };
  const createReworkOrder = async (event) => {
    event.preventDefault(); const inspection = inspections.find((row) => row.id === reworkInspection); if (!inspection) return;
    setBusy('rework'); setError('');
    try {
      if (!isWithinFailedQty(reworkQty, remainingFailedQty(inspection))) throw new Error('Số lượng sửa vượt lượng QC lỗi còn lại.');
      await api(dataPath('manufacturing.rework_order'), { method: 'POST', body: { production_order: inspection.source_id, inspection: inspection.id, qty: String(reworkQty), reason: reworkReason.trim() } });
      setReworkInspection(''); setReworkQty(''); setReworkReason(''); await load();
    } catch (reason) { setError(reason.message || t('Không tạo được lệnh sửa.')); }
    finally { setBusy(''); }
  };
  const operateRework = async (order, action) => {
    setBusy(`${order.id}:${action}`); setError('');
    try { await api(dataPath('manufacturing.rework_order', order.id, action), { method: 'POST' }); await load(); }
    catch (reason) { setError(reason.message || t('Không cập nhật được lệnh sửa.')); }
    finally { setBusy(''); }
  };
  const createProductionDisposition = async (event) => {
    event.preventDefault(); if (!dispositionInspection) return;
    setBusy('production-disposition'); setError('');
    try {
      const inspection = inspections.find((row) => row.id === dispositionInspection);
      if (!isWithinFailedQty(dispositionQty, remainingFailedQty(inspection))) throw new Error('Số lượng loại bỏ vượt lượng QC lỗi còn lại.');
      const created = await api(dataPath('manufacturing.production_disposition'), { method: 'POST', body: { inspection: dispositionInspection, qty: String(dispositionQty), note: dispositionNote.trim(), expense_account: dispositionAccount } });
      if (canPostDisposition) {
        await api(dataPath('manufacturing.production_disposition', created.id, 'posted'), { method: 'POST' });
        setNotice(t('Đã ghi sổ loại bỏ thành phẩm và hạch toán chi phí từ WIP.'));
      } else setNotice(t('Đã tạo phiếu loại bỏ; phiếu đang chờ người có quyền ghi sổ.'));
      setDispositionInspection(''); setDispositionQty(''); setDispositionNote(''); setDispositionAccount(''); await load();
    } catch (reason) { await load(); setError(reason.message || t('Không ghi nhận được lượng thành phẩm loại bỏ.')); }
    finally { setBusy(''); }
  };
  const submitConditionalAcceptance = async (event) => {
    event.preventDefault(); const inspection = inspections.find((row) => row.id === acceptanceInspection); if (!inspection) return;
    setBusy('conditional-acceptance'); setError(''); setNotice('');
    try {
      if (!isWithinFailedQty(acceptanceQty, remainingFailedQty(inspection))) throw new Error('Số lượng đề nghị vượt lượng QC lỗi còn lại.');
      const created = await api(dataPath('manufacturing.conditional_acceptance'), { method: 'POST', body: { inspection: inspection.id, qty: String(acceptanceQty), condition: acceptanceCondition.trim(), justification: acceptanceJustification.trim() } });
      await api(dataPath('manufacturing.conditional_acceptance', created.id, 'submitted'), { method: 'POST' });
      setAcceptanceInspection(''); setAcceptanceQty(''); setAcceptanceCondition(''); setAcceptanceJustification('');
      setNotice(t('Đã gửi đề nghị chấp nhận có điều kiện. Hàng vẫn bị giữ cho đến khi người có thẩm quyền phê duyệt.')); await load();
    } catch (reason) { await load(); setError(reason.message || t('Không gửi được đề nghị chấp nhận có điều kiện.')); }
    finally { setBusy(''); }
  };
  const createWipReconciliationDraft = async (asOf) => {
    setCreatingAdjustment(true);
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
      setError(reason.message || t('Không tạo được bút toán nháp đối chiếu WIP.'));
    } finally {
      setCreatingAdjustment(false);
    }
  };
  const operateConditionalAcceptance = async (row, action) => {
    setBusy(`${row.id}:${action}`); setError(''); setNotice('');
    try {
      await api(dataPath('manufacturing.conditional_acceptance', row.id, action), { method: 'POST' });
      setNotice(action === 'submitted' ? t('Đã gửi lại đề nghị vào hàng chờ phê duyệt.') : t('Đã hủy đề nghị chấp nhận có điều kiện.')); await load();
    } catch (reason) { setError(reason.message || t('Không cập nhật được đề nghị chấp nhận có điều kiện.')); }
    finally { setBusy(''); }
  };
  const operateProductionDisposition = async (row, action) => {
    setBusy(`${row.id}:${action}`); setError('');
    try { await api(dataPath('manufacturing.production_disposition', row.id, action), { method: 'POST' }); await load(); }
    catch (reason) { setError(reason.message || t('Không cập nhật được phiếu xử lý thành phẩm.')); }
    finally { setBusy(''); }
  };
  const onInspectionChange = (field, setter) => (id) => {
    const inspection = inspections.find((row) => row.id === id);
    setter(id);
    const qtySetter = { reworkInspection: setReworkQty, dispositionInspection: setDispositionQty, acceptanceInspection: setAcceptanceQty }[field];
    qtySetter?.(inspection ? String(remainingFailedQty(inspection)) : '');
  };

  return {
    busy, error, setError, notice, setNotice,
    offsetAccountId, setOffsetAccountId, memo, setMemo, adjustment, creatingAdjustment,
    createWipReconciliationDraft,
    editingBom, bomProduct, bomOutputQty, components, resetBom, editBom, saveBom,
    setBomProduct, setBomOutputQty,
    onComponentChange: (index, field, value) => setComponents((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, [field]: value, ...(field === 'product' ? { uom: '' } : {}) } : row)),
    onAddComponent: () => setComponents((rows) => [...rows, newComponent()]),
    onRemoveComponent: (index) => setComponents((rows) => rows.filter((_, rowIndex) => rowIndex !== index)),
    selectedBom, orderValues: { bom: orderBom, qty: orderQty, warehouse: orderWarehouse, center: orderCenter, date: orderDate, outputLot, outputExpiry, scrapMethod, scrapAccount },
    setOrderField, createProductionOrder, outputs, setOutputs, operateOrder, qcNotes, setQcNotes, decideInspection,
    remainingFailedQty, remainingFailedProductionInspections,
    reworkInspection, reworkQty, reworkReason, setReworkQty, setReworkReason,
    createReworkOrder, operateRework,
    dispositionInspection, dispositionQty, dispositionNote, dispositionAccount,
    setDispositionQty, setDispositionNote, setDispositionAccount, createProductionDisposition, operateProductionDisposition,
    acceptanceInspection, acceptanceQty, acceptanceCondition, acceptanceJustification,
    setAcceptanceQty, setAcceptanceCondition, setAcceptanceJustification, submitConditionalAcceptance, operateConditionalAcceptance,
    onReworkInspectionChange: onInspectionChange('reworkInspection', setReworkInspection),
    onDispositionInspectionChange: onInspectionChange('dispositionInspection', setDispositionInspection),
    onAcceptanceInspectionChange: onInspectionChange('acceptanceInspection', setAcceptanceInspection),
  };
}
