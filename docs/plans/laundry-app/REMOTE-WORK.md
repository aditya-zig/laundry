# Laundry — proposed guide for one Codex cloud issue

Status: planning draft in the selected `aditya-zig/laundry` repo; not yet committed or pushed. The founder selected isolated issue branch + PR delivery with actual browser/computer use and per-revision watchable video. Account access, cloud environment and cloud baseline remain unverified. This file does not launch a task by itself.

## Environment owner: prepare once

1. Connect the intended GitHub repository to Codex cloud using the founders' account and select the correct branch/environment.
2. Commit the approved plan, this guide, relevant design references and issue context. Preserve the repo's existing AGENTS.md rules and agent-task packets; add a short pointer to the guide rather than replacing those rules.
3. Configure setup from the repo-pinned toolchain and lockfile. Make repeat runs work and avoid depending on a developer's home directory, global skill installation or running local server.
4. Establish isolated test data/services, required non-production variables, and permitted network access. Verify database-dependent checks in the actual cloud runtime.
5. Confirm how this account produces a branch/PR and apply the chosen delivery policy.
6. Run a small smoke task from a fresh cloud environment and inspect its result before dispatching larger issues.

Current documented setup path: **Work in > Cloud**, prepare/test/review the environment, then publish it. Install/startup scripts are not automatically rerun when an existing task refreshes repository files; verify dependency freshness at task start. Use the new environment's documented network-secret behavior, not legacy setup-only rules. Sources: [Codex Cloud](https://learn.chatgpt.com/docs/cloud), [cloud environments](https://learn.chatgpt.com/docs/environments/cloud-environments).

Deployment coupling must be addressed in the final policy: the current Laundry clone auto-deploys Convex after successful CI on pushes to `build/laundry`, with its configured secret. An issue branch avoids that trigger, but merging into the branch can deploy too. If separate deploy approval is required, first change that workflow as a reviewed task.

Do not describe setup as complete until the cloud smoke task has passed. Read `cloud-workflow-findings.md` for verified capability details and current official links.

## Manual task prompt

Fill every placeholder; attach the issue body if the worker cannot fetch it.

```text
Implement GitHub issue <full issue URL and pasted body if needed> in <repo>.
Baseline branch: <branch>. Approved plan: <repo path>, version <version/commit>.
Read AGENTS.md, <committed path to this guide>, and the plan sections and task
packet referenced by the issue. Use the repository as the current-code baseline.
Confirm that this issue's blockers are merged and its requirements are approved.
Implement only the issue's accepted behavior and run the relevant checks.
Follow docs/plans/laundry-app/VERIFICATION.md. Run and use the actual app,
record the issue journey, and provide a watchable video for the delivered revision.
Delivery authority: isolated issue branch and PR; no merge or app deployment.
Wait for the current CI result and repair scoped failures within the defined loop.
Return acceptance-criterion evidence, check results, remaining blockers, and
the actual branch/commit/PR identifiers and accessible video that were created.
Record head/base/tested commits and report missing evidence as blocked. If required access,
requirements, or verification are unavailable, report the precise blocker.
```

A manual launch in Codex cloud is the initial recommended dispatcher. Add issue-triggered automation later only if it solves an observed need; a plan file is an instruction source, not a scheduler.

## Worker: preflight

1. Identify repository, branch, commit, approved plan version, issue ID, and task scope. Read existing AGENTS.md and any relevant nested instructions.
2. Read the full issue and supplied comments, relevant plan requirements, glossary/ADRs, and existing agent packet. If issue fetching is unavailable, work only from a complete supplied issue; report missing necessary context.
3. Check prerequisite issues are integrated in this baseline. A closed issue or open PR alone does not prove its code is present.
4. Inspect the current implementation and relevant scripts. Use existing components, client boundary and contracts.
5. Prepare the environment through its configured setup and establish the applicable baseline checks. Separate pre-existing failures from changes introduced by this task.

Preflight completes when scope is unambiguous, prerequisites exist, and the environment can support the required work. Otherwise return a focused blocker with observed evidence.

## Worker: implement and verify

1. Make a focused change on the task's isolated work branch, consistent with the delivery mechanism supported by the environment.
2. Preserve unrelated changes and contract compatibility. Shared schema/API changes require the scope and migration behavior specified in the issue.
3. Add or update meaningful behavior tests where risk warrants them; avoid tests that only repeat implementation details.
4. Run relevant checks from repository scripts. Inspect the actual issue journey with browser/computer tools and record it. For changed UI, inspect required states at approved viewport sizes. For critical domain changes, exercise the corresponding integration and permission checks. Use the verification guide for per-revision video, manifests and the repair loop.
5. Review the final diff against each acceptance criterion, existing instructions, and the approved design.
6. Use only the explicitly selected delivery permissions. Inspect the delivered branch/PR and CI results when available.

Do not count unrun checks as passed. Do not turn an unavailable integration into an apparent success through a simulator. Keep credentials out of task results.

## Result contract

```text
Issue and approved plan version:
Baseline and result commit:
Behavior delivered:
Acceptance criteria: criterion → evidence → pass/fail/blocked
Verification: exact command or browser flow → observed outcome
Video: current revision, scenario IDs/timestamps, accessible attachment URL
Evidence identity: head SHA, base SHA, actual tested SHA, CI run/attempt
Delivery: actual branch URL / PR URL / patch location
Known limitations and required human action:
Merge/deployment state:
```

The agent may say “implemented, verification blocked” when appropriate. “PR created,” “merged,” and “deployed” each require evidence of that specific event. A successful local task does not prove cloud delivery works.

## Retry and parallel work

Preserve earlier attempt identifiers. Check for an existing branch/PR before retrying. Rebase or reconcile with the current approved baseline according to repository policy, then rerun affected checks. If two workers need the same shared contract, manifest, lockfile or infrastructure, assign one owner or serialize those issues.

## Proposed AGENTS.md pointer

After moving this guide to its final location, preserve existing instructions and add a pointer such as:

> Issue implementation: read docs/plans/laundry-app/REMOTE-WORK.md, VERIFICATION.md in that folder, and the issue's approved plan sections before changing code. Deliver the issue branch/PR with actual app-use video and current verification evidence.

This is a proposed edit, not an edit already applied to either repository.
