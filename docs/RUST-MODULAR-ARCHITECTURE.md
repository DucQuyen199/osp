# OSP Suite: Rust modular monolith architecture

## Decision

Keep one deployable Rust modular monolith backed by PostgreSQL. Organize business code by bounded context and keep delivery, application, domain, and infrastructure responsibilities separate. Use one database transaction for synchronous business changes that cross modules. Split into services only when a measured operational need outweighs distributed transaction and deployment costs.

This document defines the target architecture and current Rust module contract. Rust is the production API and workflow runtime; all 50 module and 22 industry catalogs are JSON. TypeScript runtime, source files, and compiler configuration have been removed. All current client routes and screens are rendered in React; the remaining work is deeper domain behavior, external integrations, and release verification.

## Dependency direction

The HTTP composition root is `server/src/delivery.rs`: Axum owns method routing,
Tower HTTP owns asynchronous static-file streaming, MIME types, HEAD/ranges,
Last-Modified/304, public-asset gzip, request IDs, tracing, panic responses and
security headers. `url` and `percent-encoding` parse queries and paths; Governor
owns concurrent per-IP GCRA quotas. `http.rs` remains the API-to-kernel adapter.
Security headers also cover errors and 405 responses. API data is `no-store`
and uncompressed; public assets revalidate with `no-cache`. Static targets are
checked against the canonical public root, including directory indexes, and
hidden paths are rejected. Public assets must be deployed read-only.

PostgreSQL pool sessions use UTC, matching the Rust date guards and scheduler.
Invoice and bill journals honor the source issue date, and posting into a closed
period rolls back the source operation. Retrying a scheduled failure locks and
rechecks the failure inside the tenant transaction, commits its business effects
with the resolved status, and records failed attempts after savepoint rollback.

Verification is split between `http_transport.rs` and `domain_contracts.rs` (no
database required) and `flows.rs` (real PostgreSQL with a non-superuser role).
The latter covers core cross-context workflows, concurrent writes/retries, all
industry pack creation and all entity list contracts. This is not a statement
that every industry workflow or external provider has production certification.

```text
HTTP / React delivery
        |
        v
Application use cases ----> Domain contexts
        |                         |
        v                         v
Ports (interfaces) <-------- Domain events
        ^
        |
PostgreSQL, mail, files, external providers
```

Dependency rules:

1. Domain code contains business types, invariants, state transitions, and domain events. It does not import Axum, PostgreSQL clients, HTTP types, or other bounded contexts' internals.
2. Application code coordinates use cases and transactions through ports. It owns authorization, idempotency, and transaction boundaries.
3. Adapters implement persistence and external I/O. PostgreSQL remains the production system of record and RLS remains mandatory.
4. Delivery adapters translate HTTP/JSON into application requests. OpenAPI remains generated from the public API contract.
5. A context may depend on shared identifiers and published events, never another context's repository or tables.
6. Vertical packs configure enabled contexts, terminology, roles, and KPIs; they contain no business implementation.

## Rust source layout target

```text
server/src/
  delivery/http/          Axum routes, authentication extraction, DTOs
  application/            command/query handlers and transaction orchestration
  domain/
    shared/               money, identifiers, validation errors, event envelope
    master_data/
    sales/
    purchasing/
    inventory/
    accounting/
    hr/
    ...                   remaining bounded contexts
  ports/                   repository, clock, mail, file, payment interfaces
  adapters/
    postgres/              repositories, migrations, RLS, outbox
    integrations/          provider clients
  platform/                tenancy, identity, RBAC, audit, scheduler
  modules/                 Rust-owned bounded-context behavior
    events.rs              explicit Rust source-event workflow dispatcher
```

Keep a single Cargo package while boundaries stabilize. Promote a bounded context to its own crate only when its public API and dependency direction are stable. This avoids turning the current package migration into a large deployment rewrite.

## Module contract

Every context exposes a narrow Rust interface:

- `commands`: validated state-changing requests.
- `queries`: read models with explicit tenant scope.
- `events`: versioned facts emitted after a successful state change.
- `ports`: context-owned persistence needs.
- `api`: stable DTOs only when another context or client must integrate.
- `migrations`: additive, reversible where practical, tenant-safe schema changes.

### Rust module layout

New business contexts use a directory module instead of adding more logic to the
flat `server/src/modules/*.rs` compatibility files:

```text
server/src/modules/<context>/
  mod.rs           narrow context facade used by the kernel
  domain.rs        pure invariants and action policy
  application.rs   command preparation and orchestration within the context
  persistence.rs   tenant-scoped PostgreSQL checks and concurrency controls
  reports.rs       context-owned read models when needed
```

When a layer grows beyond one focused use case, keep its facade file and split
the implementation into private submodules such as
`domain/currency_rates.rs`, `application/source_events.rs`, or
`persistence/currency_rates.rs`. The facade dispatches and re-exports the
stable context API; submodules own one cohesive business workflow and must keep
the same tenant and transaction boundaries.

The kernel remains the transaction boundary and calls the context facade. A
context must not open its own connection or commit independently. Keep catalog
shape in `definitions/modules/<context>.json`; use its rules for declarative
cross-context reactions, and keep non-bypassable invariants in Rust. The kernel
owns event persistence, recursion limits, and declarative subscribers;
`modules/events.rs` dispatches explicit Rust workflows to their bounded
contexts within the same transaction. Optional subscribers must return without
work when their module is disabled, and external side effects must be queued
idempotently by source event. The
`payments`, `subscription`, `sales`, `inventory`, `asset`, `auto_service`, `crm`, `real_estate`,
`hotel`, `loyalty`, `budget`, `booking`, `charity`, `contract`, `einvoice`,
`expense`, `field_service`, `hrm`, `maintenance`, `manufacturing`, `master_data`,
`logistics`, `payroll`, `pos`, `project`, `quality`, `recruitment`, and
`restaurant`
contexts use this layout.

`npm run lint` enforces this boundary: every catalog context except the shared
`events` dispatcher must have a Rust folder, the four contract files, and a
`pub mod` registration in `modules/mod.rs`. It also rejects Rust context folders
that have no matching module catalog. Add contexts through `npm run new:module`
so the JSON definition and Rust layer scaffold start together; then register
the facade and implement its behavior before treating the scaffold as complete.
Helpdesk tickets require a resolution record before resolution and preserve
closed history. SLA policies enforce positive, ordered response/resolution
windows and cannot change while tickets reference them.
Auto-service validates tenant-unique vehicle identifiers, owner/customer
matching, nondecreasing odometer readings, repair parts, billable completion,
and immutable completed/delivered repair history.
Lending records annual-rate declining-balance installments atomically on
disbursement, marks overdue installments through the tenant scheduler, and
splits repayment journals between loan principal and interest. Loan terms and
repayment history remain immutable after their respective approval/payment
boundaries.
Quality source-event workflows also run through a Rust application handler.
Recruitment converts hired applications to trace-linked HR employee records
inside the same transaction.
Communication creates idempotent tenant-scoped notification records for
ticket, sales, and booking events. A Rust worker claims leased batches and sends
through optional configured HTTPS email/SMS endpoints with bounded retries;
messages stay queued until a provider is configured.
E-invoice tracking validates the source invoice in the tenant transaction,
serializes issuance requests per invoice, and returns the existing request when
the posted event is replayed. Provider issuance remains an integration-hub
delivery step rather than a claim that an external tax provider has accepted
the invoice.
Charity owns donation receipt rules: received donations can only change through
the explicit receipt action, and accepted receipts cannot be edited or deleted
after their accounting payment has been created.
Integration-hub webhook deliveries are inserted into the PostgreSQL outbox in
the source business transaction. A Rust worker claims leased batches with
`SKIP LOCKED`, pins public DNS results, disables redirects and proxies, signs
the serialized event body with HMAC-SHA256 when a secret is configured, and
uses bounded retries before dead-lettering. Tenant administrators can inspect,
retry, or dismiss dead-letter deliveries from Settings.
Workflow approval creates requests for ERP submissions and routes approve or
reject decisions to tenant-locked source records through Rust actions.
Purchase orders and stock counts cannot be cancelled while their approval
request is pending, preventing requests from outliving their source document.
Accounting creates invoices, bills, and operational payments from source events
in Rust; return notes and the related invoice/bill/adjustment journal entries
also post in the same PostgreSQL transaction. Payroll, expense, payment-method,
POS refund, and vertical payment journal events are handled in the accounting
context; its module JSON now declares entities without executable rules. Trial
balance, general ledger, income statement, and balance sheet read models live in
`modules/accounting/reports/balances.rs`; aging and cash-flow reports live in
`reports/operations.rs`, and tax-register aggregation lives in `reports/tax.rs`.
The context facade keeps shared authorization and the HTTP-facing Kernel API.
Accounting journal event posting is split by refund, settlement, and source
document flows under `modules/accounting/application/ledger/`, behind the
existing ledger event facade.
Inventory keeps line preparation/valuation, stock-level posting, and physical
count snapshots in separate application modules under
`modules/inventory/application/`, with event reactions in `application/events.rs`.
Expense claims recalculate totals from line amounts in `modules/expense/application.rs`
before create, draft edits, and submit/approve/pay transitions. Employee eligibility,
approval evidence, and accounting prerequisites remain tenant-scoped persistence checks.
Budget owns draft/approval invariants and tenant-scoped locking in its own
bounded context; ledger-derived actual refresh runs through its application and
persistence layers inside the existing kernel transaction.
CRM conversion now lives in `modules/crm/{domain,application,persistence}.rs`;
lead conversion links its tenant-scoped customer record back to the source lead.
Field-service intake, logistics shipment creation, restaurant
kitchen tickets, provider payment capture, e-invoice request tracking, payroll
totals, and paid-invoice settlement routing also run in Rust. JSON catalogs now
describe entities and verticals; cross-module business handlers run in Rust.
Ecommerce order placement locks and reuses its tenant-scoped Sales order on event
replay; source links are unique and immutable to prevent duplicate orders,
invoices, or stock reservations. The ecommerce context rebuilds order lines from
tenant product data, the storefront price list, and its configured tax policy;
client-submitted prices, discounts, and taxes are not trusted.
Field-service orders keep a tenant-validated source ticket and safely reuse the
linked order on ticket-event replay. Dispatch requires a technician, billable
completion requires a positive total, and completed/cancelled orders remain
immutable audit history.
Sales handles CRM deal conversion, quotation acceptance, ecommerce order
confirmation, and shipment delivery synchronization in Rust. Inventory event
handlers create stock moves inside the kernel transaction for purchase receipts,
transfers, counts, sales and operational consumption, returns, production BOM
consumption, harvest receipts, maintenance parts, and production QC receipts.
Older contexts are migrated into it as their business behavior is touched.

Cross-context operations run in one PostgreSQL transaction while the system is a modular monolith. External side effects go through a transactional outbox with retries; they must not run inside a database transaction.

## Migration order

1. **ERP foundation:** Rust invariants and use cases for master data, sales, purchasing, inventory, accounting. Replace generic JSON writes for money and stock operations with typed commands.
2. **Shared platform:** identity, tenant lifecycle, RBAC, audit, import/export, scheduler, notification and outbox.
3. **Business contexts:** migrate the remaining module definitions in dependency order. Vertical packs remain data configuration.
4. **Client:** React/Vite owns routing and current application screens. Keep business validation exclusively authoritative on the Rust server.
5. **Compatibility removal:** completed for TypeScript runtime and tooling. Keep JSON as the module/vertical catalog and generate OpenAPI/documentation with the Rust CLI.
6. **Release gates:** schema migration review, authorization/RLS review, API compatibility, Rust format/lint/build, persistence and integration verification, image build, backup/restore rehearsal, and staged deployment.

## Implemented Rust slice

`server/src/modules/` owns ERP invariants for inventory, sales, purchasing, POS, fixed assets, accounting, HRM, expenses, and payroll. The kernel invokes validators and cross-record checks inside its existing PostgreSQL tenant transaction. Inventory snapshots moving-average cost on each immutable stock move and tracks stock value; accounting rules post COGS, stock-count variances, sales returns, POS receipts/refunds, and purchase returns in the same transaction. Fixed assets are capitalized on activation, and monthly straight-line depreciation updates the asset register and posts its journal entry atomically. POS completion requires an open session and a warehouse, and completed orders cannot be edited/deleted. `payments` enforces provider-reference idempotency per tenant; `subscription` snapshots plan pricing, validates due cycles, and creates a posted accounting invoice through the event catalog.

Subscription billing now creates the first cycle from the subscription start date, renews from the prior paid cycle using the plan interval, and cancels pending cycles when a subscription is paused or cancelled. These changes are handled by Rust event workflows in the originating PostgreSQL transaction, with one cycle per tenant subscription and due date.

For logistics fulfillment, outbound stock validation excludes the order being shipped from competing reservations and subtracts quantities on already delivered shipments from other orders' commitments. The SKU/warehouse transaction lock still serializes shipment issues against competing stock moves.

Hotel reservations snapshot the room type's nightly rate, calculate stay totals in Rust, and validate room capacity and date overlap under a locked room type. Check-in requires a vacant assigned room on or after the reservation date; folio charges are immutable and cannot be added after checkout.

All registered Rust contexts now resolve through directory modules. Contexts with application workflows, pure rules, and persistence checks keep those responsibilities in separate files; smaller event-only contexts expose only the layers they use. The login/signup flow, generic entity list, detail drawer, generated create/edit form, entity CSV import, home dashboard, module overview, event stream, accounting reports, and all tenant Settings tabs are rendered in React. Form submissions, detail actions, report queries, data import/export, audit reads, and event-chain operations use Rust API endpoints. Deeper domain functionality remains in progress. Module/industry declarations remain JSON. Do not label the product as fully implemented or production-released until domain workflows and release gates are complete.
HRM attendance checks approved leave after locking the tenant's employee record, while leave approval checks for attendance under the same lock; submitted and approved leave records remain immutable audit history.
Scheduled jobs reacquire each candidate under the tenant write transaction and recheck its due predicate before applying the action, which makes overlapping scheduler instances safe for jobs that transition their source record out of the due set.
Maintenance plans use that scheduler to create linked work orders once per due date, advance their next date in the same PostgreSQL transaction, and record work-order completion on the plan. Additive schema migration backfills new lifecycle columns with their declared initial state for existing records.
The generic write kernel rejects direct edits to lifecycle state fields; state changes must pass through declared actions and their transactional validation/handlers.
POS session closing now snapshots opening float, completed/refunded cash sales, posted cash-in/out vouchers, counted cash, and the resulting variance in one tenant transaction. Cash vouchers post balanced journals against a tenant-owned offset account. Creating or editing an order locks and verifies its session is still open; session close is serialized against order and cash-voucher writes and is rejected while draft work remains.
Loyalty point balances and transaction rows are Rust-owned. POS refunds append one idempotent negative point transaction for an existing earning; partial Sales returns calculate cumulative reversals from received return value and cap them at points earned. Points history is immutable and retained with its member.

The Rust catalog linter also rejects .ts, .tsx, .mts, and .cts source files outside generated output and dependency folders. This keeps the no-TypeScript requirement enforced as the module catalog and client evolve.

The catalog linter also checks that bounded-context validation and persistence hooks are exported and routed through `server/src/modules/validation.rs`, that document-preparation hooks are called from the kernel, and that scheduled-job/source-event handlers are registered with their dispatchers. This prevents business rules from compiling successfully while remaining unreachable.
