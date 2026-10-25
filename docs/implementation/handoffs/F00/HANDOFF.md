# F00 handoff — shared v2 session foundation candidate (RECOVERED/UNINTEGRATED slice)

Status: IN_PROGRESS (initial handoff, updated incrementally)
Source SHA: a34281a2bad86b67f5de0ae0742652fd6a4d3f82
Inherited baseline: 16eddf74e29945932a8042d2aae88c944ea6c9f1
Candidate OpenAPI SHA256 (declared): 1e14e90db26d9715e187b70e361a4283713f4a37396367635c09c36945227626
Contract target: `laundry-wire-v2.0.0` (no freeze claimed by F00; C01-owned)

## Scope actually owned here

- `packages/app-foundation/**` (new TOML-free pure-TS package: manifest, tsconfig, src, tests)
- `apps/{customer,partner,ops}/src/foundation/**` (new modules only)
- `apps/{customer,partner,ops}/src/api-v2.ts` (new files only; v1 adapters untouched)
- `docs/implementation/handoffs/F00/**` (this file, evidence.json)

Not owned / untouched: root manifests+lockfile, CI, packages/contracts, packages/api-client,
canonical migrations, app composition, existing v1 adapters, routes, layouts.

## Changed files (updated as work lands)

- (pending)

## Commands and results

- (pending — will be recorded with real argv and exit codes; no test results are
  claimed before they are actually run in this working tree.)

## Remaining blockers / integration requests for coordinator

1. Add `packages/app-foundation` to the pnpm workspace build/typecheck/test graph
   (root lockfile regeneration is coordinator-owned).
2. Wire consumer manifests (`apps/{customer,partner,ops}`) to depend on
   `@laundry/app-foundation` and expose its modules through their own manifests.
3. Scope security review of the in-memory-access-token / injected-secure-store design
   before any release claim.

## Explicit non-claims

No browser, native, provider, physical or PostgreSQL-backed acceptance has been
performed by this task yet. No contract freeze, B01-B10 integration, or production
readiness is claimed. Native secure-store is modeled as a port; a device result is
not fabricated. The apps' v1 adapters, routes and layouts remain unchanged.
