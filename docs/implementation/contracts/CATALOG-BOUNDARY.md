# Catalog contract completion (pre-freeze candidate)

C01 remains `BLOCKED_CONTRACT`. This note records the wire corrections made
before B02 was implemented against the candidate. It is not a freeze and does
not approve tariffs, promises or production ordering.

## Gaps closed

- `Service` carried no `version`, while `ServiceUpdate` requires
  `expectedVersion` and the ops route returns `Service`. The client had no way
  to read the version it was required to send. `serviceSchema` now has a
  required positive `version`, and `serviceUpdateSchema` omits it from the
  request body so a caller cannot propose its own version. The server bumps the
  version on every accepted update and returns it.
- The generated OpenAPI for `catalog.rates.effective` declared no query
  parameter, so the service being priced was undefined. The schema name
  `EffectiveRateSummary` resolves to an array in `wire.ts`, which matches the
  plural route summary and the SDK method. The operation now documents an
  optional `serviceCode` filter and returns zero or more summaries. An
  unpublished service with a filter is `NOT_FOUND`; a published service with
  no approved active card is simply absent from the list.
- A schema-name mismatch was left in place: `EffectiveRateSummary` is a list
  wire schema despite the singular name. Renaming it would change every
  generated reference and the SDK for no behavioural gain while the candidate
  is unfrozen. It is recorded here instead of silently altered.

## Compatibility

The v2 namespace has no app consumers and C01 is not frozen, so the candidate
may still change. `Service.version` is additive; `ServiceUpdate` is narrower;
the query parameter is optional. v1 routes and types are untouched. The
generated OpenAPI was rebuilt and the operation inventory is unchanged because
it lists operations, not component schemas.

## Verification

- `pnpm contracts:generate`: 80 paths, 84 operations.
- `pnpm test:contracts`: 103 tests passed.
- `@laundry/api-client`: 146 tests passed.
- `@laundry/test-fixtures`: 231 tests passed.

The freeze SHA, digest and approval remain pending coordinator sign-off. A
digest recorded against a working tree is not a freeze receipt.
