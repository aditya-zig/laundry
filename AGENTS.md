# Wandary engineering instructions

Read docs/specs/product-spec.md, docs/specs/contracts.md and the relevant packet in docs/agent-tasks before implementation. The contracts package is the shared wire boundary; preserve compatibility. Use integer minor-unit INR amounts and timezone-qualified schedule windows. Order, payment and delivery-leg states are separate.

Keep local demo behavior explicit. Do not present demo capture, demo login, messaging outbox or simulated delivery as production integrations. Never use another project's existing cloud accounts or credentials. Do not commit .env, private logs, media, model weights or generated dist artifacts.

For parallel work, assign exclusive file ownership and a shared contract version. The coordinator owns root manifests/lock and infrastructure. Apps must use @wandary/api-client; backend owns apps/api, apps/worker and modules. Document handoffs and verification under docs/implementation. Check process completion rather than trusting detached child output.

Meaningful verification covers duplicate payment/webhook replay, ownership and role checks, stale quote/order versions, pickup and return custody, capacity promises, post-delivery reviews, and conversation draft confirmation. Run PostgreSQL-backed acceptance tests and inspect the actual apps in a browser before claiming completion. Never mask failing exits through a pipeline. Do not invoke paid models or commercial API calls without explicit authorization.

# On-demand agent workflow

For remote issue work, read `docs/agents/README.md`, the approved plan sections in `docs/plans/laundry-app/PLAN.md`, and the full issue body before editing. Product questions and each founder's answers live in `docs/discovery/2026-10-20-founder-questions-and-answers.md`; unanswered or disputed decisions block their dependent feature work.

Use the configured OpenCode `laundry-planner` and `laundry-tooling` delegates on exact `openrouter/meta/muse-spark-1.3` when those delegates are explicitly requested. Do not label native GPT agents as Muse. Coordinator owns root manifests/lock and infrastructure. Never substitute another paid model without instruction.

Deliver an isolated issue branch/PR, actual browser/computer use and watchable current-revision video, check results and evidence manifest. `pnpm verify:browser` covers existing web smoke only; native Android requirements need device/emulator evidence. Follow `docs/plans/laundry-app/VERIFICATION.md`, preserve nonzero failures, and report unavailable cloud/browser/upload capabilities precisely. No merge or deployment without its explicit authority.

When the partner joins product review, raise deferred Q20 pricing first: per-kg service rates, Premium price, minimums and increments. Preserve the raw Q&A and do not fill those numbers from historic notes. Cloud account provisioning is deferred until after this tooling push.

## Agent skills

### Issue tracker

GitHub repository `aditya-zig/laundry`, with `gh-axi` for supported issue and PR operations. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: one `CONTEXT.md` glossary at the repo root, ADRs under `docs/adr/` when needed. See `docs/agents/domain.md`.
