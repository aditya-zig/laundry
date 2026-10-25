# Return delivery and worker checkpoint

This follows `49f4b26` on the isolated `cloud/batch-20261025-01` branch. It is not a production launch receipt. The user authorized deployment **once ready**, not bypassing security or live-operation gates.

## Composed business path

Booking already commits the order, reservation, obligation, pickup attempt and event together. Quality-check PASS now reconciles accepted final pricing and creates a return attempt in that same transaction. Failed quality checks, unknown payment attempts, over-settlement and peer failures do not advance the order.

The additional delivery reconciler reads persisted facts rather than trusting a client `delivered` flag. Both return custody and final payment must be resolved, in either arrival order. It requires current accepted return proof, QC/measured intake, matching final order/obligation amounts, no unresolved payment attempt/refund/adjustment, and either positive fully settled money or an actual audited zero-due resolution. It changes the guarded order once and writes timeline, audit and `order.delivered.v2` atomically. Reviews consequently become available through their existing ownership/status checks, not a UI override.

- Return handover, manual receipt, signed successful gateway capture and audited zero-due resolution call the reconciler inside their existing transactions.
- Resolving an unknown payment attempt to a definitive non-capture state also rechecks completion. The attempt update is now locked and transactional; a stale resolver cannot overwrite concurrent successful capture.
- Final settlement publishes the validated `payment.settled.v2` event in the receipt transaction. Duplicate command/webhook replay does not produce a second receipt or completion.
- Real manual cash/UPI confirmation is staff-scoped, not a fake gateway capture. Signed gateway tests use an explicitly synthetic signing key; no live gateway was called.

## Worker reliability

A required event consumer missing from the registry is a failure, not a successful dispatch. Claims carry a fencing version/owner; stale workers cannot complete or reschedule a reclaimed lease. Each consumer effect and inbox marker share a transaction. Faulting effects roll back, retries preserve identity, and dead-letter replay remains versioned/audited.

**Runtime composition is still incomplete.** `apps/worker/src/jobs.ts` does not yet supply the actual business/notification registry. It is not an accepted production dispatcher. The legacy worker deliberately refuses real production mode. No notification success or durable live delivery is claimed from unit tests or a started process.

## Frontend candidate status

Cloud screen source/patch digests were verified before integration. F01 and F03 exited unsuccessfully; useful partial source is retained and repaired by the coordinator, not reclassified as successful agent delivery. F04 returned for review; that is not release authority.

The operations v2 entry is mounted by default. Legacy operations authentication requires explicit `VITE_DEMO_MODE=true`; browser verification uses that explicit flag only for the historical demo suite. Private views clear on sign-out/scope changes and discard late cross-session responses. Rider screens use the v2 SDK/session foundation, with explicit unconfigured/unknown states and identity subscriptions. Customer booking helpers are present, but a complete connected customer screen journey is still unfinished. Browser in-memory credentials/queues are not native secure persistence or process-restart acceptance.

The operations entry was inspected at desktop/tablet/mobile sizes, including keyboard focus; this is visual evidence for that screen, not whole-product fulfillment acceptance. The initial inspector exited unsuccessfully because its marketing-font sheet expected Besley/Libre Franklin. The subsequent inspection explicitly allows `font-not-dealt` to preserve this existing app's system UI typography, rather than pretending to have loaded those fonts. A `hero-void` warning remains: sparse staff authentication deliberately leaves whitespace instead of invented dashboard facts. Reports and screenshots remain ignored under `.data/browser-evidence/ops-entry{,-final}/`; no clean-SHA visual release receipt is inferred. Staff signup never grants staff roles and customer login is not staff onboarding.

## Observed verification and pending release gates

Before the final extension, the actual disposable-PostgreSQL billing/logistics/jobs run passed **46 tests** and API typecheck passed. The larger final workspace typecheck passed. Its first build failed in the newly connected rider bundle: Metro followed the foundation's source alias and could not resolve Node ESM `.js` imports. The existing compiled-workspace resolver now also maps `@laundry/app-foundation` in both Expo apps; the resolver regression failed before that fix and passed afterward (2/2). The initial resolver test harness also failed on Expo's CLI-only asset setup and was corrected to isolate our resolver map; this does not substitute for the actual export. The replacement full build passed (including both actual Expo web exports, operations and compiled API/worker). The disposable-PostgreSQL workspace run then passed **980 Vitest tests plus 11 gateway tests**; the API contains 336 tests. The final resolver check passed 2/2. Extended delivery cases cover simultaneous custody/payment, unknown capture reconciliation, audited zero due without a receipt, transactional peer rollback, owned review eligibility and signed capture/webhook replay. These are working-tree checks, not clean-SHA cloud acceptance; tooling checks are being run separately.

The dependency audit still reports **one high node-forge advisory, GHSA-86w9-cpqp-85rv**. A direct npm registry and GitHub advisory recheck confirmed latest `node-forge` is `1.4.0`, the affected range is `<= 1.4.0`, `first_patched_version` is null and the advisory is not withdrawn. It is not waived just because the API image excludes development tooling. No unpublished version, advisory exclusion or replacement alias is used to make the gate appear green.

Production ordering/readiness remain disabled. Current blockers also include live SMS/custody notification/payment/refund/storage/voice/WhatsApp acceptance, an actual deployed product API/worker, customer UI integration, native secure storage/device acceptance, approved rates/coverage/capacity/care/refund terms and a physical fulfillment pilot. Existing Cloudflare/Neon preflight infrastructure is not a deployed product backend. No paid service, commercial message, billing upgrade or production fulfillment has been authorized or performed by this checkpoint.
