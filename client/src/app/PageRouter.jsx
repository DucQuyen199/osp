import { lazy, Suspense } from 'react';
const EntityListPage = lazy(() => import('../EntityListPage.jsx'));
const EntityDetailPage = lazy(() => import('../EntityDetailPage.jsx'));
const EventsPage = lazy(() => import('../EventsPage.jsx'));
const HomePage = lazy(() => import('../HomePage.jsx'));
const NotFoundPage = lazy(() => import('../NotFoundPage.jsx'));
const ModuleOverviewPage = lazy(() => import('../ModuleOverviewPage.jsx'));
const AccountingReportsPage = lazy(() => import('../AccountingReportsPage.jsx'));
const InventoryReplenishmentPage = lazy(() => import('../InventoryReplenishmentPage.jsx'));
const InventoryLocationStockPage = lazy(() => import('../InventoryLocationStockPage.jsx'));
const InventoryQualityHoldsPage = lazy(() => import('../InventoryQualityHoldsPage.jsx'));
const InventoryLotTraceabilityPage = lazy(() => import('../InventoryLotTraceabilityPage.jsx'));
const InventoryLotExpiryPage = lazy(() => import('../InventoryLotExpiryPage.jsx'));
const RestaurantKitchenBoardPage = lazy(() => import('../RestaurantKitchenBoardPage.jsx'));
const LogisticsDeliveryBoardPage = lazy(() => import('../LogisticsDeliveryBoardPage.jsx'));
const HotelHousekeepingBoardPage = lazy(() => import('../HotelHousekeepingBoardPage.jsx'));
const AssetDepreciationSchedulePage = lazy(() => import('../AssetDepreciationSchedulePage.jsx'));
const BudgetVariancePage = lazy(() => import('../BudgetVariancePage.jsx'));
const CrmPipelinePage = lazy(() => import('../CrmPipelinePage.jsx'));
const MarketingCampaignPerformancePage = lazy(() => import('../MarketingCampaignPerformancePage.jsx'));
const HelpdeskSlaPage = lazy(() => import('../HelpdeskSlaPage.jsx'));
const BiReportsPage = lazy(() => import('../BiReportsPage.jsx'));
const ModuleSettingsPage = lazy(() => import('../ModuleSettingsPage.jsx'));
const UsersSettingsPage = lazy(() => import('../UsersSettingsPage.jsx'));
const RolesSettingsPage = lazy(() => import('../RolesSettingsPage.jsx'));
const InventorySettingsPage = lazy(() => import('../InventorySettingsPage.jsx'));
const BudgetSettingsPage = lazy(() => import('../BudgetSettingsPage.jsx'));
const CurrencySettingsPage = lazy(() => import('../CurrencySettingsPage.jsx'));
const BusinessTimeSettingsPage = lazy(() => import('../BusinessTimeSettingsPage.jsx'));
const TokensSettingsPage = lazy(() => import('../TokensSettingsPage.jsx'));
const AuditSettingsPage = lazy(() => import('../AuditSettingsPage.jsx'));
const FailuresSettingsPage = lazy(() => import('../FailuresSettingsPage.jsx'));
const OutboxSettingsPage = lazy(() => import('../OutboxSettingsPage.jsx'));
const FieldsSettingsPage = lazy(() => import('../FieldsSettingsPage.jsx'));
const DataSettingsPage = lazy(() => import('../DataSettingsPage.jsx'));
const MfaSettingsPage = lazy(() => import('../MfaSettingsPage.jsx'));
const PosTerminalPage = lazy(() => import('../PosTerminalPage.jsx'));
const ManufacturingWipPage = lazy(() => import('../ManufacturingWipPage.jsx'));
const ClinicWorkbenchPage = lazy(() => import('../ClinicWorkbenchPage.jsx'));
const EcommerceOrderDeskPage = lazy(() => import('../EcommerceOrderDeskPage.jsx'));
const AgricultureOperationsPage = lazy(() => import('../AgricultureOperationsPage.jsx'));
const HotelFrontDeskPage = lazy(() => import('../HotelFrontDeskPage.jsx'));
const AutoServiceWorkshopPage = lazy(() => import('../AutoServiceWorkshopPage.jsx'));
const RestaurantServicePage = lazy(() => import('../RestaurantServicePage.jsx'));
const WholesaleSalesDeskPage = lazy(() => import('../WholesaleSalesDeskPage.jsx'));
const PharmacyWorkbenchPage = lazy(() => import('../PharmacyWorkbenchPage.jsx'));
const EducationWorkbenchPage = lazy(() => import('../EducationWorkbenchPage.jsx'));
const UtilitiesWorkbenchPage = lazy(() => import('../UtilitiesWorkbenchPage.jsx'));
const FinanceOperationsPage = lazy(() => import('../FinanceOperationsPage.jsx'));
const EventsOperationsPage = lazy(() => import('../EventsOperationsPage.jsx'));
const FieldServiceWorkbenchPage = lazy(() => import('../FieldServiceWorkbenchPage.jsx'));
const RealEstateWorkbenchPage = lazy(() => import('../RealEstateWorkbenchPage.jsx'));
const ConstructionWorkbenchPage = lazy(() => import('../ConstructionWorkbenchPage.jsx'));
const ProjectWorkbenchPage = lazy(() => import('../ProjectWorkbenchPage.jsx'));
const SubscriptionWorkbenchPage = lazy(() => import('../SubscriptionWorkbenchPage.jsx'));
const CharityWorkbenchPage = lazy(() => import('../CharityWorkbenchPage.jsx'));
const ProfessionalServicesWorkbenchPage = lazy(() => import('../ProfessionalServicesWorkbenchPage.jsx'));
const WellnessBookingPage = lazy(() => import('../WellnessBookingPage.jsx'));
const PurchasingWorkbenchPage = lazy(() => import('../PurchasingWorkbenchPage.jsx'));
const PurchasingSourcingWorkbenchPage = lazy(() => import('../PurchasingSourcingWorkbenchPage.jsx'));
const MaintenanceWorkbenchPage = lazy(() => import('../MaintenanceWorkbenchPage.jsx'));
const RecruitmentWorkbenchPage = lazy(() => import('../RecruitmentWorkbenchPage.jsx'));
const PayrollWorkbenchPage = lazy(() => import('../PayrollWorkbenchPage.jsx'));
const HrmOperationsPage = lazy(() => import('../HrmOperationsPage.jsx'));
const ExpenseWorkbenchPage = lazy(() => import('../ExpenseWorkbenchPage.jsx'));
const SalesReturnsWorkbenchPage = lazy(() => import('../SalesReturnsWorkbenchPage.jsx'));
const BankReconciliationWorkbenchPage = lazy(() => import('../BankReconciliationWorkbenchPage.jsx'));
const AccountingPeriodClosePage = lazy(() => import('../AccountingPeriodClosePage.jsx'));
const AccountingAdjustmentRefundsPage = lazy(() => import('../AccountingAdjustmentRefundsPage.jsx'));
const AccountingSettlementWorkbenchPage = lazy(() => import('../AccountingSettlementWorkbenchPage.jsx'));
const InventoryStockCountWorkbenchPage = lazy(() => import('../InventoryStockCountWorkbenchPage.jsx'));
const EInvoiceWorkbenchPage = lazy(() => import('../EInvoiceWorkbenchPage.jsx'));
const HelpdeskWorkbenchPage = lazy(() => import('../HelpdeskWorkbenchPage.jsx'));
const PerformanceWorkbenchPage = lazy(() => import('../PerformanceWorkbenchPage.jsx'));
const ApprovalWorkbenchPage = lazy(() => import('../ApprovalWorkbenchPage.jsx'));
const ContractWorkbenchPage = lazy(() => import('../ContractWorkbenchPage.jsx'));
const DocumentWorkbenchPage = lazy(() => import('../DocumentWorkbenchPage.jsx'));
const IntegrationHubPage = lazy(() => import('../IntegrationHubPage.jsx'));
const LoyaltyWorkbenchPage = lazy(() => import('../LoyaltyWorkbenchPage.jsx'));
const LmsWorkbenchPage = lazy(() => import('../LmsWorkbenchPage.jsx'));
const QualityWorkbenchPage = lazy(() => import('../QualityWorkbenchPage.jsx'));
const CommunicationWorkbenchPage = lazy(() => import('../CommunicationWorkbenchPage.jsx'));
const PaymentsWorkbenchPage = lazy(() => import('../PaymentsWorkbenchPage.jsx'));
const AssetWorkbenchPage = lazy(() => import('../AssetWorkbenchPage.jsx'));
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

export default function PageRouter({ route, meta, summary }) {
  if (route.name === 'entity') {
    return <Suspense fallback={<div className="card-pad"><div className="skeleton" data-h="row" /></div>}>
      <EntityListPage key={route.qname} qname={route.qname} />
      {route.id && <EntityDetailPage key={`${route.qname}:${route.id}`} qname={route.qname} id={route.id} />}
    </Suspense>;
  }

  const Page = route.name === 'settings' ? SETTINGS_ROUTES[route.tab] : ROUTES[route.name];
  if (!Page) return <Suspense fallback={<div className="card-pad"><div className="skeleton" data-h="row" /></div>}><NotFoundPage /></Suspense>;

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

  return <Suspense fallback={<div className="card-pad"><div className="skeleton" data-h="row" /></div>}>
    <Page {...props} />
  </Suspense>;
}
