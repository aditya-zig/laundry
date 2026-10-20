# SETUP-01: Make merge and deployment authority explicit

Status: local draft; setup-design review required; not a published GitHub issue.

## Context

Read [PLAN.md](../PLAN.md), [VERIFICATION.md](../VERIFICATION.md), [REMOTE-WORK.md](../REMOTE-WORK.md), and the repository AGENTS.md. This implements the founder-selected Q03 delivery requirement; it does not settle open product questions Q07–Q11.

## What to build

Merging an ordinary verified product PR cannot accidentally bypass the founders' selected deployment authority.

## Blocked by

None within this setup draft; confirm required account/repository permissions before execution.

## Acceptance criteria

- [ ] Document the observed Convex deployment trigger on build/laundry, including the fact that a merged PR can trigger it.
- [ ] Present and review the concrete workflow change that separates app deployment approval from an ordinary merge, if separate approval remains the selected policy.
- [ ] Demonstrate event/condition behavior without invoking a real deployment or printing deployment credentials.
- [ ] Preserve verification on PR revisions and document the deliberately selected production deployment path.

## Scope boundaries

No real app deployment or unrelated hosting migration. A successful dry check is not a production deploy.

## Delivery and verification

Deliver an isolated branch and reviewable PR with exact check results and current-revision evidence. Report environment or access gaps as blockers. Before a merge, ensure SETUP-01 has settled the deployment coupling. No issue is ready merely because this draft exists. Product-facing scenarios that depend on unresolved requirements must wait for those decisions.
