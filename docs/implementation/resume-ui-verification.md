# Resume UI verification — scoped report (UI lane, 2026-10-12)

Owner: independent UI verifier (Muse Spark Free). Scope kept: only
apps/customer, apps/partner, apps/ops were read/edited; no root, API,
modules, shared, env, or cloud changes; no commits (no git access used).
Browser: gstack headless `browse` binary. Dev servers: main's supervised
`pnpm dev` (customer :8081, partner :8082, ops :5173, API :4100).

## Live servers observed

- :8081 customer (expo web dev), :8082 partner (expo web dev), :5173 ops
  (vite dev): all HTTP 200 during verification.
- :4100 API: never came up. `.agent-logs/resume-dev.log` shows
  `[wandary-api] fatal AggregateError [ECONNREFUSED]` to Postgres
  `::1:5448` / `127.0.0.1:5448`. No pg binaries, no reachable docker
  daemon in this shell. All API-backed journeys blocked (see blockers).

## Real browser interactions completed

Customer (:8081, expo-router 4.0.0 + expo 52 dev server):
- Home renders over JS: brand, address input, demo sign-in button,
  Orders/Basket/Help/Account links. Screenshot taken.
- Click Basket link -> red error overlay, URL stuck at `/`. Reproduced
  twice. Full stack captured (see defect 1).
- Click Orders link -> same crash. All client-side pushes crash.
- Direct GET /basket renders fine (single-route stack, empty basket,
  pickup/return inputs, quote button).
- Direct GET /help, /account, /orders, /checkout all render with honest
  states (help booking text + conversational booking section; account
  demo-session copy + sign out; orders "Failed to fetch" + Retry;
  checkout DEMO-simulator label + address form + "Failed to fetch").
- Demo sign-in click with API down -> "Failed to fetch" + Retry renders
  honestly. Screenshot taken.
- 390x844 mobile viewport renders cleanly, no overflow. Screenshot taken.
- Static export (`expo export --platform web`) served on scratch :4181:
  header fix confirmed ("Wandary"), Basket click whitescreens prod bundle
  too (screenshot), direct /basket on plain file server -> 404 (normal SPA
  behavior, needs host rewrite; not an Expo bug).

Partner (:8082, identical expo-router 4.0.0 / expo 52 pins):
- Home renders with correct "Wandary Partner" title. Screenshot taken.
- Demo rider sign-in -> honest "Failed to fetch" (API down).
- Direct GET /history renders "Completed Tasks" + fetch error + Retry.
- Direct GET /account renders demo rider profile.
- Push crash not directly clicked (no push trigger renders without API),
  same dependency construction as customer (verified expo-router@4.0.0
  in partner bundle network log).

Ops (:5173, vite hash router):
- Gate renders; demo operator sign-in -> honest "Failed to fetch".
- Seeded placeholder token in localStorage (removed afterwards) to verify
  authed shell: Orders/Dispatch/Catalog/Support/OrderDetail(#/orders/…)
  hash routes all navigate client-side with zero console errors; each page
  shows honest fetch error + Retry. Screenshots (desktop + 390px mobile).
- Console: only the expo `props.pointerEvents` deprecation warning; no
  app-code exceptions in ops.

## Defects

1. FIXABLE ONLY IN MAIN LANE — client-side push navigation crashes both
   Expo apps. `TypeError: Cannot read properties of undefined (reading
   'config')`. Full stack: native-stack 7.20.0 NativeStackView builds the
   header back href via `buildHref` (react-navigation/native 7.5.0
   useLinkBuilder) -> expo-router 4.0.0 `getLinkingConfig.getPathFromState`
   reads `...this.config` but is called unbound. `getStateFromPath` in the
   same file IS `.bind(store)`-ed; `getPathFromState` is not. Triggers on
   any push (stack depth >= 2); single-route direct loads are unaffected.
   NOT a static-export limitation: reproduces on dev server and prod
   bundle alike. In-scope repair impossible without touching root
   manifest/lock (adding @react-navigation/native as a direct dep to wrap
   LinkingContext would rewrite pnpm-lock, coordinator-owned) or fragile
   deep-store imports. Recommended main-lane fix: upgrade expo-router to a
   release compatible with @react-navigation/native 7.5.0 (upstream binds
   getPathFromState), or pin @react-navigation/* back to expo-router
   4.0.0's expected range; then re-run this lane's click tests.
2. FIXED IN LANE (source edit, needs re-apply — tree lost, see below):
   customer header showed raw route names ("index", "basket", …) because
   `apps/customer/app/_layout.tsx` declared a bare `<Stack/>` with no
   `Stack.Screen` titles. Partner already had titles. Fix mirrors partner:
   `<Stack.Screen name="index" options={{title:"Wandary"}}/>`, basket,
   checkout, orders, orders/[id] ("Order Details"), services/[id]
   ("Service Details"), help, account, plus matching headerTitleStyle.
   Verified: static export bundle contains the titles; home header reads
   "Wandary". Check + tests stayed green (below).
3. No other UI defects found in reachable states. Error/Retry states,
   DEMO labels, mobile widths, help booking copy all correct.

## Counts (all exit 0, no output masking)

- `tsc --noEmit` check: customer, partner, ops — 3/3 pass.
- vitest: customer 8/8, partner 6/6, ops 6/6 — 20/20 pass.
- Export/prod builds: `expo export --platform web` customer (Metro OK),
  partner (Metro OK), `tsc + vite build` ops (43 modules noted earlier,
  rebuilt OK) — 3/3 pass. No type stubs added, no tests skipped.

## Unresolved API blockers (main lane)

- Postgres :5448 unreachable from API (ECONNREFUSED); API :4100 never
  listened. Blocked: catalog/image rendering from API, cart->quote->
  checkout->capture, pickup/return OTP handover display, partner job
  accept/handover, ops intake/care/dispatch/refund, post-delivery review
  gating, conversation draft confirm, demo-token refresh persistence,
  customer-visible OTP proof path (no API route observed; nothing to
  quote). Report the concrete demo/OTP route state once backend is up.
- Main's expo dev servers served stale transforms: `_layout.tsx` title
  fix never hot-reloaded (fresh bundle lacked new strings after
  edit+touch+reload). Dev processes need a restart after restore.
- Partner push-navigation crash re-test needed after dep fix (no trigger
  renderable without API).

## INCIDENT: work tree deleted mid-task (~12:17 IST)

- `/home/batman/Projects/code/Landary` was a full repo at 12:14 (reads,
  edit, builds, browser all working) and is now absent from disk; dir
  briefly showed empty + `.gstack`, then vanished entirely. All dev
  servers died with it (8081/8082 refused, 5173 foreign 404).
- Lost with it: the `_layout.tsx` fix (exact content in section 2 above,
  re-apply on restore) and all evidence screenshots
  (docs/implementation/evidence/resume-ui/: customer-home,
  customer-home-fixed, customer-help, customer-mobile,
  customer-signin-error, customer-push-crash, partner-home, ops-home,
  ops-orders, ops-mobile). This file is the surviving record; it was
  written to /tmp/opencode because the repo path is gone.
- No lane constraint was violated before the loss: edits limited to
  `apps/customer/app/_layout.tsx`; one scratch static server on :4181
  (stopped); no git, root, API, module, env, or cloud changes.

## Coordinator correction
The worktree was moved to /home/batman/Projects/code/Landary, not deleted. The layout fix and screenshots are retained there. API/database/devservers need restart under that path; this report is partial and will be superseded by fresh connected verification.

## Fresh verification pass — Landary tree, fixed dep set (12 Oct 2026, ~15:30 IST)

Tree: `/home/batman/Projects/code/Landary`, branch `build/laundry`.
Main's dep fix confirmed in both app manifests: expo-router 4.0.22,
expo-constants 17.0.8, expo-linking 7.0.5, screens 4.4.0,
safe-area-context 4.12.0, metro-runtime 4.0.1. Both apps resolve
expo-router 4.0.22 at runtime. Display brand is now Laundry; demo token
keys renamed (`laundry.demo.*.token`). No supervised dev servers are
running (8081/8082/5173/4100 all refused), so this pass used my own
export builds served on scratch ports 4191-4193 (stopped afterwards).

Browser (headless `browse`, production static bundles):
- Customer: home header reads Laundry. Basket Link push navigates to
  `/basket` and renders (previously crashed). Depth-2 header back link
  renders and navigates back to `/`. Zero uncaught/type errors.
  Screenshot `lan-customer-basket.png` shows Basket title plus back
  arrow. 390px mobile home screenshot `lan-customer-mobile.png`.
- Partner: home reads Laundry Partner; failed demo sign-in shows honest
  fetch error. Screenshot `lan-partner-home.png`. Push path shares the
  identical fixed stack; service/job taps already proven on Vercel (see
  deployed-ui-verification.md).
- Ops: authed shell (placeholder token, removed after) renders Laundry
  Ops with all hash routes navigating cleanly; pages show honest fetch
  errors without API. Screenshot `lan-ops-orders.png`.
- Plain file servers 404 on deep links (e.g. `/services/…`); standard
  SPA-host behavior, needs rewrite rules. Not an app defect.

Counts (exit codes preserved):
- `check` (tsc --noEmit): customer, partner, ops — 3/3 pass.
- `test`: customer 8/8, partner 6/6, ops journey 6/6 plus branding 5/5
  (11/11) once workspace links resolve — see environment note below.
- `build`: customer and partner `expo export` pass; ops `tsc + vite
  build` passes once workspace links resolve. Customer/partner bundles
  verified to contain api-client code.

Environment note (main lane, not an app-source defect): the rename left
`apps/*/node_modules` with stale `@wandary/*` links while source uses
`@laundry/*`, and `pnpm-lock.yaml` is unmodified. So out of the box,
`@laundry/ops test` fails on `branding.test.ts` collection and
`@laundry/ops build` fails in vite, both `Cannot find package
"@laundry/api-client"`. Proven environmental by temporarily symlinking
the three workspace packages (removed afterwards, zero git trace):
tests 11/11, build success. Do NOT work around this in app source.
Needed: regenerate the lock for the renamed workspace and run a fresh
`pnpm install` (also prunes orphaned expo-router 4.0.0 `.pnpm` trees
per navigation-fix.md). Untouched by this lane; no lockfile edits made.

Remaining for full local journeys: supervised `pnpm dev` + database
under the Landary path (stale `resume-dev-running.md` references the old
session/ports state), then API-backed flows. Deployed Vercel journeys
are already covered by coordinator QA.
