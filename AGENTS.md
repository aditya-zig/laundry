# Laundry engineering instructions

Read docs/specs/product-spec.md, docs/specs/contracts.md and the relevant packet in docs/agent-tasks before implementation. The contracts package is the shared wire boundary; preserve compatibility. Use integer minor-unit INR amounts and timezone-qualified schedule windows. Order, payment and delivery-leg states are separate.

The canonical worktree, branch and last verified evidence are named in docs/CURRENT.md. Read it before trusting this checkout's git status, GitHub issue state or TASKS.json; refresh it with every checkpoint commit. At task startup, confirm the absolute Git root, branch, HEAD and pre-existing changes against that pointer; preserve unrelated work.

Keep local demo behavior explicit. Do not present demo capture, demo login, messaging outbox or simulated delivery as production integrations. Never use another project's existing cloud accounts or credentials. Do not commit .env, private logs, media, model weights or generated dist artifacts.

For parallel work, assign exclusive file ownership and a shared contract version. The coordinator owns root manifests/lock and infrastructure. Apps must use @laundry/api-client; backend owns apps/api, apps/worker and modules. Document handoffs and verification under docs/implementation. Report a worker as active only after a successful repository command; confirm terminal status before claiming completion. For unchanged quota/authentication failures, report the blocker once and resume only after the prerequisite changes or an authorized fallback is available.

## Execution and evidence

- Reuse package.json scripts, .github/workflows and tools/verification/evidence.mjs before adding checks. Attach the tested revision or preserved dirty snapshot, commands, exit codes and artifact paths to completion claims. A dirty run is not a clean-release receipt; changed sources require fresh evidence for affected checks.
- Default to one heavyweight worker/test/browser lane on constrained hosts; check available memory and disk before increasing concurrency. Existing parallel-work ownership rules still apply.
- Keep tool responses to bounded excerpts, exit codes and failure summaries; store full output in task-owned logs outside tracked sources. Report the log path rather than repeatedly dumping it.

Meaningful verification covers duplicate payment/webhook replay, ownership and role checks, stale quote/order versions, pickup and return custody, capacity promises, post-delivery reviews, and conversation draft confirmation. Run PostgreSQL-backed acceptance tests and inspect the actual apps in a browser before claiming completion. Never mask failing exits through a pipeline. Do not invoke paid models or commercial API calls without explicit authorization.
