# Customer UI connection to the kilogram pilot

Prepared 21 October 2026. This is the backend handoff for the UI agent; it does
not change the customer app or merge its branch. Runtime wire schemas remain
`packages/contracts/src/pilot.ts`; all calls go through `@wandary/api-client`.
Keep the existing package namespace while integrating.

## Source revisions and composition

- Pilot baseline: `efef160` on `feat/backend-mvp`, PR #3.
- Customer handoff: `4684f72` on `fix/customer-ui-handoff-20261021`.
- Backend reliability and this handoff: `fix/backend-handoff-20261021`.

A `git merge-tree --write-tree --messages efef160 4684f72` trial produced
tree `3547b61fda42ecf4c697b499b9126f4c071c71aa` with no conflicts, including
the lockfile. An exported copy of that tree passed:

```sh
CI=true pnpm install --frozen-lockfile --ignore-scripts --lockfile-only --offline
```

The export lives in ignored `.verification/integration-prep/composition`.
This proves dependency-manifest consistency at those two revisions; it does
not prove the apps use the same order flow. Recheck composition against the
UI agent's final commit. No branch merge was performed.

## Replace the legacy flow explicitly

The existing storefront selects garments and calls `createQuote` /
`createCheckout` for hosted/demo prepayment. The pilot books an estimated
weight and records payment at return. These APIs are different contracts.
Do not send a pilot order ID to legacy checkout, mix the two order histories,
or label a pilot booking as paid.

| Customer surface | Shared SDK call | Required behavior |
| --- | --- | --- |
| Service and pickup selection | `pilotConfig()` | Use only returned service codes and slots. Keep `demo` and `ratesApproved` disclosures visible. |
| Weight selection | No mutation | Use integer grams, 1–50,000. Display kilograms; garment count is not weight. |
| Address | Included in booking | Supply a confirmed address line and latitude/longitude. Let the server reject `OUT_OF_AREA`; do not invent coordinates. |
| Book pickup | `pilotCreateOrder(input, opts)` | One service and one selected slot per pilot booking; retain the idempotency key across uncertain retries. No payment step. |
| Order history/detail | `pilotListOrders()`, `pilotOrder(id)` | Keep order, pickup, return and payment states separate. Display both full windows in the returned timezone. |
| Measured-weight increase | `pilotAction(id, APPROVE_PRICE/DECLINE_PRICE, opts)` | Show measured grams, old total and proposed total before the customer decides. Use the latest version. |
| Cancel before pickup | `pilotAction(id, CANCEL, opts)` | Await server confirmation. Re-fetch after a version conflict; never show a local-only cancellation. |
| Expired/locked code | `pilotAction(id, REISSUE_HANDOVER_CODE, opts)` | Use the selected leg and latest version. Show expiry; the previous code stops working. |
| Reported rider position | `pilotLocation(id)` | Show source and timestamp; label stale data. A 404 may mean no report or closed tracking. No invented movement or ETA. |

The current config contains `WASH_FOLD` and `WASH_PRESS`. Read the returned
rate in minor INR per kilogram; never replace `ratesApproved: false` with a
production price claim. A UI estimate may use
`Math.ceil(estimatedWeightGrams * rateMinorPerKg / 1000)`, but the order's
`totalMinor` is authoritative. Do not add legacy taxes, fees or minimums.

## Booking and safe retries

The SDK methods already exist in the pilot baseline. Adapt the customer's
existing API/session module rather than adding direct fetch calls in screens.
Demo sign-in remains explicitly labeled and requires `DEMO_MODE=true` on the API.

```ts
import { createClient } from "@wandary/api-client";
import type { PilotBooking } from "@wandary/contracts";

const client = createClient({
  baseUrl: configuredApiUrl, // includes /v1; static EXPO_PUBLIC_API_URL on Expo
  getToken: () => currentSessionToken,
});

const config = await client.pilotConfig();
const slot = config.slots.find(value => value.id === selectedSlotId);
if (!slot || slot.reserved >= slot.capacity) {
  // Refresh availability and ask the customer to select another returned slot.
  return;
}

const input: PilotBooking = {
  serviceCode: selectedServiceCode,
  estimatedWeightGrams,
  slotId: slot.id,
  address: confirmedAddress,
};
// Create once per booking intent, before submitting. Retain this same input
// and key for retries after a timeout or lost response.
const idempotencyKey = crypto.randomUUID();
const order = await client.pilotCreateOrder(input, { idempotencyKey });
// Navigate using order.id. order.paymentStatus is UNPAID at booking.
```

Disable duplicate submit while a request is pending. If the response is lost,
retry the identical payload with the same key. Editing the payload starts a
new intent and needs a new key. Calling the SDK again without `opts` generates
a new key and therefore is not a safe uncertain-outcome retry.

Each action needs the latest `expectedVersion` and a retained key per intent:

```ts
const decision = {
  action: "APPROVE_PRICE" as const,
  expectedVersion: latestOrder.version,
};
const updated = await client.pilotAction(latestOrder.id, decision, {
  idempotencyKey: decisionKey,
});
```

On `VERSION_CONFLICT`, fetch `pilotOrder(id)` and present the current terms.
Do not silently approve a new price with an old confirmation. On
`IDEMPOTENCY_CONFLICT`, reconcile the existing intent rather than retrying a
modified payload under its old key. Capacity and serviceability failures need
an explicit alternative choice.

## Status, consent and custody

The usual order path is `BOOKED → PICKED_UP → AWAITING_APPROVAL` (only when
the measured total increases) `→ INTAKE_COMPLETE → IN_CARE → QUALITY_CHECK →
READY_FOR_RETURN → RETURNING → DELIVERED`.

Declining an increase or measuring a lower weight moves the order to
`ON_HOLD`. Explain that processing is held and the founder must contact the
customer. Do not invent a minimum-package charge or an automatic refund.
The supported founder resolution is a customer-agreed unprocessed return
with zero due. That delivered order remains `UNPAID` with `totalMinor=0`;
the truthful customer label is “Nothing due”.

Only the customer receives handover codes. Never render them in rider or
operations surfaces. Pickup completion is not delivery. `UNRESOLVED` payment
must remain visibly unresolved. Only operations records the exact approved
amount as a manual CASH/UPI receipt during return; a payment button in the
customer app must not simulate this authority.

## Verification before handing back the integrated UI

The consumer acceptance test uses the actual shared SDK, Nest API and a real
isolated PostgreSQL database. It verifies parsed configuration and full
windows, booking replay, one reservation, code privacy, measured-price
consent, stale-version refusal and no legacy prepayment for a pilot order:

```sh
DATABASE_URL=postgres://wandary:verification_only@127.0.0.1:5549/laundry_verify_handoff_20261021 \
DEMO_MODE=true \
pnpm --filter @wandary/api exec vitest run test/pilot-customer-client.test.ts
```

Use a disposable `laundry_verify_` database; the test resets pilot tables.
It does not verify native UI behavior, live providers or approved business
rates. The existing recorded pilot journey covers paid return, agreed
unprocessed return and restart persistence. The UI agent must additionally
record the integrated customer app: booking retry, latest-price consent,
outage/recovery, role-appropriate codes and terminal tracking behavior.

WhatsApp conversation drafting still targets the legacy per-garment flow.
Keep it clearly separate; it has not been converted into kilogram pilot
ordering. Pricing Q20, lower-weight Q29, claims policy and automatic messaging
decisions remain unresolved founder inputs, not defaults for this integration.
