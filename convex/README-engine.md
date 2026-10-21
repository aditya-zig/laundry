# Laundry Convex engine

Real Convex backend. One frozen internal mutation owns every state change.
No public functions exist, so the HTTP lane cannot bypass auth.

## Files

- `schema.ts` — typed tables. Wire IDs are UUIDs in a separate `lid`
  field with indexed lookup. Convex document IDs never leave the server.
- `engine.ts` — `dispatch` (frozen args `{ method, path, token, body,
  idempotencyKey }`, returns `{ status, body }`) plus demo-gated
  `seedDemo`. Both are `internalMutation`; the HTTP lane calls them with
  the Convex HTTP action or server client owned by main.
- `lib/hash.ts` — canonical JSON plus pure-TS SHA-256 for stable
  idempotency hashing. No Node crypto.
- `lib/ids.ts` — Web-Crypto UUIDs, session tokens, 6-digit OTPs.
- `lib/errors.ts` — error envelope `{ code, message, traceId, retryable }`
  with the shared status map.
- `lib/validate.ts` — self-contained wire validators mirroring
  `packages/contracts` schemas. No zod import, so bundling never breaks.
- `lib/catalogSeed.ts` — demo catalog. Logical IDs and INR minor-unit
  prices match the local fixtures. Images resolve as
  `{ASSET_BASE_URL}/assets/services/*.png`.
- `lib/conversation.ts` — demo draft parser ported from the local
  conversation module. Asks for missing fields, never guesses.

## Rules

- `DEMO_MODE` must be exactly `"true"` for demo auth, demo capture, demo
  handover codes, demo proof refs, and seeding. Anything else is 403.
- No network or provider calls happen inside mutations. Refunds record a
  local `SUCCEEDED` row for demo reconciliation; real dispatch moves to
  actions later. Webhooks, voice transcription, and media lanes return
  honest `501 PROVIDER_UNAVAILABLE`.
- Idempotency is scoped to actor plus `METHOD route-template`, with a
  sorted-payload hash. Same key plus different payload is `409
  IDEMPOTENCY_CONFLICT`.
- Handover OTPs are customer-visible only. Riders submit blind. Only a
  return-leg proof can mark an order `DELIVERED`.
- Every mutation writes a durable `outbox` row alongside the business
  update. Nothing claims a message was sent.

## Seeding

Main runs, after `convex` codegen and login:

```ts
await client.mutation(api.engine.seedDemo, {});
```

with `DEMO_MODE=true` and `ASSET_BASE_URL` set to the Vercel origin.
Seed data is synthetic demo phones and addresses only.
