# A0: Foundation and coordinator

**Goal:** Build runnable empty apps, local services, authentication boundary, media rules, transactional outbox and versioned contracts. Set up coordinator-owned DB migrations and CI ownership checks. Include root pnpm check/test scripts; pin native-compatible dependencies once.

**Read first:** [Product spec](../specs/product-spec.md), [shared contracts](../specs/contracts.md), [main plan](../superpowers/plans/2026-10-11-wandary.md).

**Depends on:** None. Fixtures permit independent development after the A0 gate; they do not prove cross-module integration.

**Write allowlist:** `Shared/root paths from the main plan`. A0 alone edits shared contracts, manifests, lockfile, generated SDK, canonical migrations and app/worker composition. For A0, its exact allowlist is the main plan's shared/root paths. Do not commit edits to another packet's paths. Use a separate worktree/branch.

**Create paths:**
- `packages/contracts/src/ports.ts`
- `packages/contracts/openapi.yaml`
- `packages/contracts/src/events.ts`
- `packages/api-client/src/index.ts`
- `apps/api/src/main.ts`
- `apps/worker/src/main.ts`
- `modules/schema/migrations/001_backend.sql` (canonical; supersedes the removed early `infra/db` proposal)
- `packages/test-fixtures/src/index.ts`

**Interfaces:** All signatures and routes in contracts.md; publish generated SDK and createTestContext(): Promise<TestContext> with isolated database, actor and fake ports. Export Nest module registration points without importing private module internals.

## Implementation tasks

- [ ] Create `packages/contracts/test/contracts.test.ts` with individually named behavior tests for these assertions: invalid fixtures are rejected; customer cannot read another customer order; revoked rider and facility roles cannot cross scopes; concurrent identical idempotency keys run once; missing suites fail CI. Assertions must exercise observable state, API results and ledger/job counts rather than implementation details.
- [ ] Run `pnpm test:contracts` and confirm the new cases fail for the intended missing behavior. A0 first creates these workspace scripts; do not interpret “script missing” as a useful regression result.
- [ ] Implement the interfaces and behavior above in the owned paths. Keep adapter, persistence and handler concerns separate. Every public command must honor actor authorization, idempotency and version rules from contracts.md.
- [ ] Add module-local schema proposals where applicable; send them to A0 for canonical migration integration. Request shared contract/dependency changes explicitly; never patch a private workaround into a consumer.
- [ ] Run `pnpm test:contracts` until all behavior cases pass, then `pnpm check` and `pnpm test:contracts`. Mark checks that require unmerged dependencies as pending, not passed. Backend packet tests use real isolated Postgres, with only external providers mocked.
- [ ] Commit only owned paths with message `feat: implement a0 foundation and coordinator`. Return commit ID, changed files, commands/results, fixture vs live evidence and remaining dependencies to A0. Do not merge, deploy or publish on your own.

## Definition of done

Every assigned behavior and test above is implemented; no writes escape the allowlist; schemas match contracts-v1; fixtures contain no real personal data or secrets. Empty/loading/error/permission states are covered for UI packets. Provider-dependent work is explicitly labeled simulator/sandbox/live. Handoff is incomplete if it omits an untested dependency, unsupported provider capability or migration requirement.
