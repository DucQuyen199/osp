# ADR-0007: Rust bounded contexts in a modular monolith

- **Status:** Accepted · 2026-11
- **Context:** OSP executes on a Rust/Axum and PostgreSQL server. The 49 module and 22 industry catalogs now live in JSON; the TypeScript kernel and simulator have been removed. Rust owns production behavior; remaining catalog declarations are JSON.
- **Decision:** Keep one Rust modular monolith. Group behavior by bounded context and separate domain, application, delivery, ports, and adapters. Migrate the ERP core first while keeping the public REST contract and PostgreSQL transaction model stable.
- **Rules:** Domain contexts cannot import each other's internals or infrastructure. Cross-context communication uses published events and explicit application orchestration. Vertical packs remain configuration. External effects use an outbox.
- **Consequences:** The first migration slice can be released without changing deployment topology. Some domain contexts and external integrations still need deeper business behavior. React/Vite now owns the client shell; existing business views are being migrated incrementally through an adapter. Do not claim full product completion until those requirements are implemented and verified.
- **Review when:** A bounded context needs independent scaling or release, or a cross-context workflow can no longer meet reliability goals within one PostgreSQL transaction.
