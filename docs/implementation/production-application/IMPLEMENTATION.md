# Laundry production application implementation plan

Version: 1.0 · 21 October 2026 · Repository: `aditya-zig/laundry`

> For cloud agents: execute one assigned task from [TASKS.json](TASKS.json) and its packet in [issues/](issues/). Read [CLOUD-AGENTS.md](CLOUD-AGENTS.md) first. The execution method is parallel, isolated cloud workers with a single cloud integration coordinator. Do not replace this with local subagents or create PRs.

**Goal:** Build a cohesive Android customer app, Android delivery-partner app and operations web app, with all four laundry services supported by a tested backend and explicit production activation gates.

**Architecture:** Retain Expo/React Native for customer and delivery, React/Vite for operations, and a modular NestJS API plus PostgreSQL and a durable worker. Consolidate the existing garment and kilogram implementations into one versioned order model. Publish additive `/v2` contracts through `@laundry/api-client`; preserve `/v1` while consumers migrate.

**Tech stack:** Existing pinned Node 24, pnpm 10.33.2, TypeScript, Expo, React, NestJS, PostgreSQL, Vitest and browser verification tooling. New dependencies require coordinator approval and one lockfile update. No microservice split, infrastructure rewrite or automatic paid provider calls.

**Specification:** This document defines the revised build scope; [CONTRACTS-V2.md](CONTRACTS-V2.md) defines the contract freeze deliverable. Existing [product specification](../../specs/product-spec.md), [wire contracts](../../specs/contracts.md), [founder answers](../../discovery/2026-10-20-founder-questions-and-answers.md) and task-specific packets remain supporting requirements.

## 1. Authority and what changed

The current requesting founder explicitly authorized: a whole-product frontend redesign using the taste skill; more complete backend services; all four services built, each enabled only when its rates and care rules are approved; LaundryMate investigation using REA; parallel cloud-only implementation; a document and multiple GitHub issues. The current instruction to push branches without PRs supersedes the earlier PR-oriented tooling instructions for this workstream.

These instructions authorize development and issue publication. They do not supply business rates, production credentials, commercial-provider spend, partner approval, deployment approval or evidence of a real physical pilot. Preserve the earlier partner-review record; this document is not a claim that both founders have approved unresolved commercial policies.

Scope includes `WASH_FOLD`, `WASH_PRESS`, `PRESS_ONLY`, `DRY_CLEAN`. The first two support kilogram pricing; pressing and dry cleaning support configured per-garment pricing. Availability, tiers, care exclusions and pricing units are catalog configuration. No service is sellable in production merely because its UI exists.

Payment at return remains the default product policy. A higher measured amount requires customer approval before processing; failed or unanswered approval holds processing and escalates to operations. Failed return payment remains unresolved. A zero-due agreed unprocessed return is not described as paid. Overnight and weekend schedules are offered only when configured capacity supports them.

## 2. Starting evidence and immediate defects

| Source, as inspected on 21 October | What exists | Work required |
|---|---|---|
| `wip/main-checkout-20261021` at `39eaa8d0d380f780886c06d44f91fb0760b3ae0c` | Main checkout uses `@laundry/*`; contains preserved local work and old specifications | P00 reconciles it with the two newer product branches; never blanket-stage old assets or caches |
| `fix/backend-handoff-20261021` at `99738543372ad73a955ed641112e9bf47ee4f94c` | Kilogram pilot, role-boundary tests, WhatsApp transport regression fixes, acceptance/evidence tooling; namespace `@wandary/*` | Preserve behavior, migrate namespace coherently and replace pilot-only storage/auth limits |
| `fix/customer-ui-handoff-20261021` at `328c15a4ba5cd7bccdbd3c77e5d982aca189f83f` | Reactive garment storefront, shopping tabs, bag and IST schedule editor | Replace disconnected garment prepayment with unified booking; redesign all states |
| Local recorded run, backend revision above | 63 API acceptance tests passed on isolated PostgreSQL; SDK garment order and UI kilogram order survived API restart | This is baseline evidence, not future cloud/native/production evidence |
| Customer checkout | Basket emits `+05:30`; `instantSchema = z.string().datetime()` rejects the quote input | C01 must normalize valid instants and test this exact browser-to-API boundary |
| Partner list/detail | A publicly available unassigned task appears in the list, then detail refuses it | B06 and F03 must agree on assigned-only visibility or an explicitly authorized offer/accept flow |
| Tracking | Customer view can show `Pending: RETURNING` after `DELIVERED` | F02 derives progression from canonical events/current state, with no contradictory pending step |
| Sessions and deployment | Demo tokens, missing production OTP/session lifecycle, stale session recovery gaps, push/deploy coupling | B01 establishes production identity; P00/P01 prevent ordinary feature pushes from deploying |
| Previous video | 1228×768, 1 fps, approximately 1.4 MB over 9.5 minutes | E01 replaces this with independently checked readable recordings |

Cloud workers must fetch these published refs explicitly. None may assume access to local worktrees, `/tmp` scripts, browser sessions, databases, attachments or `.verification/` artifacts.

## 3. LaundryMate investigation and reconstruction boundary

Use the official [morluto/rea](https://github.com/morluto/rea), release-pinned in the research environment. The local approved setup installed REA 6.7.0; the source checkout inspected was `8e3bf56e11bcb56d0e8754fdfa32a7a9f004ca13`. Cloud installation is a separate reproducible setup, not inherited from this computer.

Observed publicly on [LaundryMate's website](https://laundrymate.in/): four service categories; service-detail navigation; a price list; sign-in/sign-up; membership plans with recurring pickups; offers and support destinations. Its public DOM uses Ionic elements and loads versioned JavaScript bundles. The [official Android listing](https://play.google.com/store/apps/details?id=in.laundrymate.consumer) describes the same four services and a subscription offer. Marketing claims are descriptions of their offer, not verified fulfillment behavior or approved Laundry promises.

R01 must produce a screen/route inventory, interactions and states, a reference-to-Laundry feature matrix and a provenance ledger. Label each finding `observed UI`, `static client evidence`, `inference` or `unknown`. Inspect shipped artifacts without executing downloaded code. Record URLs, retrieval time, artifact digests, REA version and evidence identifiers. Keep raw competitor code, private captures and media outside the product source tree; commit concise findings and original implementation requirements.

Native APK/runtime analysis is contingent on an available artifact/device and the required JADX/JDK tooling. Missing logged-in screens, private backend code, rider software and internal operations remain unknown. No OTP request, account creation, order, payment, subscription purchase or outbound message on a competitor account is authorized by this investigation. User-controlled test access must be separately available before exploring those flows.

Build a Laundry-owned implementation of observed workflows. Laundry's identity, approved rates, service area, payment timing and care promises govern the result. Memberships, wallet credit, referrals and subscriptions are researched and recorded as later candidates; they are not silently added to the first production milestone or assigned invented financial terms.

## 4. Global constraints

- Integer minor-unit INR amounts; integer grams for weight; integer counts for custody. Estimated weight, measured weight, garment count and container count remain distinct.
- Every window has complete start/end instants and `Asia/Kolkata`; server time governs expiry. Preserve source timezone after UTC normalization.
- Order, payment obligation/attempt, refund and each delivery leg have independent states.
- Apps use `@laundry/api-client`; screens do not invent URLs, call raw fetch or compute authoritative prices.
- Every mutation uses an idempotency key. Versioned changes require `expectedVersion`. A retry retains the same key and same payload; editing intent creates a new key.
- Private resources enforce ownership/assignment/facility scopes. No client-selected staff role or scope; customer codes never appear in rider/staff payloads.
- No `.env`, secrets, raw private logs, model weights, generated `dist`, recordings or copied competitor bundles in git.
- Fixtures and provider simulators are explicit. Production disables demo auth/capture and refuses unapproved active commercial settings.
- Workers run only in isolated cloud environments. Only the coordinator writes shared integration files. No PRs, force pushes, automatic production deploys or unapproved paid calls.

## 5. Product scope and screens

### Customer

| Screen group | Required behavior and data | Recovery that must work |
|---|---|---|
| Browse/home/service detail | Serviceable address, four services, inclusions/exclusions, licensed imagery, rates/unit, active order; browse without login | Unserviceable area, inactive service, missing imagery, no reviews, failed catalog load |
| Quantity/bag | Kg selectors and approximate size guide for weight services; garment counts for piece services; care notes and persistent draft | Reload, sign-in transition, disabled service/rate change, mixed billing units, removal of final item |
| Address/availability | Owned addresses, confirmed coordinates, server-returned slots and full return windows; no invented map position | Location denied, outside boundary, full slot, changed cutoff, unavailable deadline |
| Booking confirmation | Immutable quote/rate snapshot, provisional/final label, all components, payment due at return and cancellation terms | Double submit, timeout with unknown outcome, expired quote, capacity lost before reservation |
| Order detail/tracking | One order ID shared with staff/rider, honest status, custody counts, consent requests, payment/receipt and support | Offline last-known view, stale version, declined/absent consent, failed handover/payment |
| Account/help/reviews | Verified identity, session/device management, owned addresses, incident messages, eligible reviews with publication consent | Expired session, delete/revoke, duplicate review, unsupported speech, human escalation |

### Delivery partner

Assigned jobs first; privacy-limited task details; navigation handoff; sealed container IDs and count/condition records; pickup and return code input; at-laundry measured intake; self-reported location with source/time; offline evidence queue; exceptions; completed history. A queued offline handover is `Pending sync` until the API accepts it. Reassignment invalidates queued writes. Payment problems escalate to founders; riders do not gain authority to fabricate receipts or alter rates.

### Operations

Facility-scoped order queue with the next required action; order/custody audit; weighing/condition evidence and price-consent status; care/QC tasks and exceptions; pickup/return assignment; manual-payment confirmation and cash reconciliation; refund obligations; support/rewash resolution; catalog, approved rate cards, service areas, windows/capacity, staff access and review moderation. Every override requires a reason and retains before/after values and actor/time.

## 6. Taste-led redesign specification

D01 owns the visual system and reference screens, using the app-screen workflow from `.agents/skills/design-taste-frontend/`. P00 must preserve this already committed skill and its required references/scripts for cloud workers; if unavailable, the design task is blocked rather than claiming the skill ran.

The researched initial direction is **Framed sheet**, seed `1278588346`, chosen for operations' daily queue and object-detail work. It preserves Laundry's navy/teal identity: white surface `#FFFFFF`, pale-blue frame `#EEF4FF`, ink `#0F1F3D`, action `#0E7C7B`, and semantic error/warning/success colors from existing tokens. Proposed typography is self-hosted IBM Plex Sans 400/500/600 and IBM Plex Mono for identifiers only, with license provenance. Font delivery must work in cloud screenshots and Android builds. Final direction is documented in D01 rather than randomized independently by each frontend worker.

Customer adapts the system to a compact, photographic shopping flow: address and active booking first, an honest service rail, clear units, a persistent bag, a visible next action and a date/slot editor that never asks users to type ISO strings. Delivery is a task-first phone view with one primary next action. Operations uses a quiet labeled sidebar, a tinted frame, a white work sheet, aligned rows and a selected-order detail pane. No charts or KPI tiles without an operational question and real data.

The product's signature element is a **custody receipt**: estimated quantity, measured quantity, sealed containers, due-at-return amount and current handoff appear together consistently across all roles. The same server values drive every repeated figure.

Required design deliverables: shared tokens/components, approved copy and states, customer home/booking/order detail, delivery task/handover, operations queue/intake and reusable error/empty/offline patterns. Minimum 44px phone hit areas, readable 14–16px body copy, visible keyboard focus, non-color statuses, correct screen-reader order, reduced-motion support, no overlays covering the final row/action. Verify 390, 768 and 1440px plus Android font scaling. Photography must have a license record; competitor assets are reference evidence, not Laundry product assets.

## 7. Backend modules and transaction boundaries

| Module | Responsibility | Critical invariant |
|---|---|---|
| Identity/access | OTP provider port, challenge limits, hashed expiring sessions, rotation/revocation, staff invitation/MFA, memberships | Phone claim does not grant saved-address access; demo auth is unavailable in production |
| Catalog/pricing | Four services, billing unit, care/garment eligibility, immutable rates and activation approvals | No quote without approved active configuration; integer line totals and explicit rounding policy |
| Availability | Area polygons, business calendars, slot templates/cutoffs, pickup/return capacity | Atomic reservation across required resources; concurrent final slot has one winner |
| Orders | Quote, booking, inventory/intake, adjustments/consent, processing, cancellation/reschedule, audit | One domain transition function per command; no generic status setter or pre-consent processing |
| Billing | Obligations, attempts, manual receipts, provider adapter, refund/reconciliation | Cash/manual confirmation differs from gateway capture; one economic effect per provider event/key |
| Logistics/custody | Legs/attempts, current assignment, sealed-container events, proof/code expiry/attempt limits, location | Pickup does not deliver the order; only accepted return custody can complete it |
| Media | Private proof/audio uploads, MIME/size/ownership checks, short-lived downloads, retention | Catalog assets are public; proof/audio are private and access-scoped |
| Support/reviews | Incident lifecycle, rewash/compensation request, verified eligible reviews and moderation | Incident remains open until explicitly resolved; one review per delivered order |
| Conversations | Verified inbound identity, draft revisions, text/speech adapters, exact confirmation, consent/templates and handoff | Message or voice transcription alone never books; old draft confirmations cannot authorize new terms |
| Worker | Transactional outbox/inbox, leases, retry/backoff, dead letters/replay, expiry/deletion/reconciliation | Notification failure never rolls back business state; crash/replay never repeats money/custody effects |

Canonical migrations are additive and versioned. Do not rewrite migrations already applied. Move required searchable/reportable fields from the pilot JSON object into owned normalized tables through an explicit backfill and reconciliation report. Preserve original IDs, quoted snapshots, payment facts and custody events; legacy records are not made native `/v2` orders by changing an ID prefix or relabeling a payment.

No vendor network request occurs inside a long database transaction. Persist intent and a stable provider reference, call externally, then reconcile outcomes, including timeouts where success is unknown. Critical commands update aggregate state, idempotency result, audit and outbox atomically.

## 8. Production settings and unresolved business inputs

Build admin configuration and validation now; keep the affected production behavior disabled until supplied inputs pass validation.

| Missing input | Implementation can proceed with | Activation requires |
|---|---|---|
| Rates, increments/minimums/tax/fees for each service; Premium promise | Explicit synthetic test rate cards; service/tier disabled by default | Founder-approved versioned values and customer-visible terms |
| Lower measured-weight billing floor; hold timeout/fees | `ON_HOLD` with founder-contact workflow and explicit agreed unprocessed return | Reviewed minimum-package/decrease policy; no hidden charge from the old estimate |
| Exact Indiranagar boundary and physical capacity/turnaround | Synthetic polygons/calendars; deterministic tests | Approved area, operating hours/cutoffs, facilities and measured capacity |
| Real customer OTP and staff MFA | Provider ports, fake-provider contract tests, production fail-closed checks | Laundry-owned configured providers and verified end-to-end sandbox/live checks |
| UPI/cash confirmation and refund processes | Audited manual-receipt workflow and separate gateway adapter | Founder roles/reconciliation policy; credentials only for an explicitly enabled provider |
| WhatsApp, speech, object storage, notification services | Local fixtures and private storage port tests | Laundry-owned accounts, opt-in/template/retention configuration and explicit usage authorization |
| Deployment and physical pilot | Build manifests, staging smoke, restore/migration runbooks | Named host/account/environment, launch settings, signed builds and actual fulfillment trial |

Unavailable provider tests are `BLOCKED_PROVIDER`, not passing production checks. iPhone release, subscriptions/wallets/referrals, multi-city operation and live WhatsApp calls are outside this first build's acceptance scope.

## 9. Parallel execution and integration

The coordinator establishes an explicit published integration branch and immutable wave baselines. Do not use `build/laundry` for ordinary integration while its push workflow deploys. The plan branch is documentation only. Worker delivery is `cloud/<task-id>-<short-name>` plus a verified SHA and handoff; no PR. Only the coordinator combines delivered branches and advances the integration baseline using normal git operations.

The task manifest distinguishes **start blockers** from **integration dependencies**. A task may build against frozen contracts and local fake ports while its runtime peers are in progress. Such a task can report `IMPLEMENTED`, not `INTEGRATED` or production-ready. Final end-to-end acceptance requires the actual peer implementations on the tested integration SHA.

| Wave | Work eligible after stated blockers | Parallelism rule |
|---|---|---|
| 0 | P00 baseline consolidation and R01 public reference investigation | Separate source/infrastructure and research ownership |
| 1 | P01 cloud harness, C01 contracts, D01 design system | All after P00; separate coordinator-owned file groups, so the same coordinator serializes its P01/C01 edits; research/design can run alongside |
| 2 | B01–B10 backend modules and F00 app foundations | Starts after frozen contracts and cloud preflight; isolated feature directories; schema proposals, not canonical migrations |
| 3 | F01 customer booking, F02 customer orders/account/help, F03 delivery, F04 operations | Starts after D01/F00; disjoint route/source ownership; runtime peers integrated before acceptance |
| 4 | E01 whole-product acceptance and E02 Android cloud verification | Independent browser/API versus Android evidence ownership on a pinned integrated candidate |
| 5 | E03 production-readiness and launch packet | Requires current E01/E02 proof; production promotion remains a separate authorization |

See the exact per-file ownership, contract-change protocol, leases, retry/rebase rules and copy-paste cloud dispatch prompt in [CLOUD-AGENTS.md](CLOUD-AGENTS.md). The task manifest and GitHub issue numbers are the dispatch queue; labels alone do not launch a task or prove cloud account access.

## 10. Cloud environment requirements

Prepare one reusable cloud image/environment, then give each task its own checkout, service processes, database and evidence directory. Current Codex guidance describes published prepared environments; a new task begins from that prepared filesystem, so repository/dependency freshness must be checked explicitly. Local MCP registrations and skills are not transferred automatically. See [official cloud-environment documentation](https://learn.chatgpt.com/docs/environments/cloud-environments), checked 21 October 2026. These platform observations are not a claim that this repository's cloud account is configured.

P01 must demonstrate: frozen install, package builds, task-scoped PostgreSQL, API boot/migrations/seed, browser launch, at least one real interaction, video export/upload and process shutdown in a fresh cloud task. Prefer job-local PostgreSQL binaries when nested Docker is unavailable; prove the actual route. Never fall back to SQLite/in-memory storage for acceptance evidence. Use synthetic non-production data and a `laundry_verify_<task>_<run>` database, with credentials passed through the cloud environment rather than issue bodies.

Cache dependencies/browser binaries keyed by lockfile and runtime version; never cache real sessions, private media or a task database as a shared seed. Permit only required package/source/artifact domains. Research workers may access the named competitor's public origins; build workers need no competitor account or production secrets. No unapproved commercial API/model calls, app-store purchases or paid remote-device jobs.

Android checks need a separately proven cloud emulator/device runner, Android SDK/JDK and appropriate acceleration. If the selected cloud host cannot run it, E02 remains blocked until an authorized cloud Android runner is supplied. Browser builds never certify camera, offline persistence, notifications, location/background behavior or Android accessibility.

## 11. Verification and readable evidence

Baseline commands are `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm check`, scoped Vitest suites and the integrated PostgreSQL acceptance suite. P01/C01 publish the exact canonical commands in the task packets before feature dispatch. Commands listed as proposed until then must not be represented as already existing.

Whole-product scenarios must use the real SDK, API, PostgreSQL and app screens together: all four catalog types; kg/piece/mixed quote; full slot race; invalid/expired dates and quote; booking retry; pickup custody; weigh/inspect; increased-price approval or held return; care/QC; return assignment; payment pending/rejection/receipt; wrong/expired/reissued codes; delivery; review; support; conversation revision/confirmation; duplicate provider replay; reassignment; API/worker crash and restart; media/retention; restore; staff/facility boundaries. Assert persisted counts/amounts and audit/ledger facts, not just UI labels.

Each issue delivers an evidence manifest containing task/issue ID, source/base/tested SHA, contract version/digest, design version, fixture/provider mode, commands with exit codes, scenario outcomes and stable artifact URLs with SHA-256/size/metadata. Any changed source SHA invalidates prior passing evidence. Preserve failed artifacts and distinguish test failure from missing runtime/provider access.

Record at 1920×1080 desktop or 1080×1920 portrait, 30 fps, H.264 MP4, CRF approximately 18–22; screen captures must remain readable at normal playback. Verify actual output with `ffprobe`, extract and inspect representative frames and verify both founders can open the artifact. Do not accept the 1-fps preview export. If tools only offer a compressed preview, use the cloud recorder path and retain the original high-quality video. Never upscale a low-quality clip and call it new proof. Raw browser video/trace and assertions remain available even if a shorter narrated review cut is made.

## 12. Review focus

1. Phone/app reload during booking, payment or offline handover must reconcile one intent instead of repeating an economic/custody effect: C01, B04–B06, F01/F03, E01.
2. Mixed kilogram and piece services must price independently, reserve the slowest supported return and retain an immutable quote: B02–B05, F01, E01.
3. Reassigned rider, changed staff facility or revoked session must lose access even with stale local data: B01/B06, F00/F03/F04, E01/E02.
4. Midnight/next-day IST, full slots and quote expiration must preserve the selected date and explain alternatives: C01/B03/B04/F01, E01.
5. Partial provider success, worker crash and stale/duplicated callbacks must remain pending/reconcilable without a false successful UI: B05/B09/B10/F02/F04, E01/E03.

## 13. Completion and release gates

`READY` means start blockers are integrated and the issue lease is free. `IMPLEMENTED` means scoped checks pass on the task SHA. `INTEGRATED` means the coordinator combined it and reran consumer checks. `VERIFIED` means current required evidence passes. `BLOCKED_ENV`, `BLOCKED_CONTRACT`, `BLOCKED_PROVIDER`, `BLOCKED_BUSINESS` and `FAILED` never mean done.

The application is production-ready only when the integrated candidate passes browser/API and Android gates; demo endpoints are disabled; provider and business activation inputs are verified; migrations and backup restore are rehearsed; least-privilege secrets/TLS/log redaction/monitoring are configured; operations can recover money/custody/notification failures; and the physical pilot is documented. Build completion is not deployment, and deployment is not evidence of real service fulfillment.

## 14. Implementation tasks and GitHub tracking

[TASKS.json](TASKS.json) is the machine-readable task list. [ISSUES.md](ISSUES.md) links the published epic and child issues. [REVIEW.html](REVIEW.html) is a portable visual overview with an interactive ready-task filter. [REA-SETUP.md](REA-SETUP.md) records the approved local installation and remaining reconnect/native-analysis prerequisites. Every child has a self-contained outcome, hard prerequisites, integration dependencies, exclusive write allowlist, interfaces, failing-test requirements, implementation checklist, verification, exclusions and a cloud dispatch contract. Only P00 and R01 are ready initially; later waves become ready when their pinned baselines exist.

Document publication does not launch cloud workers or invoke paid models. Cloud account/environment publication and task submission must be verified by the coordinator before claiming work has started.

## GSTACK REVIEW REPORT

Status: implementation planning complete; product implementation not started by this document. Scope: all four services and all three apps; cloud-only parallel execution; no PR delivery. This is an evidence-grounded self-review, not a completed external Claude review or a claim of full gstack engineering/design gate approval. Open risks are explicit above and in task prerequisites. External Claude review is unavailable on this machine. Future agents run phase-specific gstack review, QA and taste checks on the actual implementation. Commercial configuration, provider activation and real Android/cloud/physical fulfillment evidence remain launch gates.
