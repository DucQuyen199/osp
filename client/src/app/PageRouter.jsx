import { lazy, Suspense } from 'react';
import RouteErrorBoundary from '../components/RouteErrorBoundary.jsx';
import { uiText } from '../lib/i18n.js';

const EntityListPage = lazy(() => import('../features/entities/EntityListPage.jsx'));
const EntityDetailPage = lazy(() => import('../features/entities/EntityDetailPage.jsx'));
const EventsPage = lazy(() => import('../features/events/EventsPage.jsx'));
const HomePage = lazy(() => import('../features/dashboard/HomePage.jsx'));
const NotFoundPage = lazy(() => import('../features/auth/NotFoundPage.jsx'));
const ModuleOverviewPage = lazy(() => import('../features/dashboard/ModuleOverviewPage.jsx'));
const AccountingReportsPage = lazy(() => import('../features/accounting/AccountingReportsPage.jsx'));
const InventoryReplenishmentPage = lazy(() => import('../features/inventory/InventoryReplenishmentPage.jsx'));
const InventoryLocationStockPage = lazy(() => import('../features/inventory/InventoryLocationStockPage.jsx'));
const InventoryQualityHoldsPage = lazy(() => import('../features/inventory/InventoryQualityHoldsPage.jsx'));
const InventoryLotTraceabilityPage = lazy(() => import('../features/inventory/InventoryLotTraceabilityPage.jsx'));
const InventoryLotExpiryPage = lazy(() => import('../features/inventory/InventoryLotExpiryPage.jsx'));
const RestaurantKitchenBoardPage = lazy(() => import('../features/restaurant/RestaurantKitchenBoardPage.jsx'));
const LogisticsDeliveryBoardPage = lazy(() => import('../features/logistics/LogisticsDeliveryBoardPage.jsx'));
const HotelHousekeepingBoardPage = lazy(() => import('../features/hospitality/HotelHousekeepingBoardPage.jsx'));
const AssetDepreciationSchedulePage = lazy(() => import('../features/accounting/AssetDepreciationSchedulePage.jsx'));
const BudgetVariancePage = lazy(() => import('../features/accounting/BudgetVariancePage.jsx'));
const CrmPipelinePage = lazy(() => import('../features/crm/CrmPipelinePage.jsx'));
const MarketingCampaignPerformancePage = lazy(() => import('../features/crm/MarketingCampaignPerformancePage.jsx'));
const HelpdeskSlaPage = lazy(() => import('../features/operations/HelpdeskSlaPage.jsx'));
const BiReportsPage = lazy(() => import('../features/accounting/BiReportsPage.jsx'));
const ModuleSettingsPage = lazy(() => import('../features/settings/ModuleSettingsPage.jsx'));
const UsersSettingsPage = lazy(() => import('../features/settings/UsersSettingsPage.jsx'));
const RolesSettingsPage = lazy(() => import('../features/settings/RolesSettingsPage.jsx'));
const InventorySettingsPage = lazy(() => import('../features/inventory/InventorySettingsPage.jsx'));
const BudgetSettingsPage = lazy(() => import('../features/settings/BudgetSettingsPage.jsx'));
const CurrencySettingsPage = lazy(() => import('../features/settings/CurrencySettingsPage.jsx'));
const BusinessTimeSettingsPage = lazy(() => import('../features/settings/BusinessTimeSettingsPage.jsx'));
const TokensSettingsPage = lazy(() => import('../features/settings/TokensSettingsPage.jsx'));
const AuditSettingsPage = lazy(() => import('../features/settings/AuditSettingsPage.jsx'));
const FailuresSettingsPage = lazy(() => import('../features/settings/FailuresSettingsPage.jsx'));
const OutboxSettingsPage = lazy(() => import('../features/settings/OutboxSettingsPage.jsx'));
const FieldsSettingsPage = lazy(() => import('../features/settings/FieldsSettingsPage.jsx'));
const DataSettingsPage = lazy(() => import('../features/settings/DataSettingsPage.jsx'));
const MfaSettingsPage = lazy(() => import('../features/settings/MfaSettingsPage.jsx'));
const PosTerminalPage = lazy(() => import('../features/retail/PosTerminalPage.jsx'));
const ManufacturingWipPage = lazy(() => import('../features/manufacturing/ManufacturingWipPage.jsx'));
const ClinicWorkbenchPage = lazy(() => import('../features/healthcare/ClinicWorkbenchPage.jsx'));
const EcommerceOrderDeskPage = lazy(() => import('../features/ecommerce/EcommerceOrderDeskPage.jsx'));
const AgricultureOperationsPage = lazy(() => import('../features/agriculture/AgricultureOperationsPage.jsx'));
const HotelFrontDeskPage = lazy(() => import('../features/hospitality/HotelFrontDeskPage.jsx'));
const AutoServiceWorkshopPage = lazy(() => import('../features/automotive/AutoServiceWorkshopPage.jsx'));
const RestaurantServicePage = lazy(() => import('../features/restaurant/RestaurantServicePage.jsx'));
const WholesaleSalesDeskPage = lazy(() => import('../features/sales/WholesaleSalesDeskPage.jsx'));
const PharmacyWorkbenchPage = lazy(() => import('../features/pharmacy/PharmacyWorkbenchPage.jsx'));
const EducationWorkbenchPage = lazy(() => import('../features/education/EducationWorkbenchPage.jsx'));
const UtilitiesWorkbenchPage = lazy(() => import('../features/utilities/UtilitiesWorkbenchPage.jsx'));
const FinanceOperationsPage = lazy(() => import('../features/accounting/FinanceOperationsPage.jsx'));
const EventsOperationsPage = lazy(() => import('../features/events/EventsOperationsPage.jsx'));
const FieldServiceWorkbenchPage = lazy(() => import('../features/service/FieldServiceWorkbenchPage.jsx'));
const RealEstateWorkbenchPage = lazy(() => import('../features/real-estate/RealEstateWorkbenchPage.jsx'));
const ConstructionWorkbenchPage = lazy(() => import('../features/construction/ConstructionWorkbenchPage.jsx'));
const ProjectWorkbenchPage = lazy(() => import('../features/projects/ProjectWorkbenchPage.jsx'));
const SubscriptionWorkbenchPage = lazy(() => import('../features/subscriptions/SubscriptionWorkbenchPage.jsx'));
const CharityWorkbenchPage = lazy(() => import('../features/nonprofit/CharityWorkbenchPage.jsx'));
const ProfessionalServicesWorkbenchPage = lazy(() => import('../features/professional-services/ProfessionalServicesWorkbenchPage.jsx'));
const WellnessBookingPage = lazy(() => import('../features/subscriptions/WellnessBookingPage.jsx'));
const PurchasingWorkbenchPage = lazy(() => import('../features/purchasing/PurchasingWorkbenchPage.jsx'));
const PurchasingSourcingWorkbenchPage = lazy(() => import('../features/purchasing/PurchasingSourcingWorkbenchPage.jsx'));
const MaintenanceWorkbenchPage = lazy(() => import('../features/service/MaintenanceWorkbenchPage.jsx'));
const RecruitmentWorkbenchPage = lazy(() => import('../features/people/RecruitmentWorkbenchPage.jsx'));
const PayrollWorkbenchPage = lazy(() => import('../features/people/PayrollWorkbenchPage.jsx'));
const HrmOperationsPage = lazy(() => import('../features/people/HrmOperationsPage.jsx'));
const ExpenseWorkbenchPage = lazy(() => import('../features/accounting/ExpenseWorkbenchPage.jsx'));
const SalesReturnsWorkbenchPage = lazy(() => import('../features/sales/SalesReturnsWorkbenchPage.jsx'));
const BankReconciliationWorkbenchPage = lazy(() => import('../features/accounting/BankReconciliationWorkbenchPage.jsx'));
const AccountingPeriodClosePage = lazy(() => import('../features/accounting/AccountingPeriodClosePage.jsx'));
const AccountingAdjustmentRefundsPage = lazy(() => import('../features/accounting/AccountingAdjustmentRefundsPage.jsx'));
const AccountingSettlementWorkbenchPage = lazy(() => import('../features/accounting/AccountingSettlementWorkbenchPage.jsx'));
const InventoryStockCountWorkbenchPage = lazy(() => import('../features/inventory/InventoryStockCountWorkbenchPage.jsx'));
const EInvoiceWorkbenchPage = lazy(() => import('../features/accounting/EInvoiceWorkbenchPage.jsx'));
const HelpdeskWorkbenchPage = lazy(() => import('../features/operations/HelpdeskWorkbenchPage.jsx'));
const PerformanceWorkbenchPage = lazy(() => import('../features/people/PerformanceWorkbenchPage.jsx'));
const ApprovalWorkbenchPage = lazy(() => import('../features/operations/ApprovalWorkbenchPage.jsx'));
const ContractWorkbenchPage = lazy(() => import('../features/operations/ContractWorkbenchPage.jsx'));
const DocumentWorkbenchPage = lazy(() => import('../features/operations/DocumentWorkbenchPage.jsx'));
const IntegrationHubPage = lazy(() => import('../features/operations/IntegrationHubPage.jsx'));
const LoyaltyWorkbenchPage = lazy(() => import('../features/sales/LoyaltyWorkbenchPage.jsx'));
const LmsWorkbenchPage = lazy(() => import('../features/education/LmsWorkbenchPage.jsx'));
const QualityWorkbenchPage = lazy(() => import('../features/quality/QualityWorkbenchPage.jsx'));
const CommunicationWorkbenchPage = lazy(() => import('../features/operations/CommunicationWorkbenchPage.jsx'));
const PaymentsWorkbenchPage = lazy(() => import('../features/accounting/PaymentsWorkbenchPage.jsx'));
const ConsolidationWorkbenchPage = lazy(() => import('../features/consolidation/ConsolidationWorkbenchPage.jsx'));
const AssetWorkbenchPage = lazy(() => import('../features/accounting/AssetWorkbenchPage.jsx'));
const ROUTES = Object.freeze({
  home: HomePage,
  'not-found': NotFoundPage,
  events: EventsPage,
  module: ModuleOverviewPage,
  'account-security': MfaSettingsPage,
  'accounting-reports': AccountingReportsPage,
  'manufacturing-wip': ManufacturingWipPage,
  'asset-depreciation-schedule': AssetDepreciationSchedulePage,
  'inventory-replenishment': InventoryReplenishmentPage,
  'inventory-location-stock': InventoryLocationStockPage,
  'inventory-quality-holds': InventoryQualityHoldsPage,
  'inventory-stock-count-workbench': InventoryStockCountWorkbenchPage,
  'inventory-lot-traceability': InventoryLotTraceabilityPage,
  'inventory-lot-expiry': InventoryLotExpiryPage,
  'restaurant-kitchen-board': RestaurantKitchenBoardPage,
  'logistics-delivery-board': LogisticsDeliveryBoardPage,
  'hotel-housekeeping-board': HotelHousekeepingBoardPage,
  'pos-terminal': PosTerminalPage,
  'clinic-workbench': ClinicWorkbenchPage,
  'pharmacy-workbench': PharmacyWorkbenchPage,
  'education-workbench': EducationWorkbenchPage,
  'lms-workbench': LmsWorkbenchPage,
  'quality-workbench': QualityWorkbenchPage,
  'communication-workbench': CommunicationWorkbenchPage,
  'payments-workbench': PaymentsWorkbenchPage,
  'consolidation-workbench': ConsolidationWorkbenchPage,
  'asset-workbench': AssetWorkbenchPage,
  'utilities-workbench': UtilitiesWorkbenchPage,
  'finance-operations': FinanceOperationsPage,
  'events-operations': EventsOperationsPage,
  'field-service-workbench': FieldServiceWorkbenchPage,
  'real-estate-workbench': RealEstateWorkbenchPage,
  'construction-workbench': ConstructionWorkbenchPage,
  'project-workbench': ProjectWorkbenchPage,
  'subscription-workbench': SubscriptionWorkbenchPage,
  'charity-workbench': CharityWorkbenchPage,
  'professional-services-workbench': ProfessionalServicesWorkbenchPage,
  'wellness-booking-workbench': WellnessBookingPage,
  'purchasing-workbench': PurchasingWorkbenchPage,
  'purchasing-sourcing-workbench': PurchasingSourcingWorkbenchPage,
  'maintenance-workbench': MaintenanceWorkbenchPage,
  'recruitment-workbench': RecruitmentWorkbenchPage,
  'payroll-workbench': PayrollWorkbenchPage,
  'hrm-operations': HrmOperationsPage,
  'expense-workbench': ExpenseWorkbenchPage,
  'sales-returns-workbench': SalesReturnsWorkbenchPage,
  'bank-reconciliation-workbench': BankReconciliationWorkbenchPage,
  'accounting-period-close': AccountingPeriodClosePage,
  'accounting-adjustment-refunds': AccountingAdjustmentRefundsPage,
  'accounting-settlement-workbench': AccountingSettlementWorkbenchPage,
  'einvoice-workbench': EInvoiceWorkbenchPage,
  'ecommerce-order-desk': EcommerceOrderDeskPage,
  'agriculture-operations': AgricultureOperationsPage,
  'hotel-frontdesk': HotelFrontDeskPage,
  'auto-service-workshop': AutoServiceWorkshopPage,
  'restaurant-service': RestaurantServicePage,
  'wholesale-sales-desk': WholesaleSalesDeskPage,
  'budget-variance': BudgetVariancePage,
  'crm-pipeline': CrmPipelinePage,
  'helpdesk-workbench': HelpdeskWorkbenchPage,
  'performance-workbench': PerformanceWorkbenchPage,
  'approval-workbench': ApprovalWorkbenchPage,
  'contract-workbench': ContractWorkbenchPage,
  'document-workbench': DocumentWorkbenchPage,
  'integration-hub-workbench': IntegrationHubPage,
  'loyalty-workbench': LoyaltyWorkbenchPage,
  'marketing-campaign-performance': MarketingCampaignPerformancePage,
  'helpdesk-sla': HelpdeskSlaPage,
  'bi-reports': BiReportsPage,
});

const SETTINGS_ROUTES = Object.freeze({
  users: UsersSettingsPage,
  modules: ModuleSettingsPage,
  roles: RolesSettingsPage,
  inventory: InventorySettingsPage,
  budget: BudgetSettingsPage,
  currency: CurrencySettingsPage,
  'business-time': BusinessTimeSettingsPage,
  tokens: TokensSettingsPage,
  audit: AuditSettingsPage,
  failures: FailuresSettingsPage,
  outbox: OutboxSettingsPage,
  fields: FieldsSettingsPage,
  data: DataSettingsPage,
});

function RouteLoading() {
  return <div className="card-pad" role="status" aria-busy="true" aria-label={uiText('Đang tải màn hình…')}>
    <div className="skeleton" data-h="row" aria-hidden="true" />
  </div>;
}

function ResolvedPage({ route, meta, summary }) {
  if (route.name === 'entity') {
    return <Suspense fallback={<RouteLoading />}>
      <EntityListPage key={route.qname} qname={route.qname} />
      {route.id && <EntityDetailPage key={`${route.qname}:${route.id}`} qname={route.qname} id={route.id} />}
    </Suspense>;
  }

  const Page = route.name === 'settings' ? SETTINGS_ROUTES[route.tab] : ROUTES[route.name];
  if (!Page) return <Suspense fallback={<RouteLoading />}><NotFoundPage /></Suspense>;

  const props = route.name === 'home'
    ? { summary }
    : route.name === 'module'
      ? { moduleId: route.module, summary }
      : route.name === 'inventory-lot-traceability'
        ? { lotId: route.lotId }
        : route.name === 'bi-reports'
          ? { route }
          : route.name === 'wellness-booking-workbench'
            ? { healthcare: meta.modules.some((module) => module.id === 'clinic') }
            : {};

  return <Suspense fallback={<RouteLoading />}>
    <Page {...props} />
  </Suspense>;
}

export default function PageRouter(props) {
  const { route } = props;
  const routeKey = [route.name, route.tab, route.module, route.qname, route.id, route.view, route.lotId].filter(Boolean).join(':');
  return <RouteErrorBoundary key={routeKey}><ResolvedPage {...props} /></RouteErrorBoundary>;
}
