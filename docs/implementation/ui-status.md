# UI status handoff (second orchestrator, 11 Oct 2026)

Scope owned: `apps/customer/**`, `apps/partner/**`, `apps/ops/**` and this file.
No commits made. No cloud accounts touched. Final verification left to main.

## What was done

Partner app was delegated through agy (foreground, model
gemini-3.8-flash-medium, brief `/tmp/partner-brief.md`, conversation
afe16e87-77fc-4030-825a-490ae565e311). The worker ended with PARTNER-LANE-DONE
and stayed inside `apps/partner/**`. I read its result, confirmed every new
file sits under `apps/partner/`, then made two small follow-ups after it
stopped: env-configurable API base URL and DEMO token persistence, matching the
customer and ops treatment below.

Customer app is now wired to the real SDK instead of canned data. Checkout
uses `listAddresses`/`createAddress` with an on-screen address picker and
creation form, replacing the previous hardcoded demo address ID. Order detail
passes the real `paymentId` from checkout into a labeled DEMO capture button
(`captureDemoPayment`), gates the review form to `DELIVERED` orders, and keeps
the honest pending label. Help gained a conversational booking section built on
`postConversationMessage`/`confirmDraft`: it shows the assistant reply, missing
fields, quoted total when present, and binds confirmation to the draft revision
and quote ID. API base URL resolves from `EXPO_PUBLIC_API_URL` with the
localhost default, and the demo token persists in `localStorage` so a web
refresh keeps the session. This persistence is DEMO-only and labeled as such.

Ops console uses the same treatment: base URL from `VITE_API_URL`, demo
operator token persisted across refresh. Intake now calls
`recordIntake` with the SDK shape (`measuredLines` built from order lines plus
`bagIds` passed as an option) instead of the previous ad-hoc payload. The care
target selector is typed against the SDK `CareTarget` union, and the vitest
config now includes `.tsx` test files so the ops journey suite actually runs.

App scripts are complete for all three: customer and partner gained a `build`
script (`expo export --platform web`) alongside web, check, and test. Ops
already had dev, build, preview, test, and check.

## Readiness, measured honestly

- `pnpm --filter @wandary/customer check` passes, `test` passes 8/8.
- `pnpm --filter @wandary/ops check` passes, `test` passes 6/6.
- `pnpm --filter @wandary/partner check` passes, `test` passes 6/6.
- These are compile plus pure-helper unit tests only. Nothing here proves
  end-to-end behavior against a live backend.

## Blockers and gaps for main

- The backend is not implemented. `apps/api/src` contains only empty
  `controllers`, `filters`, `guards`, and `services` directories, with no
  `main.ts`. Every screen that calls the SDK will fail against
  `http://localhost:4100/v1` until the API exists. All error and retry states
  are in place, but no live order has flowed through these apps.
- Partner typecheck caveat: the partner lane ships
  `apps/partner/src/declarations.d.ts`, which stubs `react`, `react-native`,
  and `expo-router` as `any`. Its `tsc` pass therefore says little about the
  screens; only the pure helpers (`jobs`, `handover`, `offline`) are genuinely
  covered by the 6 passing tests. Main should treat partner screens as
  unreviewed until a real typecheck or device run happens.
- Customer `App.tsx` needed a narrow `require.context` ambient
  (`src/require-context.d.ts`) because `@types/node` is not installed for that
  package. Root install is the coordinator's call; adding the types properly
  would let that shim go away.
- Fixed along the way, flagging so main does not re-diagnose: basket state
  lived in `services/[id].tsx` while checkout imported it from `basket.tsx`
  (now re-exported), ops intake sent the wrong payload shape, and ops vitest
  never matched its own `.tsx` test file.
- Previews: customer 8081, partner 8082, ops 5173. Native API URL is env
  configurable as required; web previews still default to localhost.
- Missing from a full MVP claim: browser inspection of all three apps, duplicate
  payment and webhook replay runs, and Postgres-backed acceptance. None of that
  is possible until the backend lands, which is why final verification stays
  with main.

## Verification entry, 11 Oct 2026

I ran every app script as defined in the package files and checked the web
exports, service images, and env usage. Only free local tooling. No paid APIs.
No backend or module code touched.

Builds, checks, and tests. All six commands passed.

- `pnpm --filter @wandary/customer check` (tsc --noEmit). Exit 0, no errors.
- `pnpm --filter @wandary/partner check` (tsc --noEmit). Exit 0, no errors.
- `pnpm --filter @wandary/ops check` (tsc --noEmit). Exit 0, no errors.
- `pnpm --filter @wandary/customer test` (vitest run). 8 passed in
  test/customer-journey.test.ts. Duration about 1.6s.
- `pnpm --filter @wandary/partner test` (vitest run). 6 passed in
  test/partner-journey.test.tsx. Duration about 1.6s.
- `pnpm --filter @wandary/ops test` (vitest run). 6 passed in
  test/ops-journey.test.tsx. Duration about 1.6s.
- `pnpm --filter @wandary/ops build` (tsc plus vite build). Exit 0.
  43 modules transformed, built in 1.47s.
- `pnpm --filter @wandary/customer build` (expo export --platform web).
  Exit 0. Metro bundled 652 modules in 833ms.
- `pnpm --filter @wandary/partner build` (expo export --platform web).
  Exit 0. Metro bundled 649 modules in 808ms.

Web exports. All three exist with index.html and a JS bundle.

- apps/customer/dist has index.html (1190 bytes), metadata.json, assets/,
  and _expo/static/js/web/entry-31be1815409f6f8b3451e683d8fa37fd.js (about 1.03 MB).
- apps/partner/dist has index.html (1189 bytes), metadata.json, assets/,
  and _expo/static/js/web/entry-5d06c2eef5becdd4649f62524fcd9785.js (about 1.04 MB).
- apps/ops/dist has index.html (403 bytes) and assets/ with
  index-DmD-93Zq.js (220 kB) and index-DTk9JQHB.css (1.05 kB).

Catalog images. The demo seed in modules/shared/src/db.ts references four
service files through demoImageUrl, served at /assets/services/ by
apps/api/src/main.ts. Every referenced file exists on disk with a PNG sibling.

- wash-and-iron.svg (1778 bytes) and wash-and-iron.png (8236 bytes).
- dry-clean.svg (1744 bytes) and dry-clean.png (13622 bytes).
- wash-and-fold.svg (1927 bytes) and wash-and-fold.png (12163 bytes).
- steam-press.svg (1489 bytes) and steam-press.png (8957 bytes).
- wandary-mark.svg (815 bytes) and wandary-mark.png (8025 bytes).
  The mark is brand art, not referenced by seed data, but both forms exist.

No code references a missing image file. The customer catalog
(apps/customer/app/index.tsx lines 91 to 96) swaps a .svg URL for its .png
sibling on native, so every server URL it can receive has a local PNG match.
The ops guard only checks that imageUrl and imageLicense are set. It never
points at a file path. I did not change any mapping. That stays with backend.

Env usage. Both Expo apps use the static form Metro can inline.

- apps/customer/src/api.ts line 6 reads process.env.EXPO_PUBLIC_API_URL
  with a localhost default in getApiBaseUrl.
- apps/partner/src/api.ts line 9 does the same.
- No globalThis lookups anywhere under apps/customer or apps/partner.
  Grep for globalThis in both trees returned zero matches.

Still open after this pass. The partner declarations.d.ts stub noted above
still stands, so the partner typecheck pass means less than the other two.
Browser inspection of the three apps is still undone. Live behavior against a
backend is still unproven. Nothing here changes the earlier handoff.
