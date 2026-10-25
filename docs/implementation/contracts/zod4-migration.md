# Zod 4 security migration and review

Baseline: `d03348aa1fcd103aaf698bf98ac3c9df54ad367e`. Scope: coordinator-owned
validator/dependency upgrade and legacy request compatibility, not production
identity or a launch certificate.

All direct consumers now use Zod 4.6.7; a scoped override updates vulnerable
transitive Zod 4 instances too. No old v3 subpath is used to silence the audit.
The oversized constrained-array regression first returned 10,001 issues under
3.23.8; the patched parser rejects it without allocating per-element errors.

## Compatibility and review

The review was performed directly on the diff against the baseline along the
repository Standards and Spec axes. No paid reviewer/model or local subagent was
invoked; the cloud-only/no-PR constraints preclude presenting this as an
independent automated review.

Standards findings addressed:
- Removed private Zod 3 `_def` traversal from the OpenAPI generator. It uses the
  supported JSON Schema converter in input mode; unsupported JSON inputs fail
  rather than becoming unrestricted schemas. Runtime validation remains required.
- Legacy controllers and the pilot reuse the shared ID schema instead of acquiring
  divergent UUID validation through the upgrade.

Spec findings addressed:
- New UUID variant restrictions would reject historical UUID-like identifiers.
  Shared schemas preserve the old syntax with `z.guid()`; tests cover legacy,
  v2 and pilot inputs.
- Enum-keyed records became exhaustive in Zod 4. Partial event-consumer
  registration deliberately uses `partialRecord`, with unknown events rejected.
- Schema extension/refinement internals changed. Existing base shapes and explicit
  cross-field checks are retained for quote/order lines and rider handovers.
- Every normalized versioned wire fixture now asserts exact parsed output,
  rather than only acceptance. Omitted review media defaults, optional error
  fields, strict requests and IST/UTC normalization also have explicit checks.

No unresolved migration-specific review finding remains from this direct review.
This is not a review or completion claim for the entire unfinished v2 product.

## Verification before commit

- `pnpm check`: exit 0.
- `pnpm contracts:generate`, `pnpm contracts:check`: exit 0.
- `pnpm test:tooling`: 72 pass.
- Full workspace tests on a disposable PostgreSQL 17: 627 pass.
- Full build with Node 24.22.0, including both Expo exports: exit 0.
- All four actual API/PostgreSQL/browser scenarios: pass. This working-tree run
  is not a clean-source evidence receipt.
- Production dependency audit: exit 1, **one high** node-forge advisory remains.
  Zod's finding is removed. node-forge 1.4.0 remains the newest published version;
  the referenced upstream fix PR is unmerged. No version is invented and no
  advisory waiver is added.

A subsequent clean revision/cloud run must be checked independently. Production
ordering remains disabled; business/provider/native gates are unchanged.
