# SETUP-06: Prove the complete issue-to-video-to-review repair loop

Status: local draft; setup-design review required; not a published GitHub issue.

## Context

Read [PLAN.md](../PLAN.md), [VERIFICATION.md](../VERIFICATION.md), [REMOTE-WORK.md](../REMOTE-WORK.md), and the repository AGENTS.md. This implements the founder-selected Q03 delivery requirement; it does not settle open product questions Q07–Q11.

## What to build

One manually assigned bounded issue goes through a real cloud worker, actual app use, a repair/rerun, current CI/video and founder review without unapproved merge or deployment.

## Blocked by

SETUP-01, SETUP-05

## Acceptance criteria

- [ ] Launch with the complete approved issue packet and committed instructions, not an issue URL alone if issue retrieval is unavailable.
- [ ] Demonstrate the normal branch/PR delivery path with actual browser interaction and current watchable video.
- [ ] Exercise a controlled failure in the smoke scenario, diagnose it, make a bounded correction and regenerate evidence for the delivered revision.
- [ ] Use the proposed three repair cycles maximum per attempt; distinguish a scoped fix from a product decision or infrastructure blocker.
- [ ] Record both founders' acceptance at the same plan/revision using the agreed review mechanism; leave disputed decisions blocking.
- [ ] Verify no deployment occurred and the review packet identifies actual branch, PR, commits, checks, video, limitations and next human action.

## Scope boundaries

No unattended polling bot, broad product implementation, automatic merge/deploy or claim that a deliberately blocked run satisfies the successful smoke gate.

## Delivery and verification

Deliver an isolated branch and reviewable PR with exact check results and current-revision evidence. Report environment or access gaps as blockers. Before a merge, ensure SETUP-01 has settled the deployment coupling. No issue is ready merely because this draft exists. Product-facing scenarios that depend on unresolved requirements must wait for those decisions.
