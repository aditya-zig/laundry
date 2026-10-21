# SETUP-02: Prove actual browser interaction and video export in Codex cloud

Status: local draft; setup-design review required; not a published GitHub issue.

## Context

Read [PLAN.md](../PLAN.md), [VERIFICATION.md](../VERIFICATION.md), [REMOTE-WORK.md](../REMOTE-WORK.md), and the repository AGENTS.md. This implements the founder-selected Q03 delivery requirement; it does not settle open product questions Q07–Q11.

## What to build

A fresh Codex cloud task can start the existing app, use a safe acceptance journey through browser tools, and export a playable recording.

## Blocked by

SETUP-00

## Acceptance criteria

- [ ] Verify account-visible repository access and published cloud environment using the selected baseline; identify the runtime/browser tools actually available.
- [ ] Use synthetic/local data and perform a small existing journey such as opening the catalog and a service detail; name the actual actions and observed result.
- [ ] Capture real browser/computer interactions, stop/finalize the recording and inspect its codec, duration, size and file availability.
- [ ] Return the exact tested commit and evidence, or a focused capability/access blocker. Local T3 support is not accepted as cloud proof.
- [ ] Record setup/network requirements without embedding secrets or depending on local home-directory skills.

## Scope boundaries

No business redesign, native-device certification, public deployment or claim that local recording proves cloud support.

## Delivery and verification

Deliver an isolated branch and reviewable PR with exact check results and current-revision evidence. Report environment or access gaps as blockers. Before a merge, ensure SETUP-01 has settled the deployment coupling. No issue is ready merely because this draft exists. Product-facing scenarios that depend on unresolved requirements must wait for those decisions.
