# Laundry: production in 3 days, product parity by Day 10

**Founder-directed execution target, revised 26 October 2026.** Supersedes the earlier 10-day production-recovery schedule. Day 3 is the production-readiness deadline, not a demo or merely a staging milestone. Days 4–10 are LaundryMate-style product improvements on the same real product. No gate becomes optional because of the deadline.

Canonical development branch: `main`, created from the integrated `eb536d90e44867a15538c51e27e03cb42f7e9d57` history without a reset or force-push. GitHub epic: [#5](https://github.com/aditya-zig/laundry/issues/5). Normative scope remains [IMPLEMENTATION.md](IMPLEMENTATION.md), [CONTRACTS-V2.md](CONTRACTS-V2.md), the product specification and current [deployment checkpoint](../cloud/web-and-messaging-deferral.md).

## Rules and ownership

- Keep the selected Nest/PostgreSQL backend and Laundry-owned infrastructure. All apps use `@laundry/api-client`; preserve four-service KG/PIECE pricing, integer paise and timezone-qualified windows. Order, payment and custody states remain separate.
- Engineering coordinator owns integration, contracts/SDK, canonical migrations, root manifests/lockfile, CI and infrastructure. Backend and app owners work within existing issue allowlists; actual people must be assigned before parallel dispatch. No paid models, providers, runners or upgrades are authorized by this plan.
- Founder owns commercial scope, spending, provider/account authorization and final activation. Facility partner owns achievable turnaround, capacity, care/claims rules, staffing and physical rehearsal. An engineering assistant cannot approve these on their behalf.
- No fixtures/Convex fallback satisfies release acceptance. Demo identities, simulated capture and messaging outbox are explicitly test-only. WhatsApp ordering/voice/notifications remain deferred; real customer identity and staff MFA do not.
- Functional parity, not copied brand, photographs or exact design. Reuse existing implementation and research (#7), not a second product or speculative rewrite. Days 4–10 never excuse an unfinished Day-3 safety requirement.

Dates assume calendar-day work starting Monday 26 October: Day 3 = 28 October, Day 5 = 30 October, Day 10 = 4 November. Move dates openly if staffing starts later. These are targets, not a guarantee of external approvals.

## Day 1: establish main, repair checks, unblock activation

**Engineering:** #6/#8/#9 and existing owners. **Human decisions:** founder + facility lead under #28.

1. Make the integrated history `main` and the GitHub default. Audit branches, PRs and worktrees; delete only fully integrated, inactive branches. Preserve unique work and checked-out worktrees, record why each remaining branch stays. No force-push or broad cleanup deletion.
2. Reproduce current CI failures before changing code. First observed failures: three outdated display-name assertions in `apps/ops/test/branding.test.ts`. Verify intended names, preserve separate demo-sign-in checks, repair the mismatch and run the full release commands to discover additional failures.
3. Verify contracts/SDK/handler compatibility, migrations and clean dependency/build environment. Use existing CI and isolated PostgreSQL tooling. Pin all evidence to the actual tested SHA, not the historical “584 passed” claim.
4. Verify candidate deployment is reproducible without private `.data` helpers or committed secrets. Inspect all three apps; previous operations browser inspection was incomplete. Check errors, empty states, role denial and ordering-off behaviour.
5. Start Android tooling/build feasibility now (#27), plus backup/restore and identity checks. Do not leave these until the last evening.

**Founder deliverables today:** approved service area/facility; rates, taxes/minimums/rounding, consent and cancellation/claim/refund policies; feasible pickup/return windows and daily cap; actual ops/rider/support owners; permitted customer identity and staff-MFA channel; Laundry-owned credentials/compliance; spending decision and real-phone/physical-rehearsal availability. Real sign-in requires an approved channel even while WhatsApp is deferred. Never invent rates or use shared login codes.

**Day-1 exit:** main is canonical; first repair verified; remaining failures and contract/native/provider/business blockers have owners. Live ordering stays off until the Day-3 gate passes.

## Day 2: integrated acceptance, security and recovery

**Engineering:** #11–#18/#20–#27. #26 owns cross-role evidence, #28 recovery/security.

Complete customer booking → rider pickup → bag custody → facility intake/count/weight → price-adjustment consent or hold → care/QC → return dispatch → pay-on-return receipt → accepted return custody → delivery → review/support. Use real SDK/API/PostgreSQL and actual app screens; never database-edit a journey into passing.

Required negative/regression cases:

- Four services; KG/PIECE/mixed prices, approved rate snapshots, expired/stale quotes/order versions and timezone-qualified windows.
- Concurrent last-slot booking: one winner, no leaked capacity. Lost response/same-key retry creates one order; changed payload under reused key is rejected.
- Customer ownership, rider reassignment, facility scope, staff roles, MFA, OTP expiry/rate limits, refresh rotation/replay/revoke and demo-auth rejection.
- Pickup/return code expiry/reissue/attempt limits; expected code never exposed to staff/rider; pickup never marks delivery. Offline custody survives restart without replaying stale assignment.
- Declared/counted/measured quantities remain distinct. Increased price requires current consent; decline/expiry/unanswered consent holds care and follows approved return policy.
- Pending/failed collection cannot become paid/delivered. Manual cash/UPI record is audited, not gateway capture. Duplicate payment receipt/webhook/event changes money once. Refund obligation differs from actual settlement.
- Support/incident/rewash, delivered-only review, duplicate review rejection, consented publication, private-media access/expiry and retention.

Assert persisted order, ledger, custody, audit and job counts as well as UI. Restart API/worker during unknown outcomes; verify retry/lease/dead-letter behaviour. Restore a backup into an isolated database, reconcile identifiers/money/custody/jobs, and prevent restored outbox jobs from sending real messages. Measure recovery against founder-approved RTO/RPO.

Run real approved customer authentication and staff MFA if provisioned. Test adapters can prove engineering behaviour but cannot establish live provider readiness. Record blocked integrations explicitly. Inspect production configuration, secrets/TLS/log privacy/least privilege, dependency security and monitoring.

**Day-2 exit:** integrated engineering journey and failure suites pass at a pinned SHA; all three apps inspected; recovery/security/native evidence is ready or has a concrete blocker. Stop adding features to this release candidate.

## Day 3: physical proof, final fixes and production decision

**Owners:** coordinator supplies proof; founder + facility partner approve activation.

- Finish both Android apps' build/install, permissions denied/recovered, secure storage, process death/offline/reassignment, large-font/screen-reader and signing/artifact evidence (#27). Browser proof is not native proof. Any web-only launch exception requires explicit founder approval and keeps #27/full epic requirements open.
- Run five consented internal/partner orders through actual pickup, seals, weighing, care/QC and return, including a controlled adjustment/hold, failed collection/return and incident/refund exercise. Never deliberately damage garments. Label simulated incidents and distinguish actual money movement. A non-developer operator follows the runbook and reconciles physical garments/amounts.
- Verify approved catalog, capacity, legal/support/claim/refund information, staffed escalation and monitored error alerts. Test ordering shutdown and rollback/forward-fix while existing orders can safely complete.
- Fix release blockers and rerun affected acceptance plus clean build/check/contract/PostgreSQL/security suites on the final SHA. Capture readable role-specific and end-to-end recordings with raw evidence stored privately outside git.

### Production gate: every item required

- [ ] Current green release checks and persisted cross-role positive/negative acceptance; no unresolved critical/high launch-blocking defects.
- [ ] Real approved customer identity and staff MFA, ownership/facility controls and demo rejection verified.
- [ ] Partner-approved rates, service boundary, attainable windows/capacity, claims/refund/support policies and accountable trained operators.
- [ ] Physical rehearsal reconciled; collection/refund process and custody proven.
- [ ] Migration/restore/restart/replay, secret/privacy/security review, monitoring, rollback and ordering kill switch verified.
- [ ] All three apps browser-verified; each native app being released has native evidence. Any scope amendment explicit, never an automatic waiver.
- [ ] Readiness matches enabled capabilities. Do not force HTTP 200, hide a 503 or activate an unavailable provider just to meet a date.
- [ ] Source/deployment/artifact SHAs and provider modes recorded; founder authorizes exact activation scope. A branch push is not deployment approval.

**Outcome:** GO for the approved production scope, or NO-GO with engineering/provider/business/operational reasons, owner and next review date. A blocked gate means we missed the three-day target; it does not turn the target into a successful demo. Keep ordering off on NO-GO and fix blockers ahead of parity work.

## Days 4–5: LaundryMate-style core experience

**Owners:** #7/#10/#22/#23, with #12/#25 for approved catalog and operations.

- Day 4: compare existing evidence-backed LaundryMate feature matrix against the real product. Close customer service discovery, garment selection, price transparency, bag/minimum guidance, address/window booking and accessible mobile layout gaps. Use approved catalog and real quote errors, not demo-only rates.
- Day 5: complete tracking with genuine pickup/care/QC/return/payment events; clear due-at-return amounts, order detail/history, reorder, support/incident flow and verified reviews. No fake GPS, invented delivery promises or decorative states disconnected from backend events.
- **Gate P5:** founder reviews customer experience against the named reference behaviours; real-backend browser and API regressions pass, accessible screenshots/video tied to SHA. Production gate remains intact; no release regression accepted to gain visual parity.

## Days 6–10: remaining parity, one tested slice at a time

- **Day 6:** rider/ops dispatch, intake reconciliation, consent holds, care/QC exceptions, return, collection and audited configuration. Improve speed/usability using actual operator tasks (#24/#25/#43).
- **Day 7:** remaining customer account, support/review and responsive/accessibility polish against the feature matrix; test slow/offline/error/retry states on representative phones. Deliver usable flows, not marketing screenshots (#23/#38–#40).
- **Day 8:** evaluate subscription and express/service-category gaps against the reference. Implement only after partner rules, capacity, pricing, billing/entitlement and pause/skip/cancel semantics are approved; start with a tested vertical slice. Without approval, keep the feature disabled and mark blocked; “notify me” is not subscription parity (#41/#42).
- **Day 9:** integrate approved parity slices, native/browser regression and representative workload/restart testing. Verify new recurring jobs or billing cannot duplicate charges/bookings. No unrelated architecture migration.
- **Day 10:** real customer/rider/ops walkthrough, repeat operational drill for changed behaviour, finalize remaining feature-matrix gaps and ship only verified slices with founder approval (#44). Report delivered / partial / blocked / later honestly. Store publication, online payments and WhatsApp each need their own approved provider/distribution prerequisites; no promise of approval by Day 10.

**Gate P10:** accepted reference behaviours have traceable working evidence; production gates still pass; incomplete features remain open. Match useful LaundryMate functionality while keeping Laundry identity. Full parity is a backlog to verify, not an unsupported claim that every competitor feature is complete in ten days.

## GitHub execution

Milestones: **D3 — Production readiness (28 Oct)**, **D5 — Core experience parity (30 Oct)**, **D10 — Extended parity (4 Nov)**. #5 remains the production epic, #26 integrated evidence, #27 native evidence and #28 the Day-3 release decision. Existing implementation issues retain acceptance IDs; no reset to “not built.” #29 becomes the Days4–10 parity umbrella; #37–#44 lose demo-only acceptance and are re-scoped around real product behaviour. #19 stays explicitly deferred under the prior messaging decision.

Each active task needs an accountable owner, prerequisite, smallest remaining outcome, target gate, tested SHA/evidence and blocker. Founder inputs are tracked separately under #28. Coordinator owns daily integration; no automatic worker dispatch.

Daily update: tested SHA; completed verified work; failing/blocked work; human decision needed; next critical-path action. Re-plan on a failed gate, not after the deadline. Preserve failing logs/exit codes, redact private data and never count simulated provider behaviour as live verification.
