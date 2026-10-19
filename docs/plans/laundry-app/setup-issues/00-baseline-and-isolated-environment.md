# SETUP-00: Establish the committed baseline and isolated verification environment

Status: local draft; setup-design review required; not a published GitHub issue.

## Context

Read [PLAN.md](../PLAN.md), [VERIFICATION.md](../VERIFICATION.md), [REMOTE-WORK.md](../REMOTE-WORK.md), and the repository AGENTS.md. This implements the founder-selected Q03 delivery requirement; it does not settle open product questions Q07–Q11.

## What to build

A fresh worker can prepare the intended repository revision and run existing checks and web apps without this developer machine or a shared database.

## Blocked by

None within this setup draft; confirm required account/repository permissions before execution.

## Acceptance criteria

- [ ] Record the intended cloud baseline SHA and reconcile only explicitly selected local changes; preserve unrelated dirty work.
- [ ] Use repository-pinned Node/package-manager versions and a frozen lockfile, with setup safe to repeat.
- [ ] Run existing destructive API suites against a private disposable PostgreSQL database; verify its identity before reset/seed.
- [ ] Finish destructive API tests before browser fixtures share that database; demonstrate synthetic seed/reset and clean teardown.
- [ ] Start the three web surfaces plus API with readiness checks, and distinguish existing baseline failures from setup failures.

## Scope boundaries

Do not redesign screens, introduce product rules, reuse a hosted demo for write tests, or deploy.

## Delivery and verification

Deliver an isolated branch and reviewable PR with exact check results and current-revision evidence. Report environment or access gaps as blockers. Before a merge, ensure SETUP-01 has settled the deployment coupling. No issue is ready merely because this draft exists. Product-facing scenarios that depend on unresolved requirements must wait for those decisions.
