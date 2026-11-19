import { useState } from 'react';
import { api, dataPath } from '../../../lib/api.js';
import { uiTextWith } from '../../../lib/i18n.js';
import restaurantEnglish from '../restaurant.en.js';

const t = (text) => uiTextWith(text, restaurantEnglish);

export function useRestaurantKitchenBoardWorkflow({ load, setError }) {
  const [busy, setBusy] = useState('');

  const transition = async (ticket, action) => {
    const key = `${ticket.id}:${action}`;
    setBusy(key);
    setError('');
    try {
      await api(dataPath('restaurant.kitchen_ticket', ticket.id, action), { method: 'POST' });
      await load(true);
    } catch (reason) {
      setError(reason.message || t('Không cập nhật được trạng thái phiếu bếp.'));
      await load(true);
    } finally {
      setBusy('');
    }
  };

  return { busy, transition };
}
