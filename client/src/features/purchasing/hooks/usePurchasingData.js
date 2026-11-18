import { useCallback, useEffect, useState } from 'react';
import { uiText } from '../../../lib/i18n.js';
import { can, loadRefs, loadAllResponse } from '../../../lib/state.js';

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
      const [orderRes, receiptRes, requisitionRes, supplierInvoiceRes, returnRes, inspectionRes, supplierMap, productMap, unitMap, warehouseMap, taxRes, billRes, approvalRes, currencyMap, currencyRateRes] = await Promise.all([
        can('purchasing.purchase_order.read') ? loadAllResponse('purchasing.purchase_order') : Promise.resolve({ items: [] }),
        can('purchasing.purchase_receipt.read') ? loadAllResponse('purchasing.purchase_receipt') : Promise.resolve({ items: [] }),
        can('purchasing.purchase_requisition.read') ? loadAllResponse('purchasing.purchase_requisition') : Promise.resolve({ items: [] }),
        can('purchasing.supplier_invoice.read') ? loadAllResponse('purchasing.supplier_invoice') : Promise.resolve({ items: [] }),
        can('purchasing.purchase_return.read') ? loadAllResponse('purchasing.purchase_return') : Promise.resolve({ items: [] }),
        can('quality.inspection.read') ? loadAllResponse('quality.inspection') : Promise.resolve({ items: [] }),
        can('master-data.party.read') ? loadRefs('master-data.party') : Promise.resolve(new Map()),
        can('master-data.product.read') ? loadRefs('master-data.product') : Promise.resolve(new Map()),
        can('master-data.uom.read') ? loadRefs('master-data.uom') : Promise.resolve(new Map()),
        can('inventory.warehouse.read') ? loadRefs('inventory.warehouse') : Promise.resolve(new Map()),
        can('master-data.tax.read') ? loadAllResponse('master-data.tax') : Promise.resolve({ items: [] }),
        can('accounting.bill.read') ? loadAllResponse('accounting.bill') : Promise.resolve({ items: [] }),
        workflowApproval && can('workflow-approval.approval_request.read') ? loadAllResponse('workflow-approval.approval_request') : Promise.resolve({ items: [] }),
        can('master-data.currency.read') ? loadRefs('master-data.currency') : Promise.resolve(new Map()),
        can('master-data.currency_rate.read') ? loadAllResponse('master-data.currency_rate') : Promise.resolve({ items: [] }),
      ]);
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
        currencies: currencyMap || new Map(),
        currencyRates: itemsOf(currencyRateRes),
      });
    } catch (reason) {
      setError(reason.message || uiText('Không tải được đơn mua và phiếu nhận hàng.'));
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [workflowApproval]);

  useEffect(() => { load(); }, [load]);
  return { ...data, loading, error, setError, load };
}
