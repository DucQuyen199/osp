// Static workbench URLs have one canonical mapping shared by the URL parser
// and the navigation. Dynamic routes (records, reports, settings) stay explicit.
export const WORKBENCH_ROUTES = Object.freeze({
  events: 'events', pos: 'pos-terminal', clinic: 'clinic-workbench', pharmacy: 'pharmacy-workbench',
  education: 'education-workbench', lms: 'lms-workbench', quality: 'quality-workbench',
  communications: 'communication-workbench', payments: 'payments-workbench',
  assets: 'asset-workbench', utilities: 'utilities-workbench', finance: 'finance-operations',
  'event-ops': 'events-operations', 'field-service': 'field-service-workbench',
  'real-estate': 'real-estate-workbench', construction: 'construction-workbench',
  projects: 'project-workbench', subscriptions: 'subscription-workbench',
  charity: 'charity-workbench', cases: 'professional-services-workbench',
  wellness: 'wellness-booking-workbench', purchasing: 'purchasing-workbench',
  sourcing: 'purchasing-sourcing-workbench', sales: 'wholesale-sales-desk',
  maintenance: 'maintenance-workbench', recruitment: 'recruitment-workbench',
  payroll: 'payroll-workbench', people: 'hrm-operations', helpdesk: 'helpdesk-workbench',
  performance: 'performance-workbench', approvals: 'approval-workbench',
  contracts: 'contract-workbench', documents: 'document-workbench',
  integrations: 'integration-hub-workbench', loyalty: 'loyalty-workbench',
  expenses: 'expense-workbench', returns: 'sales-returns-workbench',
  'bank-reconciliation': 'bank-reconciliation-workbench',
  'inventory-counts': 'inventory-stock-count-workbench',
  'period-close': 'accounting-period-close', refunds: 'accounting-adjustment-refunds',
  settlements: 'accounting-settlement-workbench', einvoices: 'einvoice-workbench',
  ecommerce: 'ecommerce-order-desk', agriculture: 'agriculture-operations',
  hotel: 'hotel-frontdesk', workshop: 'auto-service-workshop',
  restaurant: 'restaurant-service', wholesale: 'wholesale-sales-desk',
});

export const workbenchHref = (path) => Object.hasOwn(WORKBENCH_ROUTES, path) ? `#/${path}` : '#/not-found';

export const recordHref = (qname, id) => {
  const separator = qname.indexOf('.');
  return `#/e/${qname.slice(0, separator)}/${qname.slice(separator + 1)}/${id}`;
};

export const listHref = (qname) => {
  const separator = qname.indexOf('.');
  return `#/e/${qname.slice(0, separator)}/${qname.slice(separator + 1)}`;
};
