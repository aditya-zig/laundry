# Navigation crash fix

## Symptom

The deployed customer web bundle blanked when tapping a service card. The console showed `TypeError: Cannot read properties of undefined (reading 'config')` in expo-router's `getPathFromState`, under `NativeStackView`. The crash reproduced on the remote 4.0.0 build.

## Fix Main verified

Main bumped both apps to one consistent SDK 52 set:

- expo-router 4.0.0 to 4.0.22
- expo-constants 17.0.8, expo-linking 7.0.5
- react-native-screens 4.4.0, react-native-safe-area-context 4.12.0
- @expo/metro-runtime 4.0.1 (already present)

Main then built the Metro bundle, served localhost:8081, signed in, and tapped a service card. The app navigated to `/services/...` correctly, with inputs and Add to basket working, and zero console errors. I did no browser testing myself. Main owns that verification.

## Root cause

The old bundle paired expo-router 4.0.0 with floating transitive copies of React Navigation, screens, and safe-area-context. Neither app pins `@react-navigation/*` directly, so those copies resolved implicitly through expo-router's peer tree. When the navigator that built the state and the `getPathFromState` code that read it came from mismatched copies, route lookups missed and the read of `.config` hit undefined. That blanked the whole screen.

I confirmed the mismatch pattern on local disk before the fix. The store held four orphaned expo-router 4.0.0 peer-variant trees, two extra `@react-navigation` sets, screens 4.29.0, safe-area-context 5.10.1, and metro-runtime 4.0.0-preview.2, none of them in `pnpm-lock.yaml`. The lock now resolves to one copy of each package, which matches what Main shipped.

Adding metro-runtime 4.0.1 alone could not fix this. Metro-runtime was never the duplicated context. The duplicated context was expo-router paired against the wrong navigation copies.

## Why I changed no Metro or layout source

I first added single-copy pinning to both `metro.config.js` files. Main's dependency update then fixed the crash in a real browser test, so the pinning was not required. I reverted both files to their original form and syntax checked them. Both `app/_layout.tsx` files were never edited. Their declared screens match the route files on disk one to one, so they were not part of the fault. App flows and styling are untouched.

## Recommendations for deploy

1. Deploy the corrected dependency set and verify the service card tap again on the deployed URL.
2. Run a fresh install on the build machine so orphaned `.pnpm` trees from the 4.0.0 era are pruned and cannot leak into a future bundle.
3. Keep the SDK 52 pins exact. Do not let screens, safe-area-context, or expo-router float.
4. If the crash ever returns, compare the bundled navigation copies first, before touching Metro config or layouts.
