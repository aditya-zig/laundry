# Cloud Agent Workflow Implementation Plan

> **For agentic workers:** Use the repository execution guide and implement one task at a time. OpenCode delegates use the configured Muse Spark 1.3 agents; do not substitute native GPT agents under their names.

**Goal:** Commit and push a reproducible issue-to-cloud-worker workflow with two actual OpenCode agent roles and per-revision browser/video evidence.

**Architecture:** Keep product discovery in the existing master plan and attributed grilling ledger. Provide a small Node CLI for task packets, OpenCode execution and explicit Codex cloud dispatch; a separate evidence module validates current commits and media hashes. Playwright runs actual existing customer, rider and ops smoke flows against a local demo backend. CI uploads videos/reports and validates evidence per revision. PR attachments are an explicitly invoked delivery step; no automatic merge/deploy or paid-model dispatch on pushes.

**Tech Stack:** Node 24, pnpm 10.33.2, OpenCode v2 configuration, exact openrouter/meta/muse-spark-1.3, Codex CLI cloud interface, Playwright, existing NestJS/PostgreSQL + Expo Web/Vite apps, GitHub Actions.

**Spec:** docs/plans/laundry-app/VERIFICATION.md and the founder's 20 October instruction to set up and push tooling.

## Global Constraints

- Isolate changes from the original dirty checkout; base is committed origin/build/laundry e3c509a.
- Discover package names from manifests; committed code uses @wandary and must retain compatibility.
- Agents and task prompts contain no account credentials. Paid model/cloud calls start only from an explicit user command.
- No app business changes or product approval invented from unresolved questions.
- A video is useful evidence, not a substitute for assertions, actual tested commit or cloud capability proof.
- App/DB writes use a local isolated test environment. No shared hosted demo writes.

## Review Focus

- Stale or tampered media cannot satisfy a current-revision evidence check.
- A failing process/provider request must produce a nonzero result, even if partial text exists.
- A task packet must include issue body and current plan status, without claiming joint approval.
- Per-push browser verification uses explicit loopback endpoints and produces successful-run recordings.
- Local browser success, CLI availability and a pushed branch do not establish a configured Codex cloud environment.

### Task 1: Actual OpenCode roles and explicit dispatch CLI

Files: opencode.json; tools/agents/workflow.mjs; tools/agents/workflow.test.mjs; docs/agents/README.md.

- [x] Write CLI behavior tests for complete packets, missing cloud environment, model error/partial responses and exact executor selection.
- [x] Run the tests red, implement the bounded CLI, run green.
- [x] Define planner and tooling agents on exact Muse model with distinct permissions and explicit reading/ownership instructions.
- [x] Verify config through OpenCode's resolved project configuration; smoke each role using a bounded explicitly authorized request if account credits permit.

### Task 2: Actual browser smoke and revision evidence

Files: playwright.config.ts; e2e/workflow-smoke.spec.ts; tools/verification/evidence.mjs; tools/verification/evidence.test.mjs; tools/cloud/setup.sh.

- [x] Write evidence behavior tests for current SHA, missing media, hash mismatch and non-passing scenarios. Observe red before implementing.
- [x] Configure passing-run video and trace, separate role contexts, loopback-only API/web origins and process readiness.
- [x] Exercise existing customer catalog/detail, rider login/job list and ops login/catalog; do not pretend this proves the full business journey.
- [x] Produce a manifest with tested/head/base SHA, dirty state, scenario outcomes and file hashes. Reject dirty media as final publication proof.
- [x] Run actual browser flow and inspect recordings; cloud install script prepares dependency/browser prerequisites without deploying.

### Task 3: CI and review delivery

Files: .github/workflows/agent-verification.yml; .github/ISSUE_TEMPLATE/agent-task.yml; .github/PULL_REQUEST_TEMPLATE.md; package.json; pnpm-lock.yaml; AGENTS.md; .gitignore.

- [x] Run tooling tests and browser smoke on PR revisions/pushes with isolated PostgreSQL service and retained evidence.
- [x] Fail verification on missing, stale or corrupt media while retaining diagnostic artifacts.
- [x] Provide explicit video-attachment command and exact delivery checks; do not automatically post messages or invoke paid models.
- [x] Link repo-local execution instructions from AGENTS.md and preserve existing engineering rules.
- [x] Document actual cloud environment bootstrap/config requirements; CLI cloud list currently succeeds with zero tasks and no selected environment ID.

### Task 4: Review, push and verify

- [x] Review standards and spec separately; use actual OpenCode Muse review runs where available, local review if provider credits block them, with honest provenance.
- [x] Run existing appropriate checks, tooling tests, browser smoke and media validation. Report baseline failures explicitly.
- [x] Commit only the scoped tooling/planning changes; push chore/cloud-agent-workflow, create/link reviewable PR and inspect CI.
- [x] Attach current video through supported GitHub capability and verify the returned PR body/player URL; no merge/deployment.
