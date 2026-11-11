# Clean-revision receipts checkpoint, 2026-11-09

Status: clean-revision four-role journey, customer-v2 restore rehearsal and original 1080p30 recording recorded at `e41049b95c801f087343b58db61005d1172a93e6` with an empty worktree. Synthetic evidence only; this checkpoint is not production acceptance, not a deployed/staffed service and not a GitHub CI result. No app source changed between these receipts and the `64943d25` clean batch; the boundary commit only updated docs, tooling scripts and their tests.

## Runs and commands

All runs happened in the canonical worktree with `git status --porcelain` empty before and after:

- Clean-revision batch at `64943d25` (no app source between it and `e41049b`): `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm check`, `pnpm check:convex`, `pnpm contracts:check`, `pnpm test:tooling` (124 tests; includes the three new `tools/cloud/branch-audit` tests), then the workspace suite on a disposable Docker PostgreSQL: API 373, contracts 104, fixtures 237, SDK 165, foundation 55, customer 126, partner 55, ops 87, design tokens 2. Exit 0 for each step. Raw log `/tmp/opencode/laundry-clean-batch-20261109.log`.
- Four-role journey: `VERIFY_WEB_SCOPE=product node tools/cloud/postgres.mjs exec --runtime auto --label product-evidence-20261109 -- pnpm verify:browser`, exit 0. Log `/tmp/opencode/product-journey-20261109.log`.
- Restore rehearsal: `LAUNDRY_PG_RUNTIME=docker LAUNDRY_RESTORE_SOURCE=customer-v2 LAUNDRY_VERIFY_OPS_FACILITY=true LAUNDRY_VERIFY_RIDER=true LAUNDRY_VERIFY_PICKUP=true CI=true pnpm verify:restore`, exit 0. Log `/tmp/opencode/restore-rehearsal-20261109.log`.
- Recording: `VERIFY_WEB_SCOPE=product PATH=/tmp/opencode/xvfb-provision/rootfs/usr/bin:$PATH pnpm verify:recording`, exit 0. Log `/tmp/opencode/hq-recording-20261109b.log`. An earlier attempt without `VERIFY_WEB_SCOPE` ran the legacy demo smoke specs and failed with exit 1 (`/tmp/opencode/hq-recording-20261109.log`); CI sets the env job-wide (`.github/workflows/ci.yml`), and the retry used the same setting instead of changing any script.

## Receipts

Index files with SHA-256 digests for every artifact live under `.verification/checkpoints/e41049b95c801f087343b58db61005d1172a93e6/`: `playwright-product/index.json`, `restore-rehearsal/index.json`, `original-product-recording/index.json`. Key digests:

- Journey (`playwright-product/index.json`): four distinct role recordings from the journey manifest — customer `f380edfb4d617df0c3c8f9594af5c776d0a52235c6bd0cfe74067f11a36b5f86` (10,111,428 B), ops `ee1197a6f4599669884b308fd3cb293539145edc7a6a1f2442005846d5133c2f` (8,700,229 B), rider `beb8aa87914d9a2e9a9dffb1c565bfc089c87b092787e8d733ab331f8a1a1a65` (976,484 B), pickupRider `f6c7fb2ed52a4bbcb1882a051d4fa4a46a9991bed8ff6df1b5b4c2399f0be048` (1,213,839 B). Manifest: `product-manifest.json` (order 1, obligations 1, legs 2, confirmed events in the ledger; pickup bag continuity proven; commercial calls 0). Screenshots retain the earlier archive under `.data/browser-evidence/customer-v2/`.
- Restore (`restore-rehearsal.json`): `testedSha e41049b9...`, `sourceDirty=false`, source journey `customer-v2`, PostgreSQL 17.11 on docker, 91 tables matched between source and target with one delivered order, one obligation, both custody legs, one manual receipt, zero gateway receipts, one private review, zero publication consents, one support case with two messages. Archive dump `.data/backups/fixture-restore-cc5f13d5-db2e-4c94-bf3d-7857510b78ce.dump`, sha256 `938f6c513fa98b50df37d779ade30901ffd483f503e2cc464e94fb4a56599665` (271,975 B).
- Recording (`original-product-recording/index.json`): `browser-original-1080p30.mp4` sha256 `327b00ecfa6ae7750b1c0daf604892ffb540c3b2f851ef98c1b9d01bfeca48f1` (5,923,102 B), 1920x1080 h264, 30/1 fps, 122.17 s. All four sampled checkpoint frames (booking 84.6 s, return-dispatch 103.4 s, return-proof 108.1 s, delivered 111.6 s) were opened and inspected: each shows the named role's real UI (customer order ledger with the INR 60 to 100 adjustment consent, ops dispatch and payment records with manual UPI receipt, rider return custody with attempt count 1, both riders' proof surfaces before delivery). Measured canvas luma is in the same healthy band as earlier accepted runs, so the previous dark-frame artifact is not present.

## Xvfb provisioning for the recording

The recording needs `xvfb-run`/`Xvfb`, which were missing after the earlier `/tmp` wipe. Provisioned under `/tmp/opencode` only, no system install:

- Package `xorg-server-xvfb-21.1.25-2-x86_64.pkg.tar.zst` fetched from the host's configured Arch mirror `https://archlinux.cachyos.org/repo/extra/os/x86_64/`.
- SHA-256 `52c6d0394109b0bdfd0e4d00dd8d89d7e38bfe7576d96145179f216480eb7564` matched the repository database (`extra.db`, same key under `%SHA256SUM%`).
- The detached repository signature verified as `Good signature from Andreas Radke <andyrtr@archlinux.org>` (keyid `94657AB20F2A092B`) with `gpg --homedir /tmp/opencode/gnupg-verify` after copying the host's public pacman keyring there. Only public keys were copied; no system state changed.
- Unpacked to `/tmp/opencode/xvfb-provision/rootfs/usr/bin` and prepended to `PATH` for the run only. Host `xauth` and `mcookie` existed already.

## What these receipts close and what stays open

- `staff-support-console.md` recorded a dirty-tree integration batch whose follow-up (clean-revision four-role journey plus private recording/restore archive) is now delivered; its checkpoint doc points here.
- `customer-billing-progress.md` required a committed-revision browser checkpoint for the read-only ledger UI changes; the `e41049b` journey manifest re-proves `ownedBillingRecordsVisible`, `manualReceiptNotGatewayCapture` and `failedReadNotZeroBalance` on a clean tree, so no new full backup/restore was run for it.
- Still open, same as before: real config approval rates/capacity/policies, actual partner/provider credentials, real staff MFA and customer identity, native device/APK/SQLCipher evidence, live providers of any kind, and physical fulfillment. Nothing here reopens ordering or presents the preview configs as launch data.
- `pnpm agents:local-status` still reports exposed local branches (unpushed `main`, `cloud/c01-contract-freeze` ahead by one, three branches without upstream). Integrating or publishing them remains a coordinator step.
