# Pilot backend MVP: build, run and verification

Branch `feat/backend-mvp`, base commit `fc8e58f53707cf8fcea3763137e0f469311f1aa3`.
This document covers the kg-priced laundry order pilot: the API, the browser
console that drives it, and the current-revision evidence.

**Stable handover:** product source and tests are frozen. The implementation
docs and ignore rules were repaired at 2026-10-20T20:10Z; the repaired tree hash
is in the fingerprint section. No further product or test edits will be made.
The recorded run `20261020191753` used paid order
`48c872fe-9b38-4a96-bfc1-113241f748b7` and hold order
`e9c0fde8-07a1-42f9-90fa-3bea177d98b9`. A later manual interactive check
completed order `37a69188-e9bc-4a04-9936-748b25842892`; it is supplementary
proof, not part of that run. The review session can validate read-only; no merge
or deploy has happened.

## What it is

One order that a customer books by the kilogram, a delivery partner collects
and weighs, the founders process, and the customer pays for at the door.

Order states are separate from the delivery legs and the money:

- `status`: BOOKED, PICKED_UP, AWAITING_APPROVAL, INTAKE_COMPLETE, IN_CARE,
  QUALITY_CHECK, READY_FOR_RETURN, RETURNING, DELIVERED, ON_HOLD, CANCELLED.
- `pickupStatus`: PENDING, ASSIGNED, COMPLETED.
- `returnStatus`: PENDING, READY, ASSIGNED, COMPLETED.
- `paymentStatus`: UNPAID, UNRESOLVED, PAID.

Rules that came from the founder's recorded answers, not invention:

- The load is weighed after pickup. A higher measured weight needs the
  customer's approval before work starts (Q13, Q21).
- A lower measured weight or a declined increase puts the order on hold. The
  founder can release it only as a customer-agreed unprocessed return; no
  minimum or fee is invented (Q29 open).
- Payment is collected at return and recorded by hand. No gateway moves money
  (Q16, Q22).
- An unpaid return cannot be completed unless the order has nothing due after
  an agreed unprocessed return.
- Handover codes are read out by the customer, expire after the slot window
  plus 12 hours, and lock after five wrong attempts. The customer can reissue
  a code without staff SQL; the other leg and the rider assignment survive.
- A reported position carries its source and capture time. A point older than
  two minutes is stale, not live tracking. Browser coordinates are explicitly
  self-reported, not attested GPS. Tracking closes after delivery.
- The pilot is demo-only: demo sign-in, unapproved per-kg rates and a manual
  receipt. The API refuses production with demo settings.

## Run it

The demo needs PostgreSQL. The local container is isolated from the old
`wandary` database on port 5448:

```bash
docker start laundry-mvp-postgres   # 127.0.0.1:5549, db laundry_verify_mvp

cd /home/batman/Projects/code/.worktrees/laundry-backend-mvp
pnpm install --frozen-lockfile

# API on 4100 (migrations run on boot)
DATABASE_URL="postgres://wandary:verification_only@localhost:5549/laundry_verify_mvp" \
DEMO_MODE=true PILOT_ENABLED=true PORT=4100 \
pnpm --filter @wandary/api dev

# Console on 5175 (proxies /v1 to the API)
PILOT_API_URL=http://localhost:4100 \
pnpm --filter @wandary/pilot-console exec vite --port 5175 --strictPort
```

Then open http://localhost:5175 and use the three tabs. Each tab signs in with
the seeded demo account. `PILOT_ENABLED` must be `true`; `DEMO_MODE` must be
the literal string `true`. The API binds `127.0.0.1` unless `HOST` is set.

`?as=customer|operator|rider` deep links remain for review screenshots. They
only produce a demo session; the API rejects demo auth when `DEMO_MODE` is off.

## Checks

Run acceptance suites against a disposable database. They truncate the pilot
tables; never point them at `laundry_verify_mvp` while evidence orders are
being used.

```bash
DATABASE_URL="postgres://wandary:verification_only@localhost:5549/laundry_verify_builder_20261021" \
DEMO_MODE=true CI=true \
pnpm install --frozen-lockfile
# then build, check, check:convex, test, test:voice with the same env
```

Current results, exit codes unmasked:

| Check | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | pass, exit 0 |
| `pnpm build` | pass, exit 0 |
| `pnpm check` | pass, exit 0 |
| `pnpm check:convex` | pass, exit 0 |
| `pnpm test` | pass, exit 0: API 43 (23 legacy + 20 pilot), SDK 16, contracts 11, customer 8, ops 11, partner 6 |
| `pnpm test:voice` | pass, exit 0 (23 tests) |
| `node tools/verification/pilot-console.mjs` | pass, exit 0, run `20261020191753` |
| `node tools/verification/check-persistence.mjs ...` | pass before and after API restart, exit 0 |
| Taste inspector, customer/operator/rider | 0 FAIL, 0 WARN at 1440/768/390 |

CI now provisions `laundry_verify_ci` in both lanes. The local CI-equivalent
run used `laundry_verify_builder_20261021`; the browser demo used
`laundry_verify_mvp`.

## Browser evidence

The script drives Chromium through the paid lifecycle, a founder-resolved hold,
wrong-code rejection, unpaid-delivery rejection, map escaping, input retention
and a double submit. It asserts the exact current status pill and reads the
same order through the shared SDK after each milestone.

Files in `docs/implementation/evidence/pilot/` (ignored, hashes in the
manifest):

| File | What it shows |
| --- | --- |
| `01-customer-booked.png` | booking, pickup code, IST window, tracking steps |
| `02-customer-map-escaped.png` | literal `<b>map text</b>` in the map popup |
| `03-ops-assigned.png` | operations queue with the rider assigned |
| `04-rider-picked-up-and-position.png` | pickup, weighed intake, manual position provenance |
| `05-customer-approved-price.png` | customer approving ₹360 for 6 kg |
| `06-ops-care-complete.png` | washing, quality check, ready for return |
| `07-rider-returning.png` | return leg before payment |
| `08-ops-payment-recorded.png` | manual payment receipt |
| `09-customer-delivered.png` | exact pill `Delivered`, label `Paid at return` |
| `10-ops-hold-resolved.png` | founder release of a held order |
| `11-customer-nothing-due.png` | zero-total return, label `Nothing due` |
| `pilot-flow.webm` | full browser session |
| `summary.json` | run id, order ids, persisted states, steps, console errors |
| `restart-persistence.log` | before/after restart reads and PID change |
| `ci-equivalent.log` | install/build/check/convex/test/voice exits |
| `taste-inspector.log` | three-role inspector results |

The restart check changed the API child PID from `72360` to `80826`. The paid
order still read `DELIVERED/PAID/36000`; the hold order still read
`DELIVERED/UNPAID/0`; tracking returned 404.

The latest manual interactive check is separate from this run. Order
`37a69188-e9bc-4a04-9936-748b25842892` reached `DELIVERED/PAID`,
`totalMinor=36000`, `measuredWeightGrams=6000`, version 11. It is
supplementary proof only. It is not one of the 17 hashed artifacts and is not
part of run `20261020191753`.

## Review disposition

`docs/implementation/pilot-review-disposition.md` has one row per accepted fix
group and the remaining Standards, Security and Architecture findings, with
FIXED, DEFERRED or NOT APPLICABLE/DISPUTED status and the exact check.

`docs/implementation/pilot-evidence-manifest.md` is the tracked, reproducible
manifest. Evidence binaries stay local and are never committed.

## What this is not

- The per-kg rates (₹60 wash and fold, ₹90 wash and iron) are placeholders.
  No rate, minimum or increment is approved (Q20 is deferred).
- The service area is a hard-coded Indiranagar box for the demo, not the
  agreed boundary (Q14).
- Pickup and return are one-hour slots with capacity 3. A full slot refuses
  with `NO_CAPACITY`; operations can raise capacity.
- Sign-in is the demo session, payment is a hand-written receipt, messaging is
  not wired, and no delivery actually happens.
- The map shows reported coordinates on OpenStreetMap tiles. It is not live
  tracking: no ETA, no route calculation, no attested GPS.
- OTP throttling, session expiry, token hashing, real provider auth, the
  namespace reconciliation and the architecture refactors are deferred. See
  the disposition for triggers.
- The `005_pilot_windows.sql` migration is additive but did run against the
  shared browser DB. It added timezone/window/expiry fields to all existing
  pilot orders, including reviewer order `088fa2e3`. That order remains
  `BOOKED/UNPAID`, version 1; no status, payment, rider or capacity field
  changed. No browser DB table was truncated.

## Fingerprint

```text
TREE_SHA=a5650c0dc36e3c15250e35ed12cae6bf4e3bf0b91012c4b6fc1c465d164bdb2e
```

The command is in `pilot-evidence-manifest.md`. The hash is the SHA-256 of the
tracked per-file manifest
`docs/implementation/pilot-fingerprint-inputs.sha256`. The command fixes
`LC_ALL=C` path order and excludes the ignored evidence,
local skill output, local skill install, the three handover documents, and the
input manifest that records the hash. The earlier `b1452f...` value came from
the same pre-repair inputs under a locale-sensitive sort order; the manifest
records the trace.
