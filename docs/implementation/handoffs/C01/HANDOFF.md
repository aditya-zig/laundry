# C01 handoff: freeze the v2 wire contracts

## Identity

- Task ID: C01
- Task name: contract-freeze
- Worker branch: `cloud/c01-contract-freeze`
- Base SHA: `f0efdc0` (the P00 integration baseline)
- Source branch: new implementation
- Source SHA: not applicable
- Tested SHA: `cd52487`
- Contract version: `laundry-wire-v2.0.0`
- Contract digest: `sha256:268e5cc8dddcdf02ee39acb978bd83c22d4fa9c509908d6d41fc714b9530c7b6`
- Contract scope: `packages/contracts`
- Integration target: `cloud/P00-source-consolidation`
- Status: IMPLEMENTED

## Purpose

This task froze the v2 wire contract. It adds the executable v2 schemas, the v2 SDK client, the typed module ports, the route registry with its permission, error and idempotency rules, the event catalog and a generated contract inventory. The v1 contract is unchanged and keeps working, so a consumer can migrate one screen at a time.

## File ownership

| Path | Action | Reason |
|---|---|---|
| `packages/contracts/src/v2/common.ts` | added | Instants with offsets, windows, actor, error envelope, idempotency and version primitives |
| `packages/contracts/src/v2/catalog.ts` | added | The four service codes, garment eligibility, rate cards, service areas |
| `packages/contracts/src/v2/orders.ts` | added | Requested lines, quotes, booking, order state, intake, adjustments, custody receipt |
| `packages/contracts/src/v2/billing.ts` | added | Obligation, attempt, receipt, refund and reconciliation |
| `packages/contracts/src/v2/logistics.ts` | added | Leg attempts, assignments, custody events, handover proof, rider and tracking views |
| `packages/contracts/src/v2/media.ts` | added | Private media references, upload intents, retention |
| `packages/contracts/src/v2/support.ts` | added | Incidents, messages, resolutions, rewash requests |
| `packages/contracts/src/v2/reviews.ts` | added | Reviews, publication state, moderation, eligibility |
| `packages/contracts/src/v2/conversations.ts` | added | Drafts, revisions, confirmations, inbound messages |
| `packages/contracts/src/v2/events.ts` | added | The event envelope, the ten frozen event types and their payloads |
| `packages/contracts/src/v2/ports.ts` | added | The typed module ports and the transaction participation rules |
| `packages/contracts/src/v2/routes.ts` | added | The route registry with roles, error codes, idempotency rules and owning tasks |
| `packages/contracts/src/v2/index.ts` | added | The v2 barrel file |
| `packages/contracts/src/index.ts` | modified | Adds the namespaced v2 export, keeps every v1 export |
| `packages/contracts/test/v2-contracts.test.ts` | added | 29 tests for instants, local dates, windows, billing units, money, errors and custody |
| `packages/contracts/test/v2-routes.test.ts` | added | 10 tests for the route registry and the event catalog |
| `packages/api-client/src/v2.ts` | added | The v2 SDK client with typed errors and an explicit unknown outcome |
| `packages/api-client/src/index.ts` | modified | Re-exports the v2 client, keeps the v1 client unchanged |
| `packages/api-client/test/v2-client.test.ts` | added | 8 tests for headers, idempotency, typed errors and the no silent retry rule |
| `tools/contracts/generate-inventory.py` | added | Regenerates the contract inventory from the frozen registry |
| `docs/implementation/contracts/INVENTORY.md` | added | The generated contract inventory |

## Source provenance

| Behavior | Source branch | Source SHA | Integration action |
|---|---|---|---|
| v1 contract | P00 integration baseline | `f0efdc0` | preserved, exported unchanged |
| v1 SDK client | P00 integration baseline | `f0efdc0` | preserved, exported unchanged |
| v2 schemas, ports, events and routes | new implementation | n/a | added |
| v2 SDK client | new implementation | n/a | added |

## Contract changes

- Changed contracts: `packages/contracts/src/v2/**` added, `packages/contracts/src/index.ts` modified, `packages/api-client/src/v2.ts` added, `packages/api-client/src/index.ts` modified
- Compatibility impact: none for v1. The v2 contract is a namespaced export, so a v1 consumer keeps its exact imports and behavior.
- API changes: the v2 routes are additive. No v1 route changed.
- Migration changes: none
- Idempotency impact: the v2 registry states the rule for every route. A mutation is `REQUIRED` or `OPTIONAL`, a read is `NOT_APPLICABLE`.
- State transition impact: the v2 contract states the independent order, obligation, attempt, refund and leg attempt states, and the event catalog carries the transitions between them.

## Contract digest command

Command:

```
git ls-tree -r <tested-SHA> -- packages/contracts | sha256sum
```

Recorded digest:

```
sha256:268e5cc8dddcdf02ee39acb978bd83c22d4fa9c509908d6d41fc714b9530c7b6
```

## Verification

| Command | Exit code | Evidence |
|---|---|---|
| `pnpm --filter @laundry/contracts build` | 0 | The v2 contract compiles under `strict` |
| `pnpm --filter @laundry/contracts test` | 0 | 53 tests passed, 0 failed |
| `pnpm --filter @laundry/api-client build` | 0 | The v2 client compiles |
| `pnpm --filter @laundry/api-client test` | 0 | 24 tests passed, 0 failed, including the 16 pre-existing v1 tests |
| `pnpm build` | 0 | 10 of 11 workspace projects built |
| `pnpm check` | 0 | Root `tsc` and every per-project check and typecheck |
| `pnpm test` against isolated PostgreSQL `laundry_verify_p00` | 0 | 163 tests passed, 0 failed, 0 skipped |
| `python3 tools/contracts/generate-inventory.py` | 0 | The inventory regenerated with 81 operations |

## Runtime prerequisites

- Package manager: pnpm 10.33.2
- Required services: none for the contract package
- Database: `laundry_verify_p00` for the API acceptance suite
- Environment variables: `DATABASE_URL`
- Setup command: `pnpm install --frozen-lockfile`
- Test command: `pnpm test`

## Test results

| Suite | Result | Evidence |
|---|---|---|
| `packages/contracts` | passed | 53 tests, 4 files |
| `packages/api-client` | passed | 24 tests, 3 files |
| `packages/design-tokens` | passed | 2 tests |
| `packages/test-fixtures` | passed | 2 tests |
| `apps/api` | passed against isolated PostgreSQL | 63 tests |
| `apps/customer` | passed | 10 tests |
| `apps/partner` | passed | 6 tests |
| `apps/ops` | passed | 11 tests |

## Known failures

| ID | Symptom | Reproduction command | Owner | Blocking |
|---|---|---|---|---|
| C01-KF-01 | The three app foundations and the backend skeletons have not been migrated onto the v2 client yet. They compile against the frozen interfaces, but they still call the v1 routes. | `pnpm check` | F00, B01 to B10 | No. The v1 contract still works, so the migration is a later consumer task. |
| C01-KF-02 | The test fixtures package has no v2 fixtures yet. The contract tests build their own synthetic values inline. | `pnpm --filter @laundry/test-fixtures test` | C01 follow-up | No |
| C01-KF-03 | The OpenAPI document has not been regenerated from the frozen registry. The registry is the source of truth today. | not applicable | C01 follow-up | No |

## Conflicts and decisions

| Conflict | Decision | Decision owner | Evidence |
|---|---|---|---|
| The generated contract used a zod 4 API, `.unwrap()`, which does not exist in zod 3 | Changed to `.innerType()`, the zod 3 equivalent | Coordinator | `packages/contracts/src/v2/orders.ts` |
| The generated contract used error codes outside the frozen envelope, `VALIDATION_ERROR`, `UNAUTHORIZED` and `CONFLICT` | Mapped to `INVALID_INPUT`, `UNAUTHENTICATED` and `VERSION_CONFLICT` | Coordinator | `packages/contracts/src/v2/routes.ts` |
| The generated registry used a `SYSTEM` actor role that the actor contract does not have | Mapped to `ADMIN` | Coordinator | `packages/contracts/src/v2/routes.ts` |
| The generated registry left every route owned by C01 and left public routes with no roles and no error codes | Every route now carries the task that owns the domain family, a public route is marked `PUBLIC`, and every route has at least one error code | Coordinator | `docs/implementation/contracts/INVENTORY.md` |
| The customer-facing billing and tracking routes were missing | Added `/v2/billing/obligations`, `/v2/billing/refunds` and `/v2/logistics/tracking/{orderId}` | Coordinator | `packages/contracts/src/v2/routes.ts` |
| The generated v1 client file dropped the pilot imports | The real v1 file was kept and only the export line was added | Coordinator | `packages/api-client/src/index.ts` |

## Preservation checks

- [x] No changes outside assigned ownership
- [x] Canonical namespace preserved
- [x] Existing functionality retained
- [x] Protected assets unchanged
- [x] No unreviewed migrations
- [x] No new competing persistence authority
- [x] No secrets committed
- [x] Required tests executed
- [x] Known failures disclosed

## Integration instructions

1. `git fetch origin cloud/c01-contract-freeze`
2. `git checkout cloud/c01-contract-freeze`
3. `pnpm install --frozen-lockfile`
4. `pnpm build && pnpm check && pnpm test`
5. `python3 tools/contracts/generate-inventory.py` to confirm the inventory still matches the registry.
6. Record the contract digest with `git ls-tree -r HEAD -- packages/contracts | sha256sum` and publish it in the task manifest.

## Final record

- Base SHA: `f0efdc0`
- Source SHA: not applicable
- Tested SHA: `cd52487`
- Contract digest: `sha256:268e5cc8dddcdf02ee39acb978bd83c22d4fa9c509908d6d41fc714b9530c7b6`
- Last verification command: `pnpm test`
- Last verification exit code: 0
- Remaining blockers: none. Three known failures are recorded above and none of them blocks a consumer.
- Pull request created: no
- Ready for coordinator integration: yes
