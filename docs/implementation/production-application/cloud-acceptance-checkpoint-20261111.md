# 11 November 2026 — local cloud-acceptance repair checkpoint

Scope: GitHub [#8](https://github.com/aditya-zig/laundry/issues/8), not production activation or complete #26/#27/#28 certification. The integration retains the prior canonical backend/frontend branch history. User-requested push/merge follows passing exact-head cloud checks; there is no automatic product deployment.

## Clean application revision

`4c48e66608e80f0df5756740685bee9783ef2816` was clean during recording. Observed exits were zero for frozen install, strict dependency security, real production-image/runtime acceptance, workspace check/build/contracts, disposable-PostgreSQL tests, tooling, actual four-role browser, product-source restore, Convex compatibility, voice tests and original recording.

- Workspace: **1,245 tests across 89 files** passed against real isolated PostgreSQL.
- Tooling: **125 passed, zero skipped**. Generated-schema compatibility: seven passed. Voice: 23 passed.
- Current browser: customer booking → pickup → facility adjustment/intake/care/QC/rework → return → manual collection → delivered private review/support. Lost replies preserve the original mutation key/body; external providers are explicitly synthetic.
- Tracking: real event history, separate delivery legs/custody, missing versus measured zero, local-time windows, isolated read errors and marked retained snapshots. Successful refresh also reloads billing/custody; the actual settled-obligation assertion remains unchanged.
- Original H.264 recording: **1920×1080, 30 fps, 141.166667 seconds, 6,685,032 bytes**, SHA-256 `4a0132a4967163372b3de0589991c75869cbe272cb02770308c0a3d2729ce71a`; four automated checkpoint/content samples passed. Image reading is unavailable in this session, so this is not an independent aesthetic review.
- A real temporary two-task PostgreSQL probe proved distinct ports/workdirs and independent rows, owner removal preserving a live peer, and complete owned-workdir cleanup.

Local manifests and failed logs remain outside git under `.verification/checkpoints/4c48e66608e80f0df5756740685bee9783ef2816/` and `.data/verification/ci-repair-20261111/`. The original recording is outside git. These receipts certify that revision, not a later source change.

## Reproduced failures and complete repairs

1. Frozen container install omitted `.pnpmfile.cjs`. The real context/image now includes and checks it; frozen installation remains mandatory.
2. New dependency advisories exceeded the old forge waiver. Published fixes replace the obsolete exception; RSA/decoder regressions and all installed consumer checks remain, with no moderate-or-higher advisory waiver.
3. Runtime fixture grants omitted reviewed `laundry_auth_*` tables. Retained startup diagnostics proved the failure. Required identity-family grants now match the actual runtime guard, without owner/schema privileges.
4. Preserving the customer tracking screen across refresh retained an old open billing obligation after settlement. Read-only projections now reload after successful order reads; failed reads retain the marked snapshot. Existing browser assertions were retained.

The first local restore invocation mixed product browser scope with the legacy restore default and failed. The explicit `LAUNDRY_RESTORE_SOURCE=customer-v2` command passed. Initial local recording failed because Xvfb was absent; a task-local distribution package was signature-verified and extracted without changing system packages, then the unchanged recording command passed.

## Permanent peer proof and publication boundary

At test-first commit `b008273`, CI configuration acceptance failed with `pnpm verify:isolation must not be dropped`. The follow-up adds the actual `pnpm verify:isolation` command and a nonconditional CI step, producing `.verification/p01-isolation.json` from two real task databases. It does not replace existing lifecycle, API, browser, restore or recording checks.

[P01 handoff](../handoffs/P01/HANDOFF.md) and its `evidence.json` publish commands, environment, providers, local receipts and the final cloud/artifact requirements. At this document's checkpoint, **fresh cloud verification, original artifact upload/download, exact-head digest/media readback and merge are still pending**. Final issue/PR evidence must identify the successfully tested current head before #8 is closed. Native preflight remains static, not Android proof. Direct full-diff review ran; no independent model review or agent pipeline ran.

Neon/Cloudflare hosting is unchanged. Live ordering, commercial providers, physical-pilot approval and unresolved business settings remain disabled/unverified. No paid provider/model, local child agent, production database or live payment was used.
