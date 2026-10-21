# Pilot review disposition

Branch `feat/backend-mvp`, base `fc8e58f53707cf8fcea3763137e0f469311f1aa3`.
The source review is `/tmp/laundry-other-review-final.md`. This file answers
each accepted fix group and the remaining Standards, Security and Architecture
findings. Checks were run on the product source. The 2026-10-20 docs and
ignore repair changed only `.gitignore` and implementation docs; no product
code, tests or dependencies changed. Binary evidence is local and ignored, and
the tracked manifest names the hashes.

Status is one of **FIXED**, **DEFERRED** (reason and trigger), or **NOT
APPLICABLE / DISPUTED** (source evidence).

## 1. CI isolation

| Item | Status | Exact check / evidence |
| --- | --- | --- |
| Main CI lane used database `laundry`, so the pilot suites could not start. | FIXED | `.github/workflows/ci.yml` now sets `POSTGRES_DB: laundry_verify_ci` and `DATABASE_URL: .../laundry_verify_ci`; `.github/workflows/agent-verification.yml` already did. `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm check`, `pnpm check:convex`, `pnpm test` and `pnpm test:voice` all exited 0. |
| Pilot tests cannot pass in the only CI lane. | FIXED | `pnpm test` against isolated `laundry_verify_builder_20261021` passed: API 43, SDK 16, contracts 11, customer 8, ops 11, partner 6; voice 23. Log: `docs/implementation/evidence/pilot/ci-equivalent.log`. |
| Frozen install fails once the namespace rename meets this branch. | DISPUTED for this tree | `pnpm install --frozen-lockfile` exits 0 on the current branch. The failure is a cross-tree integration risk with the dirty rename checkout, not a current-branch result; no rename was attempted. |
| Root manifest and lockfile are owned twice. | DEFERRED to the coordinator | `pnpm-lock.yaml` changed to register the pilot workspace; root `package.json` is untouched. Trigger: before committing or merging, the coordinator reconciles root manifests and the lockfile. |
| Naming test fails on already-committed docs. | NOT APPLICABLE | `packages/contracts/test/project-naming.test.ts` does not exist in this worktree; `packages/contracts/test/contracts.test.ts` passes 11/11. The cited test belongs to the other checkout. |
| Rename changes deploy coupling and the production DB guard. | NOT APPLICABLE | No rename, deploy-target or database-role change is in this branch. The CI deploy job still targets `build/wandary`; only the verification database name changed. |

## 2. Wire docs and schedule

| Item | Status | Exact check / evidence |
| --- | --- | --- |
| `packages/contracts/openapi.yaml` has no pilot routes. | FIXED | `python3` load of the YAML reports 33 paths and 20 schemas, including 7 `/pilot/*` paths: config, riders, orders, order detail, actions, location and slot capacity. |
| Schedule endpoints are bare strings with no timezone. | FIXED | `packages/contracts/src/pilot.ts` defines `pilotTimeZoneSchema` and emits `timeZone: "Asia/Kolkata"` on config, slots and orders. The console formats every time in `Asia/Kolkata` and labels it `IST`. |
| Pickup/return windows are incomplete or unvalidated. | FIXED | Contracts require ISO `pickupStart`, `pickupEnd`, `returnStart`, `returnEnd`; booking rejects a slot/window mismatch. Test: `a booking carries full timezone-qualified windows and codes that outlive the slot`. |
| `14:30 UTC = 20:00 IST` was described as a bug. | FIXED / confirmed correct | The code uses `istAt` and stores the service timezone; the test-created 20:00 IST pickup is returned as `14:30Z`. The offset was already correct; the missing timezone label was the real gap and is now explicit. |
| SDK and fixtures were not updated with the new fields. | FIXED | `pnpm test` SDK 16/16 and contracts 11/11 pass; browser booking parses the new order through the shared SDK. |

## 3. Maps, location and tracking

| Item | Status | Exact check / evidence |
| --- | --- | --- |
| No external directions handoff. | FIXED | `directionsUrl()` builds `https://www.google.com/maps/dir/?api=1&destination=<lat>,<lng>`; customer, operations and rider views render a directions link with `target="_blank"` and `rel="noopener noreferrer"`. |
| A replayed location response keeps a frozen `stale: false`. | FIXED | `withFreshness()` recomputes `ageSeconds`/`stale` after the idempotent store path. Test: `a replayed position recomputes age and stale at replay time`. |
| Tracking remains readable after delivery. | FIXED | Both `getPilotLocation` and the rider report path return 404 for `DELIVERED`/`CANCELLED`. Test: `tracking is closed after delivery for reads and for a late rider report`; browser summary records `locationAfterDelivery: "closed"`. |
| Provenance is presented as attested GPS. | FIXED for honest labelling; attestation deferred | The UI says `self-reported browser location (not attested GPS)` or `position entered by hand (self-reported)`. The server still trusts the client-declared source, so device attestation is **DEFERRED**; trigger: before treating a position as evidence in a real delivery dispute. |
| Separate `GET /pilot/orders/:id/location` is unlisted scope. | NOT APPLICABLE | The accepted fix packet explicitly allows a separate authorized location endpoint. It is role-gated, consumed by the SDK/UI, and returns 404 after completion; no order-detail leak was added. |
| Map popup parses customer-controlled address text as HTML. | FIXED | Leaflet receives a DOM text node; browser check clicks the customer marker and asserts the popup contains the literal `<b>map text</b>` and zero `<b>` elements. Evidence: `02-customer-map-escaped.png`. |

## 4. Handover codes

| Item | Status | Exact check / evidence |
| --- | --- | --- |
| Handover codes never expire. | FIXED | Codes expire at the slot window end plus a 12 hour grace, with a two hour minimum. Contracts carry `pickupCodeExpiresAt` and `returnCodeExpiresAt`; migration `005_pilot_windows.sql` backfills existing orders. Tests: expired code refused; code outlives the slot. |
| A five-attempt lockout needs manual SQL. | FIXED | `REISSUE_HANDOVER_CODE` is customer-only, rotates the selected leg's code, clears that leg's attempt row, records an event, and preserves the other leg. Tests: expired-code reissue and reissue-clears-lockout. |
| A reissue must not expire tomorrow's pickup code before pickup. | FIXED | Expiry is based on the full window end plus 12 hours, not the booking time. Browser booking asserts `pickupCodeExpiresAt > pickupEnd`. |
| Reissue must preserve assignment, attempt limits, versions and idempotency. | FIXED | The action is inside the version-checked transaction; only the customer can call it; only the selected leg is reset. The pilot action role-boundary suite still passes in `pilot-guard.test.ts`. |
| Reissue recovery must be auditable. | FIXED | The order event says the customer reissued the code and that the previous code and attempt lock were cleared. The event does not print either code. |

## 5. Held orders

| Item | Status | Exact check / evidence |
| --- | --- | --- |
| ON_HOLD has no founder release, so it can never reach DELIVERED. | FIXED | `RESOLVE_HOLD` is operator-only, accepts only `RETURN_UNPROCESSED`, requires `customerAgreed: true` and a note of at least 10 characters. It moves the order to `RETURNING` and preserves the rider assignment. |
| Release must not invent a fee, minimum or payment. | FIXED | Release sets `totalMinor = 0`, clears the proposed total, keeps `paymentStatus = "UNPAID"`, and writes the founder note into history. Delivery is allowed when nothing is due. Browser evidence: `10-ops-hold-resolved.png`, `11-customer-nothing-due.png`. |
| Lower-weight holds and declined increases need the same safe path. | FIXED | The action applies to any `ON_HOLD` order; no weight-specific fee is invented. The browser scenario covers a declined measured increase; the API suite covers the founder-only gate and zero-total delivery. |
| If the exception workflow is incomplete, say so. | FIXED with a stated limit | Only an agreed unprocessed return is modelled. A different hold reason still needs a founder decision; the UI does not offer a generic release. This is a deliberate business limit, not a hidden charge. |

## 6. Demo safety

| Item | Status | Exact check / evidence |
| --- | --- | --- |
| `DEMO_MODE` defaults on. | FIXED | `demoMode()` returns true only for the exact string `"true"`. Production startup refuses anything except explicit `DEMO_MODE=false`. |
| API listens on every interface by default. | FIXED | `apps/api/src/main.ts` defaults `HOST` to `127.0.0.1`; a container or LAN demo must opt in with `HOST=0.0.0.0`. |
| Credential-free demo operator sessions are a high-risk default. | FIXED for the stated demo scope; residual disclosed | Demo auth now requires explicit `DEMO_MODE=true`; the API binds loopback; production rejects demo mode and dev database URLs. Residual: an operator who sets both `DEMO_MODE=true` and `HOST=0.0.0.0` on a non-production host is deliberately exposing demo authority. No production-readiness claim is made. |
| OTP throttling, unbounded challenge rows and expired-row cleanup. | DEFERRED (pre-existing) | No real OTP provider is used in this MVP; demo codes are opt-in. Trigger: before enabling real OTP or exposing the API outside the local demo. |
| Sessions never expire and tokens are stored unhashed. | DEFERRED (pre-existing) | Demo sessions only; trigger: before real customer accounts or any public deployment. |
| Dev database guard checks only one renamed password. | FIXED | Production guard rejects both `wandary_dev_only` and `laundry_dev_only`, plus localhost/loopback URLs. |
| Postgres 5448/Redis 6381 publish on all interfaces with a dev password. | DEFERRED (pre-existing) | The pilot database is loopback-only on 5549. Trigger: before any shared-network demo. |
| WhatsApp verify token has a known demo default. | DEFERRED (pre-existing) | Production guard rejects `demo-verify-token`; POST still requires HMAC. Trigger: before WhatsApp integration. |
| The console accepts `?api=` host overrides. | FIXED | The parameter was removed; the console talks to its own `/v1` proxy through `baseUrl = "/v1"`. |
| `?as=operator` silently stages an operator session. | DEFERRED with a demo-only rationale | The deep link remains for review screenshots. It only works when the API has explicit `DEMO_MODE=true`; it is not a real credential path. Trigger: first non-demo deployment, then remove the auto sign-in. |
| Evidence embeds handover codes under a tracked docs path. | FIXED | `docs/implementation/evidence/pilot/` is ignored. `.taste-skill/`, `.agents/` and `skills-lock.json` are ignored local tooling. The tracked manifest contains hashes and order ids, never codes. |

## 7. Evidence

| Item | Status | Exact check / evidence |
| --- | --- | --- |
| No current browser evidence, video or restart record. | FIXED | Run `20261020191753` exited 0 with 11 screenshots, `pilot-flow.webm` and `summary.json`. Paid order `48c872fe-9b38-4a96-bfc1-113241f748b7` ended `DELIVERED/PAID/36000`; hold order `e9c0fde8-07a1-42f9-90fa-3bea177d98b9` ended `DELIVERED/UNPAID/0`. |
| Assertions match a future stepper label, not the current pill. | FIXED | The script reads the exact `.pill` text (`Delivered`, `Picked up`, `On the way back`) and then reads the same order through the shared SDK: status, payment status, total, return status and tracking 404. |
| Important rejection paths are untested in the browser. | FIXED | Wrong pickup code leaves the order `BOOKED`; unpaid delivery returns `PAYMENT_PENDING` and stays `RETURNING`; wrong return code stays `RETURNING`; a non-owner/unauthenticated read is covered by the API guard suite. |
| Map escaping, input retention and double submit are unverified. | FIXED | The popup check is exact; the address field is re-read after 3.4 seconds of polling; a double click produces exactly one order and the SDK list confirms one address match. |
| Restart persistence is unverified. | FIXED | API child PID changed `72360` to `80826`; before/after SDK checks both exited 0 with the same states. Log: `docs/implementation/evidence/pilot/restart-persistence.log`. |
| Evidence binaries would be committed. | FIXED | `.gitignore` excludes the pilot evidence directory, `.taste-skill/`, `.agents/` and `skills-lock.json`; the tracked manifest lists hashes. |
| The manifest/runbook is missing. | FIXED | `docs/implementation/pilot-evidence-manifest.md` has the environment, commands, evidence hashes, the per-file input manifest, exact assertions and limitations. |

The manual order `37a69188-e9bc-4a04-9936-748b25842892` reached
`DELIVERED/PAID/36000` in an interactive check after run `20261020191753`.
It is supplementary proof, not one of the 17 hashed evidence artifacts.

## Other review findings

| Finding | Status | Reason / check |
| --- | --- | --- |
| Namespace split breaks install and build. | DISPUTED for current branch | Current tree installs, builds and typechecks. The dirty rename checkout is untouched; this is a merge-time reconciliation task. |
| Ceil-vs-round money drift is a current bug. | DISPUTED | At the current integer rates (6000/9000 minor per kg) and integer grams, the API amount is integral. The console now uses the same integer grams and `Math.ceil`, removing display drift; no reachable failing example was produced. |
| Repeated operator-role checks should be one helper. | DEFERRED | The pilot action boundary suite passes. Trigger: a third operator-only route family or a role-vocabulary change. |
| The whole order lives in a JSONB blob. | DEFERRED | The accepted packet explicitly excludes a JSONB redesign. Trigger: reporting/query needs columns, or before production scale. |
| `pilotOrderSchema` bundles too many concerns. | DEFERRED | Splitting the wire contract is a versioned refactor. Trigger: next contract version or a second consumer. |
| `PilotApi` is a pass-through adapter and `main.ts` is large. | DEFERRED | Adapter deletion and a console split were explicitly excluded. Trigger: a second console consumer or a unit-test harness. |
| Migrations 003/004 drift from 001/002 naming. | DEFERRED | Applied migrations are not rewritten; 005 is additive and idempotent. Trigger: the next schema migration. |
| The console has no unit test script. | DEFERRED | The browser acceptance script is the current test surface, with exact SDK assertions. Trigger: extracting view logic into testable modules. |
| Naming test, CONTEXT Q18, 12 October docs claims and ops URL mismatch. | NOT APPLICABLE | These findings are in the dirty primary checkout or pre-existing docs, not in this MVP tree. No such files were changed here. |
| Two unlisted pilot endpoints are scope creep. | NOT APPLICABLE | The accepted packet authorizes the location endpoint; the riders endpoint is required for assignment and is role-gated. |
| Failed actions are not stored in the idempotency store. | DEFERRED | Successful mutations replay safely; rejection replay is not promised. Trigger: a client depends on replaying a rejection. |
| `GET /pilot/config` inserts slots on every read and grows unbounded. | NOT APPLICABLE / DISPUTED | The insert uses `ON CONFLICT (pickup_start) DO NOTHING` and `pilot_slots.pickup_start` is `UNIQUE`; rows do not grow. |
| Architecture: pricing module, shared state machine, derived SDK paths, shared cloud auth. | DEFERRED | All four are refactors or speculative cross-runtime work excluded by the packet. Trigger: approved rates, a new transition table, or a second generated client. |

## Handover disclosure

Migration `005_pilot_windows.sql` ran when the API restarted. It added
`timeZone`, `pickupEnd`, `returnEnd`, `pickupCodeExpiresAt` and
`returnCodeExpiresAt` to existing pilot orders, including the reviewer order
`088fa2e3-4b7d-4839-8fc7-5474810aa07a`. The review order is still
`BOOKED/UNPAID`, version 1; no status, payment, rider, customer or capacity
field changed. The exact post-restart read is in
`restart-persistence.log` and the browser database was not truncated.

No merge, deploy, paid provider call or edit to
`/home/batman/Projects/code/Landary` was made. The reviewer database
`laundry_verify_reviewer_20261021` was not opened or reset.
