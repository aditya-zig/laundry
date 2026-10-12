# Release verification — 12 October 2026

Verified source commit: `8da4409bc05071ded619ada36cff8cffa109d0c6`, pushed to
`build/wandary` in https://github.com/aditya-zig/wandary. No PR created.

## GitHub CI

Run https://github.com/aditya-zig/wandary/actions/runs/38221382306 completed
**successfully**. `verify` succeeded (2m35s) and `deploy-convex` succeeded (28s).
A real PostgreSQL 17 service ran in CI. Full logs confirm:

- API acceptance: 23 tests passed.
- Contracts: 11; SDK: 10; customer: 8; partner: 6; ops: 6.
- Design tokens: 2; fixtures: 2.
- Voice unit tests: 23 passed.
- Workspace build, checks and Convex typecheck passed.

Local Docker sockets were unavailable; the fresh PostgreSQL result above is CI,
not a local run. Earlier docs describing PostgreSQL verification as pending are
superseded by this receipt. Private CI logs stay in ignored `.agent-logs/`.

## Git-built Vercel deployments

Vercel API metadata confirmed the exact SHA above and ref `build/wandary` for
three READY production-target deployments, each aliased to its public site:

- Customer `dpl_GTfCQ9QYHy93pUBNUUpM8wCYzH64`:
  https://laundry-customer-five.vercel.app
- Partner `dpl_3rSaqaNi4NXyu4JqzrwnzGg5oZbw`:
  https://laundry-partner.vercel.app
- Ops `dpl_F8NcnXDeTUBR5HMwfGC1pbPxv7uo`:
  https://wandary.vercel.app

After Git-triggered promotion, fresh browser sessions confirmed customer demo
sign-in/service navigation with quantity inputs, partner sign-in/assigned tasks,
and ops sign-in/order queue. No runtime console errors in these smoke checks.
The earlier complete demo journey is in `deployed-ui-verification.md`.

## Convex

Both environments deployed with typecheck enabled. Production also redeployed
through the successful CI job. Production post-deploy probes passed 9/9:
`evidence/convex-api/report-2026-10-12T08-05-11-364Z.json` (manual deploy
follow-up). Production remains `demoMode=false, liveReady=false`; no catalog
fixtures or fake provider success were enabled. The last full demo/API suite
passed 57/57 and authorization regression passed 23/23.

## Remaining launch work

This is **not production merchant readiness**. Missing live authentication,
verified payment/refund transport, WhatsApp/media/voice transport and Laundry
business/provider configuration remain. The outstanding code-review work also
includes capacity/hold lifecycle, safe reschedule semantics, comprehensive
idempotency, measured intake/inventory, facility membership and moderation.
Backup restore and an actual physical service/refund pilot remain unverified.

No WhatsApp message has been sent. Its completion condition is not met and the
recipient remains unconfirmed. No paid model or commercial provider call was used.

The next commit records documentation/evidence only; source verification belongs
to the explicit SHA above. Do not treat a skipped documentation CI run as a new
source-code test run.
