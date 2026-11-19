import { useState } from 'react';
import { api, tenantPath } from '../../../lib/api.js';
import { statusLabel, uiText } from '../../../lib/i18n.js';

export function useInventoryLotExpiryWorkflow() {
  const [creatingWarehouse, setCreatingWarehouse] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(null);

  async function createWriteoff(warehouse) {
    setCreatingWarehouse(warehouse.id); setError(''); setNotice(null);
    try {
      const result = await api(tenantPath('/reports/inventory/lot-expiry/writeoff-counts'), {
        method: 'POST', body: { warehouseId: warehouse.id },
      });
      setNotice({
        id: result.id,
        message: result.existing
          ? `${uiText('Đã có phiếu kiểm kê')} ${statusLabel(result.status)} ${uiText('cho')} ${warehouse.name}.`
          : `${uiText('Đã tạo phiếu kiểm kê nháp gồm')} ${result.lineCount} ${uiText('vị trí lô hết hạn tại')} ${warehouse.name}.`,
      });
    } catch (reason) {
      setError(reason.message || uiText('Không tạo được phiếu kiểm kê xử lý hàng hết hạn.'));
    } finally {
      setCreatingWarehouse('');
    }
  }

  return { creatingWarehouse, error, notice, createWriteoff };
}
