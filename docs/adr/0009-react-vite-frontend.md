# ADR-0009: React and Vite for the ERP frontend

- **Status:** Accepted · 2026-11; supersedes the frontend decisions in ADR-0005 and ADR-0006.
- **Context:** OSP has interactive workflows across 50 modules and 22 industry packs. The original metadata-rendered JavaScript client became difficult to evolve consistently as route state, permissions, validation, accessibility and localization grew.
- **Decision:** Use React 19 with JavaScript and Vite for browser UI. Preserve the existing hash routes and REST contract. Keep business rules and authorization in the Rust server. Each feature page owns its workflow state and API orchestration; shared components render controlled values and callbacks. Keep the strict same-origin CSP and semantic HTML.
- **Build and runtime:** Vite creates static assets in ignored client-dist/. Docker builds those assets from source and copies them into the Rust runtime image; Node is not required in production. Do not commit generated output.
- **Verification:** npm run lint:translations checks English labels, npm run build checks deployable output, and Chrome E2E exercises workflows and axe accessibility across supported routes and verticals.
- **Consequences:** The client gains a standard component model, route-level code splitting and consistent state ownership. The build adds npm supply-chain and bundle-size concerns; keep dependencies minimal, pin the lockfile, use the production CSP, and review generated bundle size.
- **Review when:** Server rendering, independent client deployments or a different accessibility/runtime strategy becomes a product requirement.
