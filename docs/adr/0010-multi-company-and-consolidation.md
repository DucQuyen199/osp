# ADR-0010: Multi-company boundaries and consolidated reporting

- **Status:** Proposed · 2026-11.
- **Context:** A tenant owns its own users, roles, sessions, modules, settings, business records, events, audit trail, and RLS scope. Typed references and row policies deliberately prevent a record in one tenant from pointing at records in another. A branch is a location inside a tenant and does not provide legal-entity isolation. The product roadmap still lists multi-company and consolidated reporting as gaps.
- **Decision:** Keep the tenant as the legal-entity security and accounting boundary. Introduce a separate company-group relationship only after the member tenant explicitly consents. Do not replace tenant-scoped record keys with a shared company identifier or cross-tenant foreign keys.
- **Access model:** Group membership grants no access by itself. A group's administrator can grant named owner-tenant users a read capability for a specific member tenant and report family. A member tenant administrator can revoke consent. Every consolidated request rechecks group membership, consent, caller permission, and member status. Revoke and tenant deletion must take effect on the next request.
- **Data access:** Keep the current app.tenant_id RLS policy active for every organization query. A consolidation service may open separate read-only tenant transactions and combine bounded report results in application memory. It must never issue an unscoped query across business tables or broaden an ordinary user's tenant context.
- **Accounting behavior:** A consolidated report must show each entity's source amount and currency, conversion rate, conversion date, and group reporting currency. Elimination entries are separate, attributable accounting records with their own approval and audit trail; reporting must not silently rewrite member ledgers.
- **Delivery order:**
  1. Add consent-based group membership and revocation, with audit events in both affected tenants.
  2. Add named-user report grants, then a read-only consolidated balance sheet and trial balance.
  3. Add currency translation snapshots, reconciliation between group totals and member totals, and explicit stale/missing-rate errors.
  4. Add intercompany matching and elimination journals as a separate workflow.
- **Required verification:** Test that unconsented, revoked, suspended, and deleted member tenants are not readable; users without a group report grant cannot access reports; tenant RLS still isolates every member query; malformed or stale FX rates fail closed; and every consolidated amount reconciles to the entity-level details.
- **Review when:** Product requirements specify whether company groups have one parent, whether access is granted per report or per data family, and which accounting standards and currency translation policy apply.
