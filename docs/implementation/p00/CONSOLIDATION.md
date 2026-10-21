# P00 source consolidation and integration baseline

## 1. Purpose and scope

P00 establishes one integration baseline for `aditya-zig/laundry` by consolidating three development branches while preserving existing functionality, source history and domain contracts.

The integration branch is `cloud/P00-source-consolidation`. It starts from the pinned main checkout commit `39eaa8d0d380f780886c06d44f91fb0760b3ae0c` plus the three documentation commits that carry the production plan (`7732f0c`, `c906daf`, `f477671`). The documentation commits touch nothing under `apps/`, `modules/`, `packages/`, `convex/` or `tools/`, so the source tree at the integration base is identical to the pinned main checkout.

P00 is a source consolidation task. It does not implement production authentication, fix the recorded product defects, redesign the interface again or deploy anything.

The integration preserves these invariants:

- All monetary values use integer minor-unit INR.
- Schedule windows carry a timezone and use `Asia/Kolkata`.
- Order, payment and delivery-leg states remain independent.
- Every mutation accepts an idempotency key.
- PostgreSQL migrations are append-only.
- CI performs checks and never deploys a task branch.

### Write ownership

| Owner | Write scope |
|---|---|
| P00 coordinator | Root manifests, lockfile, CI, canonical migrations, shared packages, API composition, integration conflict resolution |
| Backend feature worker | Its assigned backend module and API feature directory |
| Customer feature worker | Its assigned customer app routes, screens and state |
| Other feature workers | Their assigned application or module directories |
| All workers | Their own handoff evidence under `docs/implementation/handoffs/<TASK>/` |

Feature workers do not change root configuration, shared contracts or canonical migrations. All workers deliver branches named `cloud/<task-id>-<short-name>`. No worker creates a pull request.

### Non-negotiable preservation rules

These paths stay byte-for-byte identical to the main checkout:

- `.agents/skills/design-taste-frontend/`
- `docs/discovery/`

The coordinator also preserves the existing `convex/` implementation and the applied migrations `modules/schema/migrations/001_backend.sql` and `002_outbox_ledger.sql`. Any correction to an applied migration uses a new forward migration.

## 2. Source inventory

| Branch | SHA | Namespace | Distinctive content | Disposition |
|---|---|---|---|---|
| `wip/main-checkout-20261021` | `39eaa8d0d380f780886c06d44f91fb0760b3ae0c` | `@laundry/*`, 52 files | Main checkout, flat customer routes, design skill, founder discovery, CI, Convex, PostgreSQL migrations | Integration base. Protected paths preserved. |
| `fix/backend-handoff-20261021` | `99738543372ad73a955ed641112e9bf47ee4f94c` | `@wandary/*`, 58 files | Pilot controller, five API test files, pilot console, E2E tooling, agent workflow tooling, pilot migrations | Imported with path-scoped restore and namespace normalization |
| `fix/customer-ui-handoff-20261021` | `328c15a4ba5cd7bccdbd3c77e5d982aca189f83f` | `@wandary/*`, 52 files | Tab-group routes, reactive basket, IST schedule editor, regression test, `DESIGN.md` | Imported with a three-way merge, namespace normalized, duplicate flat routes removed |

Both feature branches fork from `e3c509a9d9d6d7d4f88d4a39afac94cab6179e3e`. The main checkout is the ancestor of the documentation branch, so it is the integration base.

### Behavior provenance

| Behavior or artifact | Source of record | Preservation requirement |
|---|---|---|
| Existing checkout behavior | Main checkout | Not replaced without equivalent behavior |
| Canonical namespace | Main checkout | `@laundry/*` retained |
| Founder discovery documents | Main checkout | Exact content preservation |
| Design taste skill | Main checkout | Exact byte preservation |
| Pilot API behavior and controller | Backend pilot | Imported and registered in API composition |
| Pilot acceptance and regression tests | Backend pilot | All five files retained |
| Pilot console | Backend pilot | Imported and reconnected to the canonical API client |
| Browser and agent workflow tooling | Backend pilot | Imported under `tools/` |
| Customer reactive basket and schedule editor | Customer redesign | Imported |
| Customer tab navigation | Customer redesign | Single owner per route |
| Shared contracts | Main checkout, then coordinator | Every change reviewed |
| Database migrations | Main checkout, then coordinator | Append-only |
| Convex implementation | Main checkout | Preserved behind the authority boundary |

The backend pilot's recorded 63 passing API acceptance tests are historical evidence from an isolated PostgreSQL instance. They do not establish that the consolidated branch passes. Section 8 records the actual run.

### Source receipts

Stored under `docs/implementation/p00/receipts/`:

- `source-commits.txt` — the three pinned commits with full metadata
- `backend-delta.txt` — every path the backend branch changed since the fork
- `customer-delta.txt` — every path the customer branch changed since the fork
- `main-protected-tree.txt` — the protected tree listing at the base
- `integration-delta.txt` — every path the integration changed relative to the base
- `contracts.sha256` — digest of the `packages/contracts` tree at the tested SHA
- `verification.md` — commands, exit codes and observed results
- `decisions.md` — namespace, route, module and persistence decisions

## 3. Namespace decision

`@laundry/*` is the only active workspace namespace. The main checkout is never reverted to `@wandary/*`.

Imported code references the canonical workspace packages `@laundry/contracts`, `@laundry/api-client`, `@laundry/design-tokens` and `@laundry/test-fixtures`.

The rewrite is literal and scoped to imported active source and configuration files. It covers package manifests, TypeScript path mappings, Vite aliases, Metro configuration, workflow files and tooling scripts. It does not touch historical documents, where `@wandary/*` identifies the original branch state, and it does not rename third-party dependencies.

```bash
git ls-files -z -- apps modules packages tools .github \
  | xargs -0 grep -l '@wandary/\|WandaryClient\|wandary-api' \
  | while IFS= read -r f; do
      sed -i 's|@wandary/|@laundry/|g; s|WandaryClient|LaundryClient|g; s|wandary-api|laundry-api|g' "$f"
    done
```

Verification, run on the integrated tree:

```bash
! git grep -n '@wandary\|Wandary' -- apps modules packages tools .github
```

Remaining references outside those paths are historical prose and are reviewed by hand. The lockfile is regenerated by the package manager rather than edited, so it carries no legacy package identity.

## 4. Route and module ownership map

| Path | Owning branch of record | Action | Note |
|---|---|---|---|
| `apps/customer/app/(tabs)/index.tsx` | Customer redesign | Imported | Owns `/` |
| `apps/customer/app/(tabs)/orders.tsx` | Customer redesign | Imported | Owns `/orders` |
| `apps/customer/app/(tabs)/account.tsx` | Customer redesign | Imported | Owns `/account` |
| `apps/customer/app/(tabs)/help.tsx` | Customer redesign | Imported | Owns `/help` |
| `apps/customer/app/(tabs)/_layout.tsx` | Customer redesign | Imported | Single tab navigation owner |
| `apps/customer/app/index.tsx` | Main checkout | Removed | Duplicate of `/`; capability moved to the owning route |
| `apps/customer/app/orders.tsx` | Main checkout | Removed | Duplicate of `/orders` |
| `apps/customer/app/account.tsx` | Main checkout | Removed | Duplicate of `/account` |
| `apps/customer/app/help.tsx` | Main checkout | Removed | Duplicate of `/help` |
| `apps/customer/src/cart-store.ts` | Customer redesign | Imported | Reactive basket state |
| `apps/customer/src/schedule-input.ts` | Customer redesign | Imported | IST-friendly schedule editing |
| `apps/customer/test/api.regression-1.test.ts` | Customer redesign | Imported | Regression coverage retained |
| `apps/api/src/controllers/pilot.controller.ts` | Backend pilot | Imported | Registered in API composition |
| `apps/api/test/pilot.test.ts` | Backend pilot | Imported | Pilot acceptance coverage |
| `apps/api/test/pilot-guard.test.ts` | Backend pilot | Imported | Access guard coverage |
| `apps/api/test/pilot-customer-client.test.ts` | Backend pilot | Imported | Customer client coverage |
| `apps/api/test/whatsapp-media.regression-1.test.ts` | Backend pilot | Imported | Media regression coverage |
| `apps/api/test/whatsapp-signature.regression-1.test.ts` | Backend pilot | Imported | Signature regression coverage |
| `apps/pilot-console/` | Backend pilot | Imported | Separate from the operations console |
| `e2e/` | Backend pilot | Imported | Browser scenarios |
| `modules/pilot/` | Backend pilot | Imported | Pilot domain module |
| `modules/schema/migrations/003_pilot.sql` | Backend pilot | Imported | Forward migration |
| `modules/schema/migrations/004_pilot_locations.sql` | Backend pilot | Imported | Forward migration |
| `modules/schema/migrations/005_pilot_windows.sql` | Backend pilot | Imported | Forward migration |
| `packages/contracts/src/pilot.ts` | Backend pilot | Imported | Pilot contracts |
| `packages/api-client/test/pilot-client.test.ts` | Backend pilot | Imported | Pilot client coverage |
| `tools/agents/`, `tools/cloud/`, `tools/verification/` | Backend pilot | Imported | Agent and evidence tooling |
| `playwright.config.ts`, `opencode.json` | Backend pilot | Imported | Root tooling reviewed by the coordinator |
| `.github/workflows/agent-verification.yml` | Backend pilot | Imported | Checks and evidence only, no deployment |
| `docs/agents/` | Backend pilot | Imported | Source instructions retained |
| `apps/partner/` | Main checkout | Preserved | Partner defect stays assigned to its own task |
| `apps/ops/` | Main checkout | Preserved | Operations console untouched |
| `modules/billing/`, `catalog/`, `conversations/`, `logistics/`, `orders/`, `schema/`, `shared/` | Main checkout | Coordinator reconciliation | One implementation per behavior |
| `packages/contracts/`, `api-client/`, `design-tokens/`, `test-fixtures/` | Main checkout | Coordinator reconciliation | Canonical contract source |
| `convex/` | Main checkout | Preserved | Behind the authority boundary in section 6 |
| Root manifests and lockfile | Main checkout | Coordinator merge | Feature branch manifests never imported wholesale |
| `.github/workflows/ci.yml` | Main checkout | Preserved | Deployment gate unchanged |

### Canonical customer route map

| URL | Expo Router file |
|---|---|
| `/` | `apps/customer/app/(tabs)/index.tsx` |
| `/orders` | `apps/customer/app/(tabs)/orders.tsx` |
| `/account` | `apps/customer/app/(tabs)/account.tsx` |
| `/help` | `apps/customer/app/(tabs)/help.tsx` |

The `(tabs)` route group adds no URL segment. No URL has both a root-level screen and a tab-group screen.

### Route parity review

The four flat screens were compared with their grouped owners before removal.

`account`, `help` and `orders` are byte-identical to the flat versions apart from the relative import depth changing from `../src` to `../../src`. No capability was lost.

`index` differs. The flat version rendered a service-area check, an editable address field, a demo sign-in button, a service list and links to orders, help and account. The grouped owner renders the same service-area check with the area identifier and pickup hours, performs the demo session, lists every service with per-garment prices and units, and exposes orders, help and account through the tab bar. The editable address field moved to `apps/customer/app/checkout.tsx`, which lists and creates owned addresses and selects the draft address. The capability survives in the checkout flow, which is the correct place for it.

### Duplicate module policy

No `modules/*` or `packages/*` tree is copied from a feature branch. For each overlapping implementation the coordinator identifies the behavior and its source SHA, compares it with the canonical tree, keeps the canonical location, ports missing behavior, updates shared contracts through the coordinator, and removes a duplicate only after parity holds.

## 5. Merge procedure

### Strategy

Path-scoped integration using `git restore --source` for files that only one branch owns, and `git merge-tree --write-tree` for files that both branches changed. A blanket `git merge` of either feature branch is not used because it would carry the legacy namespace, the legacy root configuration and the source branch lockfile into the integration base.

### Step 1. Verify the pinned sources

```bash
export BASE=39eaa8d0d380f780886c06d44f91fb0760b3ae0c
export BACKEND=99738543372ad73a955ed641112e9bf47ee4f94c
export CUSTOMER=328c15a4ba5cd7bccdbd3c77e5d982aca189f83f
export FORK=e3c509a9d9d6d7d4f88d4a39afac94cab6179e3e

test "$(git rev-parse origin/wip/main-checkout-20261021)" = "$BASE"
test "$(git rev-parse origin/fix/backend-handoff-20261021)" = "$BACKEND"
test "$(git rev-parse origin/fix/customer-ui-handoff-20261021)" = "$CUSTOMER"
test "$(git merge-base "$BACKEND" "$CUSTOMER")" = "$FORK"
```

A moved source branch requires coordinator review before the task continues.

### Step 2. Create the integration branch

```bash
git switch -c cloud/P00-source-consolidation "$BASE"
git switch -c cloud/P00-source-consolidation docs/production-cloud-plan-20261021
```

The second command is the one that was used. The plan documents must be present on the integration branch because every worker reads them.

### Step 3. Import the backend branch

Files the base does not own are restored directly:

```bash
git restore --source="$BACKEND" --staged --worktree -- \
  apps/api/src/controllers/pilot.controller.ts \
  apps/api/test/pilot.test.ts \
  apps/api/test/pilot-guard.test.ts \
  apps/api/test/pilot-customer-client.test.ts \
  apps/api/test/whatsapp-media.regression-1.test.ts \
  apps/api/test/whatsapp-signature.regression-1.test.ts \
  apps/pilot-console e2e modules/pilot \
  modules/schema/migrations/003_pilot.sql \
  modules/schema/migrations/004_pilot_locations.sql \
  modules/schema/migrations/005_pilot_windows.sql \
  packages/contracts/src/pilot.ts \
  packages/api-client/test/pilot-client.test.ts \
  tools/agents tools/cloud tools/verification \
  .github/ISSUE_TEMPLATE/agent-task.yml \
  .github/PULL_REQUEST_TEMPLATE.md \
  .github/workflows/agent-verification.yml \
  docs/agents playwright.config.ts opencode.json
```

Files both branches changed are merged with git's three-way machinery:

```bash
git merge-tree --write-tree --name-only "$BASE" "$BACKEND"
```

The resulting tree supplied `packages/api-client/src/index.ts`, `modules/shared/src/auth.ts`, `modules/shared/src/errors.ts`, `modules/conversations/src/whatsapp.ts`, `packages/contracts/src/index.ts` and `packages/contracts/openapi.yaml`. `apps/api/src/main.ts` and `apps/api/src/app.module.ts` conflicted and were resolved by hand:

- `main.ts` keeps the base `laundry-api` service identity and adopts the backend host binding, the `HOST` environment variable and the stricter production `DATABASE_URL` guard.
- `app.module.ts` keeps every base controller and adds `PilotController`.

The backend root manifest, lockfile, `tsconfig.base.json` and `ci.yml` are not imported. Their new content is merged by hand in step 6.

### Step 4. Import the customer redesign

```bash
git merge-tree --write-tree --name-only "$BASE" "$CUSTOMER"
```

The merged tree supplied the whole `apps/customer` directory. Four conflicts were resolved by hand, and every resolution is a namespace or path-depth change:

- `apps/customer/app/(tabs)/help.tsx` and `orders.tsx` keep the base import list on the `@laundry/contracts` namespace with the `../../src` depth.
- `apps/customer/src/api.ts` keeps the base client import and adds the `ApiError` export used by the redesigned screens.
- `apps/partner/src/theme.ts` keeps the base token values and the design-token pointer.

`apps/customer/app/index.tsx` was a modify-delete conflict. The base version was kept in the merged tree, and it was removed after the parity review in section 4.

### Step 5. Remove the duplicate flat routes

```bash
git rm -- \
  apps/customer/app/index.tsx \
  apps/customer/app/orders.tsx \
  apps/customer/app/account.tsx \
  apps/customer/app/help.tsx
```

### Step 6. Normalize the namespace and merge the root manifest

The rewrite in section 3 runs after the import and before the lockfile is regenerated.

The root `package.json` keeps its `laundry` name and the `@laundry/*` filters. The backend scripts `agents:plan`, `agents:tooling`, `cloud:doctor`, `cloud:packet`, `cloud:submit`, `test:tooling`, `verify:browser` and `verify:evidence` are added, together with the `@playwright/test` dev dependency that the new tooling needs.

The lockfile is regenerated:

```bash
pnpm install --lockfile-only
pnpm install --frozen-lockfile
```

### Step 7. Verify

```bash
! git grep -n '@wandary\|Wandary' -- apps modules packages tools .github
git diff --exit-code "$BASE" -- .agents/skills/design-taste-frontend docs/discovery
git diff --exit-code "$BASE" -- \
  modules/schema/migrations/001_backend.sql \
  modules/schema/migrations/002_outbox_ledger.sql
pnpm build
pnpm check
pnpm test
```

### Step 8. Commit and publish

```bash
git add -A
git diff --cached --check
git commit -m "feat(p00): consolidate source branches into one integration baseline"
git push -u origin cloud/P00-source-consolidation
```

## 6. Convex and PostgreSQL authority

### Authority decision

PostgreSQL is the canonical persistent store for the operational domain. This follows the documented architecture, which specifies PostgreSQL, a durable worker, shared modules and canonical SQL migrations.

Convex stays in the repository for compatibility, historical access and controlled migration. This is an architectural decision, not evidence that any live deployment already treats PostgreSQL as authoritative.

### Data ownership

| Data or behavior | Authority | Convex treatment |
|---|---|---|
| Customer identity and sessions | PostgreSQL-backed API once production identity ships | Preserve historical identity references |
| Orders and order states | PostgreSQL | Read-only legacy access or migration source |
| Quotes and monetary values | PostgreSQL | Preserve historical records |
| Payments and ledger entries | PostgreSQL | No independent payment authority |
| Pickup and return delivery legs | PostgreSQL | Preserve legacy mapping where needed |
| Service catalog and pricing | PostgreSQL | Cache or historical adapter only |
| Conversations | PostgreSQL for canonical records | Legacy transport or compatibility adapter |
| Durable jobs and outbox events | PostgreSQL and the durable worker | Never a competing authoritative queue |
| Media and uploaded evidence | PostgreSQL metadata plus private object storage | Preserve references and migration metadata |
| Historical Convex documents | Convex until a verified migration runs | Preserve read access and source identifiers |

Every exception to PostgreSQL authority is recorded in `decisions.md`.

### Adapter boundaries

| Adapter | Responsibility |
|---|---|
| Legacy Convex reader | Read historical records without mutating canonical state |
| PostgreSQL repository adapter | Perform canonical domain reads and writes |
| Historical migration adapter | Transfer verified records from Convex into PostgreSQL |
| Compatibility API adapter | Resolve legacy identifiers through canonical API contracts |
| Media-reference adapter | Preserve legacy attachment references until storage ownership is settled |

### Preventing a second source of truth

- Each domain entity has one declared authoritative store.
- API mutations write only through the canonical persistence boundary.
- Every mutation requires an idempotency key.
- The durable worker consumes canonical PostgreSQL outbox records.
- No dual-write path commits business state to both systems.
- Legacy identifiers map to canonical identifiers explicitly.
- Historical adapters never generate independent payment, order or delivery transitions.
- A compatibility read identifies its source and record type.
- Migration conflicts fail visibly and enter a reconciliation report.
- A runtime authority change requires a reviewed configuration decision and a rollback plan.

A process never falls back to Convex writes when PostgreSQL is unavailable.

### Migration direction

`Convex historical data -> verified migration -> PostgreSQL canonical records`. No reverse synchronization is authorized.

The migration inventories Convex collections, exports without deleting, defines field mappings, preserves original identifiers and timestamps, converts monetary values without floating-point arithmetic, preserves schedule timezone information, keeps order, payment and delivery-leg histories separate, imports idempotently in deterministic batches, compares row counts, key fields, monetary totals and relationships, records checkpoints and reconciliation results, switches reads only after acceptance passes and retains historical data until a separate retention decision.

The migration respects `001_backend.sql` and `002_outbox_ledger.sql`. New schema work uses new forward migrations.

## 7. Known baseline failures and preserved defects

| ID | Area | Symptom | Evidence | Owner task | Blocking |
|---|---|---|---|---|---|
| BF-01 | Customer checkout | The quote request emits a `+05:30` offset while the quote schema uses `z.string().datetime()`, which rejects it | Recorded in the plan's defect table | C01 | Not P00 blocking. Release blocking. |
| BF-02 | Partner jobs | The list shows an unassigned task that the detail view refuses | Recorded in the plan's defect table | B06, F03 | Not P00 blocking. Release blocking. |
| BF-03 | Customer tracking | Tracking can show `Pending: RETURNING` after the order reaches `DELIVERED` | Recorded in the plan's defect table | F02 | Not P00 blocking. Release blocking. |
| BF-04 | Authentication | Demo tokens stand in for a production OTP and session lifecycle | Recorded in the plan's defect table | B01 | Not P00 blocking. Production blocking. |
| BF-05 | Video evidence | The earlier capture is 1228x768 at 1 fps, about 1.4 MB over 9.5 minutes | Recorded capture metadata | E01 | Not P00 blocking. Blocks final video acceptance. |
| BF-06 | Backend verification | The 63 API acceptance tests were not established as passing on the consolidated SHA | Backend pilot report | P00 | Blocked P00 verification until rerun. Resolved in section 8. |
| BF-07 | Namespace collision | The feature branches use `@wandary/*` while the base uses `@laundry/*` | Source inventory, 58 and 52 files | P00 | Blocked P00. Resolved in section 3. |
| BF-08 | Duplicate route ownership | Flat and grouped customer routes claim the same URL | Route structures in both branches | P00 | Blocked P00. Resolved in section 4. |
| BF-09 | Persistence authority | Convex and PostgreSQL code coexist without a confirmed runtime authority | Source architecture | P00 | Blocked the authority signoff. Resolved in section 6. |

### Preservation policy

A known defect may remain after P00 only when it is documented, its original behavior has not worsened, its owning task is identified, existing regression tests remain present, it is not hidden by a disabled or deleted test, and the release gates still recognise its severity.

A failure that integration introduced is a P00 blocker. A failure that predates the base is recorded, not silently fixed inside a consolidation task.

## 8. Acceptance evidence

The checklist is completed with captured command output in `docs/implementation/p00/receipts/verification.md`.

### Source and provenance

- The three pinned commits match the expected branch tips.
- The feature branches share the recorded fork.
- Both feature deltas and the integration delta have receipts.

### Source preservation

- The design skill and founder discovery documents are unchanged.
- The applied migrations are unchanged.
- The Convex tree is unchanged.

### Namespace and ownership

- No active code uses the legacy namespace.
- The four customer URLs have one route implementation each.
- The five backend pilot test files are present.
- The customer redesign support files are present.
- Shared packages have one coordinator-owned implementation.

### Build and runtime verification

- `pnpm install --frozen-lockfile` succeeds.
- `pnpm build` succeeds for all workspace projects.
- `pnpm check` succeeds.
- `pnpm test` succeeds.
- The PostgreSQL-backed API acceptance suite runs against an isolated database.

### Deployment gate

The production deploy job in `.github/workflows/ci.yml` is conditioned on `github.ref == 'refs/heads/build/laundry'`. A task branch named `cloud/<task-id>-<short-name>` cannot match that ref, so a task push cannot deploy. The evidence workflow added in this task runs checks and uploads artifacts and contains no deployment step.

### Publication

- The working tree is clean.
- The published SHA equals the tested SHA.
- No pull request is created.

## 9. Handoff record format

Every worker provides one Markdown handoff document at `docs/implementation/handoffs/<TASK>/HANDOFF.md`.

```markdown
# <task-id> implementation handoff

## Identity

- Task ID: <task-id>
- Task name: <short-name>
- Worker branch: cloud/<task-id>-<short-name>
- Base SHA: <40-character SHA>
- Source branch: <source branch or "new implementation">
- Source SHA: <40-character SHA or "not applicable">
- Tested SHA: <40-character SHA>
- Contract digest: sha256:<digest>
- Contract scope: packages/contracts
- Integration target: cloud/P00-source-consolidation
- Status: <ready / blocked>

## Purpose

<One short paragraph describing the implemented behavior.>

## File ownership

| Path | Action | Reason |
|---|---|---|
| <path> | <added / modified / removed> | <reason> |

## Source provenance

| Behavior | Source branch | Source SHA | Integration action |
|---|---|---|---|
| <behavior> | <branch> | <SHA> | <preserved / adapted / replaced> |

## Contract changes

- Changed contracts: <paths or "none">
- Compatibility impact: <details or "none">
- API changes: <details or "none">
- Migration changes: <paths or "none">
- Idempotency impact: <details or "none">
- State transition impact: <details or "none">

## Contract digest command

Command:

git ls-tree -r <tested-SHA> -- packages/contracts | sha256sum

Recorded digest:

sha256:<digest>

## Verification

| Command | Exit code | Evidence |
|---|---|---|
| <exact command> | <integer> | <log or file path> |

## Runtime prerequisites

- Package manager: pnpm 10.33.2
- Required services: <services>
- Database: <isolated test database or "not required">
- Environment variables: <names only>
- Setup command: <exact command>
- Test command: <exact command>

## Test results

| Suite | Result | Evidence |
|---|---|---|
| <suite> | <passed / failed / not run> | <log path> |

## Known failures

| ID | Symptom | Reproduction command | Owner | Blocking |
|---|---|---|---|---|
| <id> | <symptom> | <command or TODO> | <task> | <yes / no> |

## Conflicts and decisions

| Conflict | Decision | Decision owner | Evidence |
|---|---|---|---|
| <conflict> | <resolution or pending> | <owner> | <path> |

## Preservation checks

- [ ] No changes outside assigned ownership
- [ ] Canonical namespace preserved
- [ ] Existing functionality retained
- [ ] Protected assets unchanged
- [ ] No unreviewed migrations
- [ ] No new competing persistence authority
- [ ] No secrets committed
- [ ] Required tests executed
- [ ] Known failures disclosed

## Integration instructions

1. <exact command or coordinator action>
2. <exact command or coordinator action>

## Final record

- Base SHA: <SHA>
- Source SHA: <SHA or not applicable>
- Tested SHA: <SHA>
- Contract digest: sha256:<digest>
- Last verification command: <exact command>
- Last verification exit code: <integer>
- Remaining blockers: <IDs or "none">
- Pull request created: no
- Ready for coordinator integration: <yes / no>
```

The base SHA identifies the commit the worker started from. The source SHA identifies the commit the behavior was imported from. The tested SHA identifies the exact tree that produced the reported verification.

The contract digest is calculated from the tested SHA and identifies the same `packages/contracts` tree the worker tested. A worker never reports a branch tip as the tested SHA when later commits changed the tree.

Every command carries its actual exit code. A skipped suite appears as `not run` with a reason. Known failures stay visible even when they fall outside the worker's ownership.

The coordinator rejects a handoff that omits provenance, introduces unapproved shared-package changes, conceals a failure or lacks a reproducible verification command.
