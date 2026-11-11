# P01 — reproducible cloud PostgreSQL/browser/evidence environment

Issue: [#8](https://github.com/aditya-zig/laundry/issues/8). Worker: direct coordinator session; no child agents. Integration branch: `fix/p01-cloud-ci-20261111` (coordinator branch-name amendment; no automatic cloud-worker dispatch). Existing canonical history is retained.

## Evidence boundary

This is the pre-publication handoff, not a claim that a future cloud job passed. Clean application revision `4c48e66608e80f0df5756740685bee9783ef2816` passed the local lanes below. The handoff/peer-isolation follow-up is verified on its own clean revision. **Final P01 acceptance is the exact PR-head GitHub run, downloaded original artifacts and SHA/digest/media checks linked in issue #8.** A changed application revision needs fresh impacted evidence; old receipts do not certify it.

No production deployment, live ordering, real customer/provider operation or paid model call was performed. Existing Neon/Cloudflare hosting remains unchanged. Native Android, physical custody, real payment and launch/business gates remain outside P01 and open in #26/#27/#28 as applicable.

## Repairs and regression proof

- Frozen image install reproduced `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`: `.pnpmfile.cjs` was missing from the actual Docker build context. The hook is now explicitly copied and asserted present; frozen installation is not relaxed.
- The security gate rejected newly published advisories. Published `node-forge@1.4.3`, `decode-uri-component@0.5.1`, `glob@14.0.4`/`minimatch@11.0.8` replace superseded exceptions. Legacy glob 7 and the reviewed Metro/query-string patches remain. All customer/partner forge consumer chains and seven RSA cases are checked; malformed decoder runs remain bounded.
- Actual compiled image boot reported `Runtime identity table grants are incomplete`. Private startup diagnostics now survive cleanup. The isolated test role receives only the required `identity_*`/`laundry_auth_*` table grants; owner/schema restrictions remain.
- The unchanged real-settlement browser assertion failed on `Settled obligation`: preserving the tracking page across refresh left an old billing projection mounted. Successful reads now reload billing/custody projections, while failed reads retain a marked snapshot. The assertion was not weakened.
- P01 peer acceptance creates two actual PostgreSQL tasks with distinct ports/workdirs and different rows. Removing one must leave its peer running with its original row; both owned workdirs must then disappear. The SHA-bound receipt is `.verification/p01-isolation.json`.

## Fresh cloud environment

Authoritative setup: `.github/workflows/ci.yml` on a fresh GitHub-hosted Ubuntu runner: Node `24.22.0`, pnpm `10.33.2`, Python `3.12`, PostgreSQL 17, Chromium, ffmpeg/ffprobe and Xvfb. This runner supplies a host Docker daemon; it does not assume Docker nesting inside a worker container. The reusable task lifecycle also supports explicit local PostgreSQL binaries; lack of a required runtime is a failure, not a fake database fallback. Network dependencies are the configured package registries, distro packages, Playwright distribution and GitHub artifact service; no credentials belong in git.

The workstation additionally used a task-local Xvfb package matching its installed CachyOS server libraries, verified against the installed distribution keyring. No system package was installed. This workaround is not required by the Ubuntu workflow, which installs Xvfb explicitly.

## Exact commands

Run from a clean checkout. The workflow supplies a **disposable** `laundry_verify_*` database URL; never substitute a production database. Browser/restore/recording commands create additional owned task databases and override child connection settings.

```sh
export VERIFY_WEB_SCOPE=product
export LAUNDRY_VERIFY_OPS_FACILITY=true
export LAUNDRY_VERIFY_RIDER=true
export LAUNDRY_VERIFY_PICKUP=true
export LAUNDRY_RESTORE_SOURCE=customer-v2
export VERIFY_HEAD_SHA="$(git rev-parse HEAD)"
pnpm install --frozen-lockfile
pnpm build
pnpm check
pnpm check:convex
pnpm contracts:check
pnpm test:tooling
pnpm test:isolated          # local task-owned workspace database
pnpm test:voice
pnpm release:security
pnpm verify:container
pnpm verify:isolation
pnpm exec playwright install chromium
pnpm verify:browser
pnpm verify:restore
pnpm verify:recording
```

CI runs `pnpm test` against its job-local PostgreSQL service rather than requiring nested Docker for that lane. Local `pnpm test:isolated` uses the task lifecycle. Linux recording requires Xvfb, ffmpeg and ffprobe. Do not mix product scope with the legacy restore source; the earlier local mixed-scope invocation failed and is not counted as passing.

## Local results and final cloud acceptance

At the application revision above: frozen install, security, production image/runtime, typecheck, build, contracts, **1,245 workspace tests across 89 files**, **125 tooling tests**, actual four-role browser fulfillment, product-source backup/restore, Convex compatibility and **23 voice tests** passed. Generated-schema checks include seven passing compatibility cases. Recording and the follow-up isolation command have separate current clean-revision receipts; use the final issue record rather than assuming a pending run passed.

- `P01-01`: require the fresh cloud frozen install, actual PostgreSQL and compiled runtime job to pass.
- `P01-02`: require migrations/API/actual SDK browser actions and process exits; synthetic providers are explicitly bounded to external ports.
- `P01-03`: require cloud upload, authenticated download of the original, matching SHA-256/bytes, and ffprobe/recording-manifest validation. Artifact URLs and digests are published in the final issue evidence; repository video files are not substitutes.
- `P01-04`: require `pnpm verify:isolation` and its actual peer-survival/cleanup receipt on the candidate SHA, alongside lifecycle regression tests.

Contract target: `laundry-wire-v2.0.0`; executable contract/OpenAPI/SDK checks pass. No new C01 dispatch-freeze digest or D01 design freeze is invented. No schema proposal, production migration application or new service registration is requested by this CI repair. Retained backend/frontend integration is described in the PR, not hidden as a small infrastructure-only change.

Screenshots, original media and private raw logs stay outside git. Browser assertions check accessible states and mobile/desktop overflow; image reading is unavailable in this session, so no independent visual sign-off is claimed. Native preflight is static preparation, not a device test. Direct integration review ran; independent/external model review and the optional agent pipeline did not run.
