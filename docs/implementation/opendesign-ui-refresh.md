# OpenDesign UI refresh — handoff

## What was done
- Updated opencode 2.0.26 → 2.0.27 (`opencode upgrade`).
- Applied OpenDesign templates to the Laundry UI without touching contracts or API shapes:
  - Template choice: `dashboard` (ops console) + `mobile-app` Feed/Checkout archetypes
    (customer + partner). System mood from `expo` / `clean` / `minimal`.
    Kept the spec-mandated bright white + pale blue + navy + teal look.
    A dark system (e.g. Linear) was rejected because product-spec.md fixes the bright visual proposal.
  - New binding doc: `DESIGN.md` (tokens, layout, components, rules).
  - `packages/design-tokens`: added `surfaceCard`, soft status colors, `focusRing`,
    font stack, weights, content widths, card shadow. Existing exports unchanged.
  - `apps/customer`: rebuilt Home (hero + address card + service cards with price pills
    + pill nav), Service detail (hero card + garment cards), Basket (step 1 card +
    total row), Checkout (step header + address cards + quote/total card with
    PROVISIONAL/FIXED pill + breakdown rows). Logic and API calls unchanged.
  - `apps/ops`: new dashboard shell (sidebar brand/nav/role card, topbar with
    environment pill), Orders queue (4 KPI cards + status-pill table),
    Order detail (status header card, intake/care 2-col cards, timeline).
    Branding assertions preserved (`Laundry Ops` h1, no `Wandary` string).
  - `apps/partner`: theme aligned with shared tokens (soft colors). Screens unchanged.

## Verification (all local, no paid calls)
- `pnpm check` — pass (tsc root + customer/ops/partner check + api/worker typecheck).
- `pnpm --filter @wandary/design-tokens test` — 2 passed.
- `pnpm --filter @wandary/contracts test` — 11 passed.
- `pnpm --filter @wandary/customer test` — 8 passed.
- `pnpm --filter @wandary/partner test` — 6 passed.
- `pnpm --filter @wandary/ops test` — 11 passed (incl. branding).
  Note: ops tests need `packages/contracts`, `packages/api-client`,
  `packages/design-tokens` built first.
- `pnpm --filter @wandary/ops build` — pass; bundle contains
  `ops-sidebar`, `ops-nav`, `kpi-grid`, `table-card` markers.
- Headless Chrome screenshot of the built ops sign-in view renders the new
  sidebar + info card correctly (`/tmp/opencode/ops-dashboard.png`).
- No backend run: order/dispatch data states render error/empty cards by design.
  PostgreSQL acceptance and live device previews remain for the owning packets.

## Remaining / not done
- Changes are uncommitted on `build/wandary` for review. No merge, deploy, or publish.
- No `od` daemon/MCP install: Linux has no prebuilt OpenDesign desktop artifact,
  so templates were applied from the `nexu-io/open-design` checkout at `/tmp/od`.
- Real-device and Expo web previews of customer/partner were not screenshotted here.
- No contract, migration, pricing, or provider changes.
