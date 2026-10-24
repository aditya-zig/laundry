# SPA preview routing regression

Manual inspection in the founder's existing Chrome reproduced an HTTP 404 when
refreshing a customer service-detail URL. Client-side navigation worked, but the
old Python static preview server had no application-route fallback.

`e2e/workflow-smoke.spec.ts` now reloads the real service URL before entering a
quantity. It failed against the old server with the missing Service Details
heading and an actual HTTP 404. The task-only server in
`tools/verification/serve-web.mjs` now serves the exported app shell for HTML
navigation to extensionless application routes. Playwright uses it for all three
apps. Missing assets and API paths remain 404, not disguised HTML successes.

Five server tests cover route/query navigation, real scripts/Expo fonts, missing
assets/API routes, HEAD/method rejection, invalid paths, encoded traversal, hidden
files and external symlinks. It binds only to loopback, exposes no directory index
and does not read environment credentials. It is not a production hosting server.
Production hosting still requires its own verified rewrite/security configuration.

Working-tree verification: all four real API/PostgreSQL/browser scenarios passed,
including the new reload step. The evidence command correctly refused to approve
a dirty published revision; that exit is not relabeled success. `pnpm check` and
64 tooling tests passed. The repaired service URL was also opened directly at
390×844 in the existing signed-in Chrome; screenshot inspected and adding two
garments confirmed. Only owned preview processes and the disposable database
were stopped afterward. A clean-commit browser/restore receipt follows separately.

Preceding dependency-hardening commit `f9b00f1807a0d0e9a2442e59d702f50ce0e65883`
actually passed Laundry checks `40098252157` and Agent verification evidence
`40098252129`. Its security gate `40098252218` failed on the same two documented
high advisories; the retained audit artifact was downloaded and inspected. Its
staging deployment passed all nine live checks and its clean synthetic restore
passed. None of this is production-v2, native, physical fulfillment or live
commercial-provider acceptance.
