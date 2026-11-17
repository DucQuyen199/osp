import Icon from './Icon.jsx';
import { CATEGORY_ORDER, categoryLabel, uiText } from '../lib/i18n.js';
import { can, entityLabel, isAdmin } from '../lib/state.js';
import { listHref, workbenchHref } from '../lib/routes.js';

const STANDARD_ROUTES = new Set(['home', 'events', 'not-found', 'module', 'entity', 'settings', 'login', 'signup', 'forgot-password', 'reset-password', 'verify-email']);

export default function Sidebar({ meta, route, onNavigate, open, mobile }) {
  const workbenchOpen = !STANDARD_ROUTES.has(route.name);
  const activeModule = route.name === 'module' ? route.module : route.name === 'entity' ? route.qname.split('.')[0] : null;
  const link = (href, label, active, iconName) => <a key={href} className="nav-link" href={href} aria-current={active ? 'page' : undefined} onClick={onNavigate}>{iconName && <Icon name={iconName} />}{uiText(label)}</a>;
  const groups = CATEGORY_ORDER.map((category) => [category, meta.modules.filter((module) => module.category === category)]).filter(([, items]) => items.length);
  return <nav className={`sidebar${open ? ' open' : ''}`} id="nav" aria-label={uiText('Điều hướng chính')} aria-hidden={mobile && !open ? 'true' : undefined} inert={mobile && !open}>
    {link('#/', 'Trang chủ', route.name === 'home', 'home')}
    {link('#/events', 'Dòng sự kiện', route.name === 'events', 'bolt')}
    <details className="nav-group nav-workbench-group" open={workbenchOpen}>
      <summary className="nav-title nav-group-toggle">{uiText('Quy trình & báo cáo')}<span className="nav-group-chevron">›</span></summary>
    {meta.modules.some((module) => module.id === 'bi') && (can('bi.report.read') || can('bi.dashboard.read')) && link('#/reports/bi', 'Báo cáo & phân tích', route.name === 'bi-reports', 'list')}
    {meta.modules.some((module) => module.id === 'consolidation') && (can('consolidation.company_group.read') || can('consolidation.member.read') || can('consolidation.shared_company.read')) && link('#/consolidation', 'Quản lý tập đoàn', route.name === 'consolidation-workbench', 'list')}
    {meta.modules.some((module) => module.id === 'workflow-approval') && (can('workflow-approval.approval_request.read') || can('workflow-approval.approval_request.approved') || can('workflow-approval.approval_request.rejected') || can('workflow-approval.approval_rule.read') || can('workflow-approval.approval_rule.create') || can('workflow-approval.approval_rule.update')) && link(workbenchHref('approvals'), 'Phê duyệt', route.name === 'approval-workbench', 'list')}
    {meta.modules.some((module) => module.id === 'contract') && can('contract.contract.read') && link(workbenchHref('contracts'), 'Sổ hợp đồng', route.name === 'contract-workbench', 'list')}
    {meta.modules.some((module) => module.id === 'document') && (can('document.document.read') || can('document.document.create') || can('document.folder.read')) && link(workbenchHref('documents'), 'Thư viện tài liệu', route.name === 'document-workbench', 'list')}
    {meta.modules.some((module) => module.id === 'integration-hub') && (can('integration-hub.connector.read') || can('integration-hub.connector.create') || can('integration-hub.webhook.read') || can('integration-hub.webhook.create')) && link(workbenchHref('integrations'), 'Cổng tích hợp', route.name === 'integration-hub-workbench', 'list')}
    {meta.modules.some((module) => module.id === 'loyalty') && (can('loyalty.member.read') || can('loyalty.member.create') || can('loyalty.voucher.read') || can('loyalty.voucher.create')) && link(workbenchHref('loyalty'), 'Khách hàng thân thiết', route.name === 'loyalty-workbench', 'list')}
    {meta.modules.some((module) => module.id === 'accounting') && can('accounting.journal_entry.read') && link('#/reports/accounting', 'Báo cáo kế toán', route.name === 'accounting-reports', 'list')}
    {meta.modules.some((module) => module.id === 'manufacturing') && can('manufacturing.production_order.read') && link('#/reports/manufacturing/wip', 'WIP sản xuất', route.name === 'manufacturing-wip', 'list')}
    {meta.modules.some((module) => module.id === 'asset') && (can('asset.asset.read') || can('asset.asset.create')) && link(workbenchHref('assets'), 'Sổ tài sản cố định', route.name === 'asset-workbench', 'list')}
    {meta.modules.some((module) => module.id === 'asset') && can('asset.asset.read') && link('#/reports/asset/depreciation-schedule', 'Lịch khấu hao tài sản', route.name === 'asset-depreciation-schedule', 'list')}
    {meta.modules.some((module) => module.id === 'inventory') && can('inventory.reorder_rule.read') && link('#/reports/inventory/replenishment', 'Bổ sung tồn kho', route.name === 'inventory-replenishment', 'list')}
    {meta.modules.some((module) => module.id === 'inventory') && can('inventory.stock_move.read') && link('#/reports/inventory/location-stock', 'Tồn theo vị trí', route.name === 'inventory-location-stock', 'list')}
    {meta.modules.some((module) => module.id === 'inventory') && can('inventory.lot.read') && can('inventory.stock_move.read') && link('#/reports/inventory/lot-expiry', 'Lô sắp hết hạn', route.name === 'inventory-lot-expiry', 'list')}
    {meta.modules.some((module) => module.id === 'inventory') && can('inventory.stock_count.read') && link(workbenchHref('inventory-counts'), 'Kiểm kê kho', route.name === 'inventory-stock-count-workbench', 'list')}
    {meta.modules.some((module) => module.id === 'restaurant') && can('restaurant.kitchen_ticket.read') && link('#/reports/restaurant/kitchen-board', 'Màn hình bếp', route.name === 'restaurant-kitchen-board', 'list')}
    {meta.modules.some((module) => module.id === 'logistics') && can('logistics.shipment.read') && link('#/reports/logistics/delivery-board', 'Điều phối giao hàng', route.name === 'logistics-delivery-board', 'list')}
    {meta.modules.some((module) => module.id === 'hotel') && can('hotel.room.read') && link('#/reports/hotel/housekeeping-board', 'Buồng phòng', route.name === 'hotel-housekeeping-board', 'list')}
    {meta.modules.some((module) => module.id === 'pos') && can('pos.pos_session.read') && can('pos.pos_order.create') && link(workbenchHref('pos'), 'Quầy bán hàng POS', route.name === 'pos-terminal', 'list')}
    {meta.modules.some((module) => module.id === 'clinic') && can('clinic.encounter.read') && can('clinic.encounter.create') && link(workbenchHref('clinic'), 'Điều phối phòng khám', route.name === 'clinic-workbench', 'list')}
    {meta.modules.some((module) => module.id === 'pharmacy') && can('pharmacy.prescription.read') && link(workbenchHref('pharmacy'), 'Đơn thuốc nhà thuốc', route.name === 'pharmacy-workbench', 'list')}
    {meta.modules.some((module) => module.id === 'school') && (can('school.class_session.read') || can('school.fee.read')) && link(workbenchHref('education'), 'Lịch lớp và học phí', route.name === 'education-workbench', 'list')}
    {meta.modules.some((module) => module.id === 'lms') && (can('lms.course.read') || can('lms.course.create') || can('lms.enrollment.read')) && link(workbenchHref('lms'), 'Đào tạo trực tuyến', route.name === 'lms-workbench', 'list')}
    {meta.modules.some((module) => module.id === 'quality') && (can('quality.nonconformance.read') || can('quality.nonconformance.create')) && link(workbenchHref('quality'), 'Sổ sự không phù hợp', route.name === 'quality-workbench', 'list')}
    {meta.modules.some((module) => module.id === 'communication') && (can('communication.reminder.read') || can('communication.reminder.create') || can('communication.message_log.read')) && link(workbenchHref('communications'), 'Lịch nhắc và nhật ký gửi', route.name === 'communication-workbench', 'list')}
    {meta.modules.some((module) => module.id === 'payments') && (can('payments.payment_txn.read') || can('payments.payment_txn.create') || can('payments.payment_refund.read')) && link(workbenchHref('payments'), 'Giao dịch thanh toán', route.name === 'payments-workbench', 'payment')}
    {meta.modules.some((module) => module.id === 'utilities') && can('utilities.meter_reading.read') && link(workbenchHref('utilities'), 'Công tơ và hóa đơn tiện ích', route.name === 'utilities-workbench', 'list')}
    {meta.modules.some((module) => ['lending', 'insurance'].includes(module.id)) && (can('lending.loan.read') || can('insurance.policy.read')) && link(workbenchHref('finance'), 'Cho vay và bảo hiểm', route.name === 'finance-operations', 'list')}
    {meta.modules.some((module) => module.id === 'events') && can('events.ticket.read') && can('events.event.read') && link(workbenchHref('event-ops'), 'Sự kiện và quầy vé', route.name === 'events-operations', 'list')}
    {meta.modules.some((module) => module.id === 'field-service') && can('field-service.work_order.read') && link(workbenchHref('field-service'), 'Điều phối hiện trường', route.name === 'field-service-workbench', 'list')}
    {meta.modules.some((module) => module.id === 'real-estate') && can('real-estate.property.read') && link(workbenchHref('real-estate'), 'Sàn bất động sản', route.name === 'real-estate-workbench', 'list')}
    {meta.modules.some((module) => module.id === 'construction') && (can('construction.boq.read') || can('construction.site.read')) && link(workbenchHref('construction'), 'Điều hành công trường', route.name === 'construction-workbench', 'list')}
    {meta.modules.some((module) => module.id === 'project') && can('project.project.read') && link(workbenchHref('projects'), 'Quản lý dự án', route.name === 'project-workbench', 'list')}
    {meta.modules.some((module) => module.id === 'subscription') && can('subscription.subscription.read') && link(workbenchHref('subscriptions'), 'Thuê bao và gia hạn', route.name === 'subscription-workbench', 'list')}
    {meta.modules.some((module) => module.id === 'charity') && can('charity.program.read') && link(workbenchHref('charity'), 'Chương trình và quỹ', route.name === 'charity-workbench', 'list')}
    {meta.modules.some((module) => module.id === 'case-management') && can('case-management.case.read') && link(workbenchHref('cases'), 'Hồ sơ dịch vụ', route.name === 'professional-services-workbench', 'list')}
    {meta.modules.some((module) => module.id === 'booking') && can('booking.booking.read') && link(workbenchHref('wellness'), meta.modules.some((module) => module.id === 'clinic') ? 'Lịch hẹn khám' : 'Lịch dịch vụ', route.name === 'wellness-booking-workbench', 'list')}
    {meta.modules.some((module) => module.id === 'purchasing') && can('purchasing.purchase_order.read') && link(workbenchHref('purchasing'), 'Mua hàng và nhận hàng', route.name === 'purchasing-workbench', 'list')}
    {meta.modules.some((module) => module.id === 'purchasing') && can('purchasing.rfq.read') && link(workbenchHref('sourcing'), 'RFQ và so sánh báo giá', route.name === 'purchasing-sourcing-workbench', 'list')}
    {meta.modules.some((module) => module.id === 'maintenance') && can('maintenance.maintenance_request.read') && link(workbenchHref('maintenance'), 'Bảo trì tài sản', route.name === 'maintenance-workbench', 'list')}
    {meta.modules.some((module) => module.id === 'recruitment') && can('recruitment.application.read') && link(workbenchHref('recruitment'), 'Tuyển dụng', route.name === 'recruitment-workbench', 'list')}
    {meta.modules.some((module) => module.id === 'payroll') && can('payroll.payroll_run.read') && link(workbenchHref('payroll'), 'Điều hành bảng lương', route.name === 'payroll-workbench', 'list')}
    {meta.modules.some((module) => module.id === 'hrm') && can('hrm.employee.read') && link(workbenchHref('people'), 'Nhân sự và chấm công', route.name === 'hrm-operations', 'list')}
    {meta.modules.some((module) => module.id === 'performance') && (can('performance.objective.read') || can('performance.review.read')) && link(workbenchHref('performance'), 'Mục tiêu & đánh giá', route.name === 'performance-workbench', 'list')}
    {meta.modules.some((module) => module.id === 'expense') && can('expense.expense_claim.read') && link(workbenchHref('expenses'), 'Chi phí nhân viên', route.name === 'expense-workbench', 'list')}
    {meta.modules.some((module) => module.id === 'sales') && can('sales.sales_return.read') && link(workbenchHref('returns'), 'Trả hàng bán', route.name === 'sales-returns-workbench', 'list')}
    {meta.modules.some((module) => module.id === 'accounting') && can('accounting.bank_statement.read') && link(workbenchHref('bank-reconciliation'), 'Đối soát ngân hàng', route.name === 'bank-reconciliation-workbench', 'list')}
    {meta.modules.some((module) => module.id === 'accounting') && can('accounting.payment.create') && can('accounting.payment.read') && ((can('accounting.credit_note.read') && can('accounting.invoice.read')) || (can('accounting.debit_note.read') && can('accounting.bill.read'))) && link(workbenchHref('refunds'), 'Hoàn tiền điều chỉnh', route.name === 'accounting-adjustment-refunds', 'payment')}
    {meta.modules.some((module) => module.id === 'accounting') && can('accounting.settlement_batch.read') && link(workbenchHref('settlements'), 'Thu/chi phân bổ công nợ', route.name === 'accounting-settlement-workbench', 'payment')}
    {meta.modules.some((module) => module.id === 'einvoice') && can('einvoice.einvoice.read') && link(workbenchHref('einvoices'), 'Hóa đơn điện tử', route.name === 'einvoice-workbench', 'list')}
    {meta.modules.some((module) => module.id === 'accounting') && can('accounting.period.read') && link(workbenchHref('period-close'), 'Khóa sổ kế toán', route.name === 'accounting-period-close', 'list')}
    {meta.modules.some((module) => module.id === 'ecommerce') && can('ecommerce.web_order.read') && link(workbenchHref('ecommerce'), 'Đơn hàng online', route.name === 'ecommerce-order-desk', 'list')}
    {meta.modules.some((module) => module.id === 'agriculture') && can('agriculture.crop_cycle.read') && link(workbenchHref('agriculture'), 'Điều hành mùa vụ', route.name === 'agriculture-operations', 'list')}
    {meta.modules.some((module) => module.id === 'hotel') && can('hotel.reservation.read') && link(workbenchHref('hotel'), 'Lễ tân khách sạn', route.name === 'hotel-frontdesk', 'list')}
    {meta.modules.some((module) => module.id === 'auto-service') && can('auto-service.repair_order.read') && link(workbenchHref('workshop'), 'Xưởng sửa chữa', route.name === 'auto-service-workshop', 'list')}
    {meta.modules.some((module) => module.id === 'restaurant') && can('restaurant.table_order.read') && can('restaurant.table_order.create') && link(workbenchHref('restaurant'), 'Order nhà hàng', route.name === 'restaurant-service', 'list')}
    {meta.modules.some((module) => module.id === 'sales') && can('sales.quotation.read') && can('sales.quotation.create') && link(workbenchHref('sales'), 'Bán hàng và báo giá', route.name === 'wholesale-sales-desk', 'list')}
    {meta.modules.some((module) => module.id === 'inventory') && meta.modules.some((module) => module.id === 'quality') && can('inventory.stock_move.read') && can('quality.inspection.read') && link('#/reports/inventory/quality-holds', 'Hàng giữ QC', route.name === 'inventory-quality-holds', 'list')}
    {meta.modules.some((module) => module.id === 'budget') && can('budget.budget.read') && link('#/reports/budget/variance', 'Thực hiện ngân sách', route.name === 'budget-variance', 'list')}
    {meta.modules.some((module) => module.id === 'crm') && can('crm.deal.read') && link('#/reports/crm/pipeline', 'Pipeline bán hàng', route.name === 'crm-pipeline', 'list')}
    {meta.modules.some((module) => module.id === 'marketing') && can('marketing.campaign.read') && link('#/reports/marketing/campaign-performance', 'Hiệu quả chiến dịch', route.name === 'marketing-campaign-performance', 'list')}
    {meta.modules.some((module) => module.id === 'helpdesk') && can('helpdesk.ticket.read') && link('#/reports/helpdesk/sla', 'SLA hỗ trợ', route.name === 'helpdesk-sla', 'list')}
    {meta.modules.some((module) => module.id === 'helpdesk') && can('helpdesk.ticket.read') && link(workbenchHref('helpdesk'), 'Hộp thư hỗ trợ', route.name === 'helpdesk-workbench', 'list')}
    </details>
    {groups.map(([category, modules]) => <div className="nav-group" key={category}>
      <div className="nav-title">{uiText(category === 'core' ? 'Dữ liệu gốc' : categoryLabel(category))}</div>
      {modules.map((module) => <details className="nav-mod" key={module.id} open={activeModule === module.id || module.core}>
        <summary className="nav-sum">{uiText(module.name)}<span className="chev">›</span></summary>
        <div className="nav-sub">
          {link(`#/m/${module.id}`, 'Tổng quan', route.name === 'module' && route.module === module.id)}
          {module.entities.map((entity) => { const qname = `${module.id}.${entity.name}`; return link(listHref(qname), entityLabel(qname), route.name === 'entity' && route.qname === qname); })}
        </div>
      </details>)}
    </div>)}
    {isAdmin() && <div className="nav-group"><div className="nav-title">{uiText('Quản trị')}</div>{link('#/settings', 'Cài đặt', route.name === 'settings', 'settings')}</div>}
  </nav>;
}



