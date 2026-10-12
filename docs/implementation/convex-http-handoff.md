# Convex HTTP handoff

Scope: `convex/http.ts`, `convex/tsconfig.json`, this file. Nothing else
was touched. No root edits, no git actions, no deployment, no cloud login,
no key generation. The frozen `internal.engine.dispatch` args were not
changed.

## What was built

`convex/http.ts` is a thin Convex HTTP transport. One shared `httpAction`
handler is routed for `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, and
`OPTIONS` on `pathPrefix: "/v1/"`, plus exact `GET`/`OPTIONS` routes for
`/health`. Every `/v1` call is forwarded to the frozen mutation
`internal.engine.dispatch` with `{ method, path, token, body,
idempotencyKey }`, and the engine's `{ status, body }` is returned
verbatim as the HTTP response. Failures are never swallowed: the engine
status code and envelope pass through directly, and a transport-level
crash returns a safe `PROVIDER_OUTCOME_UNKNOWN` envelope with a fresh
trace ID instead of a stack trace.

## Transport behavior

- Authorization comes only from the `Authorization: Bearer <token>`
  header. Anything else (missing, non-Bearer, query or body tokens) is
  forwarded as `undefined` and the engine answers `UNAUTHENTICATED`. There
  is no bypass and no public mutation.
- `Idempotency-Key` is forwarded as `idempotencyKey`. The engine scopes it
  per actor plus `METHOD route-template`, so SDK retries keep working.
- JSON bodies are capped at 15 MB to match the Nest API voice-note limit.
  Oversize bodies get `413 INVALID_INPUT`, non-JSON content types and
  malformed JSON get `400 INVALID_INPUT`. Both use the shared
  `{ code, message, traceId, retryable }` envelope the SDK parses.
- CORS mirrors `apps/api/src/main.ts`: the same localhost defaults, plus
  `CORS_ORIGINS` (comma-separated, primary), `CORS_ORIGIN`, and
  `FRONTEND_URL` as fallbacks. Only exact allowlist matches are echoed in
  `Access-Control-Allow-Origin`. Allowed headers are `Content-Type`,
  `Authorization`, and `Idempotency-Key`. Preflight returns `204`.
- `GET /v1/health` (and `GET /health`) needs no auth and reports honestly:
  `{ ok, service, demoMode, providers: { razorpayConfigured,
  whatsappConfigured }, liveReady, note }`. `liveReady` is true only when
  demo mode is off and both provider credential sets are present.

## Honest provider boundaries

- `GET /v1/webhooks/whatsapp` answers the verification handshake at the
  transport level: `502 PROVIDER_UNAVAILABLE` when
  `WHATSAPP_VERIFY_TOKEN` is unset, `403 FORBIDDEN` on token mismatch,
  otherwise the `hub.challenge` as `text/plain`. This matches the Nest
  controller; the engine has no such route and would otherwise 501 it.
- `POST /v1/webhooks/*`, any `/v1/media/*`, and
  `/v1/demo/conversations/voice-notes` return `501
  PROVIDER_UNAVAILABLE` without calling dispatch. The frozen dispatch args
  carry no raw-body or signature fields, so HMAC-before-parsing is
  impossible here; nothing is verified, stored, or faked. Real webhook and
  media dispatch belongs in actions with credentials the main owner holds,
  pending agreement on extending the frozen args.
- Demo gating stays in the engine: demo auth, demo capture, and demo
  handover codes 403 outside `DEMO_MODE=true`. This layer adds no demo
  behavior of its own.

## Verification

- `npx tsc --noEmit -p convex/tsconfig.json`: `convex/http.ts` passes
  with zero errors.
- Pre-existing errors outside this scope (all in `convex/engine.ts`,
  owned by the engine lane): 7 strict-null `never[]` inference errors at
  lines 308, 345 (x3), 716, 964, and 1507. They come from `const x = []`
  evolving-array inference under `strict`. This lane did not touch them;
  `convex/tsconfig.json` sets `noImplicitAny: false` only because the
  engine uses an untyped `Ctx = any` by design.
- No deployment or browser run was possible from this lane (no cloud
  login, no keys). Full route verification belongs to the independent
  checker: deploy, run `seedDemo`, exercise the SDK flows against the
  Convex HTTP URL, and confirm webhook/media/voice lanes still refuse
  honestly.
