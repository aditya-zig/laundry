# Laundry agent and cloud-work tooling

The repository is the durable handoff boundary: product discussion and joint approval lead to a bounded issue; you choose when to launch it; the worker delivers an isolated branch/PR with actual app-use video and checks. A plan file does not run a queue by itself.

Read the [founder Q&A for partner review](../discovery/2026-10-20-founder-questions-and-answers.md), [master plan](../plans/laundry-app/PLAN.md), [decision ledger](../plans/laundry-app/GRILLING.md), and [verification contract](../plans/laundry-app/VERIFICATION.md). Open product decisions remain open; tooling setup does not approve the whole product.

## Two actual OpenCode delegates

`opencode.json` defines two roles with the exact selected model `openrouter/meta/muse-spark-1.3`:

- `laundry-planner`: reads project context and proposes requirements/questions. Read-only; the parent remains the sole interviewer and preserves both founders' attributed answers.
- `laundry-tooling`: works on an explicitly assigned tooling slice with scoped file permissions. The coordinator owns root manifests, lockfiles, AGENTS and infrastructure decisions. This role may edit assigned tooling/docs/tests; it cannot push, merge or deploy.

These are OpenCode roles, not native GPT agents. Model availability/credits remain provider prerequisites. No alternate model is silently selected. Model calls occur only when you invoke a delegate command; CI does not call paid models. Permissions are tool rules, not an operating-system sandbox; use an isolated worktree and only project-appropriate credentials.

```sh
pnpm cloud:doctor
pnpm agents:plan --prompt-file .agent-logs/planning-task.md
pnpm agents:tooling --prompt-file .agent-logs/tooling-task.md
```

Create the prompt file first. Give one outcome, relevant context, exclusive file ownership, checks and completion criteria. The runner explicitly supplies the repo config, exact model and role to a private OpenCode server, and saves results/receipts under ignored `.agent-logs/`. Provider errors, truncated output and process failures remain failures even if partial text exists. Never commit raw agent logs or account configuration. OpenCode authentication is local/account state; no keys are included here.

## Configure Codex cloud once

Use the account's available Codex Cloud environment setup UI; current official guidance describes preparing/testing and publishing an environment. Connect **aditya-zig/laundry**, choose the intentionally pushed baseline, and review setup results. Configure Node 24 and pnpm 10.33.2. Use `bash tools/cloud/setup.sh` to install frozen dependencies and Chromium. Linux browser system dependencies and an isolated PostgreSQL service must also exist. On supported Ubuntu runners, `pnpm exec playwright install --with-deps chromium` prepares system dependencies; the script's browser-only install does not claim to install those packages.

Set only synthetic/development verification configuration. An example job-private database URL is `postgres://wandary:verification_only@localhost:5448/laundry_verify_ci`; provision that disposable database in the environment before running tests. Browser tooling accepts only loopback databases named `laundry_verify_<run>`. Never use a hosted demo or production database for tests that initialize/reset data. Existing API tests can truncate tables; run them before browser seeding or use a separate private database.

Set the available environment ID locally as `CODEX_CLOUD_ENV_ID` or pass `--env`; do not commit account IDs/secrets as project defaults. The installed CLI cloud interface is experimental and its compatibility with an account's published environment must be tested. The browser route remains available if CLI submission is unsupported. Current local account discovery found no Laundry environment; an authenticated account setup and a real cloud smoke remain pending until completed and recorded.

Official references: [Codex Cloud](https://learn.chatgpt.com/docs/cloud), [cloud environments](https://learn.chatgpt.com/docs/environments/cloud-environments). Local T3 tools, OpenCode authentication, connected Notion access and home-directory skills do not automatically transfer to a cloud worker.

## Launch one issue on demand

Write/export the complete approved issue body into an ignored file, including acceptance criteria, plan/decision references, integrated blockers, required browser journey and exclusions. Build a reviewable packet first:

```sh
pnpm cloud:packet --issue-file .agent-logs/issue.md --branch issue/my-task --plan-version 0.5 --out .agent-logs/task.txt
```

Push the chosen baseline branch, then explicitly submit:

```sh
pnpm cloud:submit --env YOUR_ENV_ID --issue-file .agent-logs/issue.md --branch issue/my-task --plan-version 0.5
```

The submitter checks for an explicit environment, a clean tracked/untracked workspace and a matching pushed branch before launching one cloud attempt. It does not fetch, merge, push or deploy for you. If the account/environment is unavailable, it exits with the actual blocker. A local prompt or successful CLI login is not evidence of a successful cloud task.

The worker reads AGENTS, current plan/issue, contracts and relevant existing agent packet; checks blockers; implements only the issue; runs appropriate tests; actually uses/records the app; waits for checks and performs at most three scoped repair cycles. Missing access, unsettled product decisions or unavailable recording are blockers. The result names actual branch/PR/commits, checks, evidence and limitations.

## Browser verification and evidence

```sh
bash tools/cloud/setup.sh
pnpm build
pnpm check
pnpm test:tooling
# With a real isolated local PostgreSQL instance provisioned:
DATABASE_URL=postgres://wandary:verification_only@localhost:5448/laundry_verify_ci pnpm test
DATABASE_URL=postgres://wandary:verification_only@localhost:5448/laundry_verify_ci pnpm verify:browser
```

The browser suite starts an actual local API and the exported customer/rider/ops web apps. Each role gets a fresh browser context. Smoke checks cover customer catalog → service → basket quantity, rider sign-in/assigned tasks, and operator sign-in/catalog. Successful runs retain video, trace and report, and write `.verification/manifest.json` with base/head/tested commits and file hashes. Missing, stale, modified, empty, failed, skipped or flaky evidence fails the check. The workflow on PR revisions and all branch pushes retains 30-day artifacts. A new head needs a new run.

This is **existing web smoke**, not full kg-booking/fulfillment acceptance and not Android verification. Implement issue-specific scenarios and native emulator/device evidence when those requirements are ready. For local development only, `VERIFY_ALLOW_DIRTY=1` permits diagnostic runs; the manifest still records dirty state. It cannot be presented as clean published-revision proof.

## Make the PR easy to review

Use `gh-axi` for normal issue/PR operations. For its missing video-attachment feature, installed GitHub CLI supports:

```sh
gh pr edit PR_URL --attach .verification/path/to/current-video.webm
```

Check the actual PR body/player and both reviewers' access after uploading. H.264 MP4 is a broadly compatible optional transcode; preserve the original file/digest and associate each derived clip with the current scenario/commit. Files must respect GitHub's current attachment limits. Artifacts are supporting ZIPs, not automatic inline playback. Do not publish recordings publicly or introduce unapproved hosting just to obtain a link. [GitHub attachment documentation](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/attaching-files)

Lead the review packet with changed behavior, current head/tested SHA, a watch link, criterion/timestamp evidence, CI run and limits. Keep it draft while required evidence is missing. Repository rules must require the `browser-evidence` check to enforce a merge gate; this workflow alone cannot prevent a privileged human from merging. Configure rules only with actual account capabilities and team approval. A PR author cannot formally approve their own PR; record both founders' acceptance at the same revision using the agreed mechanism.

No merge or deployment is part of this workflow. Inspect the existing deployment condition before merging: local uncommitted changes and the committed baseline may target different branches. This tooling branch does not change production deployment triggers or deploy an app.

## Actual setup verification receipt

The repo-configured planner completed a bounded OpenCode role smoke using Muse Spark 1.3. The tooling role initially received a provider in-flight credit-reservation error and was retried serially; final outcomes are recorded in docs/implementation/agent-workflow-verification.md. Never call a rejected model run successful or silently substitute another provider.
