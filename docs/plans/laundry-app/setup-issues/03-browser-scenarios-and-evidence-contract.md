# SETUP-03: Add reproducible browser assertions and revision evidence

Status: local draft; setup-design review required; not a published GitHub issue.

## Context

Read [PLAN.md](../PLAN.md), [VERIFICATION.md](../VERIFICATION.md), [REMOTE-WORK.md](../REMOTE-WORK.md), and the repository AGENTS.md. This implements the founder-selected Q03 delivery requirement; it does not settle open product questions Q07–Q11.

## What to build

A bounded existing Laundry behavior can be checked reproducibly and yields a successful-run video plus a revision-specific evidence manifest.

## Blocked by

SETUP-00

## Acceptance criteria

- [ ] Use stable scenario IDs and real assertions against the relevant existing UI behavior; define expected observed results before writing the test.
- [ ] Retain video for the passing acceptance run as well as meaningful failure evidence, and await recording/context finalization.
- [ ] Use isolated contexts for actors and an isolated backend/fixture setup; verify role separation where the scenario touches it.
- [ ] Record base SHA, PR head SHA, actual tested SHA, plan revision, scenario results, fixtures, checks, run/attempt, file hashes and artifact locations.
- [ ] Reject missing/corrupt media, mismatched revision identity and missing required scenario results; demonstrate one passing and one intentionally failing case.

## Scope boundaries

No changes to unresolved pricing, tiers, slots or native behavior just to create a test. Do not replace real assertions with video existence checks.

## Delivery and verification

Deliver an isolated branch and reviewable PR with exact check results and current-revision evidence. Report environment or access gaps as blockers. Before a merge, ensure SETUP-01 has settled the deployment coupling. No issue is ready merely because this draft exists. Product-facing scenarios that depend on unresolved requirements must wait for those decisions.
