# Separate deployment migrations from runtime database authority

Baseline: `d7e17ff`. Scope is coordinator-owned Node/database deployment security,
not whole-product activation.

The original API always ran migrations at startup. Merely moving to compiled
JavaScript/non-root containers would still require an overprivileged database
owner inside the long-running API. Production now **never runs migrations or
seeding** during normal startup. It verifies an already-migrated database using
a distinct non-owner role. The same boundary applies to the compiled identity
privacy worker. Nonproduction can explicitly exercise this with
`LAUNDRY_DATABASE_MODE=runtime`; ordinary isolated demo acceptance keeps its
explicit setup behavior.

`pnpm --filter @laundry/api migrate --apply` is a separate compiled job. It also
requires `LAUNDRY_ALLOW_MIGRATIONS=true`, explicit app/direct database settings and
`DEMO_MODE=false`. Production connections require verified TLS. That process
must be given reviewed migration credentials independently; the production API
and maintenance worker refuse migration secrets/authority in their environment.
No owner credential is copied into the image or runtime environment file.

Runtime verification rejects superuser/role/database creation, replication,
bypass-RLS, database-owner membership (including NOINHERIT/SET-ROLE paths), public
schema CREATE, ownership of application objects, missing identity migrations,
incomplete DML grants, and identity TRUNCATE/TRIGGER authority. It checks each
DML privilege separately: PostgreSQL's comma-separated privilege predicate is
ANY-of, not ALL-of. The check uses a bounded read-only transaction. Startup
logging no longer dumps arbitrary database/provider exception objects.

Five real PostgreSQL tests use a distinct randomly generated login role. They
prove its positive DML-only path, rejected DDL and legacy-table reads, rejected
owner runtime, individual missing grants, inherited-owner membership, TRUNCATE
and schema CREATE. An additional runtime-config test rejects injected migration
authority. Local full check/build, 694 workspace tests, 77 tooling tests and all
four compiled-API browser scenarios pass.

The actual clean container verifier now applies migrations in a separate owned
one-shot process, creates a separate DML-only identity role, proves the API
rejects owner credentials even after migration, then starts API and privacy
maintenance using only that restricted runtime URL. It asserts runtime DDL and
legacy-customer table reads are rejected and no demo users were seeded. These
new clean-image checks must pass after committing; no working-tree result is
called a published-source receipt.

This is not evidence of a deployed product backend, native/staff/provider
acceptance, approved business configuration or a production recovery drill.
Production ordering and readiness remain closed. Runtime grants for future v2
business modules must be extended through reviewed migrations/provisioning,
not by supplying database-owner credentials again.
