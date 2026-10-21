# Customer UI handoff — 21 October 2026

Branch: `fix/customer-ui-handoff-20261021`, based on local `build/wandary`
commit `252ac32`. This branch includes the two previously unpushed commits
`dd9b2de` (icons) and `252ac32` (garment/cart helpers), plus the repaired
interrupted customer home and tab draft. Continue UI work from this branch.

## What was repaired

The interrupted Home file had duplicate default exports, missing components,
missing styles, undefined header variables and no initial catalog load.
It now loads through `@wandary/api-client`, filters/searches garments, shows
empty/error states, supports quantity controls and shows a bag summary.
Home, service detail, basket and checkout share the existing reactive store.
Service details remain reachable from the garment tiles.

Home / Orders / Help / Account use tabs. The tab bar participates in layout
rather than covering the last content row. Other tabs keep navigator headers
for safe-area handling. Search clear and quantity controls have 44px targets.

Basket defaults were fixed dates in the past. Defaults are now future editable
requests; invalid, past, reversed or timezone-free schedules are blocked before
navigation. An empty basket cannot continue. Server availability and quotes
remain authoritative. Schedule regression added to the existing customer suite.

## Verification

- Customer TypeScript check: pass.
- Final workspace `pnpm check`: pass.
- Customer tests: 10 pass, including schedule validation and rejected-demo-session recovery regressions (red before repair).
- Workspace packages built first, then customer Expo web export: pass.
- Interactive T3 browser at 390px: initial catalog, empty search, add/stepper,
  estimate, bag summary and carry-through of two garments to basket verified.
- Final built web app: future schedule defaults, rejection of past pickup, checkout address load and server quote INR 222.88 for one blazer: pass.
- Stale saved demo session reproduced at checkout; Home now validates it and reauthenticates only on UNAUTHENTICATED. Network failures remain visible.
- Local Standards and Spec reviews found missing service-detail links, an overlapping tab bar and a small clear-search target; all three were repaired. External Claude review was unavailable.

The checkout is `/home/batman/Projects/code/.worktrees/wandary-ui`.
It was deliberately not moved while another UI agent may pick it up.
`.taste-skill/` contains local screenshots/reports and must not be committed.
Generated `dist` and local evidence are not part of the handoff commit.
The backend pilot QA report is `docs/implementation/qa-handoff-2026-10-21.md` in the backend worktree.

## Run locally

Build workspace dependencies before starting Metro, since the resolver uses dist:

```sh
pnpm install --frozen-lockfile
pnpm --filter @wandary/contracts build
pnpm --filter @wandary/api-client build
pnpm --filter @wandary/design-tokens build
EXPO_PUBLIC_API_URL=http://localhost:4100/v1 pnpm --filter @wandary/customer web
```

Do not run an Expo export concurrently with a watching Metro server: rewriting
its watched dist assets can terminate the watcher. Restart Metro after exports.
A frozen install repaired the backend worktree's stale moved dependency links.

## Scope and remaining work

This is a browser-tested development handoff, not a finished visual design or
native release. Continue visual polish, real service imagery, readable garment
names in basket and a friendlier IST schedule editor. Cart remains in memory;
reloading clears it. Authentication is demo-only. Existing Help uses the legacy
conversation demo. No real payment, WhatsApp, delivery or native device was used.

The kg pilot is a separate console and API in `feat/backend-mvp` (PR #3).
This customer frontend still consumes the legacy per-garment API. Do not imply
that the new garment UI is wired to the kg pilot. API/contracts and namespace
integration need explicit coordinated work before combining these branches.

Pushing `build/wandary` triggers its configured backend deployment job.
This dedicated branch is used to publish source for the next UI agent without
merging or intentionally deploying the backend.
