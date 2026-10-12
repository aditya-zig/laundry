# Convex API verification

Independent check of the real deployed Convex backends against the shared
contracts and the custody and idempotency flows. Owned by the verifier lane.
Script: `tools/verify-convex.mjs`. Evidence JSON lands in
`docs/implementation/evidence/convex-api/`. Reports carry counts and error
codes only. No tokens, OTP values, or personal data are printed or stored.

## How to run

From the repo root:

```
node tools/verify-convex.mjs
node tools/verify-convex.mjs --skip-demo
node tools/verify-convex.mjs --skip-prod --wait-secs 20
```

The script polls the demo `/health` for up to `--wait-secs` seconds, then
runs real HTTP flows with synthetic demo users only. It validates responses
with the actual Zod schemas from `packages/contracts`. Exit 0 means every
required check passed. Exit 1 means something failed or was blocked. Run it
without a pipe, or with `pipefail`, so the exit code is the script's.

## Verified follow-up, 12 Oct 2026

The initial OTP defect below is **resolved**, not a current blocker. The engine
was hardened and both environments redeployed. Two later complete runs passed
**50 checks, 0 failures, 0 blocked** (41 demo checks plus 9 production checks):

- `evidence/convex-api/report-2026-10-12T07-17-03-385Z.json`
- `evidence/convex-api/report-2026-10-12T07-35-48-742Z.json`

Production OTP requests now reject with `501 PROVIDER_UNAVAILABLE`, rather than
minting an unsent challenge. Production reports `demoMode=false, liveReady=false`.
These checks prove tested boundaries, not a live launch or complete security
coverage. Resume review found additional role-access gaps; see
`resume-code-review.md` and the subsequent authorization-hardening report.

After authorization/dispatch/custody hardening, the expanded suite passed
**57/57** in `evidence/convex-api/report-2026-10-12T07-56-43-569Z.json`.
The independent wrong-role regression passed **23/23**; redacted evidence is
`evidence/convex-api/authorization-2026-10-12.txt`. Manual jobs now require
operator assignment before rider visibility and handover. These checks do not
resolve every remaining code-review or live-provider launch prerequisite.

The verifier now rotates synthetic future dates to avoid reusing occupied test
capacity buckets. It does not increase capacity to hide rejection.

## Initial result (historical), 12 Oct 2026

Demo cloud `https://hidden-trout-436.ap-southeast-2.convex.site/v1`:
41 pass, 0 fail, 0 blocked. An immediate rerun also passed 41 of 41, so the
script is reproducible while earlier capacity holds are still active.

Production `https://dutiful-kangaroo-719.ap-southeast-2.convex.site/v1`:
8 pass, 1 fail, 0 blocked. The one failure is a real bug, described below.

At first probe the demo cloud answered 404 with HTTP actions disabled. The
main lane deployed during this check, and the full suite then ran green.
I deployed nothing and changed no engine or transport files.

## What the demo run covers

Catalog, login roles, and quotes. Service list and detail validate against
the contract schemas. Demo login issues customer, rider, and operator
sessions, unknown roles get 400, and `/me` reflects the role. A valid quote
prices in minor-unit INR. A return earlier than the slowest turnaround gets
422 DEADLINE_UNAVAILABLE. A third concurrent hold in one slot gets 409
NO_CAPACITY. Nothing is silently replaced.

Checkout and payment. Same idempotency key plus same payload replays the
original order and payment. Same key plus a different quote gets 409
IDEMPOTENCY_CONFLICT. A stale quote version gets 409. Duplicate capture of
one payment returns the same order view, and an unknown payment is 404.

Roles and custody. An unassigned rider reading a customer order gets 404. A
customer reading the ops queue or partner jobs gets 403. Pickup handover
needs the correct OTP: missing OTP, wrong OTP, and photo-only provider
proof all get 400. Pickup completion leaves the order in PICKUP_PENDING.
The return OTP stays hidden until READY_FOR_RETURN, and the return handover
with valid proof is what delivers the order.

Ops and reviews. Matching intake reconciles to AT_FACILITY, and care walks
to READY_FOR_RETURN. A count mismatch opens AWAITING_ADJUSTMENT and care is
gated with 409 REQUIRES_APPROVAL until the adjustment is decided. A stale
cancel gets 409 VERSION_CONFLICT. The first review of a delivered order is
accepted, a second is 400, and reviewing an undelivered order is 400.

Conversation drafts. Partial text stays COLLECTING and names what is
missing. A full text with service, count, pickup window, and return date
quotes and binds the quote. A stale revision confirms with 409, the current
revision checks out, and a mismatched draft binding is 400. A bad WhatsApp
sender phone is 400 with no address disclosed, and a raw inbound webhook is
501 with nothing booked or faked.

## Resolved initial bug: live OTP lane minted unsent challenges

Production `POST /v1/auth/otp/request` returns 200 with a challenge ID even
though no SMS provider is configured and no code is delivered. The repo
engine gates this lane behind DEMO_MODE with 501 PROVIDER_UNAVAILABLE, so
the deployed production build behaves differently from the source. The
challenge can never be verified, which leaves an ungated unsent lane in
real mode. Suggested fix: redeploy production from the current engine
source, or gate the OTP lanes the same way checkout and refunds are gated.
Repro: `node tools/verify-convex.mjs --skip-demo` shows `prod-otp-reject`
as the single FAIL.

## Production boundaries that hold

Demo auth is 403 FORBIDDEN in real mode. Payment webhooks, media, and voice
lanes answer 501 PROVIDER_UNAVAILABLE. The WhatsApp handshake with no
verify token configured answers 502. Unauthenticated writes are 401. The
public catalog reads fine and validates against the service schema, with
zero services seeded, which is the correct empty live state.

No full production claim follows from this. Provider lanes refuse with
explicit 501, the notification outbox is unsent by design, and live payment
and messaging need credentials plus signature-verified transport that this
check does not provide.
