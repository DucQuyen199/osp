import { lazy, Suspense } from 'react';
const EntityListPage = lazy(() => import('../EntityListPage.jsx'));
const EntityDetailPage = lazy(() => import('../EntityDetailPage.jsx'));
const EventsPage = lazy(() => import('../EventsPage.jsx'));
const HomePage = lazy(() => import('../HomePage.jsx'));
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

export default function PageRouter({ route, meta, summary }) {
  return (
<Suspense fallback={<div className="card-pad"><div className="skeleton" data-h="row" /></div>}>
  {route.name === 'entity'
    ? <>
      <EntityListPage key={route.qname} qname={route.qname} />
      {route.id && <EntityDetailPage key={`${route.qname}:${route.id}`} qname={route.qname} id={route.id} />}
    </>
    : route.name === 'account-security' ? <MfaSettingsPage />
    : route.name === 'events' ? <EventsPage />
    : route.name === 'home' ? <HomePage summary={summary} />
    : route.name === 'module' ? <ModuleOverviewPage moduleId={route.module} summary={summary} />
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
    : route.name === 'communication-workbench' ? <CommunicationWorkbenchPage />
    : route.name === 'payments-workbench' ? <PaymentsWorkbenchPage />
    : route.name === 'asset-workbench' ? <AssetWorkbenchPage />
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
    : route.name === 'settings' && route.tab === 'business-time' ? <BusinessTimeSettingsPage />
    : route.name === 'settings' && route.tab === 'tokens' ? <TokensSettingsPage />
    : route.name === 'settings' && route.tab === 'audit' ? <AuditSettingsPage />
    : route.name === 'settings' && route.tab === 'failures' ? <FailuresSettingsPage />
    : route.name === 'settings' && route.tab === 'outbox' ? <OutboxSettingsPage />
    : route.name === 'settings' && route.tab === 'fields' ? <FieldsSettingsPage />
    : route.name === 'settings' && route.tab === 'data' ? <DataSettingsPage />
    : route.name === 'settings' ? <UsersSettingsPage />
    : <HomePage summary={summary} />}
  </Suspense>
  );
}





