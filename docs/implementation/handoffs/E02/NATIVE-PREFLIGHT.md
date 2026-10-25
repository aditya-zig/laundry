# E02 NATIVE-PREFLIGHT — Android whole-product build/readiness audit

State: `BLOCKED_ENV` (audit-only, no native build attempted). Scope: **read-only** review of the customer and partner Expo apps plus scripts/CI. No app config was edited; no dependency was installed; no Android SDK/JDK/emulator was installed or started; no APK/AAB was produced; no store upload, signing, billing or account creation of any kind.

## Provenance

- Source/ref: candidate worktree `HEAD = 1da0e8501063f4174b483ff5df11a393924d7a38`; inherited baseline `16eddf74e29945932a8042d2aae88c944ea6c9f1` (coordinator-supplied; not independently re-cloned in this step).
- Contract digest verification **run** (not assumed): `packages/contracts/openapi-v2.json` SHA-256 = `ff9d76fcc17d4c7d176afb74047fca822e311ea37f79b7cd7f1743501f52d0ef` — **matches** the dispatched candidate digest. `packages/contracts/openapi.yaml` SHA-256 = `b518a7135cdabcaa0d3b329220c0b3fa78b094a62df6eaf3ea0421416801d336` (same-tree revision, recorded for completeness).
- Working-tree note: `opencode.json` is modified in the shared checkout. It is not E02-owned, was not edited by this task, and is not evaluated here; reported verbatim to the coordinator as an existing tree delta outside this handoff.
- Apps reviewed: `apps/customer` (`@laundry/customer`) and `apps/partner` (`@laundry/partner`), both Expo 52.0.0 / expo-router 4.0.22 / RN 0.76.5 with `expo-router/entry` main.

## What was actually run on this envelope (argv → exit)

| # | Command argv | Exit | Result |
|---|---|---|---|
| 1 | `pnpm exec node -e` SHA-256 over `packages/contracts/openapi-v2.json` / `openapi.yaml` (worktree: repo root) | 0 | Digest `ff9d76fc…` confirmed — evidence binding anchor |
| 2 | `pnpm --filter @laundry/customer check` (`tsc --noEmit -p tsconfig.json`) | 0 | Clean |
| 3 | `pnpm --filter @laundry/partner check` (`tsc --noEmit -p tsconfig.json`) | 0 | Clean |
| 4 | `pnpm --filter @laundry/customer test` (`vitest run`, 4 files / 23 tests: customer-journey, tracking, schedule-input, api.regression-1) | 0 | 23 passed / 0 failed |
| 5 | `pnpm --filter @laundry/partner test` (`vitest run`, 1 file / 6 tests: partner-journey) | 0 | 6 passed / 0 failed |
| 6 | `pnpm exec expo --version` (worktree `apps/customer`) | 0 | expo CLI 0.20.4 available from the lockfile-managed tree; no install performed |
| 7 | `gradle`/`sdkmanager`/`emulator`/`adb` native-build checks | — | **Blocked.** No Android SDK, JDK 17 or emulator is available in this verification environment's allowlisted toolset; installing a full Android SDK/JDK stack is out of E02 authorization and would require a coordinator amendment. The runner's other system paths were NOT probed with non-allowlisted commands, so this is stated as "blocked within the authorized toolset", not as a system-wide absence claim |

No test suite touching proposal tables was run; this audit owns no API schema work and therefore did not require the mandatory self-contained proposal-table setup rule.

## Native whole-product reachability findings

All 4 workflows (`ci.yml`, `agent-verification.yml`, `cloud-workers.yml`, `dependency-security.yml`) are Node/pnpm/browser-only. There is **no Android build job, no JDK/SDK/emulator step, no gradle invocation and no artifact upload path for either mobile app** anywhere under `.github/workflows/`. Coverage of scenario `E02-01` (cloud runner proves SDK/JDK/emulator acceleration) is therefore missing at the CI layer and would need a new, dedicated coordinator-authored workflow (see exact reproducible commands below).

## Exact missing prerequisites (blocking native build), by area

1. **SDK/toolchain** — no Android SDK (platform/build-tools/emulator system image) or JDK 17 (the native-code minimum at Expo SDK 52 / RN 0.76) is available within this environment's authorized toolset, and no authorized probe of unrestricted runner paths ran; do not treat this as a tested statement about every system path. The repo itself also has no version-pinned Android/platform/`gradle-wrapper`-JDK manifest tuned for a cloud compile. Before any build can start, the runner needs a coordinator-published, immutable JDK 17 + Android SDK environment (platform/build-tools pinned), with `ANDROID_HOME`/`JAVA_HOME` exported per run.
2. **eas.json** — no `eas.json` (or its equivalent self-managed `expo prebuild` profile) exists in either app; there is no declared, reproducible build profile set. Native builds are currently unconfigured.
3. **Signing key** — no release signing keystore or certificate exists in the workspace, and no vault/secret binding in any workflow. Building is only achievable via `./gradlew assembleDebug` with the debug keystore; a release build (and any store upload) is **not** attempted, in scope or out.
4. **Expo plugins / config plugin surface** — `app.json` for both apps contains only the `expo-router` plugin. No `expo-camera`, `expo-image`, `expo-location`, `expo-notifications`, `expo-secure-store` or other community plugin is declared. The native build therefore has no camera/location/notification capability compiled in, even though partner UX logic (`apps/partner/src/handover.ts:68`) and job detail screens reference camera-verification modes.
5. **Camera / location / notification paths** — nothing in `apps/partner/app/jobs/[id].tsx` or `apps/customer/app/(tabs)/index.tsx` invokes a real `expo-camera`/`expo-location`/`expo-notifications` permission request; the camera-denial "permission" is a **hardcoded demo toggle** (`setCameraPermissionGranted(!cameraPermissionGranted)`, line 373–378) and location needs `navigation handoff` only as a text label (`apps/partner/src/jobs.ts:106`). Until real permission request/response flow (with denial/fallback branches) is introduced via plugins, scenarios `E02-03` can only be exercised as UI mockups, not as a native runtime acceptance test.
6. **Secure session/offline persistence** — both apps persist the session token via `localStorage` in `apps/customer/src/api.ts` (`TOKEN_KEY = laundry.demo.customer.token`) and `apps/partner/src/api.ts` (`TOKEN_KEY = laundry.demo.partner.token`) plus an in-memory `API_BASE` fall-back to `http://localhost:4100/v1`. Because this is demo/HTTP transport with no `expo-secure-store` (or `expo-secure-store/expo-local-authentication` equivalent) in the dependency set, native sessions are **not** archived in a secure keystore, and any network-error/offline recovery (`ensureDemoSession` retry only on `UNAUTHENTICATED`) is demo-simulator behavior, not a production-ready recovery path. Native session persistence and secure token storage are still missing prerequisites for `E02-03`, `E02-04` (offline retention after process death).
7. **`packages/api-client` transport** — both apps consume `@laundry/api-client` / `@laundry/contracts` via `"workspace:*"`, so a candidate-time rebuild reads the lockfile-managed tree and cannot silently drift.
8. **Companion check** — `apps/partner/app.json` and `apps/customer/app.json` both point `apiBaseUrl` at `http://localhost:4100/v1` (demo note included in-tree, matching the current dev-preview runbooks and `docs/implementation/production-application/CONTRACTS-V2.md`). No app currently carries the `/v2` base URL and no environment-specific production gate exists. Demo capture, demo login, the messaging outbox and simulated delivery remain explicitly labeled dev-preview behavior (`demoNote` fields) and are **not** production integrations, per this dispatch's constraints.

## Reproducible free commands (verify ability without a device or paid service)

The following sequence is self-serviceable on a free cloud runner with no device, no paid device farm, no store interaction. The audit did **not** execute any line below beyond the parenthesized preflight:

```bash
# Preflight (this envelope):
pnpm --filter @laundry/customer check && pnpm --filter @laundry/partner check
pnpm --filter @laundry/customer test  && pnpm --filter @laundry/partner test

# Native build pipeline candidate (requires the missing prerequisites above):
pnpm install --frozen-lockfile
pnpm --filter @laundry/customer exec expo prebuild -p android --no-install
pnpm --filter @laundry/customer exec ./gradlew assembleDebug   # requires JDK17 + Android SDK
pnpm --filter @laundry/partner  exec expo prebuild -p android --no-install
pnpm --filter @laundry/partner  exec ./gradlew assembleDebug

# Emulator-first free verification path (same runner; no paid farm):
export ANDROID_SDK_ROOT=…   # + $PATH containing platform-tools
%SDK%/cmdline-tools/latest/bin/avdmanager create avd -n laundry-customer \
  -k "system-images;android-34;google_apis;x86_64" -d pixel_5
%SDK%/emulator/emulator -avd laundry-customer -no-window -gpu swiftshader_indirect \
  -no-audio -no-boot-anim &
adb wait-for-device && adb install -r apps/customer/android/app/build/outputs/apk/debug/app-debug.apk
```

These are only candidates with their prerequisites listed; running them here would be out-of-scope work, both because the SDK/JDK are absent and because neither emulator nor a device session was started, per the boundary of an audit-only E02 native preflight.

## What requires a coordinator action before any E02 build claim

- A reproducible Android SDK/JDK setup (a published container image or a committed, version-pinned install manifest under coordinator-owned CI/infrastructure) is the concrete missing environment input. Without it, no `assembleDebug`, no emulator screen that claims "native run under Expo 52 with `android/` prebuild", and no `e2e mobile evidence` can be honestly produced.
- `expo-camera`, `expo-location`, `expo-notifications`, `expo-secure-store`, `expo-sqlite`/`@react-native-async-storage/async-storage` (or coordinator-approved equivalents) are missing dependencies across both apps' `package.json`. Every one of these is a root-manifest/lockfile change, which is **coordinator-owned per CLOUD-AGENTS.md**, so E02 has never installed them silently.
- Camera `MANUAL_COUNT` mode exists as graceful logic (`apps/partner/src/handover.ts`) but has no real native camera pathway behind it, so the "denial offers manual count" behavior in `apps/partner/test/partner-journey.test.tsx:190` remains a logic unit test rather than a native permission-grant acceptance run.
- Partner `/v2` base URL, and customer app store-review policy strings, remain future work for the coordinator on a separate production-activation gate; the demo-only labels currently shipped in `app.json` (`extra.demoNote`) are accurate statements of the current state, not evidence of production readiness.

## What this handoff does NOT claim

- No Android app was compiled on this candidate tree; no APK/AAB artifact or `evidence.json` (native video/screenshot) is attached.
- No emulator boot or device state was captured; `E02-02`/`E02-03`/`E02-04`/`E02-05` scenarios have not been natively exercised on this tree.
- No store upload, signing, purchase, billing, account or paid device-farm use of any kind was performed.
- No claim is made that any app's UI behavior observed through unit tests equals native runtime acceptance, and none of the allowed `BLOCKED_*` states other than `BLOCKED_ENV` is asserted.
- No unpatched contract drift (verified beat-for-beat via the digest above), no ownership amend, no dependency install, no CI change, and no edits outside this handoff were made during this audit.

## Honest current tree state (as measured by this audit)

- `git status`-equivalent, via the shared checkout: **only `opencode.json` is modified**; no E02-owned file had a pre-existing baseline deviation from the published candidate `HEAD` outside the handoff directory, and this audit added exactly one file: `docs/implementation/handoffs/E02/NATIVE-PREFLIGHT.md`.
