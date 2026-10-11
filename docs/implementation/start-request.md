# Dev server start request (UI/root verifier → main coordinator)

Date: 2026-10-11. UI/root scope is ready for the managed interactive group.

## What is ready

- `apps/customer` web export passes (`expo export --platform web`), check passes, 8/8 tests pass.
- `apps/partner` web export passes, check passes against real React types (ambient `any` stub removed), 6/6 tests pass.
- `apps/ops` production build passes, check passes, 6/6 tests pass.
- Shared packages build; 22/22 tests pass. Voice transcriber suite 23/23 plus a real local-model transcription, exit 0.
- PostgreSQL container `wandary-postgres-1` is already up on host port 5448.

## Request

Once `docs/implementation/backend-qa-ready.md` exists, start the persistent
managed exec session (`pnpm dev`, i.e. `node tools/dev.mjs`) and write
`docs/implementation/dev-running.md` with the session handle. Expected ports:
API :4100, customer :8081, partner :8082, ops :5173.

Do not start the group while the backend QA lane is still running its HTTP
acceptance suite: its tests may bind :4100 themselves and a parallel group
would cause port conflicts and flaky results.

## What I will verify once the group is up

Book order → DEMO capture → track in the customer preview; pickup → care →
return via ops/partner screens; delivered-only review; catalog PNG/SVG image
loads; form error states; mobile viewport; refresh/session persistence; API
error paths. Screenshots go to `docs/implementation/evidence/`. If the group
needs a restart after env/source changes, I will say so here.
