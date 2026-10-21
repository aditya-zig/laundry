# Handoff QA — 21 October 2026

Status: DONE_WITH_CONCERNS. Local demo pilot verified. Customer UI handoff pushed.
No merge, backend deployment, commercial API call or paid model call was performed.

## Scope and isolation

Backend revision `efef160`, PR #3, based on `chore/cloud-agent-workflow`.
Read product spec, contracts, acceptance packet, pilot runbook and disposition.
The `/tmp/opencode/handoff-2026-10-21-backend-mvp-pr3.md` file was missing;
tracked implementation records supplied the usable handoff.

Acceptance database: `laundry_verify_qa_20261021` on the existing isolated
`laundry-mvp-postgres` container, loopback port 5549. A separate fresh database,
`laundry_verify_qa_browser_20261021`, was used by the recorded pilot journey.
Neither suite truncated the preserved `laundry_verify_mvp` browser database.

Charters: prove the documented paid and held-order lifecycles and restart
persistence; recheck idempotency, auth/ownership/version boundaries, custody,
capacity, reviews and conversation confirmation using repository acceptance
suites; verify last-known operator data and recovery on failed refresh.
Commands had finite 60–240 second limits. T3 browser used for interactive
customer checks; repository browser acceptance runner used for the recorded
multi-role pilot journey.

## Results

| Check | Result |
| --- | --- |
| `pnpm test` on isolated PostgreSQL | PASS: 99 tests, including 43 API tests |
| `pnpm check` | PASS |
| `pnpm check:convex` | PASS |
| `pnpm build` after frozen install repaired moved dependency links | PASS |
| `pnpm test:voice` | PASS: 23 tests, local mocked transcription edges |
| `pnpm test:tooling` | PASS: 7 tests |
| `node tools/verification/run-pilot.mjs` | PASS, run 20261021094805 |
| API restart persistence (inside runner) | PASS |
| `node tools/verification/pilot-offline-refresh.mjs` | PASS |
| 310-file source fingerprint | PASS |

The first build failed to resolve `expo-asset` from the moved dependency tree.
`CI=true pnpm install --frozen-lockfile` repaired the local links; rerun of the
whole build passed. No backend source change or test weakening was required.

The pilot browser journey proved double-submit creates one booking, literal
map address escaping, assignment, wrong pickup code rejection, pickup custody,
reported location provenance, measured-weight consent, care/QC, unpaid return
rejection, manually recorded payment, wrong return code rejection and delivery.

Paid order `2241636c-66ac-453e-9073-0708635e8779` ended
`DELIVERED / PAID / 36000 minor INR / return COMPLETED`. Held order
`5e04051a-c8e2-4bba-9279-cbc061e6417b` ended
`DELIVERED / UNPAID / 0 / return COMPLETED` after an agreed unprocessed return.
Both states survived API restart. Tracking was closed after delivery.
The runner reported no unexpected JavaScript console errors; expected rejected
requests generated browser network warnings. No independent performance or
full accessibility score is claimed.

The offline refresh regression retained the selected version/status, displayed
Refresh failed and stale/last-known labels during an outage, then recovered.
It also recovered from a malformed orders response.

## Evidence

Ignored local evidence: `.verification/pilot/manifest.json`, `summary.json`,
`pilot-flow.webm`, `trace.zip`, screenshots and restart log.
Functional captures: `.verification/qa-20261021/functional/.qa-evidence/001..003`.
Checkpoints: [pilot journey](../../.verification/qa-20261021/functional/exploration-002.json) and [offline recovery](../../.verification/qa-20261021/functional/exploration-003.json). The evidence materializer returned pass with no open items.
UI browser recording is stored by T3 under its local attachments, not committed.
Evidence contains synthetic demo data and remains local.

## Frontend handoff

Remote branch `fix/customer-ui-handoff-20261021`, commit `4684f72`.
It includes the previously local `dd9b2de` and `252ac32` commits, tab/Home repair,
shared basket connection, service-detail links, nonoverlapping tab layout,
future schedule defaults/validation and stale-demo-session recovery.

Final customer tests 10/10, workspace typecheck and customer Expo export passed.
Interactive browser checks at 390px covered catalog load, no-result search,
quantity/estimate changes, bag summary, basket carry-through, expired schedule
rejection, checkout address load and a server quote INR 222.88 for one blazer.
Standards/Spec review findings were repaired. External Claude was unavailable;
local reviews were used. Native Android/iOS behavior was not verified.

The UI worktree remains `/home/batman/Projects/code/.worktrees/wandary-ui` so a
new UI agent can continue safely. It is now on the handoff branch. Local
`.taste-skill/` screenshots/reports were preserved and not published. The main
checkout and tooling worktree were not changed or moved.

## Remaining concerns

- Customer garment storefront and kg pilot are separate flows on different
  branches; they have not been integrated. Shared namespace/lockfile composition
  remains a coordinator task before merging branches.
- Demo auth, placeholder kg rates, manual payment recording, hardcoded area and
  simulated delivery remain explicitly demo behavior. Pricing Q20 and operating
  configuration still need founder approval. Real accounts, session hardening,
  real provider integration and a physical pilot are not verified.
- Customer UI is a working development handoff, with further visual polish,
  photography, friendly IST editing, garment-name display and persistent cart
  behavior left for the UI agent. A browser reload clears the in-memory basket.
- Latest PR #3 checks were successful (runs 39576639742 and 39576640173).
  The PR aggregate also listed failed jobs from earlier runs; it should not be
  described as having zero historical failures.
- UI branch CI run 39581290262 completed successfully: install, full workspace build, typecheck, Convex check, workspace tests and voice tests passed. Backend deployment was skipped. No PR or deployment was created for this UI handoff.

## Running local previews

Pilot console: http://localhost:5175, API: http://127.0.0.1:4100.
Customer built web preview: http://localhost:8081 (open root and navigate inside
app; the temporary Python static server does not rewrite deep-link requests).
The PostgreSQL container and local preview processes were left running for review.
Do not run destructive acceptance tests against the browser evidence database.
