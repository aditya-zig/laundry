# Native session storage wiring

Status: storage wiring prepared; **not device-, APK- or production-accepted**. No live OAuth, SMS, messaging, payment or ordering was enabled.

## Scope

Customer and rider native hosts install their storage before exposing the router or a session client. Web intentionally remains memory-only. The shared native binding refuses incomplete ports rather than silently creating an in-memory journal.

The SDK-52-matched Expo SQLite config plugin requests SQLCipher. Each app uses its own database and OS-protected 32-byte random key; SecureStore contains only that small key, not a growing command journal. Refresh/rotation data and exact actor-scoped pending command records live in the encrypted database. Secure UUID generation is injected from Expo Crypto.

Startup checks SQLCipher capability before creating a sensitive schema, verifies key persistence, sets the raw database key and full synchronous writes, and fails closed on missing/malformed keys, a missing previously keyed journal, unsupported runtime or database failure. A retry does not rotate or replace a missing key, erase the database, or invent replacement command IDs. After reinstall, backup restore or lost key/database, manual reconciliation/restoration is still required; an automatic reset flow is deliberately absent.

A command insert cannot overwrite another intent with the same key. Corrupt pending rows raise an error, not an empty journal. Existing foundation rules still control actor/role scope, revocation, explicit replay, version checks and retirement after server acknowledgement. No automatic offline submission or new role/provider capability is added.

## Verification boundary

Host Node SQLite tests close/reopen an ordinary temporary database to check credential/rotation strings, a command larger than 2KB, exact insert/retry behavior, corruption rejection and explicit removal/clearing. Synthetic capability tests exercise startup ordering and missing-key/runtime failures. **Neither is SQLCipher encryption, OS-keychain, force-stop or real-device evidence.**

The first targeted run passed 54 foundation, 126 customer and 55 rider tests plus the workspace typecheck. Its Android JavaScript exports were **not accepted as native wiring evidence**: the packages consume compiled foundation output, and a new static preflight reproduced `Build the updated foundation before exporting native apps` (`undefined` instead of `function`). Rebuilding the foundation before clearing/re-exporting both native bundles is part of the corrected check. A later journal-key/JSON-key mismatch guard adds one test. Corrected run `bf5c86849` passed 55 foundation, 126 customer and 55 rider tests, workspace typecheck, a fresh foundation build, both fresh Android JavaScript exports and the native static preflight. Subsequent clean checkpoint `02ad7dcd8f42351838010ae20e965b1a7b47f883` passed the actual four-role web journey (`bc9fd02ab`), including an original 1080p30 recording and four role videos. Four original-film sample frames were inspected. Those are web-only receipts; all native device/APK/encryption/live-provider proof flags remain false.

`node tools/verification/native-storage-preflight.mjs <customer-export-directory> <rider-export-directory>` checks the compiled API, plugins and both native bundles' actual guard/host code. It writes a scoped, hashed static receipt whose device, APK, encryption and live-provider proof flags are all false. These exports do not create an APK, run a phone, or prove a native module was linked. The final web regression remains the task-owned four-role browser journey.

The SDK-matched dependency install and `pnpm release:security` passed. The raw audit retains the existing node-forge advisory; the existing exact-source/seven-RSA-case backport checks passed. No advisory was muted.

Existing definitive revocation clears credentials and private caches. Pending commands retain the foundation's encrypted, actor/scope-filtered reconciliation behavior; explicit logout clears that journal. No new automatic replay or destructive reset policy is introduced by this storage adapter.

## Remaining gates

- Custom Android/iOS binaries with SQLCipher linked; Expo Go must fail closed.
- Device lock/unlock, force-stop/relaunch, offline reply-loss retry, rotation, logout/revocation purge and account switching on actual devices.
- Missing-key/database, backup/reinstall and corrupt-journal recovery with explicit reconciliation, not a destructive reset.
- Real Google/Apple callbacks, verified mobile binding and native logout/cookie/deep-link handling. Browser-only Better Auth is not silently reused as native identity.
- Physical bag/garment operations, real staff MFA and business/provider approvals remain unproved. Existing production-ordering gates stay closed.
