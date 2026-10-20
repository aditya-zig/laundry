# OpenCode Muse Spark 1.3 — cloud work track

Executor: OpenCode CLI. Requested model: `openrouter/meta/muse-spark-1.3`. Session: ses_eaa8bd54bffeNQZZy9V8DcM6dD. Exit: 0. Supplied-context planning run; tools disabled; no implementation or tests performed.

Hybrid approach

Each GitHub issue triggers one manual on demand cloud task. The agent works on an isolated issue branch and opens a draft PR early. Before handoff the agent drives the actual app through browser or computer use and records the session. Each revision gets its own watchable mp4 or webm in H264. CI then supplies reproducible assertions and video per push. Coordination stays in Notion for discussion and GitHub for approved Markdown. Humans merge and deploy separately. No custom orchestrator is used at first. Regular PR work uses the gh-axi wrapper and only the attachment step uses plain gh.

SHA and identity contract

Record baseSHA, headSHA and testedSHA in every evidence manifest. baseSHA is the target branch tip. headSHA is the branch tip. testedSHA is the synthetic merge commit GitHub actually tests. A video tied only to headSHA does not prove testedSHA. Manifests must list stable scenario IDs taken from the Oct18 Game plan so results stay comparable across runs. Any push with a new headSHA marks prior video and CI results stale. The PR stays draft until fresh video for the current headSHA plus green CI plus linked manifest exist. Then it can move to ready. Both founders must approve and either founder can challenge.

Attachments, artifacts and failure handling

Per supplied gh help, gh pr edit supports --attach with a file and renders video as a player. Per supplied docs, private repos gate attachment access and prefer mp4 or webm H264 with about 10MB on free plans and higher paid limits. No successful upload is claimed in this plan. Use PR attachments only for watchable video. Use Actions artifacts for full reports and traces. ZIP artifacts are not inline playback. Per supplied Playwright docs, video is off by default and mode on retains passing runs, and context close finalizes the file. If video is missing, over limit, corrupt or not playable, or artifact links are broken, the PR stays blocked with a plain reason. Cloud browser tooling and account access remain unproven, so the agent must report blocked with logs rather than claim coverage.

Bounded loop

Allow at most two fix and rerun cycles per revision for flaky or minor failure. After that mark the issue blocked and wait for human direction. API Vitest suites TRUNCATE tables and need a private job database, so finish API tests before seeding any browser suite. Dev ports per supplied facts are API 4100, customer 8081, rider 8082 and ops 5173. Cloud mode connects to hosted demo and must not be used for write tests.

Setup issues

1. Manifest contract. Define JSON fields for baseSHA, headSHA, testedSHA, scenario IDs and video URLs. Acceptance is a checked in schema plus one hand filled example. It blocks issues 3 and 4.
2. Agent capture and attach path. Document recording start and stop plus gh attach upload and player check. Acceptance is a written runbook with failure strings. It is blocked until browser capability in cloud is proven.
3. CI browser suite separation. Keep Node 24 and pnpm 10.33.2, keep PG 17 on 5448 plus build, check, Convex types, tests and voice jobs, and add a separate Playwright video job with multiple webServers. Acceptance is green CI with video artifact on a test PR. It is blocked by issue 1.
4. Draft to ready gate. Enforce draft status while evidence is stale and require current video plus green CI plus manifest link before ready. Acceptance is a stale PR that cannot go ready and a fresh PR that can. It is blocked by issues 1 and 3.
5. Founder watch smoke. Open a tiny PR with a short attached clip and have both founders comment that they watched it. Acceptance is two watch comments on current headSHA. It is blocked by issue 2.
6. Cloud task checklist. Define manual launch steps, secrets needed, Convex deploy guard for build laundry branch, and honest blocked reporting. Acceptance is one dry run that ends in either pass with video or explicit blocked. It is blocked by issues 2 and 3.

Recommendation

Adopt this hybrid with strict SHA manifests, stale invalidation, draft gating, attachments for watchable video, artifacts for full evidence, a two rerun limit, and the six setup issues above, with founder watch smoke as the proof that review works.
