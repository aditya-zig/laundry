# CI browser recovery — first failure only

The first scoped CI reproduction (`b0eeac91b`) built the workspace successfully, then failed `e2e/fulfillment.spec.ts:75` waiting for the old demo T-shirt link. Its actual browser trace showed `GET http://127.0.0.1:4499/v2/catalog/services` failing with `net::ERR_CONNECTION_REFUSED`: the ordinary export had retained the previous synthetic API URL after that public environment variable was unset.

## Small build repair

Customer and rider release exports now use `expo export --platform web --clear`. This trades a fresh Metro export at build checkpoints for reproducible public configuration; it does not affect the development server or add a new build framework. Two focused regression cases first failed on the old scripts; all four Metro workspace checks then passed. Run `b19ce78df` verified both actual fresh exports: the previous configured endpoint was absent from both bundles. The unchanged browser test then still failed, now showing the correct fail-closed message `Configure the explicit v2 API URL before using product sessions`, rather than contacting the stale test server. This isolates the remaining CI configuration/journey mismatch; it is not a green CI run.

## Remaining CI gate

The existing fulfillment and smoke specs still name demo login, v1 garment baskets and simulated gateway capture; the actual product is now the v2 service/unit, OTP and pay-on-return flow. Correcting stale environment output alone cannot establish those journeys. Do not skip these tests, invent missing UI, or label service-only rider calls as real rider-app verification. Preserve the customer quantity/deep-link checks, both real rider-app handovers (including wrong-code rejection and no premature delivery), real ops intake/care/QC, payment provenance, review eligibility/duplicates and PostgreSQL assertions when aligning the gate. CI remains red until the complete replacement coverage passes.

## Rider-path repair in progress

The rider job screen had no assignment-acceptance action, and the shared mutation journal had no approved `logistics.rider.accept` sender. Focused tests reproduced both missing capabilities; the adapter repair passed 40 foundation tests and 37 existing rider checks. Assignment acknowledgement is now separate from custody, actor/version bound, and cannot replace a lost retained key. Later controller tests initially used an undeclared test-fixture dependency; they now use small local typed synthetic DTOs, without adding a dependency.

The handover UI also disagreed with the journal on HTTP 408/409/429 outcomes (three red regressions), ignored the classifier's unknown state for structured errors, and had no direct immutable replay action. These now use the common outcome policy and the retained body/key, not recreated form timestamps; 49 rider tests, its typecheck and the three configured app exports passed in `b770d003c`. A definitive rejected code clears the entered code and starts a new explicit action; it is not a confirmed custody receipt.

`b770d003c` is the focused integration checkpoint: rebuild the affected exports and add the actual rider return-task browser to the existing customer/ops journey, including wrong-code rejection and reply loss after both acceptance and successful custody. It reached the actual rider screen but failed its sign-in step: fixture setup had already signed in the same rider, so the UI correctly received `RATE_LIMITED` from the real 60-second OTP cooldown. The fixture now provisions that rider/profile without requesting any OTP; the actual UI alone must obtain and verify the code. No rate guard, clock, timestamp or retry delay was weakened. `b95587bfb` passed that login and rejected the wrong custody code, but exposed a harness route mistake: the canonical handover endpoint is `/v2/rider/handovers`, not a job-scoped `/handover`. With fault injection/capture aligned to the published route, `b80fb7841` passed the actual customer + ops + rider-return browser journey using the existing builds. It proves acknowledgement is required even with filled-in proof, one acknowledgement audit, one rejected-code count, one accepted return handover, exact retained bodies/keys after both lost replies, and `RETURNING` (not `DELIVERED`) before the operator records collection. All later customer review/support/payment-ledger checks also passed. The rider recording plus 390px/1280px screenshots were inspected; no browser runtime errors or horizontal overflow were observed. This adds return-rider web coverage, not pickup-rider, native-device, staff-MFA, physical-transfer or live-provider evidence. Both actual rider-app legs are still required before replacing the old fulfillment CI coverage. `ba3e0fbd0` additionally passed the full workspace typecheck, all 40 foundation tests and whitespace checks. The changed rider package passed 49 tests. No database schema/backend behavior or production provider was changed in this slice; the previously measured backup/restore gate is not being relabelled as a fresh run.

### Reproduce the return-rider scope

After the normal repository dependency/API build, build all three exports against the task-only API from the repository root (these are synthetic verification settings, not production identity configuration):

```sh
set -eu
EXPO_PUBLIC_API_V2_URL=http://127.0.0.1:4499/v2 EXPO_PUBLIC_AUTH_ENGINE=legacy pnpm --filter @laundry/customer build
EXPO_PUBLIC_API_V2_URL=http://127.0.0.1:4499/v2 pnpm --filter @laundry/partner build
VITE_API_V2_URL=http://127.0.0.1:4499/v2 pnpm --filter @laundry/ops build
LAUNDRY_SYNTHETIC_ACCEPTANCE=true LAUNDRY_VERIFY_OPS_FACILITY=true LAUNDRY_VERIFY_RIDER=true \
  node tools/cloud/postgres.mjs exec --runtime auto --label rider-browser -- \
  node tools/verification/customer-v2-browser.cjs
```

Use the documented `--runtime local --bin-dir <verified-PostgreSQL-bin>` option if Docker is unavailable and the local binaries are not on `PATH`. No browser rebuild is needed when changing only fixture/driver code. Evidence is ignored under `.data/browser-evidence/customer-v2/`: root `result.json`, `rider-result.json`, all three role recordings, and the rider screenshots. A release claim additionally needs a clean committed revision; a dirty diagnostic result is not that claim.

### Clean return checkpoint and next pickup scope

`bc770ccec` passed the full return-rider journey again at clean commit `4534a22707be3847e29c99c5debdb7606c4b8cbb`. The three role recordings, results and screenshots are copied with SHA-256 digests into ignored `.verification/checkpoints/4534a22707be3847e29c99c5debdb7606c4b8cbb/rider-return/index.json`. GitHub #24 records the result without closing the issue or claiming pickup coverage.

The next bounded scope is actual pickup dispatch and custody before facility intake. Six new rider cases failed first: an empty pickup task dropped observed bag IDs and allowed empty/invalid/duplicate/oversized bag sets. The rider now accepts explicitly entered inventory UUIDs only for a pickup with no registered containers; known pickup IDs and facility return IDs cannot be overridden. No ID is generated in the rider app. `bf15504e2` passed 55 rider tests and its typecheck. Ten dispatch-eligibility cases also failed first; pickup assignment is being enabled only for booked legs on `CONFIRMED` / `PICKUP_PENDING` orders. Manual collection stays return-only.

Add `LAUNDRY_VERIFY_PICKUP=true` to the verification invocation above to select an actual pickup-rider browser, with its own synthetic identity, wrong-code case and post-commit reply loss on each leg. The fixture does not call `markPickupPending` in this mode: actual pickup proof must cause that transition. Inventory UUIDs are different from free-text physical seal labels; the intake form now allows the existing pickup UUID to be recorded, separately from the physical seal. Editing the UUID resets physical confirmation and does not replace it automatically. QC keeps existing inventory IDs read-only.

`b0da36040` passed the dispatch tests, typecheck and exports and completed pickup in the actual rider app, then failed on the missing intake `Bag inventory UUID` field. After adding that field, `b5de23e1a` passed 69 ops tests, its typecheck/build, and the full customer + ops + pickup-rider + return-rider browser journey. Database assertions checked the same inventory UUID immediately after intake and again after return in this same-bag scenario; each leg had one acknowledgement audit, one rejected-code attempt and one accepted handover despite lost replies. Manual collection remained disabled at pickup, and delivery still required both return custody and recorded collection. `b4c71b337` also passed the full workspace typecheck, 1,167 PostgreSQL-backed/workspace Vitest tests, 112 Node tooling tests and whitespace checks. The browser result is a dirty diagnostic pass; the clean committed checkpoint is still pending. CI is not being marked green or weakened.

The extended receipt includes `pickupBrowserProven` and `pickupBagContinuity`, separate per-leg results, and four recordings (customer, ops, pickup-rider session, return-rider session). No physical transfer, native restart/permissions, live-provider verification or real staff MFA is established by this synthetic web journey.

No production deployment, live ordering, real payment or provider activation is authorized by this work.
