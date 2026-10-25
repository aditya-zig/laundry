# EOD backend integration checkpoint

Baseline: isolated cloud snapshot `1da0e8501063f4174b483ff5df11a393924d7a38`.
This is coordinator integration, not production readiness or completed app/native
acceptance. The original production-direct worktree and its recovered changes
are preserved; this batch is in a separate worktree/branch.

## Actual cloud work

Workflow 40193293042 ran nine isolated free-model workers on GitHub-hosted
runners. Receipt source SHA and patch digests were verified before applying B05,
B06 and B08 changes. These are untrusted inputs until reviewed and re-tested.

- B05 reproduced four regressions: manual/refund retry after result-cache purge,
  duplicate manual external references, and late pending webhooks. The agent
  supplied failing tests and a schema amendment but hit its 45-step limit before
  implementation. Coordinator implemented the fixes, added serialization of
  manual transaction references, cross-money-command key conflict checks, and
  locked payment attempts during webhook state changes. One agent-authored
  reservation test had incorrect arithmetic (6000 - 2000 - 2000 leaves 2000,
  not zero); its rejection case now correctly requests 2001.
- B06 reproduced six inherited failures and repaired the handover SQL bind count,
  invalid tracking identifiers and custody-code expiry test setup. Coordinator
  re-tested and made milestone GUIDs stable across reads, rather than fresh
  random identifiers on every refresh. Wrong-code lockout and one-live-leg
  regressions are retained.
- B08 added cross-scope and concurrency regressions; coordinator retained them.
- C01, B09, B10 and F00 returned useful inspection findings but exhausted the
  step allowance without completing their assigned deliverables. A successful
  process exit is **not** task completion. C01 freeze remains blocked.
- D01 failed ownership after its taste draw generated `.taste-skill/app/direction.json`
  outside the allowlist. Its patch was not integrated. The design is not built
  or verified. E02 returned a scoped native preflight document and no native
  acceptance. Its report must not be read as a device/emulator test.

## Coordinator fixes and composition

B07 was not relaunched. Nine new PostgreSQL regressions actually failed before
repair: explicitly supplied fake storage in production; unassigned rider upload;
finalize replay after deletion; stale facility access; expired URL replay; voice
retention of 90 days; unbounded retention/sweep inputs (including a real timeout);
and a signed URL outliving object retention. All 20 media tests now pass.
Production requires explicitly LIVE storage, voice defaults to at most 24 hours,
resource denials hide existence, replay reauthorizes current scopes, and signed
URLs cannot outlive retention. Storage is still a fake in tests, not a configured
production integration. Incident-only ownership, content scanning and moving all
storage I/O outside transactions remain unresolved B07 integration work.

Canonical additive migrations 014–018 integrate the reviewed billing, logistics,
media, support/reviews and jobs proposals after 013. B09 remains a proposal: no
conversation business adapter or acceptance suite was invented.

`ProductModule` provides one composition boundary for seven feature families;
missing integrations return their unavailable envelopes rather than invented
success. The real app composes billing, logistics/tracking, support, reviews and
job-control services against the same identity/database boundary. Media and
conversations remain unavailable until their required real ports are configured.
The billing runtime does not choose its fake refund provider; missing refund
transport explicitly refuses execution. Logistics assignment refuses a missing
custody-code notifier rather than issuing a code nobody can receive.

Booking now uses its own transaction for the order, capacity reservation,
billing obligation, pickup leg, command result, audit and `order.confirmed.v2`
outbox event. Identical concurrent SDK requests produce one of each. A peer
failure rolls back order, peer rows, quote consumption and reservation conversion.
The worker outage test consumes the event produced by real booking rather than
inserting a test-only replacement. Pending/failure still cannot turn into an
invented payment or accepted custody event.

The payment webhook refuses missing untouched raw bytes. Re-serializing parsed
JSON is no longer an authentication fallback.

## Direct Standards and Spec review

Coordinator review verified source/patch ownership, durable money uniqueness,
redacted errors, integer amounts, separate states, expiry/replay authorization,
additive migrations and transaction participation. This is not an independent
review or a no-mistakes completion claim.

Remaining critical findings: staff MFA is not enforced at session issuance;
worker registry/peer maintenance and lease fencing need final integration;
conversation ordering has no real transaction-participating adapter; apps still
use legacy v1 sessions/flows; return-ready amount synchronization and return-leg
orchestration need whole-product acceptance. A composed route is not proof that
its UI, provider or physical operation is ready.

## Observed local verification

On the integration working tree, Node 24.22.0:

- `pnpm check`: exit 0.
- `pnpm build`: exit 0 (all packages/apps, compiled API/worker).
- Task-only PostgreSQL `pnpm test`: exit 0, 817 Vitest tests plus 11 gateway Node
  tests; API has 295 tests. External providers are synthetic fixtures.
- Earlier focused media red run: exit 1, 9 failures; green: 20/20.
- Earlier focused money/custody/media run: 51/51; five-module run: 72/72.
- Initial integration checks exposed two test-fixture errors and were preserved
  as failures. An initial workspace run also failed because the SDK build had
  not yet been performed in the new checkout; the final full build preceded
  the passing workspace run. No failing exit was hidden.

No current-SHA browser, native, live-provider, backup/container or cloud passing
receipt is inferred from these working-tree checks. The first snapshot's Laundry
checks 40193293043 and Agent verification 40193293110 actually failed on the
inherited B06 defects; they remain failures. Workflow 40193293042 remains failed
because D01 violated ownership. The remaining node-forge audit is not waived.

Production ordering/readiness remain disabled. Rates, boundaries, care/refund
terms, provider configuration/authority, device and physical-pilot evidence are
not supplied by an EOD deadline.
