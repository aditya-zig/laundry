# Vercel deploy notes (frontend only)

`vercel.json` at the repo root deploys the ops console (`apps/ops`) as a
static site. Import the GitHub repo in the Vercel dashboard and keep the root
settings from `vercel.json`. No other app is wired up; customer and partner
Expo web exports would each need their own Vercel project.

The repo is already linked locally to the `wandary` Vercel project
(`.vercel/project.json`, git-ignored, never committed):
projectId `prj_ktaTuC9jUnLMCN5qDY5ghYWswcsI`, org `team_1l58te9lH5HVLaxq47ryTBMn`.
The remaining step needs your browser auth: `npx vercel login` (or
`npx vercel link` if the token lives elsewhere), then `npx vercel --prod`.

## Required project setting

Set `VITE_API_URL` in the Vercel project environment to the public base URL
of a running API, e.g. `https://api.example.com/v1`. Without it the console
builds against `http://localhost:4100/v1` and every request fails in the
browser. There is no placeholder default that works in production.

After the API host is up, also set `CORS_ORIGIN` on the API host to the exact
Vercel origin (e.g. `https://wandary-....vercel.app`) — the API's localhost
allowlist alone will reject browser calls from Vercel.

## What Vercel cannot host

The API (`apps/api`) is a persistent NestJS server backed by PostgreSQL with
a transactional outbox. That does not fit serverless functions. Host it on a
service with long-running Node and managed Postgres (Render, Fly, Railway, or
equivalent) via `apps/api/Dockerfile` (see `render.yaml` / `fly.toml` and the
`docker-compose.yml` header for the exact env list), with `DEMO_MODE=false`,
production `DATABASE_URL`, and real
`WHATSAPP_*` / `RAZORPAY_*` credentials. The static frontends then point at
that URL.

## Local check before importing

```bash
pnpm --filter @wandary/ops build
python3 -m http.server 4183 --directory apps/ops/dist
# open http://localhost:4183/ ; API calls go to VITE_API_URL or localhost:4100
```

