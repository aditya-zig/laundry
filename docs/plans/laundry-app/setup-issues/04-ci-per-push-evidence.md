# SETUP-04: Generate current browser evidence on every PR revision

Status: local draft; setup-design review required; not a published GitHub issue.

## Context

Read [PLAN.md](../PLAN.md), [VERIFICATION.md](../VERIFICATION.md), [REMOTE-WORK.md](../REMOTE-WORK.md), and the repository AGENTS.md. This implements the founder-selected Q03 delivery requirement; it does not settle open product questions Q07–Q11.

## What to build

Each pushed PR revision produces its own CI result and current browser evidence; failures preserve diagnostic outputs and remain failures.

## Blocked by

SETUP-03

## Acceptance criteria

- [ ] Run the existing appropriate checks plus the browser scenario(s) in private services using the intended checkout policy.
- [ ] Record the actual tested checkout SHA separately from head/base; do not assume all workflows test a synthetic merge.
- [ ] Use unique artifact names including revision/run/attempt and configure documented retention; upload relevant evidence on ordinary test failure.
- [ ] Push a second controlled revision on the smoke PR and demonstrate that earlier evidence cannot satisfy the current evidence check.
- [ ] Preserve nonzero failure exits and classify cancellation/timeout/missing-upload as unavailable evidence rather than success.

## Scope boundaries

No paid hosting, public media publication, automatic cloud-task dispatcher or automatic merge.

## Delivery and verification

Deliver an isolated branch and reviewable PR with exact check results and current-revision evidence. Report environment or access gaps as blockers. Before a merge, ensure SETUP-01 has settled the deployment coupling. No issue is ready merely because this draft exists. Product-facing scenarios that depend on unresolved requirements must wait for those decisions.
