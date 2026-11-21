import { useCallback, useEffect, useState } from 'react';
import { uiTextWith } from '../../../lib/i18n.js';
import { app, can, loadAllResponse, loadIndependentData, loadRefs } from '../../../lib/state.js';
import { useLatestRequest } from '../../../lib/useLatestRequest.js';
import restaurantEnglish from '../restaurant.en.js';

const t = (text) => uiTextWith(text, restaurantEnglish);
const itemsOf = (response) => Array.isArray(response?.items) ? response.items : [];
const emptyResponse = () => ({ items: [] });
const emptyMap = () => new Map();
const emptyData = () => ({
  tables: [], menuItems: [], recipes: [], orders: [], tickets: [], payments: [], reservations: [],
  products: new Map(), units: new Map(), warehouses: new Map(),
});

/** Owns restaurant reference reads, polling, refresh/error state, and stale-response protection. */
export function useRestaurantServiceData() {
  const [data, setData] = useState(emptyData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const beginRequest = useLatestRequest();

  const load = useCallback(async (quiet = false) => {
    const isCurrent = beginRequest();
    if (!quiet) { setLoading(true); setError(''); }
    try {
      const canReadTickets = can('restaurant.kitchen_ticket.read');
      const canReadPayments = app.meta?.modules?.some((module) => module.id === 'accounting') && can('accounting.payment.read');
      const canReadReservations = can('restaurant.reservation.read');
      const { data: reads, errors } = await loadIndependentData({
        tables: can('restaurant.table.read') ? loadAllResponse('restaurant.table') : Promise.resolve(emptyResponse()),
        menu: can('restaurant.menu_item.read') ? loadAllResponse('restaurant.menu_item') : Promise.resolve(emptyResponse()),
        recipes: can('restaurant.recipe.read') ? loadAllResponse('restaurant.recipe') : Promise.resolve(emptyResponse()),
        orders: can('restaurant.table_order.read') ? loadAllResponse('restaurant.table_order') : Promise.resolve(emptyResponse()),
        products: can('master-data.product.read') ? loadRefs('master-data.product') : Promise.resolve(emptyMap()),
        units: can('master-data.uom.read') ? loadRefs('master-data.uom') : Promise.resolve(emptyMap()),
        warehouses: can('inventory.warehouse.read') ? loadRefs('inventory.warehouse') : Promise.resolve(emptyMap()),
        tickets: canReadTickets ? loadAllResponse('restaurant.kitchen_ticket') : Promise.resolve(emptyResponse()),
        payments: canReadPayments ? loadAllResponse('accounting.payment') : Promise.resolve(emptyResponse()),
        reservations: canReadReservations ? loadAllResponse('restaurant.reservation') : Promise.resolve(emptyResponse()),
      }, {
        tables: emptyResponse(), menu: emptyResponse(), recipes: emptyResponse(), orders: emptyResponse(),
        products: emptyMap(), units: emptyMap(), warehouses: emptyMap(), tickets: emptyResponse(),
        payments: emptyResponse(), reservations: emptyResponse(),
      });
      if (!isCurrent()) return;
      const orders = itemsOf(reads.orders).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
      const reservations = itemsOf(reads.reservations).sort((a, b) => String(a.starts_at || '').localeCompare(String(b.starts_at || '')));
      setData({
        tables: itemsOf(reads.tables), menuItems: itemsOf(reads.menu), recipes: itemsOf(reads.recipes), orders,
        products: reads.products, units: reads.units, warehouses: reads.warehouses,
        tickets: itemsOf(reads.tickets), payments: itemsOf(reads.payments), reservations,
      });
      if (errors.length) setError(errors.map((reason) => reason?.message || t('Không tải được dữ liệu nhà hàng.')).join(' · '));
    } catch (reason) {
      if (isCurrent()) setError(reason.message || t('Không tải được dữ liệu nhà hàng.'));
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [beginRequest]);

  useEffect(() => {
    load();
    const timer = window.setInterval(() => load(true), 15000);
    return () => window.clearInterval(timer);
  }, [load]);

  return { ...data, loading, error, setError, load };
}
