# Wandary (working name)

Laundry pickup and delivery: customer storefront, delivery partner app, WhatsApp
voice-note ordering, and an internal operations console sharing one order engine.

This slice is the foundation. It owns root configuration, `packages/contracts`,
`packages/api-client`, `packages/design-tokens`, `packages/test-fixtures`,
`infra`, and this README. Application code (`apps/customer`, `apps/partner`,
`apps/ops`, `apps/api`) and domain modules belong to later agents and are
intentionally absent here.

## Quick start

```bash
cp .env.example .env
pnpm install
pnpm test:contracts
pnpm test:integration
pnpm check
```

Postgres runs on host port **5448** (not 5432) via `docker-compose.yml`.
Do not start containers for contract tests. API base URL defaults to
`http://localhost:4100/v1`.

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
| `dev:api`, `dev:customer`, `dev:partner`, `dev:ops` | Placeholders. The owning agents add these apps. |
| `check` | Typechecks every package. |
| `test` | Runs every package suite. |
| `test:contracts` | Runs the `@wandary/contracts` behavior suite. |
| `test:integration` | Runs the `@wandary/api-client` mocked-transport suite. |
| `build` | Emits `dist` for every package. |

No script uses `--passWithNoTests`. Suites must exist and pass.

## Pinned toolchain

Node 24. Customer and partner apps will use Expo 52 with Expo Router on React
18.3.1 and React Native 0.76.5 (plus React Native Web). Ops will use React
18.3.1 with Vite 6. The API will use NestJS 11 with `pg` 8. Exact pins live in
the `wandary.pinnedVersions` field of the root `package.json`.
