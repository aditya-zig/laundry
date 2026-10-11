# Wandary engineering instructions

Read docs/specs/product-spec.md, docs/specs/contracts.md and the relevant packet in docs/agent-tasks before implementation. The contracts package is the shared wire boundary; preserve compatibility. Use integer minor-unit INR amounts and timezone-qualified schedule windows. Order, payment and delivery-leg states are separate.

Keep local demo behavior explicit. Do not present demo capture, demo login, messaging outbox or simulated delivery as production integrations. Never use another project's existing cloud accounts or credentials. Do not commit .env, private logs, media, model weights or generated dist artifacts.

For parallel work, assign exclusive file ownership and a shared contract version. The coordinator owns root manifests/lock and infrastructure. Apps must use @wandary/api-client; backend owns apps/api, apps/worker and modules. Document handoffs and verification under docs/implementation. Check process completion rather than trusting detached child output.

Meaningful verification covers duplicate payment/webhook replay, ownership and role checks, stale quote/order versions, pickup and return custody, capacity promises, post-delivery reviews, and conversation draft confirmation. Run PostgreSQL-backed acceptance tests and inspect the actual apps in a browser before claiming completion. Never mask failing exits through a pipeline. Do not invoke paid models or commercial API calls without explicit authorization.
