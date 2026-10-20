# Verification workflow setup — draft issue map

These local packets make the setup concrete for review. They have not been published to GitHub and are not yet marked ready for implementation. Product decisions remain in the [grilling ledger](../GRILLING.md).

- [SETUP-00: Establish the committed baseline and isolated verification environment](00-baseline-and-isolated-environment.md) — blocked by no other setup packet.
- [SETUP-01: Make merge and deployment authority explicit](01-separate-merge-and-deployment.md) — blocked by no other setup packet.
- [SETUP-02: Prove actual browser interaction and video export in Codex cloud](02-cloud-browser-and-recording-smoke.md) — blocked by SETUP-00.
- [SETUP-03: Add reproducible browser assertions and revision evidence](03-browser-scenarios-and-evidence-contract.md) — blocked by SETUP-00.
- [SETUP-04: Generate current browser evidence on every PR revision](04-ci-per-push-evidence.md) — blocked by SETUP-03.
- [SETUP-05: Deliver a watchable PR video and enforce current evidence](05-watchable-pr-evidence-and-gate.md) — blocked by SETUP-02, SETUP-04.
- [SETUP-06: Prove the complete issue-to-video-to-review repair loop](06-integrated-agent-repair-loop.md) — blocked by SETUP-01, SETUP-05.

Dependency paths: SETUP-00 → SETUP-02 and SETUP-03; SETUP-03 → SETUP-04; SETUP-02 + SETUP-04 → SETUP-05; SETUP-01 + SETUP-05 → SETUP-06. SETUP-01 must land before ordinary merges can be assumed deployment-independent.

Native-device verification is a later branch of this map if Q08 selects installed-app requirements. Browser success does not close that branch.
