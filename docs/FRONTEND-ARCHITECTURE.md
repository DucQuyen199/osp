# React frontend architecture

The client is a React 19 application built with Vite. It uses JavaScript and the existing hash routes so deployed links and API integration remain stable.

## Application layers

- `client/src/main.jsx` mounts React and registers the production service worker.
- `client/src/app/App.jsx` owns session startup, authentication redirects, route changes, account preferences, and the shared application shell.
- `client/src/app/parseRoute.js` translates the current hash into a route object. Unknown paths resolve to the not-found screen.
- `client/src/app/PageRouter.jsx` maps route names to screens. Screens load with `React.lazy` inside one suspense boundary, keeping business workflows out of the initial bundle.
- `client/src/components/` contains shared shell and UI pieces such as navigation, global search, and icons.
- `client/src/lib/` contains cross-screen API, tenant state, date, event, formatting, feedback, and URL helpers.
- Feature screens remain in `client/src/` and own their workflow state and API orchestration. They should use the shared helpers and design tokens; move them into domain folders as they receive deeper refactors.

## Adding a screen

1. Add the workflow screen with a focused page component and a descriptive file name.
2. Add a lazy import and route branch in `app/PageRouter.jsx`; add its URL mapping in `app/parseRoute.js`.
3. Add navigation only where the feature is enabled and the current user has permission.
4. Use the shared API/state/date/format helpers rather than recreating tenant or money rules in a screen.
5. Use semantic headings, labels, accessible names, visible focus, and the existing CSS tokens. Add reusable styles to shared components only when more than one screen needs them.
6. Keep generated `client-dist/` output out of commits. `npm run build` copies the public assets and creates deployable output.

## Styling layers

`client/public/app/styles/` loads in this order: design tokens, base/reset and utilities, reusable components, page layout, then shared workspace refinements. Components should use semantic variables (`--surface`, `--text-muted`, `--accent`) instead of hard-coded colors. Responsive behavior and reduced-motion preferences belong in shared styles unless a workflow needs a distinct interaction model.
