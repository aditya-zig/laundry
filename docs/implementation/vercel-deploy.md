# Vercel deploy notes (frontend only)

`vercel.json` at the repo root deploys the ops console (`apps/ops`) as a
static site. Import the GitHub repo in the Vercel dashboard and keep the root
settings from `vercel.json`. No other app is wired up; customer and partner
Expo web exports would each need their own Vercel project.

## Required project setting

Set `VITE_API_URL` in the Vercel project environment to the public base URL
of a running API, e.g. `https://api.example.com/v1`. Without it the console
builds against `http://localhost:4100/v1` and every request fails in the
browser. There is no placeholder default that works in production.

## What Vercel cannot host

The API (`apps/api`) is a persistent NestJS server backed by PostgreSQL with
a transactional outbox. That does not fit serverless functions. Host it on a
service with long-running Node and managed Postgres (Render, Fly, Railway, or
equivalent), with `DEMO_MODE=false`, production `DATABASE_URL`, and real
`WHATSAPP_*` / `RAZORPAY_*` credentials. The static frontends then point at
that URL.

## Local check before importing

```bash
pnpm --filter @wandary/ops build
python3 -m http.server 4183 --directory apps/ops/dist
# open http://localhost:4183/ ; API calls go to VITE_API_URL or localhost:4100
```
