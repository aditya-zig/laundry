# Foundation verification

Independent check by Muse Spark Free, 11 October 2026. I owned only packages, root tsconfig files, and this doc. I did not touch apps, modules, tools, root package.json, the lockfile, and I made no commits.

## Results

All green. 22 tests pass across the four shared packages, all four build, and the root typecheck is clean.

The exact commands I ran, from the repo root:

- pnpm --filter @wandary/contracts test --run. 11 passed.
- pnpm --filter @wandary/api-client test --run. 7 passed.
- pnpm --filter @wandary/test-fixtures test --run. 2 passed.
- pnpm --filter @wandary/design-tokens test --run. 2 passed.
- pnpm --filter @wandary/contracts --filter @wandary/api-client --filter @wandary/test-fixtures --filter @wandary/design-tokens build. All four done, exit 0.
- npx tsc -p tsconfig.json --noEmit. Exit 0.

Before my changes the count was 16. I added 6 regression tests, 3 in contracts and 3 in the client. Nothing that passed before fails now.

## Defects I found and fixed

I read contracts.md against the SDK and found real bugs, not style nits.

Stable idempotency hashing. IdempotencyStore hashed payloads with plain JSON.stringify, which depends on key order. Two identical payloads built in a different key order hashed differently and executed twice. I added a small stable stringify that sorts keys recursively. Same payload now replays. A new test builds the same object in two key orders and asserts one execution.

Stable idempotency keys on retry. The client generated a fresh UUID for every call and gave callers no way to reuse one. Contracts.md says a failed checkout retries with the same key. Every mutating client method now takes an optional trailing opts object with idempotencyKey. Omit it and behavior is exactly what it was. Pass it and the same key goes out on each retry. A new test calls createCheckout twice with one key and asserts both requests carry it.

Handover dropped expectedVersion. handoverJob parsed the input through handoverInputSchema, and Zod strips unknown keys, so expectedVersion never reached the wire even though the type required it and openapi.yaml documents it. The client now splits expectedVersion out before validation and adds it back into the body. A new test asserts the sent body carries jobId, expectedVersion, and method.

Untyped conversation results. postConversationMessage parsed the draft as a record of unknowns, so field names and the attached quote had no checking at all. Contracts had no draft schema either. I added conversationDraftSchema, conversationMessageResultSchema with an optional quote, and reviewSchema to schemas.ts. The client now parses with them and returns a typed draft plus an optional Quote. A new test round-trips a QUOTED draft with its quote. This is the draft quote gap closed in the least invasive way. I did not invent a new endpoint.

Smaller transport fixes in the same pass. createReview and listServiceReviews now use reviewSchema and return Review types instead of inline shapes and unknown arrays. createCheckout accepts an optional expectedVersion and sends it only when provided. createRefund accepts an optional obligationId and sends it only when provided. recordIntake accepts optional bagIds and sends them only when provided. advanceCare types its target as the three legal care states. All additions are optional. Existing call shapes send byte-identical bodies.

## Generated artifacts

The initial commit tracked 24 compiler outputs beside packages/contracts/src/*.ts. I removed all of them from disk with git rm and then unstaged the index, so the coordinator decides when to commit. Only the six .ts sources remain.

The build configs were already correct. Each tsconfig.build.json sets outDir dist, rootDir src, and clears paths so workspace aliases never leak compiled output across packages. I rebuilt all four packages after the fix and listed src. Only .ts files, dist holds the output. A new test in contracts locks this in. It asserts outDir, rootDir, and empty paths, and asserts no .js, .d.ts, or .map file sits in src.

Root configs are untouched. tsconfig.json typechecks packages with noEmit, tsconfig.base.json holds the shared paths.

## What this does not prove

No UI verification happened here. That stays separate per the task. No backend integration ran either. These are mocked-transport unit tests plus builds and typechecks. test:integration stays reserved for real backend work.

Two things I noticed but left alone because fixing them would exceed my scope. openapi.yaml has no GET /services/:id even though contracts.md lists one, so I added no getService method rather than invent a route. ports.ts keeps simplified view shapes where contracts.md describes richer ones. Widening those belongs to A0 with the module owners, not to a foundation repair pass.

## Files changed

- packages/contracts/src/guards.ts. Stable payload hashing.
- packages/contracts/src/schemas.ts. Draft, conversation result, and review schemas.
- packages/contracts/test/contracts.test.ts. Three regression tests.
- packages/api-client/src/index.ts. Key overrides, handover fix, typed conversation and review paths, optional refund, intake, and checkout fields.
- packages/api-client/test/client.test.ts. Three regression tests.
- 24 tracked compiler artifacts deleted from packages/contracts/src.
