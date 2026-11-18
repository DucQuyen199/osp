# Kiến trúc OSP Suite

## Mục tiêu

OSP là modular monolith: một tiến trình Rust/Axum, một PostgreSQL, các bounded context triển khai qua catalog module. Tất cả nghiệp vụ ghi chạy trong transaction PostgreSQL có tenant scope và RLS. Tách dịch vụ chỉ khi có nhu cầu vận hành đo được.

## Tenant and company boundaries

Each tenant owns one organization's data and its users, roles, settings, audit, and row-level security context. A branch is an operational location within that tenant. Separate tenants cannot reference one another's records. A consent-based, read-only consolidated trial balance is implemented for company groups, with named-user report grants, FX rate-age controls, audited snapshots, and approved management elimination journals. It preserves tenant RLS and requires active member consent before each cross-tenant report access. A consolidated balance sheet, automated intercompany matching, and statutory translation remain out of scope; see [ADR-0010](adr/0010-multi-company-and-consolidation.md).

## Các lớp hệ thống

```text
React/Vite client (React routes and screens; shared utilities in `client/src/lib`)
        │ REST / JSON
        ▼
Delivery: Axum HTTP, auth extraction, DTO, OpenAPI
        ▼
Application: Kernel use cases, permissions, transaction/event orchestration
        ▼
Domain contexts: server/src/modules/<context>
        │                         │
        └── domain events/rules ──┘
        ▼
Adapters: PostgreSQL repositories/schema, RLS, file/provider integrations
```

Dependency direction flows inward: domain policy does not depend on HTTP or SQL APIs. Application code owns command sequencing and transaction boundaries. Persistence adapters use the transaction passed by the kernel; they never commit independently. Cross-context database writes remain atomic inside the modular monolith. External calls should use a transactional outbox before being enabled in production.

## Module catalog and behavior

`definitions/modules/<id>.json` declares entities, fields, states, dependencies, scheduled jobs, and declarative event reactions. `definitions/verticals/<id>.json` selects modules and configures terminology, extensions, roles, and KPIs. Rust validates and loads both catalogs; Rust catalog CLI produces lint results, OpenAPI, and module documentation.

Computed fields, numeric rule increments, schema minimums, CSV imports, KPI formulas, and financial preview/reconciliation paths use Decimal. The server emits JSON numbers; the browser response parser preserves values beyond JavaScript's safe precision as decimal strings so Decimal calculations do not receive rounded values.

Scheduled job actions run in tenant-scoped PostgreSQL transactions under tenant and row locks; each worker rechecks the due predicate and retry cooldown after acquiring the tenant lock, so candidates selected by concurrent scheduler instances cannot bypass a newly recorded failure. Failed retries update one open failure record per tenant/job/entity instead of creating a row every scheduler tick. The scheduler delays retries with capped exponential backoff (one minute to six hours) and skips records whose failure is still cooling down, so permanently invalid early records cannot occupy the first 500 due slots on every tick; a successful retry resolves the failure in the same transaction as the action.

Each tenant can set `settings.businessTimezone` to an IANA timezone. Date-only domain validations, business-date defaults, due-date scheduler jobs, and client calendar defaults use that tenant-local date; database timestamps remain UTC. New tenants and older tenants without this setting use UTC until an administrator configures their business timezone. Timezone identifiers are validated against the IANA database via [`chrono-tz`](https://docs.rs/chrono-tz/latest/chrono_tz/).

The client is installable as a PWA and caches only the application shell and static assets. The service worker never caches `/api` responses or queues transactions. Writes are rejected when the browser reports offline; if a connection drops during a write, the client reports that the result is unknown and asks the operator to reload and reconcile before retrying. Offline transaction entry and synchronization are not supported.

New domain contexts use:

```text
server/src/modules/<context>/
  mod.rs           public facade registered by modules/mod.rs
  domain.rs        pure invariants and action policy
  application.rs   command preparation and orchestration
  persistence.rs   tenant-scoped queries and concurrency control
```

Existing flat context files are being moved when their workflows are deepened. Catalog rules are appropriate for simple event-to-command integrations. Financial, inventory, authorization, tenant isolation, and concurrency invariants remain enforced in Rust. The React application lives in `client/`; domain contexts stay in Rust and are exposed through the REST contract.

Large contexts keep the same public facade while splitting focused use cases into private submodules under the owning layer (for example, accounting source-document event mappings live under `modules/accounting/application/`). Submodules do not introduce cross-context ownership; they keep one bounded context's policy and transaction responsibilities discoverable.

The shared kernel data layer follows the same rule. `kernel/data.rs` keeps the `ListQuery` and row-normalization contract stable while its private `kernel/data/` modules separate schema validation, database mapping and API entry points, create/update use cases, lifecycle actions and audit, accounting side effects, and list/report queries. List queries support typed equality filters and date range suffixes (`__gt`, `__gte`, `__lt`, `__lte`), with pages capped at 1,000 rows. Document commands are grouped under `kernel/data/documents/`. Internal helpers use the narrowest visibility that fits their callers; domain modules continue to use the existing `Kernel` API and transaction contract.

### Quy ước trách nhiệm trong module

- `mod.rs` chỉ khai báo các lớp con và xuất API mà kernel cần; không chứa quy tắc nghiệp vụ.
- `domain.rs` kiểm tra bất biến thuần, không truy cập PostgreSQL, HTTP, tenant session hay transaction.
- `application.rs` chuẩn hóa dữ liệu và điều phối use case/event trong transaction do kernel truyền vào; không tự mở hoặc commit transaction.
- `persistence.rs` là facade truy vấn; các luồng lớn được tách thành `persistence/<nghiệp-vụ>.rs` theo entity hoặc thao tác. Truy vấn phải giới hạn tenant và khóa dữ liệu khi quyết định phụ thuộc trạng thái có thể đổi đồng thời.
- `reports.rs` và các thư mục con chỉ tạo projection đọc; không cập nhật trạng thái nghiệp vụ.
- Số tiền và số lượng cần độ chính xác thập phân dùng `rust_decimal::Decimal`; đọc PostgreSQL `numeric` dưới dạng text, tính bằng phép toán checked và chuyển JSON qua `money::json_number`.

Tách file theo use case và chủ sở hữu dữ liệu, không theo số dòng. Submodule chỉ dùng trong bounded context qua `pub(super)`; facade giữ nguyên contract để kernel, REST và React không phụ thuộc đường dẫn nội bộ.

Journal-line balance and shape rules are isolated in `modules/accounting/domain/journal.rs`; the accounting domain facade delegates journal validation there so the accounting entry policy remains independent from document and payment validation.

Accounting return-note creation is also isolated under `modules/accounting/application/returns.rs`; it retains the locked source lookup and note posting in the caller's transaction.

Tenant-scoped journal-line references and exact event-ticket refund reversals are validated by `modules/accounting/persistence/journals.rs`, called by the accounting persistence facade inside the same write transaction.

Accounting payment creation checks and posted invoice, bill, credit-note, and debit-note checks live in `modules/accounting/persistence/payments.rs` and `documents.rs`. The facade dispatches by entity and lifecycle action; these validators retain the transaction and tenant context passed by the kernel.

Accounting payment checks read PostgreSQL numeric values as decimal text and compare invoice balances, refunds, payroll payments, and source-document totals with shared decimal tolerance rules.

Invoice, bill, and return-note posting validation uses Decimal for credit exposure, purchase-order line snapshots, payment coverage, and adjustment caps. Credit-limit exposure uses base-currency totals consistently for existing and new invoices.

Bank-statement CSV parsing, matching, reconciliation, ticket-refund reversal checks, and stock-valuation journal creation also use the shared Decimal layer for financial amounts.

Bank-statement persistence keeps its accounting facade stable and routes statement setup/retention, line snapshots, payment/journal matching, and reconciliation into focused private workflows under `modules/accounting/persistence/bank_statements/`. Each workflow receives the caller's tenant-scoped PostgreSQL transaction.

The accounting tax register reads numeric totals and exchange rates as decimal text, converts line amounts with decimal rounding, and returns monetary report fields as JSON numbers without float aggregation.

Accounting currency posting and payment preparation snapshot effective rates and convert totals, taxes, and applied payment amounts with Decimal before writing base-currency fields.

Ledger settlement handlers build journal lines from Decimal amounts and reconcile payroll gross allocations, deductions, contribution liabilities, refunds, and foreign-exchange differences without float arithmetic. The settlement facade dispatches focused `disbursements.rs`, `payroll_expense.rs`, and `provider_payments.rs` workflows under `application/ledger/`, preserving one transaction and the existing kernel event contract.

Accounting monetary invariants and journal construction use checked Decimal operations. PostgreSQL numeric report values are parsed as Decimal, and derived report totals are serialized as JSON numbers through the shared money adapter. Trial balance, income statement, balance sheet, receivable/payable aging, cash-flow forecast, and FX revaluation keep exact decimal values through their final aggregation.

Accounting's structure follows the bounded-context layers: `domain.rs` validates document, payment, and journal rules; `application/` owns source-event preparation, posting, refunds, and reconciliation; `persistence/` owns tenant-scoped stored-record checks; `reports/` owns read-only ledger projections. The public facade in `mod.rs` preserves the kernel contract while each workflow remains in a focused file.

Inventory valuation journal creation is implemented in `modules/accounting/persistence/stock_posting.rs`; the persistence facade re-exports it so the existing event dispatcher keeps the same public entry point.

Inventory lot allocation and FIFO cost-layer reconstruction live in `modules/inventory/application/valuation.rs`; stock-movement use cases call this shared policy adapter inside their existing transaction.

Sales line monetary calculations (discount, net, tax, and total rounding) live in `modules/sales/application/pricing.rs`; the sales application recalculates line snapshots and document total/tax totals in Rust. Credit exposure, logistics stock commitments, delivered quantities, and return eligibility use Decimal through tenant-scoped persistence checks, with PostgreSQL numeric aggregates read as text. These header amounts are system-managed and the sales application facade re-exports the line recalculation use case used by the kernel.

Sales keeps its stable module facade while splitting application use cases into document preparation, fulfillment/source events, and pricing; persistence routes order, price-list, and return invariants to separate workflow files. All child workflows receive the kernel transaction, and the cross-context event contract remains unchanged.

Shared financial primitives in `server/src/money.rs` use `rust_decimal` for base-10 arithmetic and serialize derived amounts as JSON numbers with arbitrary precision before they reach PostgreSQL JSONB. Sales and purchasing use the same line-rounding and tax policy.

POS, ecommerce, restaurant, field service, automotive repair, project timesheets, and employee expense claims use the same decimal primitives for line and document totals.

POS session cash reconciliation reads numeric aggregates from PostgreSQL as decimal text and computes expected cash and counted-cash variance with the shared decimal primitives.

Payroll monthly salary proration, overtime, tax brackets, contribution rates, payslip invariants and payroll-run totals use checked Decimal arithmetic. Its domain facade delegates policy and lifecycle rules to `modules/payroll/domain/policies.rs` and `domain/lifecycle.rs`; the application workflow separates calculation, overtime, tax and contribution policies. The persistence facade routes policy, setup, run-calculation and payslip checks to focused files and reads PostgreSQL numeric values as decimal text.

POS and restaurant order totals and payroll net pay are prepared in their Rust application workflows; catalog expressions do not duplicate these persisted financial values. Fields derived from line snapshots or payroll inputs are marked system-managed so clients cannot submit a conflicting amount.

Restaurant recipe output quantities, order portions, and ingredient consumption snapshots use checked Decimal multiplication/division before the inventory event; the resulting JSON quantities are serialized as decimal numbers.

Automotive repair part quantities, prices, completion totals, and stored odometer readings are validated with Decimal; PostgreSQL odometer values are read as text before the monotonicity check.

Project budgets, time quantities, and billable rates use Decimal. School tuition snapshots and fee comparisons use PostgreSQL decimal text, while class capacity remains integer-valued. Loyalty accruals and return reversals calculate points with Decimal and cap cumulative reversals at the original earned balance.

Fixed-asset capitalization, monthly depreciation, disposal and book-value updates use checked Decimal values; PostgreSQL numeric amounts are read as decimal text and journal lines are serialized as JSON numbers. Book value is prepared from acquisition cost and opening depreciation, then reduced in the same transaction that posts depreciation; it remains system-managed and is no longer defined by a catalog expression.

Field-service work-order totals are rebuilt from line snapshots in the module application layer before validation and state transitions; the catalog only declares the work-order shape and state machine.

Ecommerce cart line prices are refreshed from tenant-owned product and storefront price-list data in the Rust application layer. The persisted total is system-managed, and placement recalculates the cart before creating its sales order.

Bank reconciliation can bind a statement line to a single unused posted journal when posting date, account 112 net movement, direction, and amount identify exactly one candidate. Ambiguous matches remain explicit user choices inside the same tenant-scoped transaction.

The ERP inventory context now follows this directory layout. Its pure stock and transfer policies are in `domain.rs`; transactional stock preparation and the stock-movement-to-balance handler are in `application.rs`; tenant record checks and approval guards are in `persistence.rs`. The kernel-facing API remains re-exported from `mod.rs`. Stock quantity, inventory value, QC-held quantity, and related COGS/WIP/count journal entries are handled by Rust in the movement transaction rather than catalog rules.

Master Data follows the same bounded-context layout. Shared parties, products, product categories, units, branches, currencies, and taxes are normalized in `application.rs`; pure monetary and measurement bounds live in `domain.rs`; `persistence.rs` dispatches tenant-scoped uniqueness, credit exposure, lot-tracking, currency-rate, category-tree, and unit-of-measure checks to focused adapters under `persistence/`. Credit exposure reads PostgreSQL numeric aggregates as text and compares them with Decimal. Product inventory units must reference tenant-owned base units. Alternate units point directly to a base unit and store a positive ratio of base units per alternate unit, preventing cross-family conversions and chained conversion drift. Sales, purchasing, and POS lines preserve entered quantities/prices for the commercial amount and snapshot `base_qty`, unit name, and conversion ratio for stock movements; purchase unit costs are divided by the ratio before inventory valuation. Clinic prescriptions now select the medicine unit and snapshot base quantities before dispensing. Prescription fulfillment compares dispensed POS quantities in the medicine's base unit. Restaurant recipes can be maintained from the service screen; each ingredient selects a product unit and stock consumption converts that recipe quantity to the ingredient's base unit. Manufacturing BOM lines likewise snapshot base quantities for production issue. Agriculture input and harvest records preserve the entered unit and snapshot base quantities before inventory issue or receipt. Product base units and conversion ratios cannot change while stock history, recipes, or business documents depend on them. Product unit and category-parent links are catalog references with PostgreSQL tenant-composite foreign keys. Existing text values are migrated by matching legacy names inside their tenant; unresolved labels are preserved in the record's `custom` metadata before the typed reference is cleared.

Real Estate validates positive area and rent, lease date order, and buyer identity for sales. Lease activation locks the property and rejects unavailable properties or overlapping active dates; lease termination releases the property after the last active lease ends. A scheduled Rust lifecycle action terminates expired leases so the same release flow runs for expiry and manual termination. Each lease creates an idempotently source-linked contract; lease termination cancels its draft contract or terminates its active contract. Viewing appointments cannot be scheduled for sold properties, and sold property/operational lease history is protected from edits or deletion.

Inventory replenishment rules are scoped to one product and warehouse. A tenant-authorized read model projects usable stock after expired lot balances and QC holds, remaining quantities on active purchase orders, open purchase requisitions, and committed tracked-product demand from confirmed sales orders. It subtracts only delivered shipment quantities from sales demand because created and dispatched shipments remain in on-hand stock until delivery posts their stock movements. Sales demand joins are included only when the tenant enables Sales and, for delivered-quantity netting, Logistics; QC holds are included only when Quality is enabled. The report shows committed and projected quantities and suggests enough supply to reach the configured target. Creating a draft purchase requisition recalculates positive suggestions inside the tenant write transaction and creates one request per warehouse; later suggestions net that request until a linked purchase order takes over. The implementation lives in `modules/inventory/reports.rs` and the UI consumes only the Rust API.

Inventory valuation supports tenant-wide moving-average and FIFO methods. FIFO receipt layers are reconstructed from immutable stock moves; every outbound movement snapshots the exact consumed layer IDs, quantities, costs, lot, and receipt date. Warehouse transfers split their receipt movements by source layer and preserve the original receipt date/order. The method can only be selected before any stock movement or nonzero balance exists, and FIFO cannot be combined with negative stock. Purchase-return debit notes credit inventory at the returned stock movement's actual valuation and post any difference from supplier credit to the appropriate gain/loss account.

Inventory application workflows are separated into count snapshots, event handlers, stock-move preparation, stock-level application, and FEFO/FIFO valuation. Stock quantities and costs stay Decimal across these boundaries; PostgreSQL `numeric` values are read as decimal text and serialized to JSON numbers before system-managed stock balances are updated.

Products can opt into lot tracking before their first inventory movement. Expiry-sensitive products can additionally require an expiry date on every lot; that policy can be enabled only when existing movements and lots already have complete lot/expiry traceability, and it cannot be disabled after inventory history exists. Rust enforces the policy when lots are created and when movements use them, validates tenant/product ownership, uses FEFO for unassigned issues, records lot-specific stock-count snapshots, and prevents changing lot tracking once movements, balances, or lots exist.

Physical stock counts enter quantities in each product's base unit, snapshot book balances on submission, and serialize through the same product/warehouse locks as stock moves. The count workbench labels that base unit on product selection, entry, and variance review. The Rust event handler derives and posts only the variance after approval; while a submitted count is pending, new movements for its products are rejected. Submitted and approved count records remain audit evidence.

Budget actuals are recomputed from posted ledger lines inside the same PostgreSQL transaction that posts a journal entry or approves a budget. Expense accounts use debit-minus-credit and revenue accounts use credit-minus-debit; the tenant-authorized Rust variance report keeps those totals separate, calculates variance and utilization with Decimal, and treats negative favorable variance as overspend or missed revenue target.

Optional budget enforcement is owned by `modules/budget/persistence/journal_control.rs` and dispatched for every accounting journal posting. It checks expense activity at annual and monthly periods, acquires tenant-period advisory locks before reading allocations, and rejects unallocated or over-limit postings in the source transaction.

CRM pipeline reports read monetary and probability values as decimal text. Rust calculates stage-weighted opportunity values and all stage/overall totals with checked Decimal operations before serializing report JSON.

Hotel reads room rates, folio charges, and locked reservation totals as PostgreSQL decimal text. Rust snapshots the nightly rate, multiplies by the stay length, adds folio charges, and emits the checkout invoice amount without float arithmetic.

An in-house hotel reservation can only be updated through a checkout-date extension. The update must move checkout later and include no other fields; the tenant-serialized persistence check rejects room-type or assigned-room conflicts, and application preparation recomputes nights and folio total from the original nightly-rate snapshot before the eventual checkout invoice is created.

Sales orders fulfilled through Logistics reserve their remaining quantities at confirmation. Reservation and stock availability checks use base quantities, while shipment lines are locked and checked against the source order's selected unit and price; each successful partial delivery creates its stock issue in the same event transaction. The order moves to `partially_delivered` on an incomplete first delivery and closes only when all physical quantities have shipped.

Sales returns for shipped orders are capped by successfully delivered shipment quantities, less submitted or completed prior returns. The source order row lock serializes delivery and return checks, so pending deliveries cannot be returned and the same delivered units cannot be returned twice.

Purchasing also uses the layered context layout. Submitting/approving a purchase requisition checks supplier, warehouse, and product records under tenant-scoped locks, then approval creates a linked draft purchase order in the same transaction. Requisition lines retain the selected unit and a server-resolved conversion snapshot; generated purchase orders and RFQs reuse that snapshot so a later unit-catalog change does not silently alter the approved requirement. Accepting an RFQ creates its linked draft purchase order through the same Rust application service; this stateful flow no longer lives in a JSON event rule. Submitted and operational procurement records cannot be hard-deleted.

Purchasing application use cases are grouped by workflow under `modules/purchasing/application/`: `documents.rs` prepares purchase document snapshots and calculates order, receipt and return totals in Rust, while `sourcing.rs` creates orders from requisitions/RFQs and advances orders from receipt events. Receipt completion reconciles quantities by product, price, and unit so same-price lines in different units remain independent. Totals are system-managed fields, so clients cannot supply or override the financial values. The `application.rs` facade exports only the existing kernel entry points, preserving the module boundary while keeping each workflow independently navigable.

Purchasing quantities, source prices, receipt progress, supplier-return limits and QC disposition checks use Decimal; PostgreSQL numeric fields and quantity aggregates are read as text before validation. Application and persistence code no longer uses binary floating point for purchasing values.

Pharmacy prescriptions store each selected dispensing unit with a server-resolved base-quantity snapshot. POS prescription limits, partial-dispense status, and the pharmacy workbench compare base quantities, then present fulfillment in the prescribed unit.

Quality inspection dispositions and source-document traceability use Decimal for inspected, released, returned, and held-stock quantities. Purchase-order and receipt line matching uses the same tolerance policy in Rust, while numeric aggregates are parsed from PostgreSQL text to avoid float conversions.

Lending policy keeps loan and repayment invariants in `domain.rs` and annuity/date calculations in `domain/installments.rs`. Each new loan records the contractual first due date before approval; generated monthly installments start on that date and preserve its day-of-month when possible, avoiding a schedule anchored to the server's UTC processing date. Legacy loans without the field retain the previous one-month-from-disbursement schedule. Principal, annual rates, monthly interest, principal portions, and repayment totals use Decimal with cent rounding; persistence reads PostgreSQL numeric terms as decimal text and validates each generated installment against the approved loan schedule.

Utilities meter reading snapshots calculate consumption and billed amount from Decimal readings and the rate locked for that meter. Persistence compares the prior reading, meter-rate snapshot, and immutable reading period against PostgreSQL numeric text; issued bills copy the verified amount snapshot from their reading.

Manufacturing validates BOM and production quantities in Decimal, snapshots good output and scrap quantities, and checks work-center daily load against persisted capacity using numeric text. WIP subledger valuation and account 154 reconciliation also retain Decimal through report aggregation and draft journal preparation.

Logistics validates partial delivery reservations by product and rounded source price using Decimal quantities. Shipment preparation snapshots server-derived product weights and total shipment weight as JSON numbers, while dispatch checks the captured weight against the vehicle's PostgreSQL numeric capacity.

Event ticket reservations snapshot the published price and tax rate as Decimal; net and tax are calculated with cent rounding and checked against the captured gross. POS order lines, session cash and completed totals validate against the same decimal parser used by Rust pricing workflows. The POS workbench lists recent completed transactions and exposes the supported full-refund action with a required audit reason; refund processing restores eligible stock, reverses the accounting/payment effects, and records cash refunds against a compatible open cashier session.

Subscription billing snapshots the plan's PostgreSQL numeric price as Decimal when creating each cycle and checks the persisted cycle amount against the locked current plan price before accepting the record. A cycle can transition to paid only after its linked accounting invoice is paid; the invoice payment event performs that transition and schedules the following cycle.

Booking defaults snapshot service prices as Decimal and convert service duration to milliseconds through checked Decimal arithmetic. Insurance claim approval parses coverage and prior claim totals from PostgreSQL numeric text and caps cumulative approved claims against the policy limit.

Each tracked purchase receipt posts its inventory value to the GRNI clearing liability account in the same transaction as the stock movement. Receipt alone does not create a payable. Supplier invoice records capture the vendor's invoice number and dates; approval locks the order and verifies cumulative invoiced quantities by product and PO unit price never exceed received quantities after dispatched returns. The invoice can preserve actual vendor unit prices, tax rates, and described charges or discounts with their tax codes. Its PO-cost matched value clears GRNI; product price differences and invoice-level adjustments post separately to purchase expense account 632, while input tax posts to 1331. Each bill matches the approved supplier invoice, including adjustment lines. Legacy receipts without GRNI journals continue to fall back to inventory, preserving existing tenant balances during rollout. Invoice adjustments are not allocated into inventory valuation layers.

Purchase returns without a posted supplier bill debit the order's GRNI and credit inventory. Return limits are reconciled by product, source price, and unit so quantities bought by case and by piece are not combined. Returns linked to a failed quality inspection compare against the inspection's base-unit quantity and base-unit cost. A return against billed goods must select the supplier invoice being reversed; its return quantity is capped by that invoice on the same unit basis, and the accounting workflow creates a payable debit note against the matching bill.

BI report schedules support daily and weekly UTC cadences. The shared scheduled-job dispatcher locks due reports and emits the report state action in the tenant transaction; the BI event handler evaluates the saved tenant-authorized query in one repeatable database snapshot, stores up to 50,000 rows in a system-managed snapshot capped at 2 MB, and advances the next-run time atomically. Email attachments contain the complete CSV and are limited to 1 MB; larger files fail the job instead of being sent partially. Report owners can pause or resume the cadence and inspect the latest 50 snapshots.

Production Compose separates the HTTP API service from background workers with `OSP_PROCESS_ROLE=api` and `OSP_PROCESS_ROLE=worker`. Worker replicas share PostgreSQL-backed queues using row locks, `SKIP LOCKED`, and leases; scheduled entity jobs recheck eligibility after locking before applying transitions. Scale the `osp-worker` service independently of the API and size it against PostgreSQL capacity.

The integration-hub context owns connector, webhook, and API-key configuration policy. Its domain layer validates public HTTPS endpoint shape, event names, connector headers, and permission scopes; its application layer normalizes configuration and enqueues subscribed events in the source transaction. A Rust worker delivers webhook and `http_event_sink` connector events with bounded retry and dead-letter handling, DNS/IP SSRF protection, and HMAC signatures. Connectors can send provider-specific headers, which are redacted from API reads and preserved when clients round-trip masked configuration. Tenant administrators can send connectivity probes and inspect, retry, or dismiss dead-letter deliveries.

E-invoice provider requests classify transport failures, HTTP 408/425/429, and 5xx as transient. The worker records each failed attempt, schedules up to eight idempotent retries with exponential backoff, and returns issuance or cancellation to its matching queue when due. Permanent provider rejections remain failed for operator review; manual retry resets the attempt counter.

Project work now includes an explicit `task_dependency` entity. The persistence layer verifies both tasks belong to the same tenant and project, serializes changes through the project row, rejects cycles and duplicate links, and blocks task completion until every predecessor is done. Dependency links are immutable; users remove and recreate a link to change it. The module remains split into the standard `domain.rs`, `application.rs`, `persistence.rs`, and `mod.rs` layers.

Project timesheets calculate `amount` in Rust from hours and rate, treat a missing rate as unpriced time, and expose the amount as a system-managed field so client input cannot set it.

Accounting now follows the same bounded-context layers: `domain.rs` owns pure document and ledger invariants, `application.rs` translates business events into invoices, notes, and balanced journals, and `persistence.rs` performs tenant-scoped cross-document checks and posting locks. `mod.rs` is the stable facade used by the kernel. Source-document changes and ledger entries remain in the same PostgreSQL transaction.

Accounting bank reconciliation uses tenant-scoped statement headers and immutable matched/ignored statement lines. A statement line can match either a bank/transfer payment or a directly selected posted journal entry. Persistence locks a statement while lines are entered or matched, checks the net account 112 movement against direction and amount, prevents one journal from matching multiple lines (including payment-linked journals), and reconciles only when every match still resolves and the statement balance equation holds.

Draft bank statements accept UTF-8 CSV imports through the Rust accounting application layer. The importer validates the complete file and statement period before writing, creates all lines atomically, and makes replays idempotent by bank reference or a deterministic row fingerprint. The supported CSV contract uses `transaction_date` (or `date`), `amount` plus `direction` (or `debit` plus `credit`), and optional `reference` and `description` columns.

Bank statements now retain the selected transaction currency. Rust snapshots each line's effective exchange rate, rate date, and base-currency amount when the line is created or its amount/date/statement changes. Reconciliation compares the statement amount and currency with a linked payment and compares the base-currency snapshot with the posted bank-account journal movement; older statements without a currency remain base-currency statements.

Accounting's tax register aggregates posted invoices, customer credit notes, supplier bills, supplier debit notes, and VAT-bearing ticket payments/refunds by tax name/rate and journal posting date. Purchasing snapshots tax name/rate and calculates line tax in Rust; recoverable input VAT posts separately from inventory cost, and supplier returns reverse the matching input VAT. The report reconciles document totals against line snapshots and puts legacy amounts without snapshots in an unallocated bucket. It is an internal control report; statutory filing formats remain separate work.

Tax-register detail rows carry Rust-calculated taxable and tax amounts in tenant base currency, so the React report only formats and displays financial values.

Foreign-currency invoices, bills, adjustment notes and settlements snapshot effective rates in Rust; settlement journals record realized exchange differences. The as-of receivable/payable revaluation report calculates closing-rate adjustments and can create one idempotent draft journal per accounting date. Control-account lines retain currency, receivable/payable identity, closing rate, rate date, and balance snapshots so later valuations carry forward active adjustments and reviewers can inspect the inputs; reversed journals stop affecting later cutoffs. It requires rates for every open position and rejects closed periods; posting remains in the normal journal approval flow.

Payroll's `calculated` action locks a draft run and the active employee roster, then creates one immutable payslip per employee from a monthly base salary and paid attendance, approved leave, holidays, and overtime. Complete or partial attendance contributes elapsed hours divided by the employee's scheduled hours for that date, rounded to six decimal places and capped at one paid day; paid leave and paid holidays are combined with attendance and capped at one day per date. HRM leave requests store an explicit paid/unpaid treatment and lock it after submission. Each payroll run snapshots a validated ISO weekday set (Monday–Friday by default); an employee can override it with a recurring weekly day set and standard hours, while date-specific entries and applied rotation patterns materialized into those entries can add shifts or mark rest days. A rotation cycle specifies local start/end times and an IANA time zone, and applies atomically to up to 50 employees for up to two years, capped at 40,000 generated employee-day rows, after locking the affected payroll months and employee rows. Rust uses the effective calendar for salary proration, attendance, paid leave, holidays, overtime rates, leave-entitlement reservations, and payslip validation. Payslips snapshot the effective weekday set and standard hours with paid/working-day counts, and schedule entries cannot be changed or removed for a month with a payslip. Longer horizons and jurisdiction-specific holiday rules remain future work.

HRM departments now support a typed `parent_department` reference while retaining the prior free-text `parent` value for existing tenant data. Rust serializes hierarchy edits per tenant, validates the parent is tenant-owned, prevents self-parenting and descendant cycles, and keeps departments with employees, positions, child departments, or journal history from being removed.

Utilities now follows the same layout for the metering-to-cash workflow. The application layer snapshots each meter's rate and calculates period consumption, then prepares a bill from the immutable reading. The domain layer protects reading history and bill state transitions; persistence checks tenant ownership, unique readings and bills, and requires the related accounting invoice to be paid before the utility bill can be marked paid. Issued bills continue through the accounting event handler in the same transaction.

Insurance follows the same layout for policy and claim administration. Policy activation requires complete coverage dates, a premium and a coverage limit; claims are accepted only for an active tenant-owned policy and an incident inside its coverage period. Approval locks the policy row and checks aggregate approved and paid claims against the coverage limit, so concurrent approvals cannot overrun it. Accounting continues to receive the policy-premium and claim-payment events in the same transaction.

Agriculture follows the same layout for farm, crop-cycle, harvest, and input-application records. It checks tenant-owned farms, products, and warehouses, validates operation dates against planting and expected harvest dates, and preserves field-operation history. A harvest creates its inventory receipt in the source transaction; a product-backed input application creates an inventory issue, while non-stock water-use records remain agricultural-only.

Clinic follows the same layout for patient identity, encounters, prescriptions, and laboratory orders. Encounter billing derives the accounting party from the tenant's patient record; completion requires a clinician, diagnosis, and positive fee. Dispensing requires a completed encounter and validated medication lines, then consumes tracked inventory in the same transaction. Completed encounters, dispensed prescriptions, and resulted laboratory orders remain immutable medical history.

Construction follows the same layout for BOQs, sites, subcontracts, progress claims, and site diaries. BOQ lines retain an explicit measurement unit with their quantity and unit price, and totals are calculated from validated quantities and prices. Subcontract signing locks the project and checks total signed commitments against its budget. Signing records a commitment only. Each approved progress claim locks its subcontract, checks that cumulative approved value stays within contract value, and creates a payable bill in the same transaction. Site diaries are unique per site/day and kept as immutable project history.

For sales orders with a shipping address in a tenant that uses Logistics, confirmation creates fulfillment work but does not recognize receivables. Accounting invoices the full order after the sales order reaches delivered, which is only allowed after every shipment and ordered quantity has been delivered. Counter sales without shipment workflow remain invoiced at confirmation.

Construction persistence is divided into BOQ, site/diary, and subcontract checks. Budget and commitment values are read as PostgreSQL decimal text and compared with checked Decimal arithmetic before a subcontract is signed.

Charity persistence is divided into program-budget, donation-receipt, and disbursement workflows. Donation amounts, program budgets, accounting payment snapshots, and cumulative approved disbursements use Decimal through Rust validation and source-event posting.

Purchasing persistence separates receipt progression and order matching from purchase-return and inspection checks. Supplier, requisition, and shared-approval checks remain in the facade and use the kernel transaction.

Starting a manufacturing order issues its full BOM-scaled batch from raw inventory into WIP account 154 in the same transaction. Completion records accepted output and scrap quantities; Rust requires them to sum to the planned order quantity and requires a scrap reason when nonzero. QC is opened for accepted output, and a passed inspection transfers consumed material value into finished inventory at good-unit cost. Failed finished-goods inspections can be split among partial rework, scrap, and conditional acceptance without overlapping quantities. Rework issues a BOM-scaled batch against the original production order and WIP balance; completing it returns the repaired quantity to a separate pending QC inspection. A conditional acceptance records both technical justification and usage/control conditions, creates an approval request, and cannot post inventory until an independent approver accepts it. Approval creates a linked concession inspection; passing that inspection receives only the approved quantity, transfers base plus rework material cost from WIP into finished inventory, and preserves the failed inspection and its nonconformance history. Rework and dispositions are locked against duplicate quantities on the source inspection. The tenant-authorized WIP read model includes in-progress and completed-but-not-yet-accepted orders and compares their open operational balances with posted account 154 at a cutoff date. An accountant can create an idempotent draft adjustment with a chosen contra account; posting remains in the standard accounting review flow. Automatic period-end close remains a separate policy/workflow.

Production orders can reserve a work center for their planned start date. Rust serializes the work-center row, sums planned and in-progress quantities for that day, and rejects assignments over the configured daily capacity. Capacity cannot be lowered beneath the busiest scheduled day, and a center remains in history while referenced by any production order.

Expense claims calculate their total in Rust from validated item amounts and expose it as a system-managed field. The bounded payment method (`cash` or `bank`) flows through approval and reimbursement. The source-event application creates a valid accounting payment, and the ledger handler credits cash account 111 or bank account 112 against employee payable 334. The legacy/default method remains cash.

Automotive repair-order totals are calculated by the Rust application from work and parts lines and cannot be supplied by the client.

Events uses a dedicated Rust context to publish events, hold ticket reservations, sell tickets at the published price, and check in attendees. A row lock on the event serializes capacity checks across ticket creation, preventing overselling. Tenant-configured ticket tax is snapshotted on the event/ticket; the tax-inclusive price is split into revenue and VAT payable in the source transaction. Full refunds before event start reverse the original payment journal and add a credit to the internal tax register.

Case Management follows the same layout for client matters, notes, and billable time. Time entries derive their client from the case and calculate fees from Decimal hours and rates, retaining the two-decimal invoice rounding policy; the tenant-scoped write lock protects each person's daily 24-hour ceiling using exact numeric aggregation. Closing a case requires every time entry to be billed, and the billing action emits the existing accounting invoice event in the same transaction.

Maintenance validates part quantities, labor hours and rates as Decimal. Scheduled plan execution reads the interval as PostgreSQL numeric text, validates it as a positive whole number of days, and advances the due date while holding the tenant-owned plan row lock.

Approval rules compare minimum amounts using PostgreSQL `numeric` and exact decimal input. Recruitment uses whole-number headcount limits against locked hired counts; document version transitions likewise compare validated integer-valued decimals.

## Write transaction

```text
HTTP request → authenticate → authorize → BEGIN
  validate shape and domain policy
  lock/check referenced tenant records
  persist source record + audit entry
  emit event
    each enabled subscriber runs under SAVEPOINT
    required failure rolls back the source command
    optional failure rolls back only its subscriber and is recorded
COMMIT
```

Events include causation identifiers. A configured maximum depth stops event loops. PostgreSQL RLS protects business tables even when a query forgets an application filter.

## Release status

The Rust server, PostgreSQL deployment, and React/Vite client build are active. TypeScript source and runtime have been removed. React owns the web routes and screens; Rust owns the production API and business workflows. Shared client helpers live in `client/src/lib`; design tokens and styles remain in `client/public/app/styles`. Deeper module behavior, external provider integrations, release rehearsals, and full workflow verification remain in the roadmap.

Inventory bin tracking now covers transfers, stock-on-hand reporting, and physical counts. A submitted count snapshots the product/lot/bin book balance while holding the product/warehouse lock, prevents competing stock movements until disposition, and posts only approved variances back to the counted bin.

The manufacturing workbench now manages BOMs, planned production orders, material issue, good/scrap output, and finished-goods QC. BOM ingredient units are validated against each component's base unit; production scales their snapshotted base quantities, then QC pass posts accepted output into inventory.


Purchase-order bill posting now performs three-way line matching in the tenant transaction: the bill must cover the same product quantities and per-product net amounts as the fully received source order, in addition to supplier, tax, total, and single-bill checks.


Salary changes are stored as approved, effective-dated HRM revisions. Payroll selects the latest approved salary effective on or before the run month, with the employee's base salary as the legacy baseline. Salary approval shares the payroll period lock and is rejected when that employee already has payslips for the effective month or any later month, preventing retroactive changes to payroll snapshots.

Generated payroll slips now retain the monthly salary basis, paid/working-day counts and applied HRM salary-revision reference. Rust checks that the salary snapshot matches the revision effective for the run period and that gross pay reconciles to the captured inputs. This preserves the calculation trail for review after later salary changes.

HRM leave entitlements and half-day reservations use Decimal values from PostgreSQL numeric text. Salary-change guards compare Decimal snapshots against the employee's stored salary before allowing edits after payroll has started.

HRM persistence keeps a stable facade and routes attendance, employee/salary, leave-entitlement, and organization/calendar checks to focused workflow modules. The checks remain tenant-scoped and use the transaction passed by the kernel.

Automatic inventory replenishment locks the tenant/warehouse handoff before recalculating and creating a requisition, so concurrent automated requests cannot emit duplicate proposals from the same stock position.

Payroll now supports approved, period-specific additions and deductions. Each payslip snapshots the approved amounts, and Rust validates them against source adjustments. Accrual accounting debits gross wages, credits net employee payables, and credits withholding to configured tenant-owned asset or liability accounts. Payroll run creation is serialized and unique per non-cancelled month.

Payroll payslip creation now rechecks the captured paid-day count against locked attendance, approved paid leave, and paid holidays for the run month. This prevents manual API writes from bypassing the payroll calculation's attendance snapshot.

Automotive repair quotes, field-service estimates, and maintenance material reservations now snapshot each selected product unit. Service prices are scaled from the product base price by the selected unit ratio, while completion issues stock in the validated base quantity.
