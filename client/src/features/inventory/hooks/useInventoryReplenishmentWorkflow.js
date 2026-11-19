import { useState } from 'react';
import { api, tenantPath } from '../../../lib/api.js';
import { uiText } from '../../../lib/i18n.js';

export function useInventoryReplenishmentWorkflow({ load, clearLoadError }) {
  const [creatingWarehouse, setCreatingWarehouse] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(null);

  async function createRequisition(warehouseId) {
    clearLoadError(); setCreatingWarehouse(warehouseId); setError(''); setNotice(null);
    try {
      const requisition = await api(tenantPath('/reports/inventory/replenishment/purchase-requisitions'), {
        method: 'POST', body: { warehouseId },
      });
      setNotice(requisition?.id ? {
        id: requisition.id,
        message: `${uiText('Đã tạo đề nghị mua nháp')} ${requisition.id}. ${uiText('Hãy bổ sung nhà cung cấp và đơn giá trước khi gửi duyệt.')}`,
      } : { message: uiText('Đã tạo đề nghị mua nháp.') });
      await load();
    } catch (reason) {
      await load();
      setError(reason.message || uiText('Không tạo được đề nghị mua.'));
    } finally {
      setCreatingWarehouse('');
    }
  }

  return { creatingWarehouse, error, notice, createRequisition };
}
