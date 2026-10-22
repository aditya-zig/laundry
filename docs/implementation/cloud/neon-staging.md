# Laundry Neon staging

Status on 22 October 2026: a dedicated Laundry staging database exists. No production application was deployed.

## Provisioned resource

- Organization: Laundry.
- Project: `laundry-staging`, ID `broad-rain-86048848`.
- Branch: `staging`, ID `br-icy-moon-a1xvszpf`. The initial branch name was changed from `production`.
- Database: `laundry_staging`.
- PostgreSQL 17, AWS Singapore, Neon Free plan.
- Both pooled application and direct migration connections passed verified-TLS probes. Applying the current migration sequence produced 36 public tables. A subsequent read-only probe through both endpoints confirmed that database name and table count, with zero seeded demo users.

This is a staging experiment under the user's account-setup authorization. It does not settle the architecture questions in Notion's Laundry partner review. No billing upgrade, paid model call, live provider activation or production promotion is authorized.

## Credentials

The private connection strings are in the private child page `401074fd-a556-81c4-b3c4-f3c102072cbf` under Notion's All password page. The parent was invite-only and not published when checked. Credential persistence was checked after a browser reload.

A machine-local copy is in ignored `.data/laundry-staging.neon.env`, mode 0600. Neither connection string belongs in git, screenshots, logs, public frontend variables or build artifacts. This file is not a deployment secret store. A deployment must receive credentials through its provider's protected secret mechanism.

## Connection settings

Use the provider's pooled hostname in `DATABASE_URL` for the application. Use the provider's direct hostname in `DATABASE_URL_UNPOOLED` for migrations. Do not derive a secret by rewriting another project's URL.

The shared database module requires TLS on Neon and normalizes `sslmode=require` to `verify-full`. Migrations reject a pooler endpoint and a different database or normalized endpoint. They use a separate, single-connection pool and transaction-scoped migration lock. Both successful and failed initialization close that pool.

Per-process defaults:

- `PG_POOL_MAX=10`.
- `PG_CONNECTION_TIMEOUT_MS=10000`, covering connection and checkout waits.
- `PG_IDLE_TIMEOUT_MS=30000`.
- `PG_MAX_LIFETIME_SECONDS=300`.

Choose the maximum for the total number of API and worker replicas, not one instance alone. Idle connection errors remove the failed client and log a bounded error code, not the URL. API shutdown hooks and worker signal handling close the pool after active work. Failed rollback destroys a client rather than returning an uncertain transaction to the pool.

The pooling suite runs on disposable local PostgreSQL, not on Neon. It checks exhaustion and recovery, migration connection selection, migration rejection, rollback cleanup, coordinated shutdown, idle socket termination and verified TLS configuration.

## Deployment gates

Set `DEMO_MODE=false` outside explicitly labeled demos. Do not deploy the current legacy backend as production identity or billing. Confirm the actual provider selection, media retention, GPS requirements and SMS budget with the founders. The partner review still marks those architecture questions unanswered.

No Cloudflare or AWS application hosting is complete. Cloudflare R2 and Durable Objects remain candidates, not approved production integrations. Do not enable a paid plan merely to finish a staging checklist.

## References

- Notion Laundry partner review: `3fe074fda5568152b1c4c7461650acaf`.
- https://neon.com/docs/connect/connection-pooling
- https://node-postgres.com/features/transactions
- https://www.postgresql.org/docs/17/explicit-locking.html
