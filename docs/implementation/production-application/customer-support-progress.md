# Customer support implementation checkpoint

Status: **scoped local browser/recovery acceptance passed; not deployment, production readiness or issue closure**. Continuation of the unattended production recovery plan.

## Scope

- Owned-order support case creation through the existing v2 SDK and backend; explicit category, required summary, optional details, and no invented attachments.
- Owned case list and authorized message pages, with visible pagination rather than silently presenting a first page as the complete history.
- Exact actor-bound case/message intent and command key retained after an unknown result. Original requests are shown read-only for explicit reconciliation, never automatically replaced with newly typed text.
- Help links to owned orders. Support does not change order status/version, resolve a case, issue a refund, or send SMS/WhatsApp.
- Existing published wire routes and request/response schemas remain unchanged.

## Reproduced and repaired boundaries

The previous SDK support read methods accepted no cursor/limit. Tests were added before repairing either boundary.

Foundation reproduction `b90e3d883` failed both new cases with `No approved replay sender exists; reconcile the retained intent`, before any expected HTTP503 could be received. Added only the two typed, fixed first-party SDK senders and result mappings; retained actor/body/parameter/key checks are unchanged. Full foundation verification `b415d3108` passed **39 tests**, including both exact retained support requests.

The first pagination diagnostic (`b58062e86`) failed on an **invalid new test fixture** (`data` instead of the canonical page `items`), not yet on cursor loss. The fixture and the new screen were corrected to the existing wire shape. The corrected reproduction `b0b6e6e62` then failed both cursor assertions: expected `opaque+/=cursor`, received `null`. Added optional query arguments to the two existing SDK read methods, preserving current no-argument callers and the canonical URL encoder. The separate HTTP/PostgreSQL red reproduction `b6c299e0f` also failed on the first `limit: 1` assertion by returning both owned cases. Fresh verification `bc8fa4b7d` passed: **164 SDK tests**, workspace typechecks and **14 PostgreSQL/HTTP support/review tests**, including paginated owner-only reads and refused cross-customer/rider message access. The original invalid-fixture failure is not evidence of the transport defect by itself.

## Full regression

`b0465591f` passed **1,124 tests** against disposable PostgreSQL: API 371, contracts 104, fixtures 236, SDK 164, foundation 39, customer 117, rider 36, ops 55 and design tokens 2. `b77b98f90` also passed **110 tooling tests** and the OpenAPI registry check (all seven contract-generation assertions). These are dirty-worktree source checks, not yet a clean-revision browser/restore gate.

## Visual uncertainty defect

`b8a7d4d94` passed the complete customer/ops/review/support journey, exact case/message retries and unchanged order assertions. Actual desktop and 390px mobile screenshots were inspected. The pending-case screenshot exposed a contradictory empty-state claim (“No support cases are recorded”) alongside the unknown committed result. Both case and thread empty-state conditions incorrectly trusted their pre-command read snapshots while a mutation was unresolved.

Regression `bebc19fc4` failed against the frozen pre-fix export: both `emptyCasesDuringUnknown` and `emptyMessagesDuringUnknown` were **1**, expected **0**, after committed reply loss. Source now suppresses empty claims while pending, sending or blocked. `b2f2d6112` passed all **117 customer tests** and workspace typechecks after the repair. Rebuilt browser/restore `b9798b1f3` then passed both zero-empty-state assertions, exact case/message request replay and unchanged-order checks, with no browser errors. The repaired pending-state mobile screenshot was visually re-inspected: the contradictory empty claim is gone. An incorrectly parameterized export/restore attempt (`be4f7ae93`) was intentionally stopped and replaced, not counted as a failed application gate.

## Browser and recovery evidence

`b9798b1f3` restored **91 tables and all sequences**, preserved exactly one support case with one customer message and one synthetic operator reply, and refused a duplicate per-case message sequence after restore. It also preserved the previous delivered order, accepted return handover, one manual receipt, zero gateway receipts and one private unpublished review. Encrypted identity recovery passed. This first repaired receipt was explicitly **dirty**. Clean rerun `b79f5a795` then passed on **`e2413d932672475929ae147e77fa08743cba4bec`**, with clean worktree checks before and after. Both browser and restore receipts name that exact SHA with `dirty=false`; case/message counts, duplicate-sequence rejection, absence of false empty-state claims and zero browser errors were rechecked. Desktop and mobile support screenshots were inspected. Customer and ops WebM paths are indexed by the private browser receipt; these headless test recordings are not the original 1080p legacy demo recording or a native/physical fulfillment claim.

Diagnostic runs are not silently relabelled: `ba4fb485e` rebuilt/exported successfully but ran only the baseline journey because the facility option was misspelled; it is not support evidence. `b60b7dff1` used the right facility option but omitted the ops build API URL and correctly stopped at “Operations console is not configured”. `b8a7d4d94` corrected that configuration and passed the functional journey before visual review found the empty-state defect above.

Customer input/intent safeguards `bca24c91f` passed all five tests. JavaScript syntax checks for the new/extended browser and fixture scripts, and `git diff --check`, passed. Neither is runtime acceptance.

## Boundaries

The operator acknowledgement in the browser fixture uses the real compiled support service with a synthetic provisioned staff session. It is **not** proof of a staffed support console, live notification, real staff MFA or response-time SLA. The fixture is guarded for disposable loopback databases and must never be deployed.

Photos/media viewing and live notifications remain disconnected. Default browser tokens and pending-intent stores remain memory-only; device secure persistence, process-death/offline recovery, actual OTP/Google/Apple callbacks, production-host restore, approved commercial inputs and physical facility rehearsal remain open gates. No paid calls, live messages, ordering enablement or production deployment are authorized by this checkpoint.

The founder/facility decision tracker (#45) was re-read in `b2092eae3`: it remains open with zero comments and no recorded approvals. Engineering must not invent rates/capacity, assume spending consent, provision another project's accounts, or activate ordering while those gates remain unresolved. Continue independent code work instead of treating business blockers as passed.

## Next unblocked finding

The owned-order header currently labels every `DUE_AT_RETURN` payment model as “Payment due at return”, including after recorded collection. Payment model is not payment state. Verify this against the actual fulfilled browser order, then repair customer ledger visibility in a separate checkpoint using existing owned billing reads; do not infer settlement from `DELIVERED` or invent a receipt.

## Reproduce the scoped browser/restore gate

Build the API normally, then rebuild ops with `VITE_DEMO_MODE=false VITE_API_V2_URL=http://127.0.0.1:4499/v2`, and customer with `EXPO_PUBLIC_AUTH_ENGINE=legacy EXPO_PUBLIC_API_V2_URL=http://127.0.0.1:4499/v2` plus Expo `--clear`. These values are only for the isolated synthetic fixture.

Run `node tools/verification/restore-rehearsal.mjs` with `LAUNDRY_SYNTHETIC_ACCEPTANCE=true LAUNDRY_VERIFY_OPS_FACILITY=true LAUNDRY_RESTORE_SOURCE=customer-v2 LAUNDRY_PG_RUNTIME=local LAUNDRY_PG_BIN_DIR=<verified PostgreSQL bin directory>` (and that local runtime's library path if needed). The tool creates its own source and empty target; do not point it at a production URL. Inspect `.verification/restore-rehearsal.json` for the tested revision, dirty flag, exact support facts and duplicate message-sequence rejection.

Private browser/database/credential artifacts remain ignored and are not published.
