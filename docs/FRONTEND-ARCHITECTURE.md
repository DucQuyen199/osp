# React frontend architecture

The client is a React 19 application built with Vite. It uses JavaScript and the existing hash routes so deployed links and API integration remain stable.

## Application layers

- `client/src/main.jsx` mounts React and registers the production service worker.
- `client/src/app/App.jsx` owns session startup, authentication redirects, route changes, account preferences, and the shared application shell.
- `client/src/app/parseRoute.js` translates the current hash into a route object. Unknown paths resolve to the not-found screen.
- `client/src/app/PageRouter.jsx` uses explicit screen and settings registries. Screens load with `React.lazy` inside shared suspense boundaries that announce route loading to assistive technology; a keyed error boundary provides localized reload and home actions when a screen fails.
- `client/src/components/` contains shared shell and UI pieces such as navigation, global search, and icons.
- `client/src/lib/` contains cross-screen API, tenant state, date, event, UI language and number/date formatting, feedback, and URL helpers. UI language (`vi-VN` or `en-US`) is stored independently from number/date formatting; the large English interface dictionary is loaded as a separate chunk only when the selected locale needs it. Shared shell, navigation, dashboard and module overview, generic CRUD screens, POS, sales returns, wholesale sales, purchasing, sourcing, inventory replenishment, stock counts, stock by location, lot expiry, lot traceability, quality holds, inventory, currency, budget, and business time settings, quality, audit, and integration operations, custom-field, role, data, module, account security, API token, and user settings, accounting period close, settlement and e-invoice workbenches, budget variance, cross-module events, campaign performance, and employee performance reviews use the shared localization helpers. Inline API errors, operation feedback, and shared CRUD confirmation/toast messages also pass through those helpers. The module registry also has localized names and descriptions for its 50 catalog entries.
- Route screens use `useDocumentTitle()` to keep browser tab titles in sync with the current locale without tying language changes to workbench data reloads.
- `EntityListPage` owns list loading, filters, permissions, import/export and bulk actions; `EntityListToolbar` and `EntityListPager` render controlled filters/actions/navigation, and `EntityRecordsTable` renders rows with selection/navigation callbacks for the catalog-wide CRUD screen.
- `EntityFormDialog` owns generic CRUD form state, reference loading, payload normalization, validation and persistence; `EntityFormView` renders the controlled drawer fields, errors and submit actions, `EntityFieldControl` maps catalog field types to controls, and `EntityLineEditors` handles structured business lines through callbacks.
- `client/src/features/<domain>/` groups workflow screens and related dialogs by business domain. Each feature owns its workflow state and API orchestration while using shared helpers and tokens.

Feature-local English dictionaries are used for the authentication flow, lazy-loaded events, agriculture, LMS, education, clinic, helpdesk, professional services, wellness booking, subscriptions, communications, recruitment, maintenance, charity, loyalty, integration hub, BI reporting, CRM pipeline, project management, payroll, construction, manufacturing, real-estate, and utilities workbenches, plus accounting chart-template and entity-import dialogs. These dictionaries translate presentation text while leaving permission keys, API payloads, status values, and business rules unchanged. Industry workbenches and a few shared screens still need localization coverage.

## Adding a screen

1. Add the workflow screen under the matching `client/src/features/<domain>/` folder with a focused page component.
2. Add a lazy import to the screen registry in `app/PageRouter.jsx`; add its URL mapping in `app/parseRoute.js`.
3. Add navigation only where the feature is enabled and the current user has permission.
4. Use the shared API/state/date/format helpers rather than recreating tenant or money rules in a screen.
5. Use semantic headings, labels, accessible names, visible focus, and the existing CSS tokens. Selectable table rows expose their selected state and use `selectableTableRowProps` so Enter and Space activate them without changing table semantics. Add reusable styles to shared components only when more than one screen needs them.
6. Keep generated `client-dist/` output out of commits. `npm run build` copies the public assets and creates deployable output.

For translations used only by a lazy-loaded feature, keep its English text map in that feature directory and use `uiTextWith()` to fall back to the shared dictionary. This keeps feature vocabulary out of the startup bundle.
Wrap every user-visible literal with `uiText()` or the feature-local translator, including text chosen by conditional branches and fallback labels; raw Vietnamese JSX text will stay untranslated in `en-US`.

Run `npm run lint:translations` while changing a screen or dictionary. The check verifies that literal `uiText()` and feature `t()` calls resolve through the shared or feature-local English dictionary, and catches raw Vietnamese JSX text, accessible text attributes, and static page titles. It is part of `npm run check`.

### Feature-local workflow components

- Keep route-level loading, permission checks, and business actions in the feature page or a feature hook.
- Split a long workflow view into focused components under `features/<domain>/components/`. Pass controlled values and callbacks so child components render and edit the state owned by the workflow.
- Keep business rules, API calls, and cross-module coordination out of presentational line editors and panels. Promote a component to `components/` only when more than one domain uses it.
- The ecommerce order desk follows this boundary: `EcommerceOrderDeskPage` owns loading, permissions, API actions and cart state; `WebOrderCreateForm` edits controlled values through callbacks, and `WebOrderCard` renders an order and emits requested actions.
- The wholesale sales desk owns quotation payload construction, price-list selection and persistence; `QuotationComposer` renders controlled customer, warehouse, price, delivery and product fields and emits changes and submit requests through callbacks.
- The school workbench keeps attendance persistence and permission checks in `EducationWorkbenchPage`; `AttendanceRosterTable` renders the roster and requests marks through a callback.
- The school workbench owns class and session permissions, validation, and persistence; `CourseClassForm` and `ClassSessionForm` render controlled schedule fields and submit through callbacks.
- The school workbench owns the atomic contact-and-student creation flow and pending-contact recovery; `StudentIntakeForm` renders controlled learner fields and submits through a callback.
- The school workbench owns tuition issuance permissions and invoice actions; `TuitionLedgerTable` renders controlled fee and invoice records and emits issuance requests through a callback.
- The school workbench owns grade filters, permissions and persistence; `GradebookSection` renders controlled class, term and subject filters with editable grade rows.
- The HRM workbench owns shift schedule validation, time-zone conversion and persistence; `WorkScheduleEntriesPanel` renders the controlled day override form and exception list, while `WorkSchedulePatternsTable` renders patterns and emits apply/delete requests.
- The manufacturing workbench keeps production commands and output drafts in `ManufacturingWipPage`; `ProductionOrderCard` renders the controlled output fields and emits requested transitions.
- The manufacturing workbench owns production-order permissions and creation; `ProductionOrderForm` renders the controlled BOM, warehouse, work-center, lot and scrap-account fields and emits changes through a callback.
- The manufacturing workbench owns BOM permissions and persistence; `BillOfMaterialsSection` renders controlled BOM and component fields and emits edits through callbacks.
- The manufacturing workbench keeps QC permissions and inspection actions in `ManufacturingWipPage`; `ProductionInspectionQueue` renders pending production inspections and emits pass/fail decisions through callbacks.
- The manufacturing workbench owns failed-quantity accounting, rework permissions and API actions; `ReworkOrdersPanel` renders controlled failed inspection selection, repair quantity and reason fields, plus rework orders and their available actions.
- The manufacturing workbench owns WIP report filters and reconciliation actions; `ManufacturingWipReport` renders the order level WIP table and its reconciliation context.
- `AccountingReportsPage` owns report filters, permissions, API requests and FX journal creation; `AccountingReportResults` renders each selected report with controlled memo and draft-action callbacks.
- The purchasing workbench owns supplier-invoice state and validation; `SupplierInvoiceAdjustmentsEditor` edits controlled charge and landed-cost allocations through a callback.
- The purchasing workbench owns invoice permissions, FX validation and persistence; `SupplierInvoiceDraftForm` renders controlled invoice quantities, tax, currency and reference fields.
- The purchasing workbench owns supplier-invoice validation, permissions and state transitions; `SupplierInvoicesPanel` renders controlled dispute fields and emits dispute, resolution, submit and approval requests.
- The POS terminal owns cart, tender, permissions and checkout; `PosCheckoutPanel` displays controlled payment fields and emits the checkout request.
- The POS terminal owns session and cash-movement permissions, API calls and closing rules; `PosSessionPanel` displays controlled shift fields, `PosCashOperationsPanel` edits and lists controlled cash movements, and `PosRecentTransactions` renders receipt, refund and partial-return actions through callbacks.
- The BI workbench owns safe query construction, source permissions, scheduling, and persistence; `BiReportBuilderForm` renders controlled report criteria and emits field changes and submit requests through callbacks.
- The POS terminal owns return permissions, the draft retry flow and persistence; `PosReturnDialog` edits controlled return quantities and reason, previews the refund, and emits submit/close callbacks.
- The HR workbench owns attendance-date rules and punch actions; `AttendanceEntriesTable` renders the controlled daily records and emits punch-out requests.
- The HR workbench owns salary-revision permissions, submission and approval; `SalaryRevisionForm` renders controlled employee, effective-date, salary and reason fields and emits changes and submit requests.
- The HR workbench owns schedule-pattern permissions, template selection, date limits and persistence; `WorkSchedulePatternForm` renders the controlled rotation schedule and emits form edits through callbacks.
- The performance workbench owns key-result permissions and updates; `KeyResultProgressCard` renders a controlled progress meter and value field and emits edits and submit requests.
- The inventory stock-count workbench owns the count draft, validation and persistence; `StockCountLinesEditor` renders controlled product, lot, location and quantity fields and emits line edits through callbacks.
- The purchasing workbench owns requisition and supplier-return permissions, quantity validation, reference data and API actions; `PurchaseRequisitionsTable` and `PurchaseReturnsPanel` render controlled records and emit edit or workflow actions through callbacks.
- The purchasing workbench owns receipt validation and inventory API actions; `PurchaseReceiptForm` edits controlled actual quantities, supplier lot codes, expiry dates, and notes, then submits through a callback.
- The generic entity drawer owns payload normalization, validation and persistence; `EntityLineEditors` renders controlled sales, purchasing, inventory and journal lines with their reference data and preview.
- The hotel front desk owns reservation permissions, validation and persistence; `ReservationCreateForm` renders controlled guest, room type, date and occupancy fields, while `ReservationDatesForm` edits the dates and guest count of booked stays. Both forms emit changes and submit requests through callbacks.
- The automotive workshop owns repair-order status, permissions and price refreshes; `RepairQuoteEditor` edits the controlled parts, labor, warehouse and complaint draft, then submits the revised quote through a callback while the order is still awaiting customer approval.
- The pharmacy workbench owns prescription validation, status transitions and persistence; `PrescriptionForm` renders controlled prescription details and medicine lines for new records or editable drafts, and emits updates through callbacks.

## Styling layers

`client/public/app/styles/` loads in this order: design tokens, base/reset and utilities, reusable components, page layout, then shared workspace refinements. Components should use semantic variables (`--surface`, `--text-muted`, `--accent`) instead of hard-coded colors. Responsive behavior and reduced-motion preferences belong in shared styles unless a workflow needs a distinct interaction model.
