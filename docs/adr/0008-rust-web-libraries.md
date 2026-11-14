# ADR-0008: Rust web libraries for the HTTP transport

Status: accepted.

## Context

The Rust server already used Axum as an entry point but implemented static reads,
URL decoding, per-IP counters, request IDs and response headers itself. Static
files were read synchronously into memory, and the transport lacked HEAD, byte
ranges, revalidation and compression. The requested direction is to use existing
Rust web libraries while retaining the modular ERP kernel and PostgreSQL safety.

## Decision

- Use Axum method routes for public API and entity collection/item/actions.
- Compose Tower HTTP services for asynchronous static streaming, MIME, ranges,
  conditional requests, public gzip, request IDs, tracing, headers and panic
  handling. The canonical public-root and hidden-path guards remain application
  policy; static content must be deployed read-only.
- Use `url::form_urlencoded` for queries and `percent-encoding` for path and
  attachment-name decoding, preserving literal plus signs in paths.
- Use Governor concurrent keyed quotas with bounded bursts and continuous GCRA
  replenishment. Keep independent API, authentication and tenant-creation quotas;
  a zero quota denies requests. Responses include `Retry-After` on HTTP 429.
- Keep authoritative authorization, Decimal arithmetic, tenant locking, RLS and
  business transactions in Rust bounded contexts. Transport libraries do not
  replace domain rules or alter transaction ownership.

## Consequences and verification

The transport depends on maintained crates and their locked transitive versions.
Static files stream instead of occupying one full response-sized allocation.
Authenticated API data remains uncompressed and `no-store`; public files use
`no-cache` with Last-Modified revalidation. The limiter replenishes continuously
instead of resetting all requests at one minute boundary. Quotas are per process;
multiple replicas still need a shared edge limit when an aggregate quota is needed.

`http_transport.rs` verifies the public transport contract without a database;
`domain_contracts.rs` and PostgreSQL `flows.rs` check financial and workflow
invariants. Chrome/Edge E2E covers the React client. The optional container gate
verifies Linux execution and restores a real database into a second isolated DB.
