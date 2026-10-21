> Historical research snapshot from the earlier GPT-6.1-Sol discovery track. Read PLAN.md and GRILLING.md for the founder’s current decisions. This report is evidence, not the approved plan. The two native GPT subagents were interrupted after the founder requested actual OpenCode Muse execution.

# Cloud workflow findings

Research date: 2026-10-19. Status: planning evidence and proposed setup; no repository integration, issue, pull request, cloud environment, or cloud implementation task was created.

## Recommendation

Use a GitHub repository as the durable handoff boundary. Build the detailed plan through the shared grilling session, resolve partner disagreements, commit the approved documents, generate small issues from stable sections, and manually launch a cloud Codex task for a chosen ready issue. Review the result and its checks before merging. A Markdown file supplies context and instructions; it does not schedule work, provision credentials, or make an issue queue execute itself.

This is a workflow recommendation, not a verified configuration of the laundry project. The canonical repository, Notion page, product scope, stack, cloud environment, and partner access are still unconfirmed.

## Local evidence

| Check | Observed result | Limits |
| --- | --- | --- |
| `opencode --version` | `opencode v2.0.29` | Local installation only. |
| `opencode models` | Exact `openrouter/meta/muse-spark-1.3` listed | Catalog listing alone does not prove successful inference. |
| `opencode auth list` | OpenRouter stored API key; OpenAI OAuth stored; other providers also present | Secret values were not exported. |
| Bounded Muse consultation | Exact requested model completed through OpenCode; exit 0 | Planning consultation using supplied evidence, not independent product research or cloud implementation. |
| `codex --version` | `codex-cli 0.163.0` | CLI cloud interface is marked experimental. |
| `codex login status` | Logged in using ChatGPT | Does not establish environment or repository access. |
| `codex cloud exec --help` | Supports `--env`, `--branch`, `--attempts`; prompt positional argument | No actual cloud task was launched. Compatibility with a particular new published environment remains untested. |
| `gh auth status --active` | Active GitHub account; SSH Git protocol; repository scope present | Target repository and partner permissions remain unverified. |
| `gh-axi issue/pr create --help` | `--body-file` supported; PR supports explicit head/base and draft | Help inspection only; no external writes. |
| `git rev-parse --show-toplevel` in `/home/batman/Projects/code` | Not a Git repository | This parent folder contains projects; it is not proof that the laundry app has no repository. |

## Current official OpenAI workflow

Current documentation describes **Work in > Cloud** with a **published environment**. Select GitHub repositories, let Codex prepare and test the setup, review missing inputs and results, then publish. Start a task and later inspect changes and checks before committing or opening a PR. Tasks can continue while the local computer sleeps. [Codex Cloud overview](https://learn.chatgpt.com/docs/cloud)

New environments store an install script and start skill. New tasks get separate workspaces; existing tasks retain their files. Repository refresh does not rerun install/startup. Environment updates require republishing and a new task. Network secrets use proxy placeholders for permitted HTTPS destinations during setup and tasks; direct environment variables are visible to programs. Shared environment access is documented for Enterprise workspaces; a personal-account partner workflow needs separate access verification. [Cloud environments](https://learn.chatgpt.com/docs/environments/cloud-environments)

The former `/codex/cloud/environments/` page now describes **Codex Cloud (Legacy)**. Do not apply its setup-only secret behavior or caching rules to the new environment system. [Legacy environments](https://learn.chatgpt.com/docs/environments/cloud-environment)

Official GitHub integration documentation currently describes non-review `@codex` PR comments starting a **legacy** cloud chat. It does not establish that an issue label or issue comment automatically launches the new cloud workflow. [GitHub integration](https://learn.chatgpt.com/docs/third-party/github)

Codex reads repository `AGENTS.md` instructions on startup and combines nested guidance. The default combined instruction limit is 32 KiB. Keep the entrypoint concise and point it at the detailed plan and issue-specific sections. [AGENTS.md discovery](https://learn.chatgpt.com/docs/agent-configuration/agents-md)

## Proposed repository handoff documents

These are proposed responsibilities; final filenames should follow the project conventions chosen during planning.

| Document | Responsibility |
| --- | --- |
| `PLAN.md` | Detailed product plan: evidence, users, workflows, scope, interface states, requirements, architecture decisions, acceptance criteria, rollout and issue map. Clearly mark unresolved items. |
| `AGENTS.md` | Short agent entrypoint: required reading, authoritative decisions, setup and check commands, boundaries, completion evidence, escalation when blocked. |
| `CONTEXT.md` | Agreed domain terms and invariants, including laundry-specific vocabulary discovered in the Notion page. |
| `docs/adr/` | Accepted architectural decisions, rationale, alternatives, and changes that supersede them. Do not record guesses as accepted decisions. |
| `docs/grilling.md` | Stable question IDs; owner answer; partner review; objections; follow-up; resolved decision; affected plan/ADR sections. |
| `docs/REMOTE_WORK.md` | Manual cloud setup, task launch packet, branch/PR expectations, troubleshooting, and smoke-run record. |
| `.github/ISSUE_TEMPLATE/` | Issue fields for scope, plan references, dependencies, acceptance, verification, fixtures and delivery requirements. |
| `.github/PULL_REQUEST_TEMPLATE.md` | Issue link, observed behavior, evidence, checks and known limits. |
| `.env.example` | Required configuration names and safe example values; no credentials. |

Commit and push the relevant documents, scripts, screenshots/fixtures and lockfiles to the branch the cloud agent will read. A local draft, local home-directory skill, local conversation memory, browser session or connected Notion authorization is not automatically present in the cloud workspace. Vendor only the project-relevant instructions or configure the required tools explicitly. Do not make remote execution depend on this machine's `~/.local/bin` wrappers.

## Issue readiness gate

A task is ready when its product decision is settled, one owner has claimed it, dependencies are merged or the explicit base branch contains them, and the following packet is complete:

- A single observable outcome and stable references to approved plan sections/ADRs.
- In-scope behavior and files/modules; explicit exclusions where they prevent scope expansion.
- Concrete acceptance examples, including empty/error/loading states when relevant.
- Verification commands and fixtures; expected manual evidence for UI changes.
- Needed configuration names and access, with credentials supplied through settings.
- Expected branch/base and whether pushing a branch and opening a draft PR are authorized.
- Stop conditions: missing product decisions, unavailable tools/secrets, failing baseline checks, or conflicting concurrent work.

Labeling an issue ready is a team convention, not an execution trigger. At launch, paste the issue body into the task if GitHub issue retrieval is unavailable; include an issue URL as traceability, not as the only specification.

## Manual cloud launch packet

```text
Implement GitHub issue <URL/NUMBER> in <OWNER/REPO>.
Use base branch <BASE> and verify expected base commit <SHA>.
Read AGENTS.md, docs/REMOTE_WORK.md, CONTEXT.md, and PLAN.md sections <IDS>.
Relevant decisions: <ADR IDS>. Dependencies: <MERGED PRS / EXPLICIT BASE>.
Issue snapshot: <FULL APPROVED ISSUE BODY>.
Confirm current code and lockfile match the intended task before editing.
Implement only the approved issue and run <PROJECT CHECK COMMANDS>.
Return acceptance evidence, changed files, check results, and known limitations.
Delivery authorization: <e.g. push issue branch and open draft PR; no merge/deploy>.
If access or product decisions are missing, stop and explain the blocker.
```

The human chooses the task on demand. The recommended first route uses the published environment UI. Do not treat a prompt asking for a PR as proof that branch publication succeeded; inspect the actual GitHub branch, base, diff, CI results and returned PR URL.

## Experimental CLI option

Local help verifies these command shapes. They are **proposals only**, after confirming the target environment and repository. Their availability in CLI 0.163.0 does not prove they address a particular new published environment.

```sh
codex cloud exec --env '<ENV_ID>' --branch '<BASE_BRANCH>' --attempts 1 '<TASK_PACKET>'
codex cloud status '<TASK_ID>'
codex cloud list --env '<ENV_ID>' --limit 5 --json
```

For manual issue publication from a selected repository, local wrapper help supports:

```sh
gh-axi issue create --title '<ISSUE_TITLE>' --body-file '<ISSUE_BODY_FILE>'
gh-axi pr create --base '<BASE>' --head '<ISSUE_BRANCH>' --draft --title '<PR_TITLE>' --body-file '<PR_BODY_FILE>'
```

Do not use these placeholders as executable commands. Do not assume `gh-axi` exists inside Codex Cloud. Use the cloud task's supported PR action or explicitly provision GitHub tooling and permissions. Merge/deploy remain distinct decisions.

## Setup, checks and smoke run

Proposed setup discipline:

1. Pin runtimes/package manager, commit the lockfile, and verify install/start/check commands on a fresh checkout.
2. Make setup safe to rerun. Keep destructive migrations and production data out of installation. Use repeatable local fixtures and development services.
3. Confirm required domains, private registry access, browser/system dependencies, app runtime configuration, and test credentials. Use project settings for secrets, not documentation or issues.
4. Define CI for the actual stack: lint/typecheck where relevant, meaningful tests, and build. A UI task also needs an inspectable screenshot or equivalent browser evidence.
5. After code/lockfile changes, check dependency freshness within the task; republish reusable setup when its preparation changes.
6. Start serially. Launch parallel tasks only when their dependencies and edited modules are independent. One active worker per issue. Shared schema, migrations and design-system changes need explicit ordering.

Smoke issue after repository bootstrap: make a tiny approved UI text or documentation change using the normal entrypoint and existing check commands. Success requires the correct base commit, docs discovered, app/checks runnable, only intended files changed, a published issue branch and reviewable PR, CI status visible, and human review completed. A task finishing with a diff alone proves only part of the flow. If no app or CI exists yet, bootstrap it as its own reviewed issue before the UI smoke run.

## Requested Muse model consultation

Actual coordinator: GPT-6.1-Sol. Actual consulted executor: **`openrouter/meta/muse-spark-1.3` through OpenCode v2.0.29**. Successful consultation session: `ses_eaa98aa55ffeTfG3kIAVRr7u2m`.

The first exact-model attempt failed with OpenRouter HTTP 402: default maximum output request was 256000 tokens, exceeding the available request allowance. A second attempt succeeded with a **process-local** inline config, 2500 maximum output tokens, one planning step, and all tools/integrations denied. No persistent configuration was edited. The result contained no tool calls and exited 0; the main step reported cost `$0.012517`.

Muse recommended docs → small ready issues → one manual task per issue → human PR review; strict acceptance/dependency/access requirements; serial execution until a smoke PR succeeds. These recommendations were checked against current official documentation by the coordinator. Its suggestion that no repo exists is unverified and rejected; the correct state is that the canonical repo is not yet confirmed. Its suggestion to keep the plan short does not override the user's request for a detailed plan: keep the agent entrypoint short and the main plan detailed.

Inline runtime overrides and schema fields were checked in [OpenCode configuration documentation](https://opencode.ai/docs/config/) and the [configuration schema](https://opencode.ai/config.json). The OpenCode plan agent's printed merged permissions included later allow rules, so the successful consultation used explicit per-process deny rules and policy overrides instead of assuming the agent name alone enforced read-only behavior.

## Missing decisions before actual integration

- Canonical repository and default/base branch, including whether existing code should be reused.
- Exact Notion page and what “app look” means: visual prototype, replacement app, or a frontend that remains connected to Notion.
- Partner review mechanism and authority for resolving disagreements.
- First delivery stack and necessary persistence/auth/integrations, based on the product interview.
- Account-visible new Cloud environment support, GitHub connector access, partner access and who launches tasks.
- Whether the desired default delivery is a branch only, a draft PR, or a ready-for-review PR. No automatic merge or deployment is implied.

