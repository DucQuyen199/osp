import { useCallback, useEffect, useState } from 'react';
import { uiText } from '../../../lib/i18n.js';
import { can, loadRefs, loadAllResponse, loadIndependentData } from '../../../lib/state.js';

const itemsOf = (response) => Array.isArray(response?.items) ? response.items : [];
const emptyData = () => ({
  orders: [], requisitions: [], receipts: [], supplierInvoices: [], purchaseReturns: [], qualityInspections: [],
  suppliers: new Map(), products: new Map(), units: new Map(), warehouses: new Map(), taxes: [], currencies: new Map(),
  currencyRates: [], bills: [], approvalRequests: [],
});

export function usePurchasingData(workflowApproval) {
  const [data, setData] = useState(emptyData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (quiet = false) => {
    if (!quiet) { setLoading(true); setError(''); }
    try {
      const emptyMap = () => new Map();
      const emptyResponse = () => ({ items: [] });
      const { data, errors } = await loadIndependentData({
        orderRes: can('purchasing.purchase_order.read') ? loadAllResponse('purchasing.purchase_order') : Promise.resolve(emptyResponse()),
        receiptRes: can('purchasing.purchase_receipt.read') ? loadAllResponse('purchasing.purchase_receipt') : Promise.resolve(emptyResponse()),
        requisitionRes: can('purchasing.purchase_requisition.read') ? loadAllResponse('purchasing.purchase_requisition') : Promise.resolve(emptyResponse()),
        supplierInvoiceRes: can('purchasing.supplier_invoice.read') ? loadAllResponse('purchasing.supplier_invoice') : Promise.resolve(emptyResponse()),
        returnRes: can('purchasing.purchase_return.read') ? loadAllResponse('purchasing.purchase_return') : Promise.resolve(emptyResponse()),
        inspectionRes: can('quality.inspection.read') ? loadAllResponse('quality.inspection') : Promise.resolve(emptyResponse()),
        supplierMap: can('master-data.party.read') ? loadRefs('master-data.party') : Promise.resolve(emptyMap()),
        productMap: can('master-data.product.read') ? loadRefs('master-data.product') : Promise.resolve(emptyMap()),
        unitMap: can('master-data.uom.read') ? loadRefs('master-data.uom') : Promise.resolve(emptyMap()),
        warehouseMap: can('inventory.warehouse.read') ? loadRefs('inventory.warehouse') : Promise.resolve(emptyMap()),
        taxRes: can('master-data.tax.read') ? loadAllResponse('master-data.tax') : Promise.resolve(emptyResponse()),
        billRes: can('accounting.bill.read') ? loadAllResponse('accounting.bill') : Promise.resolve(emptyResponse()),
        approvalRes: workflowApproval && can('workflow-approval.approval_request.read') ? loadAllResponse('workflow-approval.approval_request') : Promise.resolve(emptyResponse()),
        currencyMap: can('master-data.currency.read') ? loadRefs('master-data.currency') : Promise.resolve(emptyMap()),
        currencyRateRes: can('master-data.currency_rate.read') ? loadAllResponse('master-data.currency_rate') : Promise.resolve(emptyResponse()),
      }, {
        orderRes: emptyResponse(), receiptRes: emptyResponse(), requisitionRes: emptyResponse(), supplierInvoiceRes: emptyResponse(), returnRes: emptyResponse(), inspectionRes: emptyResponse(),
        supplierMap: emptyMap(), productMap: emptyMap(), unitMap: emptyMap(), warehouseMap: emptyMap(), taxRes: emptyResponse(), billRes: emptyResponse(), approvalRes: emptyResponse(), currencyMap: emptyMap(), currencyRateRes: emptyResponse(),
      });
      const { orderRes, receiptRes, requisitionRes, supplierInvoiceRes, returnRes, inspectionRes, supplierMap, productMap, unitMap, warehouseMap, taxRes, billRes, approvalRes, currencyMap, currencyRateRes } = data;
      const orders = itemsOf(orderRes).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
      const requisitions = itemsOf(requisitionRes).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
      setData({
        orders,
        requisitions,
        receipts: itemsOf(receiptRes),
        supplierInvoices: itemsOf(supplierInvoiceRes),
        purchaseReturns: itemsOf(returnRes),
        qualityInspections: itemsOf(inspectionRes),
        suppliers: new Map([...supplierMap].filter(([, row]) => row.is_supplier !== false)),
        products: productMap,
        units: unitMap,
        warehouses: warehouseMap,
        taxes: itemsOf(taxRes),
        bills: itemsOf(billRes),
        approvalRequests: itemsOf(approvalRes),
        currencies: currencyMap,
        currencyRates: itemsOf(currencyRateRes),
      });
      setError(errors[0]?.message || (errors.length ? uiText('Một số dữ liệu mua hàng không tải được.') : ''));
    } catch (reason) {
      setError(reason.message || uiText('Không tải được đơn mua và phiếu nhận hàng.'));
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [workflowApproval]);

  useEffect(() => { load(); }, [load]);
  return { ...data, loading, error, setError, load };
}
