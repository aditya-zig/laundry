# Laundry backend MVP implementation plan

**Goal:** One locally usable, PostgreSQL-persisted kg-based order from booking through pickup, intake approval, care, return and a manually confirmed payment record.

**Architecture:** Add a bounded `/v1/pilot` API inside the existing NestJS application. Preserve legacy routes and namespaces. Shared contracts and SDK own the wire format; a thin browser console uses the SDK for customer, operator and assigned-rider views. PostgreSQL locks, versions and idempotency protect capacity, transitions and receipts. Leaflet/OpenStreetMap display reported coordinates; navigation opens an external directions provider.

**Authority:** Today's explicit request authorizes this MVP implementation and browser verification. Prior founder decisions govern kg selection, consent before increased-price processing, payment at return, manual rider operations and founder authority. Unresolved decisions are held rather than guessed.

**Test seams:** Public authenticated HTTP endpoints backed by a private PostgreSQL database, plus real browser interactions requested by the user. No mocked database and no private-function assertions.

## Boundaries

- Worktree `feat/backend-mvp` starts at the committed tooling baseline; preserve the original dirty Landary checkout.
- Real persistence and role authorization; explicitly demo-only sign-in, example prices, service boundary and slots. No actual SMS, WhatsApp sending, payment capture or physical delivery is claimed.
- Sample rates are test fixtures, not approved launch rates. Lower measured weight goes on hold pending the deferred package/billing policy.
- Rider coordinates include provenance and freshness. Never manufacture movement or an ETA. No proprietary competitor code or assets copied.
- Separate order, pickup/return leg and payment states. An unpaid return cannot be completed.
- No production deployment, existing cloud-account changes or merges.

## Public interfaces

- `GET /v1/pilot/config`: demo services/rates, available slots, sample boundary, facility, rider choices for operations.
- `POST /v1/pilot/orders`: customer creates a booking with service code, estimated grams, slot and coordinate/address snapshot; idempotency key required.
- `GET /v1/pilot/orders`, `GET /v1/pilot/orders/:id`: actor-scoped queue/detail, versions, events, permitted codes and location freshness.
- `POST /v1/pilot/orders/:id/actions`: typed/versioned/idempotent assignment, pickup, intake, approval/decline, care, quality check, return dispatch, manual receipt confirmation and handover.
- `POST /v1/pilot/orders/:id/location`: assigned-rider report; coordinates, capture time and browser/manual-test provenance.
- `PUT /v1/pilot/slots/:id`: operator sets capacity without reducing below reservations.

## Implementation slices

1. Booking contract and capacity: write one failing HTTP test; implement schema, migration, pilot config and booking; verify persistence, replay and concurrent last-slot behavior.
2. Fulfillment: one failing transition test at a time; implement role-scoped assignment, customer-only codes, pickup, intake approval and care gates. Check stale versions, other-customer/rider denial, declined/lower-weight holds and wrong codes.
3. Return/payment: test unpaid return rejection, exact-amount manual receipt, idempotent duplicate receipt and final handover. Preserve immutable audit events and separate payment state.
4. Maps and browser console: expose only authorized current location with timestamp/provenance; build minimal role views using shared SDK and existing Laundry colors. Show map errors and navigation handoff honestly.
5. Verification: run existing and new backend tests, workspace checks/build, browser happy path and important rejection paths. Record actual browser use/video, restart to verify persistence and document exact limits.

## Review risks

- Two requests competing for the last capacity place must yield exactly one booking.
- Duplicate/retried actions must not create another receipt, event or booking.
- Rider reassignment must immediately revoke former rider access; codes stay customer-only.
- Price changes cannot advance care without customer consent; lower-weight policy stays unresolved.
- A stale location or failed tile request must not appear as live tracking/navigation.

## Reference research

Inspect the requested `morluto/rea` toolkit and run bounded static analysis on public client artifacts where obtainable. Record blocked downloads and limitations. Public websites and engineering posts reveal client behavior and published patterns, not private operations backends. Use original code and licensed open-source libraries for implementation.
