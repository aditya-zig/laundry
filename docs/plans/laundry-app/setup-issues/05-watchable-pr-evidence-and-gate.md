# SETUP-05: Deliver a watchable PR video and enforce current evidence

Status: local draft; setup-design review required; not a published GitHub issue.

## Context

Read [PLAN.md](../PLAN.md), [VERIFICATION.md](../VERIFICATION.md), [REMOTE-WORK.md](../REMOTE-WORK.md), and the repository AGENTS.md. This implements the founder-selected Q03 delivery requirement; it does not settle open product questions Q07–Q11.

## What to build

Both founders can watch the correct current revision directly from the PR, and the required evidence check prevents review/merge based on stale or missing proof.

## Blocked by

SETUP-02, SETUP-04

## Acceptance criteria

- [ ] Attach a current recording through the installed supported GitHub capability; prefer gh-axi for regular PR work and use gh --attach for the wrapper's missing feature.
- [ ] Inspect the returned PR body/player and independently test the two founders' access; preserve partial-upload failure outcomes.
- [ ] Respect supported format, size and access constraints; use H.264 MP4 when transcoding is needed, and retain original evidence with its hashes.
- [ ] Link video timestamps/chapters to acceptance criteria and immutable run/manifest evidence in the current review packet.
- [ ] Configure the supported repository-required evidence check with existing permissions; draft status alone is not counted as enforcement.
- [ ] Demonstrate rejection of stale, absent and failed evidence, and acceptance of a valid current packet. If rules or upload permissions are missing, report the exact blocker.

## Scope boundaries

Do not publish media publicly, purchase storage, merge, or count a PR author's self-acceptance as a formal approving review.

## Delivery and verification

Deliver an isolated branch and reviewable PR with exact check results and current-revision evidence. Report environment or access gaps as blockers. Before a merge, ensure SETUP-01 has settled the deployment coupling. No issue is ready merely because this draft exists. Product-facing scenarios that depend on unresolved requirements must wait for those decisions.
