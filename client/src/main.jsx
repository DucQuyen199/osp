import React, { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import EntityListPage from './EntityListPage.jsx';
import EntityDetailPage from './EntityDetailPage.jsx';
import EventsPage from './EventsPage.jsx';
import HomePage from './HomePage.jsx';
import ModuleOverviewPage from './ModuleOverviewPage.jsx';
import AccountingReportsPage from './AccountingReportsPage.jsx';
import InventoryReplenishmentPage from './InventoryReplenishmentPage.jsx';
import InventoryLocationStockPage from './InventoryLocationStockPage.jsx';
import InventoryQualityHoldsPage from './InventoryQualityHoldsPage.jsx';
import InventoryLotTraceabilityPage from './InventoryLotTraceabilityPage.jsx';
import InventoryLotExpiryPage from './InventoryLotExpiryPage.jsx';
import RestaurantKitchenBoardPage from './RestaurantKitchenBoardPage.jsx';
import LogisticsDeliveryBoardPage from './LogisticsDeliveryBoardPage.jsx';
import HotelHousekeepingBoardPage from './HotelHousekeepingBoardPage.jsx';
import AssetDepreciationSchedulePage from './AssetDepreciationSchedulePage.jsx';
import BudgetVariancePage from './BudgetVariancePage.jsx';
import CrmPipelinePage from './CrmPipelinePage.jsx';
import MarketingCampaignPerformancePage from './MarketingCampaignPerformancePage.jsx';
import HelpdeskSlaPage from './HelpdeskSlaPage.jsx';
import BiReportsPage from './BiReportsPage.jsx';
import ModuleSettingsPage from './ModuleSettingsPage.jsx';
import UsersSettingsPage from './UsersSettingsPage.jsx';
import RolesSettingsPage from './RolesSettingsPage.jsx';
import InventorySettingsPage from './InventorySettingsPage.jsx';
import BudgetSettingsPage from './BudgetSettingsPage.jsx';
import CurrencySettingsPage from './CurrencySettingsPage.jsx';
import TokensSettingsPage from './TokensSettingsPage.jsx';
import AuditSettingsPage from './AuditSettingsPage.jsx';
import FailuresSettingsPage from './FailuresSettingsPage.jsx';
import OutboxSettingsPage from './OutboxSettingsPage.jsx';
import FieldsSettingsPage from './FieldsSettingsPage.jsx';
import DataSettingsPage from './DataSettingsPage.jsx';
import MfaSettingsPage from './MfaSettingsPage.jsx';
import AuthPage from './AuthPage.jsx';
import { api, onUnauthorized, session } from './lib/api.js';
import { CATEGORY_ORDER, categoryLabel } from './lib/i18n.js';
import { app, can, entityLabel, isAdmin, loadMeta, loadSummary, resetCaches } from './lib/state.js';
import { listHref } from './lib/routes.js';

const PosTerminalPage = lazy(() => import('./PosTerminalPage.jsx'));
const ManufacturingWipPage = lazy(() => import('./ManufacturingWipPage.jsx'));
const ClinicWorkbenchPage = lazy(() => import('./ClinicWorkbenchPage.jsx'));
const EcommerceOrderDeskPage = lazy(() => import('./EcommerceOrderDeskPage.jsx'));
const AgricultureOperationsPage = lazy(() => import('./AgricultureOperationsPage.jsx'));
const HotelFrontDeskPage = lazy(() => import('./HotelFrontDeskPage.jsx'));
const AutoServiceWorkshopPage = lazy(() => import('./AutoServiceWorkshopPage.jsx'));
const RestaurantServicePage = lazy(() => import('./RestaurantServicePage.jsx'));
const WholesaleSalesDeskPage = lazy(() => import('./WholesaleSalesDeskPage.jsx'));
const PharmacyWorkbenchPage = lazy(() => import('./PharmacyWorkbenchPage.jsx'));
const EducationWorkbenchPage = lazy(() => import('./EducationWorkbenchPage.jsx'));
const UtilitiesWorkbenchPage = lazy(() => import('./UtilitiesWorkbenchPage.jsx'));
const FinanceOperationsPage = lazy(() => import('./FinanceOperationsPage.jsx'));
const EventsOperationsPage = lazy(() => import('./EventsOperationsPage.jsx'));
const FieldServiceWorkbenchPage = lazy(() => import('./FieldServiceWorkbenchPage.jsx'));
const RealEstateWorkbenchPage = lazy(() => import('./RealEstateWorkbenchPage.jsx'));
const ConstructionWorkbenchPage = lazy(() => import('./ConstructionWorkbenchPage.jsx'));
const ProjectWorkbenchPage = lazy(() => import('./ProjectWorkbenchPage.jsx'));
const SubscriptionWorkbenchPage = lazy(() => import('./SubscriptionWorkbenchPage.jsx'));
const CharityWorkbenchPage = lazy(() => import('./CharityWorkbenchPage.jsx'));
const ProfessionalServicesWorkbenchPage = lazy(() => import('./ProfessionalServicesWorkbenchPage.jsx'));
const WellnessBookingPage = lazy(() => import('./WellnessBookingPage.jsx'));
const PurchasingWorkbenchPage = lazy(() => import('./PurchasingWorkbenchPage.jsx'));
const PurchasingSourcingWorkbenchPage = lazy(() => import('./PurchasingSourcingWorkbenchPage.jsx'));
const MaintenanceWorkbenchPage = lazy(() => import('./MaintenanceWorkbenchPage.jsx'));
const RecruitmentWorkbenchPage = lazy(() => import('./RecruitmentWorkbenchPage.jsx'));
const PayrollWorkbenchPage = lazy(() => import('./PayrollWorkbenchPage.jsx'));
const HrmOperationsPage = lazy(() => import('./HrmOperationsPage.jsx'));
const ExpenseWorkbenchPage = lazy(() => import('./ExpenseWorkbenchPage.jsx'));
const SalesReturnsWorkbenchPage = lazy(() => import('./SalesReturnsWorkbenchPage.jsx'));
const BankReconciliationWorkbenchPage = lazy(() => import('./BankReconciliationWorkbenchPage.jsx'));
const AccountingPeriodClosePage = lazy(() => import('./AccountingPeriodClosePage.jsx'));
const AccountingAdjustmentRefundsPage = lazy(() => import('./AccountingAdjustmentRefundsPage.jsx'));
const AccountingSettlementWorkbenchPage = lazy(() => import('./AccountingSettlementWorkbenchPage.jsx'));
const InventoryStockCountWorkbenchPage = lazy(() => import('./InventoryStockCountWorkbenchPage.jsx'));
const EInvoiceWorkbenchPage = lazy(() => import('./EInvoiceWorkbenchPage.jsx'));
const HelpdeskWorkbenchPage = lazy(() => import('./HelpdeskWorkbenchPage.jsx'));
const PerformanceWorkbenchPage = lazy(() => import('./PerformanceWorkbenchPage.jsx'));
const ApprovalWorkbenchPage = lazy(() => import('./ApprovalWorkbenchPage.jsx'));
const ContractWorkbenchPage = lazy(() => import('./ContractWorkbenchPage.jsx'));
const DocumentWorkbenchPage = lazy(() => import('./DocumentWorkbenchPage.jsx'));
const IntegrationHubPage = lazy(() => import('./IntegrationHubPage.jsx'));
const LoyaltyWorkbenchPage = lazy(() => import('./LoyaltyWorkbenchPage.jsx'));
const LmsWorkbenchPage = lazy(() => import('./LmsWorkbenchPage.jsx'));
const QualityWorkbenchPage = lazy(() => import('./QualityWorkbenchPage.jsx'));

function parseRoute(hash = location.hash) {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const [a, b, c, d] = parts;
  if (!a) return { name: 'home' };
  if (a === 'login' || a === 'signup') return { name: a };
  if (a === 'forgot-password') return { name: 'forgot-password' };
  if (a === 'reset-password' && b) return { name: 'reset-password', token: b };
  if (a === 'verify-email' && b) return { name: 'verify-email', token: b };
  if (a === 'm' && b) return { name: 'module', module: b };
  if (a === 'e' && b && c) return { name: 'entity', qname: `${b}.${c}`, id: d };
  if (a === 'events') return { name: 'events' };
  if (a === 'pos') return { name: 'pos-terminal' };
  if (a === 'clinic') return { name: 'clinic-workbench' };
  if (a === 'pharmacy') return { name: 'pharmacy-workbench' };
  if (a === 'education') return { name: 'education-workbench' };
  if (a === 'lms') return { name: 'lms-workbench' };
  if (a === 'quality') return { name: 'quality-workbench' };
  if (a === 'utilities') return { name: 'utilities-workbench' };
  if (a === 'finance') return { name: 'finance-operations' };
  if (a === 'event-ops') return { name: 'events-operations' };
  if (a === 'field-service') return { name: 'field-service-workbench' };
  if (a === 'real-estate') return { name: 'real-estate-workbench' };
  if (a === 'construction') return { name: 'construction-workbench' };
  if (a === 'projects') return { name: 'project-workbench' };
  if (a === 'subscriptions') return { name: 'subscription-workbench' };
  if (a === 'charity') return { name: 'charity-workbench' };
  if (a === 'cases') return { name: 'professional-services-workbench' };
  if (a === 'wellness') return { name: 'wellness-booking-workbench' };
  if (a === 'purchasing') return { name: 'purchasing-workbench' };
  if (a === 'sourcing') return { name: 'purchasing-sourcing-workbench' };
  if (a === 'sales') return { name: 'wholesale-sales-desk' };
  if (a === 'maintenance') return { name: 'maintenance-workbench' };
  if (a === 'recruitment') return { name: 'recruitment-workbench' };
  if (a === 'payroll') return { name: 'payroll-workbench' };
  if (a === 'people') return { name: 'hrm-operations' };
  if (a === 'helpdesk') return { name: 'helpdesk-workbench' };
  if (a === 'performance') return { name: 'performance-workbench' };
  if (a === 'approvals') return { name: 'approval-workbench' };
  if (a === 'contracts') return { name: 'contract-workbench' };
  if (a === 'documents') return { name: 'document-workbench' };
  if (a === 'integrations') return { name: 'integration-hub-workbench' };
  if (a === 'loyalty') return { name: 'loyalty-workbench' };
  if (a === 'expenses') return { name: 'expense-workbench' };
  if (a === 'returns') return { name: 'sales-returns-workbench' };
  if (a === 'bank-reconciliation') return { name: 'bank-reconciliation-workbench' };
  if (a === 'inventory-counts') return { name: 'inventory-stock-count-workbench' };
  if (a === 'period-close') return { name: 'accounting-period-close' };
  if (a === 'refunds') return { name: 'accounting-adjustment-refunds' };
  if (a === 'settlements') return { name: 'accounting-settlement-workbench' };
  if (a === 'einvoices') return { name: 'einvoice-workbench' };
  if (a === 'ecommerce') return { name: 'ecommerce-order-desk' };
  if (a === 'agriculture') return { name: 'agriculture-operations' };
  if (a === 'hotel') return { name: 'hotel-frontdesk' };
  if (a === 'workshop') return { name: 'auto-service-workshop' };
  if (a === 'restaurant') return { name: 'restaurant-service' };
  if (a === 'wholesale') return { name: 'wholesale-sales-desk' };
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
  return { name: 'home' };
}

const ICONS = {
  menu: 'M4 6h16M4 12h16M4 18h16', home: 'M4 11l8-7 8 7M6 10v9h4v-6h4v6h4v-9',
  search: 'M11 4a7 7 0 100 14 7 7 0 000-14zM20 20l-4-4',
  moon: 'M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z', sun: 'M12 8a4 4 0 100 8 4 4 0 000-8zM12 2v2M12 20v2M2 12h2M20 12h2',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  bolt: 'M13 2L4 14h7l-1 8 10-12h-7l1-8z', settings: 'M12 8a4 4 0 100 8 4 4 0 000-8zM4 12l-2-1 2-4 2 1 2-2-.5-2h5l.5 2 2 1 2-1 2 4-2 1v2l2 1-2 4-2-1-2 1-.5 2h-5L8 19l-2-1-2 1-2-4 2-1z',
  logout: 'M10 4H6a2 2 0 00-2 2v12a2 2 0 002 2h4M16 8l4 4-4 4M20 12H9',
};

function Icon({ name }) {
  return <svg className="icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ICONS[name] || ICONS.grid} /></svg>;
}

function Search({ meta, onNavigate }) {
  const [query, setQuery] = useState('');
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !meta) return [];
    const found = [];
    for (const mod of meta.modules) {
      if (mod.name.toLowerCase().includes(q) || mod.id.includes(q)) found.push({ href: `#/m/${mod.id}`, title: mod.name, sub: `${mod.entities.length} loại dữ liệu`, icon: 'grid' });
      for (const entity of mod.entities) {
        const qname = `${mod.id}.${entity.name}`;
        const label = entityLabel(qname);
        if (label.toLowerCase().includes(q) || entity.name.includes(q)) found.push({ href: listHref(qname), title: label, sub: mod.name, icon: 'list' });
      }
    }
    return found.slice(0, 8);
  }, [query, meta]);
  return <div className="global-search">
    <Icon name="search" />
    <input className="input global-search-input" type="search" placeholder="Tìm module hoặc dữ liệu…" aria-label="Tìm module hoặc dữ liệu" aria-keyshortcuts="Control+K" value={query} onChange={(event) => setQuery(event.target.value)} />
    {query.trim() && <div className="global-search-results" role="listbox" aria-label="Kết quả tìm kiếm">
      {matches.length ? matches.map((match) => <a key={match.href} className="global-search-result" href={match.href} role="option" onClick={() => { setQuery(''); onNavigate(); }}><Icon name={match.icon} /><span><strong>{match.title}</strong><small>{match.sub}</small></span></a>) : <div className="global-search-empty">Không tìm thấy module hoặc dữ liệu phù hợp.</div>}
    </div>}
  </div>;
}

function Sidebar({ meta, route, onNavigate, open }) {
  const activeModule = route.name === 'module' ? route.module : route.name === 'entity' ? route.qname.split('.')[0] : null;
  const link = (href, label, active, iconName) => <a key={href} className="nav-link" href={href} aria-current={active ? 'page' : undefined} onClick={onNavigate}>{iconName && <Icon name={iconName} />}{label}</a>;
  const groups = CATEGORY_ORDER.map((category) => [category, meta.modules.filter((module) => module.category === category)]).filter(([, items]) => items.length);
  return <nav className={`sidebar${open ? ' open' : ''}`} id="nav" aria-label="Điều hướng chính">
    {link('#/', 'Trang chủ', route.name === 'home', 'home')}
    {link('#/events', 'Dòng sự kiện', route.name === 'events', 'bolt')}
    {meta.modules.some((module) => module.id === 'bi') && (can('bi.report.read') || can('bi.dashboard.read')) && link('#/reports/bi', 'Báo cáo & phân tích', route.name === 'bi-reports', 'list')}
    {meta.modules.some((module) => module.id === 'workflow-approval') && (can('workflow-approval.approval_request.read') || can('workflow-approval.approval_request.approved') || can('workflow-approval.approval_request.rejected') || can('workflow-approval.approval_rule.read') || can('workflow-approval.approval_rule.create') || can('workflow-approval.approval_rule.update')) && link('#/approvals', 'Phê duyệt', route.name === 'approval-workbench', 'list')}
    {meta.modules.some((module) => module.id === 'contract') && can('contract.contract.read') && link('#/contracts', 'Sổ hợp đồng', route.name === 'contract-workbench', 'list')}
    {meta.modules.some((module) => module.id === 'document') && (can('document.document.read') || can('document.document.create') || can('document.folder.read')) && link('#/documents', 'Thư viện tài liệu', route.name === 'document-workbench', 'list')}
    {meta.modules.some((module) => module.id === 'integration-hub') && (can('integration-hub.connector.read') || can('integration-hub.connector.create') || can('integration-hub.webhook.read') || can('integration-hub.webhook.create')) && link('#/integrations', 'Cổng tích hợp', route.name === 'integration-hub-workbench', 'list')}
    {meta.modules.some((module) => module.id === 'loyalty') && (can('loyalty.member.read') || can('loyalty.member.create') || can('loyalty.voucher.read') || can('loyalty.voucher.create')) && link('#/loyalty', 'Khách hàng thân thiết', route.name === 'loyalty-workbench', 'list')}
    {meta.modules.some((module) => module.id === 'accounting') && can('accounting.journal_entry.read') && link('#/reports/accounting', 'Báo cáo kế toán', route.name === 'accounting-reports', 'list')}
    {meta.modules.some((module) => module.id === 'manufacturing') && can('manufacturing.production_order.read') && link('#/reports/manufacturing/wip', 'WIP sản xuất', route.name === 'manufacturing-wip', 'list')}
    {meta.modules.some((module) => module.id === 'asset') && can('asset.asset.read') && link('#/reports/asset/depreciation-schedule', 'Lịch khấu hao tài sản', route.name === 'asset-depreciation-schedule', 'list')}
    {meta.modules.some((module) => module.id === 'inventory') && can('inventory.reorder_rule.read') && link('#/reports/inventory/replenishment', 'Bổ sung tồn kho', route.name === 'inventory-replenishment', 'list')}
    {meta.modules.some((module) => module.id === 'inventory') && can('inventory.stock_move.read') && link('#/reports/inventory/location-stock', 'Tồn theo vị trí', route.name === 'inventory-location-stock', 'list')}
    {meta.modules.some((module) => module.id === 'inventory') && can('inventory.lot.read') && can('inventory.stock_move.read') && link('#/reports/inventory/lot-expiry', 'Lô sắp hết hạn', route.name === 'inventory-lot-expiry', 'list')}
    {meta.modules.some((module) => module.id === 'inventory') && can('inventory.stock_count.read') && link('#/inventory-counts', 'Kiểm kê kho', route.name === 'inventory-stock-count-workbench', 'list')}
    {meta.modules.some((module) => module.id === 'restaurant') && can('restaurant.kitchen_ticket.read') && link('#/reports/restaurant/kitchen-board', 'Màn hình bếp', route.name === 'restaurant-kitchen-board', 'list')}
    {meta.modules.some((module) => module.id === 'logistics') && can('logistics.shipment.read') && link('#/reports/logistics/delivery-board', 'Điều phối giao hàng', route.name === 'logistics-delivery-board', 'list')}
    {meta.modules.some((module) => module.id === 'hotel') && can('hotel.room.read') && link('#/reports/hotel/housekeeping-board', 'Buồng phòng', route.name === 'hotel-housekeeping-board', 'list')}
    {meta.modules.some((module) => module.id === 'pos') && can('pos.pos_session.read') && can('pos.pos_order.create') && link('#/pos', 'Quầy bán hàng POS', route.name === 'pos-terminal', 'list')}
    {meta.modules.some((module) => module.id === 'clinic') && can('clinic.encounter.read') && can('clinic.encounter.create') && link('#/clinic', 'Điều phối phòng khám', route.name === 'clinic-workbench', 'list')}
    {meta.modules.some((module) => module.id === 'pharmacy') && can('pharmacy.prescription.read') && link('#/pharmacy', 'Đơn thuốc nhà thuốc', route.name === 'pharmacy-workbench', 'list')}
    {meta.modules.some((module) => module.id === 'school') && (can('school.class_session.read') || can('school.fee.read')) && link('#/education', 'Lịch lớp và học phí', route.name === 'education-workbench', 'list')}
    {meta.modules.some((module) => module.id === 'lms') && (can('lms.course.read') || can('lms.course.create') || can('lms.enrollment.read')) && link('#/lms', 'Đào tạo trực tuyến', route.name === 'lms-workbench', 'list')}
    {meta.modules.some((module) => module.id === 'quality') && (can('quality.nonconformance.read') || can('quality.nonconformance.create')) && link('#/quality', 'Sổ sự không phù hợp', route.name === 'quality-workbench', 'list')}
    {meta.modules.some((module) => module.id === 'utilities') && can('utilities.meter_reading.read') && link('#/utilities', 'Công tơ và hóa đơn tiện ích', route.name === 'utilities-workbench', 'list')}
    {meta.modules.some((module) => ['lending', 'insurance'].includes(module.id)) && (can('lending.loan.read') || can('insurance.policy.read')) && link('#/finance', 'Cho vay và bảo hiểm', route.name === 'finance-operations', 'list')}
    {meta.modules.some((module) => module.id === 'events') && can('events.ticket.read') && can('events.event.read') && link('#/event-ops', 'Sự kiện và quầy vé', route.name === 'events-operations', 'list')}
    {meta.modules.some((module) => module.id === 'field-service') && can('field-service.work_order.read') && link('#/field-service', 'Điều phối hiện trường', route.name === 'field-service-workbench', 'list')}
    {meta.modules.some((module) => module.id === 'real-estate') && can('real-estate.property.read') && link('#/real-estate', 'Sàn bất động sản', route.name === 'real-estate-workbench', 'list')}
    {meta.modules.some((module) => module.id === 'construction') && (can('construction.boq.read') || can('construction.site.read')) && link('#/construction', 'Điều hành công trường', route.name === 'construction-workbench', 'list')}
    {meta.modules.some((module) => module.id === 'project') && can('project.project.read') && link('#/projects', 'Quản lý dự án', route.name === 'project-workbench', 'list')}
    {meta.modules.some((module) => module.id === 'subscription') && can('subscription.subscription.read') && link('#/subscriptions', 'Thuê bao và gia hạn', route.name === 'subscription-workbench', 'list')}
    {meta.modules.some((module) => module.id === 'charity') && can('charity.program.read') && link('#/charity', 'Chương trình và quỹ', route.name === 'charity-workbench', 'list')}
    {meta.modules.some((module) => module.id === 'case-management') && can('case-management.case.read') && link('#/cases', 'Hồ sơ dịch vụ', route.name === 'professional-services-workbench', 'list')}
    {meta.modules.some((module) => module.id === 'booking') && can('booking.booking.read') && link('#/wellness', meta.modules.some((module) => module.id === 'clinic') ? 'Lịch hẹn khám' : 'Lịch dịch vụ', route.name === 'wellness-booking-workbench', 'list')}
    {meta.modules.some((module) => module.id === 'purchasing') && can('purchasing.purchase_order.read') && link('#/purchasing', 'Mua hàng và nhận hàng', route.name === 'purchasing-workbench', 'list')}
    {meta.modules.some((module) => module.id === 'purchasing') && can('purchasing.rfq.read') && link('#/sourcing', 'RFQ và so sánh báo giá', route.name === 'purchasing-sourcing-workbench', 'list')}
    {meta.modules.some((module) => module.id === 'maintenance') && can('maintenance.maintenance_request.read') && link('#/maintenance', 'Bảo trì tài sản', route.name === 'maintenance-workbench', 'list')}
    {meta.modules.some((module) => module.id === 'recruitment') && can('recruitment.application.read') && link('#/recruitment', 'Tuyển dụng', route.name === 'recruitment-workbench', 'list')}
    {meta.modules.some((module) => module.id === 'payroll') && can('payroll.payroll_run.read') && link('#/payroll', 'Điều hành bảng lương', route.name === 'payroll-workbench', 'list')}
    {meta.modules.some((module) => module.id === 'hrm') && can('hrm.employee.read') && link('#/people', 'Nhân sự và chấm công', route.name === 'hrm-operations', 'list')}
    {meta.modules.some((module) => module.id === 'performance') && (can('performance.objective.read') || can('performance.review.read')) && link('#/performance', 'Mục tiêu & đánh giá', route.name === 'performance-workbench', 'list')}
    {meta.modules.some((module) => module.id === 'expense') && can('expense.expense_claim.read') && link('#/expenses', 'Chi phí nhân viên', route.name === 'expense-workbench', 'list')}
    {meta.modules.some((module) => module.id === 'sales') && can('sales.sales_return.read') && link('#/returns', 'Trả hàng bán', route.name === 'sales-returns-workbench', 'list')}
    {meta.modules.some((module) => module.id === 'accounting') && can('accounting.bank_statement.read') && link('#/bank-reconciliation', 'Đối soát ngân hàng', route.name === 'bank-reconciliation-workbench', 'list')}
    {meta.modules.some((module) => module.id === 'accounting') && can('accounting.payment.create') && can('accounting.payment.read') && ((can('accounting.credit_note.read') && can('accounting.invoice.read')) || (can('accounting.debit_note.read') && can('accounting.bill.read'))) && link('#/refunds', 'Hoàn tiền điều chỉnh', route.name === 'accounting-adjustment-refunds', 'payment')}
    {meta.modules.some((module) => module.id === 'accounting') && can('accounting.settlement_batch.read') && link('#/settlements', 'Thu/chi phân bổ công nợ', route.name === 'accounting-settlement-workbench', 'payment')}
    {meta.modules.some((module) => module.id === 'einvoice') && can('einvoice.einvoice.read') && link('#/einvoices', 'Hóa đơn điện tử', route.name === 'einvoice-workbench', 'list')}
    {meta.modules.some((module) => module.id === 'accounting') && can('accounting.period.read') && link('#/period-close', 'Khóa sổ kế toán', route.name === 'accounting-period-close', 'list')}
    {meta.modules.some((module) => module.id === 'ecommerce') && can('ecommerce.web_order.read') && link('#/ecommerce', 'Đơn hàng online', route.name === 'ecommerce-order-desk', 'list')}
    {meta.modules.some((module) => module.id === 'agriculture') && can('agriculture.crop_cycle.read') && link('#/agriculture', 'Điều hành mùa vụ', route.name === 'agriculture-operations', 'list')}
    {meta.modules.some((module) => module.id === 'hotel') && can('hotel.reservation.read') && link('#/hotel', 'Lễ tân khách sạn', route.name === 'hotel-frontdesk', 'list')}
    {meta.modules.some((module) => module.id === 'auto-service') && can('auto-service.repair_order.read') && link('#/workshop', 'Xưởng sửa chữa', route.name === 'auto-service-workshop', 'list')}
    {meta.modules.some((module) => module.id === 'restaurant') && can('restaurant.table_order.read') && can('restaurant.table_order.create') && link('#/restaurant', 'Order nhà hàng', route.name === 'restaurant-service', 'list')}
    {meta.modules.some((module) => module.id === 'sales') && can('sales.quotation.read') && can('sales.quotation.create') && link('#/sales', 'Bán hàng và báo giá', route.name === 'wholesale-sales-desk', 'list')}
    {meta.modules.some((module) => module.id === 'inventory') && meta.modules.some((module) => module.id === 'quality') && can('inventory.stock_move.read') && can('quality.inspection.read') && link('#/reports/inventory/quality-holds', 'Hàng giữ QC', route.name === 'inventory-quality-holds', 'list')}
    {meta.modules.some((module) => module.id === 'budget') && can('budget.budget.read') && link('#/reports/budget/variance', 'Thực hiện ngân sách', route.name === 'budget-variance', 'list')}
    {meta.modules.some((module) => module.id === 'crm') && can('crm.deal.read') && link('#/reports/crm/pipeline', 'Pipeline bán hàng', route.name === 'crm-pipeline', 'list')}
    {meta.modules.some((module) => module.id === 'marketing') && can('marketing.campaign.read') && link('#/reports/marketing/campaign-performance', 'Hiệu quả chiến dịch', route.name === 'marketing-campaign-performance', 'list')}
    {meta.modules.some((module) => module.id === 'helpdesk') && can('helpdesk.ticket.read') && link('#/reports/helpdesk/sla', 'SLA hỗ trợ', route.name === 'helpdesk-sla', 'list')}
    {meta.modules.some((module) => module.id === 'helpdesk') && can('helpdesk.ticket.read') && link('#/helpdesk', 'Hộp thư hỗ trợ', route.name === 'helpdesk-workbench', 'list')}
    {groups.map(([category, modules]) => <div className="nav-group" key={category}>
      <div className="nav-title">{category === 'core' ? 'Dữ liệu gốc' : categoryLabel(category)}</div>
      {modules.map((module) => <details className="nav-mod" key={module.id} open={activeModule === module.id || module.core}>
        <summary className="nav-sum">{module.name}<span className="chev">›</span></summary>
        <div className="nav-sub">
          {link(`#/m/${module.id}`, 'Tổng quan', route.name === 'module' && route.module === module.id)}
          {module.entities.map((entity) => { const qname = `${module.id}.${entity.name}`; return link(listHref(qname), entityLabel(qname), route.name === 'entity' && route.qname === qname); })}
        </div>
      </details>)}
    </div>)}
    {isAdmin() && <div className="nav-group"><div className="nav-title">Quản trị</div>{link('#/settings', 'Cài đặt', route.name === 'settings', 'settings')}</div>}
  </nav>;
}

function App() {
  const [route, setRoute] = useState(() => parseRoute());
  const [ready, setReady] = useState(false);
  const [meta, setMeta] = useState(null);
  const [user, setUser] = useState(null);
  const [error, setError] = useState('');
  const [navOpen, setNavOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [theme, setTheme] = useState(() => { try { return localStorage.getItem('osp.theme') || ''; } catch { return ''; } });
  const [, setEpoch] = useState(0);
  const authenticated = Boolean(session.current());

  const refresh = useCallback(() => setEpoch((value) => value + 1), []);
  const signedIn = useCallback(async () => {
    try {
      const loaded = await loadMeta();
      await loadSummary();
      setMeta(loaded);
      setUser(app.user);
      setError('');
      refresh();
      setRoute(parseRoute());
    } catch (reason) {
      session.clear();
      resetCaches();
      setError(reason.message || 'Không tải được dữ liệu doanh nghiệp.');
      setRoute({ name: 'login' });
      refresh();
    }
  }, [refresh]);

  useEffect(() => {
    const changed = () => { setRoute(parseRoute()); setNavOpen(false); };
    const metaChanged = () => { setMeta(app.meta); setUser(app.user); };
    window.addEventListener('hashchange', changed);
    window.addEventListener('osp:meta', metaChanged);
    document.documentElement.dataset.theme = theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const stop = onUnauthorized(() => { session.clear(); setMeta(null); setUser(null); setError('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'); location.hash = '#/login'; refresh(); });
    return () => { window.removeEventListener('hashchange', changed); window.removeEventListener('osp:meta', metaChanged); stop?.(); };
  }, [theme, refresh]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const params = new URLSearchParams(location.search);
      if (params.get('demo') && !session.current()) {
        try {
          const response = await api('/api/demo', { method: 'POST', body: { vertical: params.get('demo') } });
          session.set({ tenantId: response.tenantId, token: response.token }, false);
          history.replaceState(null, '', `${location.pathname}#${params.get('go') || '/'}`);
          setRoute(parseRoute());
        } catch { /* show the login page */ }
      }
      if (session.current()) {
        try {
          const loaded = await loadMeta();
          await loadSummary();
          if (alive) { setMeta(loaded); setUser(app.user); }
        } catch {
          session.clear();
          resetCaches();
        }
      }
      if (alive) setReady(true);
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!ready) return;
    if (session.current() && ['login', 'signup', 'forgot-password', 'reset-password', 'verify-email'].includes(route.name)) {
      location.hash = '#/';
      return;
    }
    if (!session.current() && !['login', 'signup', 'forgot-password', 'reset-password', 'verify-email'].includes(route.name)) setRoute({ name: 'login' });
  }, [ready, route]);

  const toggleTheme = () => {
    const next = (document.documentElement.dataset.theme || 'light') === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('osp.theme', next); } catch { /* theme remains active in memory */ }
    setTheme(next);
  };

  const logout = async () => {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* session may have expired */ }
    session.clear();
    resetCaches();
    app.meta = null;
    setMeta(null);
    setUser(null);
    setAccountOpen(false);
    location.hash = '#/login';
    refresh();
  };

  useEffect(() => {
    const shortcut = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        document.querySelector('.global-search-input')?.focus();
      }
      if (event.key === 'Escape') setAccountOpen(false);
    };
    document.addEventListener('keydown', shortcut);
    return () => document.removeEventListener('keydown', shortcut);
  }, []);

  useEffect(() => {
    if (!ready || !session.current() || !meta || !user) return;
    const heading = document.querySelector('#main h1');
    const target = heading || document.getElementById('main');
    if (!target) return;
    if (heading && !heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
    target.focus();
  }, [route, ready, meta, user]);

  if (!ready) return <div className="landing-panel"><div className="skeleton" data-h="row" /></div>;
  if (!session.current()) return <>
    {error && <div className="toast toast-danger" role="alert">{error}</div>}
    <AuthPage route={route} onSignedIn={signedIn} />
  </>;
  if (!meta || !user) return <div className="page"><div className="alert danger">Không tải được dữ liệu doanh nghiệp. Vui lòng tải lại trang.</div></div>;

  const initials = (user.name || '?').split(' ').slice(-2).map((part) => part[0]).join('').toUpperCase();
  return <>
    <a className="skip-link" href="#main">Bỏ qua điều hướng</a>
    <div className="app">
      <header className="topbar">
        <button className="btn btn-ghost btn-icon nav-toggle" type="button" aria-label="Mở menu" aria-expanded={navOpen} aria-controls="nav" onClick={() => setNavOpen((open) => !open)}><Icon name="menu" /></button>
        <a className="brand" href="#/"><span className="brand-mark">O</span>OSP</a>
        <span className="tenant-chip">{meta.name}</span>
        <span className="grow" />
        <Search meta={meta} onNavigate={() => setNavOpen(false)} />
        <button className="btn btn-ghost btn-icon" type="button" aria-label={theme === 'dark' ? 'Chuyển sang giao diện sáng' : 'Chuyển sang giao diện tối'} title={theme === 'dark' ? 'Giao diện sáng' : 'Giao diện tối'} onClick={toggleTheme}><Icon name={theme === 'dark' ? 'sun' : 'moon'} /></button>
        <div className="menu">
          <button className="btn btn-ghost" type="button" aria-haspopup="menu" aria-expanded={accountOpen} aria-label={`Tài khoản ${user.name}`} onClick={() => setAccountOpen((open) => !open)}><span className="avatar">{initials}</span></button>
          {accountOpen && <div className="menu-pop" role="menu">
            <div className="menu-item" role="none"><div><strong>{user.name}</strong><div className="faint">{user.email || 'Tài khoản máy'}</div></div></div>
            <a className="menu-item" role="menuitem" href="#/account/security" onClick={() => setAccountOpen(false)}>Bảo mật tài khoản</a>
            <button className="menu-item" role="menuitem" type="button" onClick={logout}><Icon name="logout" />Đăng xuất</button>
          </div>}
        </div>
      </header>
      <Sidebar meta={meta} route={route} open={navOpen} onNavigate={() => setNavOpen(false)} />
      <main className="main" id="main" tabIndex="-1">
      <Suspense fallback={<div className="card-pad"><div className="skeleton" data-h="row" /></div>}>
      {route.name === 'entity'
        ? <>
          <EntityListPage key={route.qname} qname={route.qname} />
          {route.id && <EntityDetailPage key={`${route.qname}:${route.id}`} qname={route.qname} id={route.id} />}
        </>
        : route.name === 'account-security' ? <MfaSettingsPage />
        : route.name === 'events' ? <EventsPage />
        : route.name === 'home' ? <HomePage summary={app.summary} />
        : route.name === 'module' ? <ModuleOverviewPage moduleId={route.module} summary={app.summary} />
        : route.name === 'accounting-reports' ? <AccountingReportsPage />
        : route.name === 'manufacturing-wip' ? <ManufacturingWipPage />
        : route.name === 'asset-depreciation-schedule' ? <AssetDepreciationSchedulePage />
        : route.name === 'inventory-replenishment' ? <InventoryReplenishmentPage />
        : route.name === 'inventory-location-stock' ? <InventoryLocationStockPage />
        : route.name === 'inventory-quality-holds' ? <InventoryQualityHoldsPage />
        : route.name === 'inventory-stock-count-workbench' ? <InventoryStockCountWorkbenchPage />
        : route.name === 'inventory-lot-traceability' ? <InventoryLotTraceabilityPage lotId={route.lotId} />
        : route.name === 'inventory-lot-expiry' ? <InventoryLotExpiryPage />
        : route.name === 'restaurant-kitchen-board' ? <RestaurantKitchenBoardPage />
        : route.name === 'logistics-delivery-board' ? <LogisticsDeliveryBoardPage />
        : route.name === 'hotel-housekeeping-board' ? <HotelHousekeepingBoardPage />
        : route.name === 'pos-terminal' ? <PosTerminalPage />
        : route.name === 'clinic-workbench' ? <ClinicWorkbenchPage />
        : route.name === 'pharmacy-workbench' ? <PharmacyWorkbenchPage />
        : route.name === 'education-workbench' ? <EducationWorkbenchPage />
        : route.name === 'lms-workbench' ? <LmsWorkbenchPage />
        : route.name === 'quality-workbench' ? <QualityWorkbenchPage />
        : route.name === 'utilities-workbench' ? <UtilitiesWorkbenchPage />
        : route.name === 'finance-operations' ? <FinanceOperationsPage />
        : route.name === 'events-operations' ? <EventsOperationsPage />
        : route.name === 'field-service-workbench' ? <FieldServiceWorkbenchPage />
        : route.name === 'real-estate-workbench' ? <RealEstateWorkbenchPage />
        : route.name === 'construction-workbench' ? <ConstructionWorkbenchPage />
        : route.name === 'project-workbench' ? <ProjectWorkbenchPage />
        : route.name === 'subscription-workbench' ? <SubscriptionWorkbenchPage />
        : route.name === 'charity-workbench' ? <CharityWorkbenchPage />
        : route.name === 'professional-services-workbench' ? <ProfessionalServicesWorkbenchPage />
        : route.name === 'wellness-booking-workbench' ? <WellnessBookingPage healthcare={meta.modules.some((module) => module.id === 'clinic')} />
        : route.name === 'purchasing-workbench' ? <PurchasingWorkbenchPage />
        : route.name === 'purchasing-sourcing-workbench' ? <PurchasingSourcingWorkbenchPage />
        : route.name === 'maintenance-workbench' ? <MaintenanceWorkbenchPage />
        : route.name === 'recruitment-workbench' ? <RecruitmentWorkbenchPage />
        : route.name === 'payroll-workbench' ? <PayrollWorkbenchPage />
        : route.name === 'hrm-operations' ? <HrmOperationsPage />
        : route.name === 'expense-workbench' ? <ExpenseWorkbenchPage />
        : route.name === 'sales-returns-workbench' ? <SalesReturnsWorkbenchPage />
        : route.name === 'bank-reconciliation-workbench' ? <BankReconciliationWorkbenchPage />
        : route.name === 'accounting-period-close' ? <AccountingPeriodClosePage />
        : route.name === 'accounting-adjustment-refunds' ? <AccountingAdjustmentRefundsPage />
        : route.name === 'accounting-settlement-workbench' ? <AccountingSettlementWorkbenchPage />
        : route.name === 'einvoice-workbench' ? <EInvoiceWorkbenchPage />
        : route.name === 'ecommerce-order-desk' ? <EcommerceOrderDeskPage />
        : route.name === 'agriculture-operations' ? <AgricultureOperationsPage />
        : route.name === 'hotel-frontdesk' ? <HotelFrontDeskPage />
        : route.name === 'auto-service-workshop' ? <AutoServiceWorkshopPage />
        : route.name === 'restaurant-service' ? <RestaurantServicePage />
        : route.name === 'wholesale-sales-desk' ? <WholesaleSalesDeskPage />
        : route.name === 'budget-variance' ? <BudgetVariancePage />
        : route.name === 'crm-pipeline' ? <CrmPipelinePage />
        : route.name === 'helpdesk-workbench' ? <HelpdeskWorkbenchPage />
        : route.name === 'performance-workbench' ? <PerformanceWorkbenchPage />
        : route.name === 'approval-workbench' ? <ApprovalWorkbenchPage />
        : route.name === 'contract-workbench' ? <ContractWorkbenchPage />
        : route.name === 'document-workbench' ? <DocumentWorkbenchPage />
        : route.name === 'integration-hub-workbench' ? <IntegrationHubPage />
        : route.name === 'loyalty-workbench' ? <LoyaltyWorkbenchPage />
        : route.name === 'marketing-campaign-performance' ? <MarketingCampaignPerformancePage />
        : route.name === 'helpdesk-sla' ? <HelpdeskSlaPage />
        : route.name === 'bi-reports' ? <BiReportsPage route={route} />
        : route.name === 'settings' && route.tab === 'modules' ? <ModuleSettingsPage />
        : route.name === 'settings' && route.tab === 'users' ? <UsersSettingsPage />
        : route.name === 'settings' && route.tab === 'roles' ? <RolesSettingsPage />
        : route.name === 'settings' && route.tab === 'inventory' ? <InventorySettingsPage />
        : route.name === 'settings' && route.tab === 'budget' ? <BudgetSettingsPage />
        : route.name === 'settings' && route.tab === 'currency' ? <CurrencySettingsPage />
        : route.name === 'settings' && route.tab === 'tokens' ? <TokensSettingsPage />
        : route.name === 'settings' && route.tab === 'audit' ? <AuditSettingsPage />
        : route.name === 'settings' && route.tab === 'failures' ? <FailuresSettingsPage />
        : route.name === 'settings' && route.tab === 'outbox' ? <OutboxSettingsPage />
        : route.name === 'settings' && route.tab === 'fields' ? <FieldsSettingsPage />
        : route.name === 'settings' && route.tab === 'data' ? <DataSettingsPage />
        : route.name === 'settings' ? <UsersSettingsPage />
        : <HomePage summary={app.summary} />}
      </Suspense>
      </main>
    </div>
    {navOpen && <button className="scrim" type="button" aria-label="Đóng menu" onClick={() => setNavOpen(false)} />}
  </>;
}

createRoot(document.getElementById('app')).render(<App />);
