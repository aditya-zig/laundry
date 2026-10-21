# Laundry cloud deployment runbook

Updated 2026-10-12. Repository: https://github.com/aditya-zig/laundry.
Workspace: `/home/batman/Projects/code/Laundry`. The technical package namespace
is `@laundry`; the Convex project name is **Laundry**.

## Environments

| Component | Location | Current behavior |
|---|---|---|
| Customer | https://laundry-customer-five.vercel.app | Explicit demo, synthetic data |
| Partner | https://laundry-partner.vercel.app | Explicit demo, manual custody workflow |
| Operations | https://laundry-ops.vercel.app | Explicit demo operator console |
| Convex development | hidden-trout-436, Sydney | DEMO_MODE=true, seeded synthetic catalog/users |
| Convex production | dutiful-kangaroo-719, Sydney | DEMO_MODE=false, demo and unconfigured live providers rejected |

Development HTTP API: `https://hidden-trout-436.ap-southeast-2.convex.site/v1`.
Production HTTP API: `https://dutiful-kangaroo-719.ap-southeast-2.convex.site/v1`.
Dashboard: https://dashboard.convex.dev/t/galaxy-d/laundry/dutiful-kangaroo-719.
`laundry-customer.vercel.app` is an unrelated existing website. Use the exact
customer URL above. CORS allows the three approved site origins on the development
backend; local origins are allowed only with demo mode. Public frontend API URLs
contain no server secrets.

## Repeatable deployment

All Vercel projects link to the same GitHub repository. Per-project production
`LAUNDRY_APP` selects `customer`, `partner`, or the default `ops`. The common
build command builds workspace dependencies before the app, copies original
service images, and emits `.web-dist`. Vercel deploys use Node 24 and a frozen
pnpm lockfile. SPA rewrites preserve nested screen links.

```
pnpm install --frozen-lockfile
pnpm check
pnpm check:convex
pnpm exec convex dev --once --typecheck enable
node tools/verify-convex.mjs
pnpm exec convex deploy --yes --typecheck enable
npx vercel deploy --prod --yes --project laundry-customer
npx vercel deploy --prod --yes --project laundry-partner
npx vercel deploy --prod --yes --project laundry-ops
```

GitHub CI runs PostgreSQL acceptance, contracts/app tests, voice unit tests,
builds, and both type checks. Only a successful push to `build/laundry` deploys
the production Convex backend. Its deploy key is a GitHub repository secret,
never a browser variable or committed file. Frontend sites still intentionally
point to the demo backend until the live launch prerequisites below are satisfied.
All three Vercel Git connections were verified to use production branch
`build/laundry`. Public API URLs and app selectors are currently production-only;
configure preview API URLs/app selectors and matching CORS separately before use.
The expanded cloud verifier passes 57 checks and the authorization regression
passes 23 checks. See `deployed-ui-verification.md` for the actual synthetic
customer → partner → operations → return → review browser journey.

## Backup and rollback

A production snapshot was exported on 2026-10-12 and downloaded under ignored
`.data/laundry-production-backup.zip`. It is not a tested restore or an automated
backup schedule. Convex dashboard snapshots expose the same snapshot. Before
live data, configure retention and test restore into a separate environment.
Roll back Vercel by promoting the previous verified deployment; roll back Convex
by deploying a compatible previous commit, checking schema/index differences
first. Code rollback does not undo database writes.

## Live launch prerequisites

Infrastructure is deployed, but a live merchant launch is **not ready**. The
web apps currently expose demo sign-in and capture explicitly. Production OTP,
checkout/refunds, WhatsApp webhooks/media/voice, and external rider dispatch need
actual implementations and Laundry-specific provider configuration. Merely
setting credentials does not enable missing Convex action lanes. HTTP health
reports `liveReady=false` until those capabilities are implemented and verified.

Also resolve the remaining code-review findings before launch: hold lifecycle
and capacity accounting, safe rescheduling against current quotes, idempotency
on all mutating routes, full intake reconciliation and inventory/custody audit,
secure facility membership (facility access currently fails closed), media and
review moderation, and tested backup restore. Passing demo checks is not a
complete security or production-readiness certification.

Required: real customer authentication and secure session storage; staff SSO/MFA
and rider provisioning; payment checkout, verified capture/refund webhooks;
WhatsApp Business number, consent and verified media/webhook transport; hosted
speech transcription; contracted rider dispatch and verified tracking events;
approved service area, prices, taxes, facility capacity and refund policy.
Never enable demo mode on production to bypass these prerequisites. Do not reuse
other projects' merchant or messaging credentials.

The user received a demo recording and links in their confirmed WhatsApp self-chat.
The separate production-completion notification remains pending because the
fully verified production-service condition is not met.
