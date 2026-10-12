# Vercel deployment

The current instructions are in [cloud-deployment.md](cloud-deployment.md).

All three static apps are deployed from this repository using `node tools/build-web.mjs`:

- Customer: https://laundry-customer-five.vercel.app (`LAUNDRY_APP=customer`)
- Partner: https://laundry-partner.vercel.app (`LAUNDRY_APP=partner`)
- Operations: https://wandary.vercel.app (default `ops`)

All three Git-connected projects use production branch `build/wandary`, verified through the Vercel API on 2026-10-12. Public API environment variables are configured for the production target only; preview deployments need separately configured URLs and CORS before use.

The web apps intentionally point to the **development Convex demo** backend. A Vercel production deployment is not a live merchant launch. Convex production has demo mode disabled and rejects unimplemented live provider lanes. See the runbook for prerequisites, verification, rollback and backup limitations.

The former PostgreSQL/NestJS deployment instructions described an alternative backend, not the current cloud deployment. Local PostgreSQL acceptance remains valuable for that implementation and runs in GitHub CI.
