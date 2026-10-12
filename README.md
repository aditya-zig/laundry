# Wandary (working name)

Laundry pickup and delivery: customer storefront, delivery partner app, WhatsApp
voice-note ordering, and an internal operations console sharing one order engine.

This repo holds the working implementation: `apps/api` (NestJS + PostgreSQL),
`apps/customer` and `apps/partner` (Expo + React Native Web), `apps/ops`
(React + Vite), domain modules under `modules/`, shared contracts, typed
client, design tokens and fixtures under `packages/`. External providers
(payments, logistics, WhatsApp, speech) run through explicitly labeled
simulators or local tooling until real credentials and contracts are supplied.
No simulated result is described as a live payment, courier dispatch, or
WhatsApp delivery.

## Cloud deployment

The hosted backend uses **Convex**. Customer, partner, and operations web apps
are separate Vercel projects using the same versioned REST contract.
The PostgreSQL implementation remains available for local development.

- [Customer demo](https://laundry-customer-five.vercel.app)
- [Delivery partner demo](https://laundry-partner.vercel.app)
- [Operations demo](https://wandary.vercel.app)

These sites use the development Convex deployment and synthetic demo data.
The separate production deployment has `DEMO_MODE=false`; live authentication,
payments, WhatsApp, speech, and courier integrations are unavailable and rejected
explicitly. Deploying infrastructure does not make those integrations ready.
See [cloud deployment runbook](docs/implementation/cloud-deployment.md).

For local screens connected to Convex, set `EXPO_PUBLIC_API_URL` and
`VITE_API_URL` to the HTTP actions URL ending in `/v1`, then run
`pnpm dev:cloud`. No local database is required for this mode.

## Quick start

```bash
cp .env.example .env
docker compose up -d postgres
pnpm install
pnpm test:contracts
pnpm test:integration
pnpm check
```

Postgres runs on host port **5448** (not 5432) via `docker-compose.yml`.
API base URL defaults to `http://localhost:4100/v1`. Start the API with
`pnpm dev:api` (or `pnpm --filter @wandary/api start` after
`pnpm --filter @wandary/api build`); customer/partner web previews with
`pnpm dev:customer` / `pnpm dev:partner`; ops console with `pnpm dev:ops`.
Web previews default to the local API when `EXPO_PUBLIC_API_URL` /
`VITE_API_URL` are unset.

## Demo credentials

`.env.example` holds development-only demo phones and `000000` as the demo OTP.
Production uses a real OTP/SMS vendor and separate credentials. Nothing here is
a real customer, price, or address. Fixtures carry a `demo-only` label.

## Wire contract

All routes live under `/v1`. Success returns direct resource or list shapes.
Errors return `{code,message,traceId,retryable}`. Key flows:

- `POST /auth/otp/request {phone}` then `POST /auth/otp/verify {challengeId,code}`
  gives `{token,user}`. `POST /auth/demo {role}` works in demo mode only.
- `POST /quotes` takes `{addressId,lines,pickupWindow,requestedReturnBy,timezone}`
  and returns a versioned `Quote`. `POST /checkouts {quoteId}` returns
  `{orderId,paymentId,paymentUrl,expiresAt,status}`.
- `GET /orders` lists, `GET /orders/:id` returns one `Order`.
  `POST /orders/:id/cancel {reason,expectedVersion}` cancels.
- `POST /demo/payments/:id/capture` captures in demo mode only.
- `GET /services` returns the service array. Reviews round-trip through
  `POST /reviews` and `GET /services/:id/reviews`.
- Partner jobs: `GET /partner/jobs`, `POST /partner/jobs/:id/accept`,
  `/handover {expectedVersion,actionId,bagIds,otp?,method}`, `/exception`.
- Ops: `GET /ops/orders`, intake, care, `GET /ops/deliveries`, dispatch, refunds.
- Conversations: `POST /demo/conversations/messages {text,receivedAt?,draftId?}`
  returns `{draft,reply,missingFields}`. Confirmation posts to
  `POST /conversation-drafts/:id/confirm` with the current revision.

Types and zod schemas live in `@wandary/contracts`. The typed fetch client is
`@wandary/api-client`. Full route list is in `packages/contracts/openapi.yaml`.

## Scripts

| Script | What it does |
|---|---|
| `dev:api` | Runs the NestJS API with reload (`tsx watch`, port `PORT` or 4100). |
| `dev:customer`, `dev:partner` | Serve the Expo customer / partner web preview. |
| `dev:ops` | Runs the ops console (Vite dev). |
| `dev` | Supervises API + apps as one process group (`tools/dev.mjs`). |
| `db:start` | Starts local Postgres (port 5448). |
| `check` | Typechecks every package. |
| `test` | Runs every package suite. |
| `test:contracts` | Runs the `@wandary/contracts` behavior suite. |
| `test:integration` | Runs the `@wandary/api` acceptance suite against real local Postgres (no mocks; refuses non-local databases). |
| `test:e2e` | Alias of the API acceptance suite. |
| `test:voice` | Runs the local voice-transcriber Python tests. |
| `build` | Emits `dist` for every package. |

No script uses `--passWithNoTests`. Suites must exist and pass.

## Pinned toolchain

Node 24. Customer and partner apps will use Expo 52 with Expo Router on React
18.3.1 and React Native 0.76.5 (plus React Native Web). Ops will use React
18.3.1 with Vite 6. The API will use NestJS 11 with `pg` 8. Exact pins live in
the `wandary.pinnedVersions` field of the root `package.json`.
