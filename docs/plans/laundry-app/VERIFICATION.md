# Laundry — browser use, video evidence and repair loop

Status: design draft · Required outcome selected by requesting founder in Q03 · Joint plan approval and implementation pending.

## Required outcome

When a remote worker pushes an issue revision, the founders should receive a reviewable PR and a watchable recording of the actual app interactions that demonstrate the issue. The worker must start/use the app, verify the relevant behavior, fix failures, and rerun the checks. A recording from an earlier revision cannot approve a newer revision.

The scope is the whole product: customer app, delivery partner app and operations console. Browser verification of their web builds does not establish native-device correctness; the launch-platform decision must determine any additional device tests.

## Existing baseline observed locally

The current working tree already has PostgreSQL-backed integration tests and CI for build, types, domain tests, Convex type checks and voice tooling. It does not yet have a Playwright browser suite, video upload or a per-commit browser-evidence gate. The root `test:e2e` name currently refers to API tests, not a customer/rider/ops browser journey.

`tools/dev.mjs` can start a local API on port 4100, customer web on 8081, partner web on 8082 and ops on 5173. Its cloud mode can use shared hosted services; use an isolated local/test backend for verification that changes orders. Current integration tests truncate tables: never point them at a shared demo/production database or run them concurrently against a browser suite using the same data.

These observations concern the local working tree, which includes uncommitted changes. The first workflow setup task must establish the intentionally committed baseline.

## Proposed simplest architecture

Use the cloud worker for implementation and exploratory browser use. Use repository-owned browser scenarios and GitHub CI to reproduce important assertions and capture evidence on every PR revision. Keep a draft PR until the current revision has the required checks and evidence. This avoids creating a custom job dispatcher before the manual issue workflow has been proven.

Two forms of evidence serve different purposes:

1. **Agent browser/computer exploration:** the worker opens the running app, follows the issue's acceptance journey, inspects results and records its interactions. Include relevant alternate/error paths. This directly supports the founder's request to see the agent use the product.
2. **Reproducible browser checks:** scripts exercise critical journeys with assertions and generate videos, traces and reports. They repeat in CI for each revision and guard against regressions. A passing video file is not an assertion; check visible behavior and persisted outcomes where relevant.

Cloud access to browser tools and recording must be demonstrated in a smoke run. Local T3 browser/recording tools and locally installed skills do not automatically exist in Codex cloud. If the account cannot support agent browser interaction, report that requirement blocked; CI recordings alone do not silently replace it.

## Per-revision sequence

1. Select a ready issue whose prerequisites are in the chosen baseline. Record repository, issue, plan revision and baseline commit.
2. Prepare isolated services and synthetic fixtures; start the relevant app builds. Confirm readiness by behavior/health checks rather than fixed sleeps.
3. Implement a bounded change. Run appropriate static, domain and integration checks; run destructive test setup only against the job's private database.
4. Perform and record actual browser interactions for the issue. Check the successful result and important recovery/permission behavior. Add meaningful repeatable browser assertions when the changed behavior warrants regression coverage.
5. Inspect failures, fix the implementation or justified test/environment defect, then repeat affected checks and recordings. Proposed bound: three repair cycles per attempt; unresolved product decisions or unavailable access are blockers rather than reasons to change the acceptance criteria.
6. Create/push the isolated issue branch and draft PR. The pushed revision triggers CI verification. The worker waits for results and follows the same repair loop if it can fix a clear failure within scope.
7. Publish current evidence and a short review packet. Mark the PR ready only when required checks and evidence for its current revision are complete. Every new push makes the previous evidence stale until a new run completes.
8. Both founders review according to the chosen approval policy. Record the approved plan/version and implementation commit. A PR author's self-approval cannot be counted as a formal GitHub approving review; decide how their explicit acceptance is recorded.

## Evidence packet

For each current PR revision, retain:

- A short watchable video of the relevant acceptance journey, with enough context to understand the actor, action and result. Separate chapters/clips for customer, rider and operations when the issue spans all three.
- A summary connecting each acceptance criterion to its check and, where useful, video timestamp.
- Browser test report and failure trace when available; app/server logs needed to diagnose the result.
- Exact check commands, outcomes and any checks that could not run.
- A machine-readable manifest containing issue URL, plan revision, PR head SHA, base SHA, actual tested SHA, workflow run/attempt, app/backend build identifiers, scenarios, fixture version, environment type, timestamps, pass/fail status and artifact links/digests.

If CI tests a synthetic merge commit, record it separately from the PR head commit. Bind the evidence to both, and invalidate it if the tested integration or head changes. A cloud-local run against uncommitted files is useful diagnostic evidence but cannot establish that a published PR commit was tested.

## Making review easy

The PR body should lead with the observable change, the current verification status and a direct way to watch the video. Provide technical reports as supporting links. Suggested review packet:

```text
Issue: <URL> · Plan: <version> · Verified head: <SHA>
Change: <observable before/after behavior>
Watch: <accessible current video link>
Proof: <criterion → result and timestamp>
Checks: <CI run and browser report>
Limits/blockers: <specific remaining issues, or none>
```

A downloadable Actions artifact ZIP is useful storage but is not automatically an inline watchable PR video. The setup smoke task must prove a supported upload/playback path that both founders can access. Prefer a private repository-supported attachment or existing approved private storage; introducing a new public hosting service requires an explicit choice. Do not claim the video has been delivered merely because it exists in a worker's temporary directory.

Choose retention long enough for the team's actual review cadence. Link the precise run/attempt rather than a mutable “latest” recording. Use synthetic accounts/data so recordings remain reviewable without exposing real customer information.

### Verified attachment path

Local `gh` version 2.102.0 exposes `gh pr edit <PR> --attach <file>`. Its help says videos render as a player, and an attachment failure can leave the PR partly updated while returning a nonzero exit. Use `gh-axi` for ordinary GitHub operations; its current wrapper does not expose this attachment flag, so this specific capability uses `gh`. No actual upload has been performed.

Proposed task command, after an authorized PR and recording exist:

```sh
gh pr edit '<PR_URL>' --attach '<CURRENT_REVISION_VIDEO.mp4>'
```

After upload, inspect the resulting PR body and verify the player, artifact identity and access; command availability is not delivery proof. GitHub documents repository access controls for private/internal attachments, a 10 MB video limit for free plans and larger limits under specified paid-plan conditions. Prefer H.264 in an MP4 container for broad playback; a WebM recording uses a codec supported by that container and may need transcoding. [GitHub attachment documentation](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/attaching-files)

### Recording and CI configuration

Playwright's `video: 'on'` retains recordings from passing tests as well as failures; failure-only recording cannot satisfy the founder's requirement for successful journey evidence. Manually created contexts must be closed and awaited so the video finalizes before upload. Set an explicit usable viewport/video size and keep recordings focused on the acceptance journey. [Playwright video documentation](https://playwright.dev/docs/videos)

Use traces for diagnosis and assertion context, and the video for the human review path. Record a trace for the explicit acceptance run or retain failure traces according to the cost/coverage policy; do not imply that a trace viewer is the requested video player. [Playwright trace documentation](https://playwright.dev/docs/trace-viewer)

Each CI attempt uploads uniquely identified reports, traces and the manifest with its videos. Handle ordinary test failures by retaining evidence while preserving the failed check outcome. Cancelled/timed-out runs may not finalize/upload everything; their absence cannot become a success. Artifacts have configurable retention and digests, so review links must identify the actual run and expire honestly. [GitHub workflow artifact documentation](https://docs.github.com/en/actions/how-tos/writing-workflows/choosing-what-your-workflow-does/storing-and-sharing-data-from-a-workflow)

### Review gate versus draft convenience

A draft PR is a useful signal, but a person can change that status. The enforceable merge gate requires a repository-required check for current evidence and passing verification, configured through the repository's supported rules. The checker must reject mismatched head/tested SHAs, missing recordings, unsuccessful required scenarios and absent upload evidence. It must not accept a mutable PR description saying “passed” as its sole source.

For same-repository PRs, CI can test either the head or a merge result; record the actual checked-out/tested commit instead of assuming every run is a synthetic merge. A browser run and CI run can test different commits, but the review packet must say so and satisfy the chosen policy before becoming current. Merge/deploy coupling remains a separate setup issue.

## Critical connected regression journey

After product decisions settle, implement a small core regression journey across all three surfaces: customer creates the intended booking; operations sees and processes it; rider performs the required pickup/return actions; customer sees the correct result. Assert common identity, prices/quantity, state, permissions and custody behavior across screens and backend. Add issue-specific scenarios beyond that core where the issue warrants them.

The exact business steps, payment policy, measurement/adjustment rules, box custody and timing are still under grilling. This paragraph defines verification coverage, not invented business requirements.

## Failure policy

- Failed behavior: record the failure and repair/rerun; never send only a handpicked successful clip as proof that all criteria pass.
- Missing browser/recording/upload capability: keep the task verification-blocked and name the smallest setup needed.
- Missing real integration: test its isolated adapter or explicit simulator only where approved, and label evidence accordingly.
- Flaky/infrastructure failure: retain failure artifacts, classify the cause, and perform a bounded retry. A green retry does not erase the earlier failure history.
- New push: supersede the previous review packet and generate evidence for the new revision.

## Deployment coupling

Current CI deploys Convex after successful checks on a push to `build/laundry`, when its secret is configured. A PR merge into that branch can therefore deploy. If merge and deployment require separate approvals, modify that coupling in a reviewed setup task before using the branch for ordinary product merges.

## Proposed setup slices, before ordinary product issues

1. **Fresh verification environment:** run the existing checks and app builds against a private database using the intentionally committed baseline. Acceptance: new environment can reproduce the setup without local developer state.
2. **First recorded browser scenario:** implement one approved small scenario, assertions and video/trace outputs. Acceptance: both success and induced failure produce understandable evidence.
3. **Per-push CI evidence:** run scenarios for each PR revision and upload the manifest/reports/recordings even on relevant failures. Acceptance: artifact identity matches tested/head commits; a second push supersedes first-push evidence.
4. **Founder review surface:** make the recording watchable from the PR and record current status/acceptance links. Acceptance: both founders can access the exact current video and tell what passed.
5. **Agent repair loop smoke:** manually assign a small issue to Codex cloud, observe real browser use/video, introduce or encounter a controlled failure, repair it within the defined loop and deliver a review-ready PR. Acceptance: all evidence belongs to the delivered revision; no merge/deploy occurred without its authority.

These are local draft slices, not published GitHub issues. Refine them with the two OpenCode Muse planning outputs and review the final setup design before implementation.

The detailed draft issue packets now live in [setup-issues/README.md](setup-issues/README.md). The two actual Muse reports are [cloud workflow](muse-cloud-workflow.md) and [product grilling](muse-product-grilling.md). Their prose is agent advice, not an accepted specification. Coordinator corrections: use actual tested SHA instead of always assuming a merge SHA; use H.264/MP4 rather than H.264/WebM; keep the proposed repair bound at three cycles unless the founders change it; and use a required check for enforcement rather than relying solely on draft status.

## Local recording smoke result — 20 October 2026

Local T3 browser recording/export succeeded on the planning worksheet. The 10.2168-second output is H.264 MP4, 1228×768, 412246 bytes. The agent selected a draft answer, checked portable-mode behavior, then cleared it; all five questions ended unanswered. No founder decision was inferred from this synthetic interaction.

This proves local browser recording/export only. It does not prove Laundry journeys, native devices, Codex cloud browser capability, PR upload or partner playback access. See [BROWSER-SMOKE.md](BROWSER-SMOKE.md) for exact evidence and the separate outstanding smoke gates.
