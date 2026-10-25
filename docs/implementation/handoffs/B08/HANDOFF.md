# B08 support incidents, rewash requests and consented reviews

Baseline: branch `work/production-direct-20261022`. Built against the frozen
`laundry-wire-v2.0.0` contracts as published in `packages/contracts/src/v2`.
No notification provider, syndication feed, moderation model or production
support channel is claimed.

## What is implemented

`modules/schema/proposals/B08.sql` adds `support_v2_incidents`,
`support_v2_incident_messages`, `support_v2_rewashes`, `reviews_v2` and
`reviews_v2_moderation_events`. The proposal is applied to the disposable test
database only. It seeds nothing and references `orders_v2_orders`,
`identity_profiles` and `identity_staff` rather than any v1 table.

The tables carry a `v2` suffix because migration `001_backend.sql` already owns
`support_incidents` and `reviews` with different columns and foreign keys into
`orders` and `users`. Reusing those names would have silently skipped creation
and written production rows into the demo schema.

`modules/support/src/v2.ts` serves the six published support operations:

- `POST /v2/orders/{orderId}/incidents` opens an incident on an order the
  caller owns. Another customer's order is `NOT_FOUND`, so the route does not
  confirm that the order exists.
- `GET /v2/incidents` lists owned incidents, newest first, with a keyset cursor.
- `GET /v2/incidents/{incidentId}/messages` reads the thread for the owning
  customer or for `OPERATOR`, `SUPPORT` and `ADMIN`.
- `POST /v2/incidents/{incidentId}/messages` appends one message under a
  per-incident lock, so sequence numbers cannot collide. A customer writing to
  another customer's incident gets `NOT_FOUND`.
- `POST /v2/ops/incidents/{incidentId}/resolve` closes an incident with an
  outcome, a reason and a refund amount only when the outcome is `REFUND`. The
  row records the deciding staff id and time, and `v2_audit` records
  `INCIDENT_RESOLVED` with the previous and new state.
- `POST /v2/incidents/{incidentId}/rewash-requests` creates one rewash request
  for an incident whose order has reached `READY_FOR_RETURN`, `RETURNING` or
  `DELIVERED`. The order status, version and timeline are untouched.

`modules/reviews/src/v2.ts` serves the four published review operations:

- `GET /v2/reviews/eligibility/{orderId}` projects eligibility from the order
  status and the existing review. It is not stored, so it cannot drift.
- `POST /v2/orders/{orderId}/reviews` requires a delivered order, the current
  order version and one row per order and customer. A review is always created
  `PENDING`, with the submitted consent recorded.
- `POST /v2/ops/reviews/{reviewId}/moderation` requires an operator, the current
  review version and a reason. `PUBLISH` needs recorded consent and approved
  media. `REJECT` removes pending or published content. `HIDE` removes published
  content. Every decision appends a `reviews_v2_moderation_events` row and a
  `REVIEW_MODERATED` audit entry. A rejected review cannot be published later.
- `GET /v2/reviews` returns published, consented reviews only, newest first,
  with a masked display name and an optional `serviceId` filter. An empty feed
  is a valid page.

Every mutating handler runs through `createPostgresCommandExecutor`, so a
repeated key returns the stored row and a reused key with a different body is
`IDEMPOTENCY_CONFLICT`. Read handlers never mutate. Errors use the same envelope
fields as `OrdersFault`, translated by `SupportEnvelopeFilter` and
`ReviewsEnvelopeFilter`.

## Deliberate limits (blockers, not waivers)

- **No notification delivery.** Incidents, messages and resolutions write rows
  and audit entries. No SMS, WhatsApp, email or push message leaves the process.
- **No public review syndication.** `GET /v2/reviews` is the only public
  surface. Nothing is pushed to search engines, marketplaces or partner feeds.
- **No automated moderation model.** Publication is a human decision plus two
  recorded facts: consent and media approval. The media approval port is a
  function, and its default denies every media id until B07 is wired.
- **Media ids are not verified for existence.** B07 owns media records. B08
  only refuses to publish a review whose media the port has not approved.
- **No refund or order mutation from an incident.** `REFUND` is recorded as an
  outcome with its amount. B05 owns the refund. An incident never changes an
  order state or completes the original order.
- **Rewash completion is not implemented.** There is no published route to move
  `REQUESTED` to `APPROVED`, `IN_PROGRESS`, `COMPLETED` or `DECLINED`, so
  `completedAt` stays unreachable through the API.
- **Incident statuses `AWAITING_CUSTOMER` and `AWAITING_FACILITY` are unused.**
  Messages do not move the incident status. Only an audited resolution closes
  it.
- **The rewash route is customer-scoped.** The issue text describes a rewash
  created by operations, while the published route lists `CUSTOMER`. B08 follows
  the route registry. An operator records the `REWORK` outcome through incident
  resolution instead.
- **Rewash bumps the incident version.** The link is stored on the incident, so
  its version increments and the returned rewash row is the only payload. A
  client should re-read the incident list before the next versioned command.
- **The public feed accepts an undeclared `serviceId` query.** The published
  route declares no query schema, but `@laundry/api-client` always sends
  `serviceId`. B08 accepts it, validates it as an id and filters on order lines.
- **Registration is pending.** `SupportModule` and `ReviewsModule` are not wired
  in `apps/api/src/app.module.ts`, which this task does not own. The coordinator
  needs to add both `register` calls with the shared `authenticate` function.

## Scenario status

- `B08-01`: covered. Another customer and an operator are refused. The owner
  creates one review, the same key returns the same row, a second key is
  `INVALID_INPUT`, and eligibility flips to ineligible with the existing id.
  Undelivered orders and stale order versions are also refused.
- `B08-02`: covered. A review without consent and a review with unapproved
  media both fail `PUBLISH` with `REQUIRES_APPROVAL` and stay out of the feed.
  Approving the media publishes it. A rejection cannot later be published, and
  hiding a published review removes it from the feed with two recorded events.
- `B08-03`: covered. A rewash request exists while the original order keeps
  `DELIVERED` and its version. Repeating the request with a new key is
  `INVALID_INPUT`. A rewash before return is refused. Resolution by a customer
  is `FORBIDDEN`, a stale version is `VERSION_CONFLICT`, and the first accepted
  resolution is the only one; the audit row carries the deciding staff id.
  A refund outcome without an amount fails validation.
- `B08-04`: covered. Customer B cannot read, append to or open an incident on
  customer A's order. Operators cannot list customer incidents. Support can read
  the thread. An incident create and a message append each replay once, sequences
  are 1 then 2, and one key with a different body is `IDEMPOTENCY_CONFLICT`.
- `B08-05`: the issue file defines only B08-01 through B08-04. A derived case is
  included for the checklist item about empty public behavior: the feed is empty
  before moderation, one published review appears after it, the service filter
  works, and one decision writes one moderation event and one audit row.

## Verification

- `pnpm --filter @laundry/api typecheck`: exit 0.
- `node tools/cloud/postgres.mjs exec -- pnpm --filter @laundry/api test
  support-reviews-v2`: exit 0, 11 tests passed in 1 file on disposable
  PostgreSQL 17.
- The suite applies `modules/schema/proposals/B08.sql` in `beforeAll` after
  `initializeDb` and truncates the B08 tables before every case.
- Orders, profiles, staff and addresses are seeded with SQL. No test calls
  `OrdersService`.
- The HTTP case runs the real `@laundry/api-client` against a Nest app built from
  both modules and checks incident create and list, message append and read,
  rewash, review create, eligibility, the published feed, ops resolve, ops
  moderation, a customer cross-scope 404 and an anonymous 401.

Production support and reviews remain disabled.
