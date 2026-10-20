# Muse cloud workflow — incomplete attempt

Executor: OpenCode; requested model `openrouter/meta/muse-spark-1.3`; session `ses_eaa922732ffe3t5H0Gb4EjrvnV`. This run produced partial output, hit its output limit, then failed with OpenRouter HTTP 402 (`in_flight_budget_exhausted`). A serial retry also received 402. This is diagnostic material, not a completed cloud-tooling plan or a successful setup. No replacement model was used.

# Cloud tooling and video verification loop

Executor. I am one of two independent OpenCode agents. Model is openrouter slash meta slash muse-spark-1.3 through OpenCode. This is planning only. Tools were disabled for this run. I did not browse, run code, configure tools, or test anything. Everything below separates what was supplied from what I propose and what remains unknown.

## 1. What was supplied

Observed from the supplied audit and snapshots. I treat these as facts for planning, not as things I rechecked.

Repo is aditya-zig slash laundry. Local checkout is Landary. Baseline branch is build slash laundry. Package manager is pnpm 10.33.2. Node is 24. CI has a Postgres service on port 5448, frozen install, build, check, check colon convex, test, test colon voice. There is no Playwright browser test. There is no video artifact upload. Root test colon e2e is API Vitest, not browser.

Local start is tools slash dev.mjs. It starts API on 4100, customer on 8081, partner on 8082, ops on 5173. Flag cloud skips local API and points web apps at hosted Convex. Supplied warning says avoid writes there.

Integration tests truncate tables. That means a shared database is unsafe. Browser journeys need seeded data. API suite should finish before the seeded browser journey starts, or the seed will get wiped mid run.

CI file shows a deploy convex job. It runs after verify on push to build slash laundry when the deploy secret exists. That means both direct push and PR merge into that branch can deploy. Merge and deploy are coupled today.

Local T3 recording tools exist on this machine. Cloud does not inherit them. AGENTS.md requires Postgres backed acceptance and actual browser inspection before claiming completion. AGENTS.md also forbids presenting demo login, demo capture, outbox, or simulated delivery as production.

Founder choices for this track. Whole product is in scope. Customer plus delivery partner plus ops. 18 October Game plan is product authority. Both founders approve the same plan version and either can challenge. Review home is shared Notion discussion plus GitHub Markdown. Cloud workers may push issue branches and open PRs, must use browser or computer tools and supply watchable video per revision, human does merge and deploy.

## 2. Unknowns that must be smoke tested

Unknown. Do not assume these in implementation issues.

Cloud UI and CLI compatibility with the selected repo and branch. Exact video publishing path from a cloud task. Whether the cloud environment supports Postgres service containers, Playwright system deps, ffmpeg, Expo web builds, and parallel web servers. Whether a cloud worker can push a branch and open a draft PR with the supplied permissions. Whether large video files can play inline in PRs or must be download links. Whether browser agent tools exist in the cloud task runtime at all.

Proposal. Every unknown above gets an explicit smoke assertion. Pass means seen in a real cloud run with a URL a founder can open. Fail means draft and blocked, not assumed done.

## 3. Goals for this track

Proposed. One manual cloud issue at a time. No polling bot. No custom orchestration service.

A future implementer can take one ready GitHub issue, launch one cloud task by hand, get a small diff plus repeatable evidence, review video, merge by hand, and deploy by hand. Every push invalidates stale evidence. Humans stay in control of merge and deploy.

Evidence must tie one exact head SHA and one exact base SHA to all builds used in the test. That is API plus customer plus partner plus ops. Plus video plus trace plus logs plus manifest. No evidence reuse across revisions.

## 4. Feasible approaches compared

### Option A. CI owned Playwright with artifact evidence

Proposed as simplest.

Add a repo local Playwright project. Add one pnpm script such as test colon browser. CI installs Playwright browsers and ffmpeg, starts Postgres, installs deps, builds all apps, starts API and three web apps on fixed ports, runs API tests first, then seeds, then runs Playwright with video and trace on. CI uploads video, trace, junit, and a JSON manifest as workflow artifacts. PR body links those artifacts for the exact head SHA.

Strengths. Deterministic. Reviewable. No dependency on interactive agent tools. Works the same locally and in CI. Fits existing GitHub Actions Postgres pattern.

Limits. CI video shows scripted regression, not freeform exploration. It does not by itself prove the worker interacted with the app. It needs a supplement for the founder Q03 video interaction rule.

### Option B. Worker driven interactive browser with screen recording

Proposed as supplement, not as gate.

Cloud worker opens the running app with its browser or computer tool, performs the issue journey by hand, records screen to mp4, narrates or captions steps, uploads to the PR.

Strengths. Directly matches the founder ask to run the app and show it works. Good for usability judgment. Good for ops console flows that are hard to script early.

Limits. Fragile. Tool availability varies by cloud runtime. Video size and upload path vary. Manual steps drift. Hard to assert on. Cannot be the only gate.

### Option C. Preview deploy plus external check service

Proposed and rejected for initial use.

Build preview URLs per PR, run an external synthetic monitor or video service, post back status.

Strengths. Closer to production networking. Useful later for mobile or cross device checks.

Limits. Needs hosting, secrets, data isolation, cleanup, and a new service to maintain. Overkill before one manual issue works end to end. Also risks writes to hosted demo data, which the supplied warning forbids.

My judgment. Start with A as the required gate. Use B as required supplemental video when tools exist, with an explicit blocked state when they do not. Defer C. I say this because the team needs determinism first and the founder video rule second. A gives determinism. B gives human confidence. C adds cost before the basics pass.

## 5. Recommended loop

Proposed. Hybrid A plus B. CI recording is authority. Interactive video is required supplement.

Flow for one issue.

Human picks one ready issue. Human launches one cloud task by hand with the full issue body pasted in. Worker uses base branch build slash laundry at a pinned base SHA. Worker implements only that issue. Worker runs repo scripts in order. Worker pushes to an issue branch named like issue slash 123 short slug. Worker opens a draft PR against the base. CI runs on that push and produces fresh evidence for the new head SHA. Worker attaches interactive video if its runtime has browser tools and recording. Human reviews. Human marks review ready only when CI evidence and interactive video both match head SHA. Any new push resets status to needs fresh evidence.

No auto merge. No auto deploy from issue branches. Merge to build slash laundry stays manual and explicit.

## 6. Repo local entrypoint and setup

Proposed file changes, all inside aditya-zig slash laundry.

Keep AGENTS.md short. It should point to docs slash agent-workflow.md, CONTEXT.md, the approved plan sections, and the issue packet. Keep the combined AGENTS.md chain under the cloud instruction limit noted in prior research.

Add docs slash agent-workflow.md. One issue execution order. Preflight. Install. DB. Build. Test order. Browser run. Evidence collection. Branch and draft PR. Blocked report format.

Add tools slash verify-browser.mjs or equivalent. Single entry that waits for API 4100 and web ports 8081, 8082, 5173, checks health, then invokes Playwright. Cloud and CI call the same file. No hidden local wrappers.

Add playwright.config.ts at root. Projects for customer, partner, ops. Use 390px phone width as baseline plus one desktop width for ops. Set video retain on failure and on first passing smoke, trace retain on first retry, screenshot only on failure after that to control size.

Add pnpm scripts. Keep names stable. Suggested set is test colon browser, test colon browser colon smoke, record colon smoke, verify colon evidence. Exact names get settled in implementation, but issues must reference the settled names.

Pin versions. Playwright version, browser build, ffmpeg presence, Node 24, pnpm 10.33.2. Lockfile committed. Document system deps for CI ubuntu runner.

Env handling. Use .env.example with safe placeholders only. Real secrets come from CI secrets or cloud environment secrets. Never commit .env. Never print secrets in logs. Never include secrets in video, screenshots, or manifest.

## 7. Browser interaction design

Proposed.

Deterministic regressions live in e2e slash browser. One spec per user journey slice. Example paths are booking