import { WORKBENCH_ROUTES } from '../lib/routes.js';

export function parseRoute(hash = location.hash) {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const [a, b, c, d] = parts;
  if (!a) return { name: 'home' };
  if (a === 'login' || a === 'signup') return { name: a };
  if (a === 'forgot-password') return { name: 'forgot-password' };
  if (a === 'reset-password' && b) return { name: 'reset-password', token: b };
  if (a === 'verify-email' && b) return { name: 'verify-email', token: b };
  if (a === 'm' && b) return { name: 'module', module: b };
  if (a === 'consolidation') return { name: 'consolidation-workbench' };
  if (a === 'e' && b && c) return { name: 'entity', qname: `${b}.${c}`, id: d };
  if (WORKBENCH_ROUTES[a]) return { name: WORKBENCH_ROUTES[a] };
  if (a === 'reports' && b === 'accounting') return { name: 'accounting-reports' };
  if (a === 'reports' && b === 'bi' && c === 'dashboard' && d) return { name: 'bi-reports', view: 'dashboard', id: d };
  if (a === 'reports' && b === 'bi' && c === 'report' && d) return { name: 'bi-reports', view: 'report', id: d };
  if (a === 'reports' && b === 'bi') return { name: 'bi-reports', view: 'index' };
  if (a === 'reports' && b === 'manufacturing' && c === 'wip') return { name: 'manufacturing-wip' };
  if (a === 'reports' && b === 'asset' && c === 'depreciation-schedule') return { name: 'asset-depreciation-schedule' };
  if (a === 'reports' && b === 'inventory' && c === 'replenishment') return { name: 'inventory-replenishment' };
  if (a === 'reports' && b === 'inventory' && c === 'location-stock') return { name: 'inventory-location-stock' };
  if (a === 'reports' && b === 'inventory' && c === 'quality-holds') return { name: 'inventory-quality-holds' };
  if (a === 'reports' && b === 'inventory' && c === 'lot-expiry') return { name: 'inventory-lot-expiry' };
  if (a === 'reports' && b === 'restaurant' && c === 'kitchen-board') return { name: 'restaurant-kitchen-board' };
  if (a === 'reports' && b === 'logistics' && c === 'delivery-board') return { name: 'logistics-delivery-board' };
  if (a === 'reports' && b === 'hotel' && c === 'housekeeping-board') return { name: 'hotel-housekeeping-board' };
  if (a === 'reports' && b === 'inventory' && c === 'lots' && d && parts[4] === 'traceability') return { name: 'inventory-lot-traceability', lotId: d };
  if (a === 'reports' && b === 'budget' && c === 'variance') return { name: 'budget-variance' };
  if (a === 'reports' && b === 'crm' && c === 'pipeline') return { name: 'crm-pipeline' };
  if (a === 'reports' && b === 'marketing' && c === 'campaign-performance') return { name: 'marketing-campaign-performance' };
  if (a === 'reports' && b === 'helpdesk' && c === 'sla') return { name: 'helpdesk-sla' };
  if (a === 'settings') return { name: 'settings', tab: b || 'users' };
  if (a === 'account' && b === 'security') return { name: 'account-security' };
  return { name: 'not-found' };
}
