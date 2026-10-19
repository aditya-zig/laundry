# Laundry — product plan and cloud delivery workflow

Version: 0.5 · Started: 2026-10-19 · Status: discovery draft; first founder answers recorded, partner review pending.

This is the master planning document for the Laundry app. It is deliberately a draft: unresolved product choices are marked OPEN instead of being silently filled in. It becomes an implementation specification only after the grilling is complete and the agreed approval rule is satisfied. No application changes or GitHub issues have been created by this planning session.

## 1. Requested outcome

Build the Laundry app's look from the founders' Notion material. First produce a detailed Markdown plan; then convert approved, bounded work into GitHub issues. Either founder should be able to return later, choose an eligible issue, and ask Codex cloud to implement it without needing this conversation. A partner must be able to review answers, challenge decisions, and continue the interview asynchronously.

The requested sequence is:

1. Gather evidence from Notion and the existing implementation.
2. Grill the founders and record answers, disagreements, vocabulary, and decisions.
3. Agree a versioned product and design plan.
4. Draft issue-sized vertical slices with acceptance criteria and dependencies.
5. Publish the reviewed issues when requested.
6. Manually launch a cloud task for an eligible issue.
7. Review its change and verification evidence; merge and deploy according to the chosen authority rule.

## 2. Current evidence and source conflicts

| Source | Observed fact | Planning implication |
|---|---|---|
| `/home/batman/Projects/code/Landary` | Git remote is `aditya-zig/laundry`; root README names `build/laundry` as production branch; substantial uncommitted work exists | Candidate implementation, not a safe place for blanket staging or reset |
| `/home/batman/Projects/code/wandary` | Git remote is `aditya-zig/wandary`; displayed product is Laundry; implementation and design tokens already exist | A second candidate; newer changes do not prove it is authoritative |
| Both root READMEs | Customer and rider apps use Expo/React Native Web; operations uses React/Vite; local API is NestJS/PostgreSQL; hosted backend is Convex | Preserve actual architecture until founders explicitly choose changes |
| Existing specs and A0–A9 agent packets | Product, contracts, and task material already exists | Reconcile and reuse before replacing or expanding it |
| Notion Laundry home | https://app.notion.com/p/3f6074fda55681ee8b3cdc20db4090a2 | Starting source; see `product-findings.md` for fetched pages and provenance |
| Older Notion build plan | Describes an empty project and an operations framework different from the implementation | Historical planning evidence; not an execution baseline |
| Later Notion meetings | Include familiar quick-commerce UI, kg quantity, pickup windows, tiers, WhatsApp communication, and local delivery ideas | Candidate requirements requiring founder agreement |
| Meeting notes | Launch-area and delivery-model descriptions differ | Resolve explicitly; timestamps alone do not settle intent |

Founder-selected source policy: the 18 October Game plan is the product authority; code describes current implementation. Later explicit jointly approved decisions may amend that authority. Other meeting notes are supporting evidence and cannot silently override it. When these disagree, name the conflict and obtain a decision. Keep original source links and approval history. A model-generated summary with a warning needs source checking before it supplies prices, hours, or contractual promises.

## 3. Canonical project — selected (Q04)

The founder selected `aditya-zig/laundry`, local checkout `Landary`. The current working branch is `build/laundry`; confirm its intended use as the cloud baseline and reconcile required uncommitted changes before execution. Record repository URL, target branch, relevant current commit, and which useful local changes have not reached GitHub. A cloud agent cannot access uncommitted local files.

Do not merge the two projects or migrate namespaces just to establish this workflow. First identify the intended source and preserve the other checkout.

## 4. Scope — whole product selected (Q01)

The founder selected the whole product: customer app, delivery partner app, and operations console. Plan all three and their shared workflows; implementation may still land in small dependency-aware slices. Q07 selects a controlled live pilot, with a connected synthetic-data demo before accepting real orders. Q08 selects installed Android customer/rider apps and operations web, with iPhone later. Browser evidence supports web behavior; native behavior needs an additional gate. Name the first user and the first observable result that makes the work useful. Explicitly identify which existing functions should survive unchanged.

The plan must cover the connected journey across customer booking, operational fulfillment, delivery-partner pickup/return, and customer status/support. The precise service, pricing, timing and custody behavior must follow the product authority and subsequent settled questions.

## 5. Users and boundaries — OPEN

For each included actor, record their job, permissions, information needs, device, and failure recovery. Candidate actors from the current product are customer, delivery partner, and operations staff. A business cofounder reviewing this plan is different from the product's delivery partner role.

Determine whether laundry shop staff need their own interface, whether WhatsApp is a support/notification channel or an ordering channel, and which interactions can be handled manually for the first release. Defer these questions until scope and operating model are settled.

## 6. Customer journey — OPEN

For every included step, specify entry point, information shown, action, validation, success state, and recovery path. Candidate steps to reconcile with existing screens:

- Discover services and understand what is included.
- Check address/serviceability and select quantity.
- Choose pickup timing and see any return promise.
- See a transparent price or estimate and confirm the request.
- Complete the chosen payment flow if included.
- Track pickup, care, and return with useful next actions.
- Get help, cancel when permitted, and handle exceptions.
- Review delivered service if included.

Do not infer fixed-price checkout from kg selection. Decide how estimated weight, measured weight, adjustments, consent, and payment timing work before specifying the price UI.

## 7. Screen specification — OPEN

Create an entry for every in-scope screen using this format:

| Field | Required detail |
|---|---|
| Screen ID and purpose | One job and the user who needs it |
| Entry/exit | Navigation paths, deep link, back behavior |
| Content hierarchy | Primary information, secondary detail, primary action |
| Components and assets | Reused components, approved new components, image fallbacks |
| Data | Required fields and authoritative source |
| States | Loading, empty, success, failure, unavailable/offline, expired/stale |
| Interaction | Inputs, validation, disabled behavior, confirmation, retry |
| Accessibility | Labels, focus order, readable text, touch targets, status beyond color |
| Responsive behavior | Small phone, tablet, desktop when applicable |
| Evidence | Approved mockup/reference and acceptance criteria |

No screen is ready for an agent while its important behavior is described only as “make it look good.”

## 8. Visual direction — interaction reference selected; detailed design OPEN

The current Wandary design source uses white and pale-blue surfaces, navy text, teal actions, a system font, 44px minimum touch targets, and a 390px phone baseline. See `the earlier Wandary design reference (historical local source)` and `packages/design-tokens/src/index.ts`.

Q10 selects familiar shopping/navigation and fast selection, preserving a distinct Laundry identity. Detailed typography, components, image treatment and approved screen mockups remain to be designed and reviewed.

Before design work becomes build issues, approve the key journey at phone width, shared components, typography, spacing, colors, icon/image treatment, copy tone, and error/empty/loading behavior. Record approved screenshots or mockups in the repository so cloud agents can retrieve them.

## 9. Service model and commercial rules — OPEN

Q09 selects wash-and-fold and wash-and-iron initially. The single-rider pilot and paid delivery-person role must be reflected in capacity and permissions. Resolve geography/boundary, operating radius, tiers, pricing, minimum order, availability, pickup windows, return promises, cancellation, refunds, lost/damaged handling and support hours. Mark manually operated steps as such. Check disputed prices against primary founder/shop evidence rather than adopting an unreliable meeting summary.

## 10. Domain vocabulary and state — OPEN

Read the selected repo's glossary if present. Add resolved domain terms to `CONTEXT.md` as they crystallize; keep that file a glossary. Candidate distinctions already explicit in repository instructions: order state, payment state, and delivery-leg state are separate. Money is represented in integer INR minor units and schedule windows include a timezone.

Resolve ambiguous words such as partner (cofounder, rider, or shop), booking versus confirmed order, estimated quantity versus measured weight, pickup window versus guaranteed arrival, and notification versus order confirmation. Record domain edge cases before changing state machines.

## 11. Architecture and integrations — OPEN

Begin from the selected repo's current architecture and contracts. Identify whether each planned issue touches visual presentation, app behavior, shared contracts, server logic, or an external integration. Scope architectural changes separately from visual work when they are independently reviewable.

Inventory login/OTP, payment, messaging, speech, logistics, maps, and hosting. Classify each as real, simulated, unavailable, or intentionally manual using current evidence. Existing project instructions prohibit presenting simulators as live integrations. Use synthetic data for tests and demos.

## 12. Durable decisions and traceability

Maintain stable question IDs in `GRILLING.md`. Every requirement should point to a settled decision or accepted existing requirement. Every issue should reference the approved plan version and specific requirement IDs. Record difficult, costly trade-offs in short ADRs only when future readers need the rationale; keep routine reversible choices in this plan.

Suggested requirement IDs: `UX-001` for user behavior, `VIS-001` for visual rules, `OPS-001` for operational rules, and `NFR-001` for quality constraints. Assign IDs when requirements are accepted; no fictitious requirements are assigned yet.

## 13. Partner collaboration — founder-selected (Q02, Q06)

Use the same Markdown question ledger rather than relying on one person's private chat history. Each answer records author, date, rationale, and status. Either founder may add a challenge referencing a question ID. A challenge reopens affected decisions and marks dependent requirements/issues for re-review. Silence is not approval.

Proposed statuses: unanswered → answered → challenged/resolved → accepted. Plan states: discovery → ready for review → approved → superseded. Both founders must approve the same version, as selected in Q02. Later edits create a new version and identify affected issues.

`GRILLING.md` contains the first frontier and a prompt the partner can paste into a fresh agent session. Later questions depend on earlier answers; the topic map is not permission to guess those answers.

Selected shared review home (Q06): shared Notion for discussion and versioned GitHub Markdown for approved execution context. The draft plan and attributed Q&A are published on `chore/cloud-agent-workflow` in PR #2. The partner needs repository access to review them; Notion discussion publication remains pending. Avoid automatic two-way syncing initially: record each accepted decision in the approved Markdown version and link it from the discussion.

## 14. Files for repeatable cloud work — proposed layout

After selecting a repository, adapt existing files before adding new ones:

```text
AGENTS.md                         # Short entry point; preserve project-specific rules
CONTEXT.md                        # Resolved product language
docs/plans/laundry-app/PLAN.md     # Current draft; both-founder approval pending
docs/discovery/2026-10-20-founder-questions-and-answers.md # Original answers
docs/adr/                         # Only consequential trade-offs
docs/agents/README.md              # One-issue execution instructions
docs/agent-tasks/                  # Reuse existing packets, link from relevant issues
.github/ISSUE_TEMPLATE/            # Reviewable, self-contained issue template
.github/workflows/                 # Reproducible verification, adapted to existing CI
```

The master plan stays the detailed product reference. The short agent guide supplies the execution order and points to only the relevant plan sections and task packet. Installed local skills and this chat are not prerequisites for a fresh cloud worker.

## 15. Remote environment prerequisites

Confirm GitHub app/repository access in the founders' Codex account; choose the actual repository and baseline branch; configure the environment's runtime and setup; and verify that the needed tests can run there. Local login does not establish cloud environment readiness.

Current official guidance uses **Work in > Cloud** and a published environment: connect the intended repositories, let Codex prepare and test setup, review results, then publish the environment and start a task. Publishing an environment is a remote setup action; deploying the Laundry app is a different operation. The local experimental `codex cloud` commands are optional and have not been tested against a selected published environment. Current GitHub `@codex` task-trigger guidance concerns the legacy cloud route; do not assume an issue label launches the newer system. Sources: [Codex Cloud](https://learn.chatgpt.com/docs/cloud), [cloud environments](https://learn.chatgpt.com/docs/environments/cloud-environments), [GitHub integration](https://learn.chatgpt.com/docs/third-party/github).

Use repository-pinned Node/package-manager versions and lockfile. Make setup repeatable, document required non-production variables, and establish an isolated test database or supported substitute when the task requires one. The local project expects PostgreSQL through Docker on host port 5448; cloud support for that exact setup must be demonstrated rather than assumed. UI-only checks may have a smaller footprint, but required integration evidence must remain explicit.

Document setup versus task runtime network access and configure only required domains. Provide cloud secrets through the environment's supported secret mechanism. Keep secrets out of committed docs, issue bodies, model prompts, logs, and screenshots.

For the new cloud system, repository refresh does not automatically rerun installation/startup; check lockfile and dependency freshness at task start. Its network-secret placeholders and task-time behavior differ from the legacy setup-only secret model. Shared environment availability for the partner must be checked against the account/workspace; sharing the plan does not establish shared cloud access. See the official cloud-environment source above and `cloud-workflow-findings.md`.

## 16. Ready-to-start issue contract

An issue is ready when it has a concrete user outcome, approved plan version, requirement references, acceptance criteria, relevant starting context, scope boundaries, completed blockers, verification steps, and expected delivery. See `ISSUE-TEMPLATE.md`.

Split primarily by demoable behavior. Avoid separate giant “build frontend,” “build backend,” and “test everything” issues. Existing code may make a presentation-only issue appropriate; do not force database work into it. Shared contract or manifest changes need a named owner when work overlaps.

## 17. Manual dispatch and agent procedure

The founders choose when work starts. The initial system does not need a polling bot or a custom orchestration service. The cloud task prompt names the issue and approved plan version, includes the full issue if issue retrieval is unavailable, and directs the worker to the committed agent guide.

`REMOTE-WORK.md` contains the proposed dispatch prompt, preflight, implementation, verification, result format, and blocked-task behavior. Cloud launch and output mechanisms must be checked against the account's actual capabilities. A local command's presence is not proof of a configured cloud environment.

## 18. Delivery authority — branch and PR selected (Q03)

Selected: a task may make focused code changes, run checks, push an isolated issue branch and deliver a reviewable PR. Founders review and authorize merge/deployment separately. The founder additionally requires the worker to run and interact with the app using browser/computer tools and provide a watchable video that demonstrates the issue works. Each pushed revision needs current verification evidence; the detailed loop is specified in VERIFICATION.md.

Deployment policy needs reconciliation before product release. The isolated committed baseline still targets `build/wandary` in its Convex deployment job, while the original dirty checkout proposes `build/laundry`. This tooling branch preserves the committed job. Existing Vercel integrations automatically create branch previews. Confirm the eventual production target and separate merge from production promotion before release; this tooling does not authorize production deployment.

An instruction in an issue is part of task context; it cannot supply missing repository permissions or account credentials. Decide the delivery policy before using the smoke task.

## 19. Verification and done

For a given issue, completion means its acceptance criteria are demonstrated, relevant repository checks have run successfully, the diff matches scope, and delivery evidence exists. List the exact commands, exit outcomes, screenshots where UI is involved, and limitations. Distinguish implementation complete, verification blocked, PR open, merged, and deployed.

For UI changes, inspect the actual affected journey at the agreed phone width and required larger sizes. For changes to orders, payment, permissions, custody, or messaging, use the relevant existing behavior and integration tests. Repository instructions require PostgreSQL-backed acceptance evidence and actual browser checks before claiming full completion; document any unavailable check as a blocker or limitation.

## 20. Concurrency and failure recovery

Start with one cloud worker per issue and avoid concurrently changing the same shared files. A dependent issue becomes eligible after its blockers are merged into the task's baseline, not merely after another worker reports success. If several independent issues run, assign file ownership and an integration owner.

On missing access, missing secrets, an unavailable database, unresolved requirements, or contradictory acceptance criteria, the worker reports a precise blocker with observed evidence and the smallest human action needed. It may deliver verified partial work, clearly labeled, without claiming the whole issue is done. Retry from the latest approved baseline and identify earlier attempts so duplicate branches/PRs are avoided.

## 21. Change management

An accepted plan change identifies its rationale, author, affected requirements, affected issues, compatibility impact, and need for renewed approval. Update existing ready issues or retire them before a worker implements stale behavior. A running worker should stop at a safe point when its requirements are superseded.

## 22. Setup acceptance test

Before trusting the workflow for product work, use one small, reversible smoke issue after repository/environment setup. From a fresh cloud task, demonstrate that the worker can read committed instructions, prepare the workspace, make the bounded change, execute required checks, and produce the selected delivery artifact. The founders inspect the diff and confirm no local-only knowledge was required.

Pass only with an actual cloud run and accessible result. A Markdown file, successful local tests, and configured CLI are preparation evidence, not a completed smoke test.

## 23. Proposed milestones

| Milestone | Deliverable | Exit condition |
|---|---|---|
| Discovery | Source reconciliation and completed grilling ledger | Every blocking product/design decision settled |
| Plan review | Detailed master plan and design references | Required founders approve the same version |
| Work breakdown | Draft vertical slices and dependency graph | Founders approve scope and granularity |
| Cloud preparation | Committed guide, configured environment and CI | Fresh cloud smoke task passes |
| First slice | One issue implemented remotely | Acceptance evidence and selected delivery artifact reviewed |
| Continued build | Eligible issues worked on demand | Each slice passes the same completion contract |

Dates and estimates remain open until scope and capacity are known.

## 24. Risks that must affect the plan

- Two repository candidates and dirty working trees: identify the baseline and intentionally publish required context before cloud work.
- Historical documents conflict with code: retain provenance and agree desired behavior explicitly.
- A polished UI can promise unsupported operations: match quantity, pricing, pickup, and return copy to the actual service model.
- Local runtime assumptions may fail in cloud: prove setup and checks with a smoke task.
- Partner approval can drift between chats: version and attribute decisions in shared files.
- A broad issue encourages a broad unreviewable change: use bounded behavior and dependency-aware slices.

## 25. Approval record

| Item | Status |
|---|---|
| Canonical repo/branch | `aditya-zig/laundry` selected; cloud baseline confirmation pending |
| Product scope | Whole product: customer, delivery partner and operations — Q01; controlled live pilot, Android customer/rider + ops web; iPhone later |
| Partner decision rule | Both approve the same plan version; either may challenge — Q02 |
| Shared partner review home | Notion discussion + GitHub Markdown — Q06; GitHub draft published in PR #2, Notion discussion pending |
| Remote delivery authority | Issue branch + PR with real browser/computer verification and video — Q03; merge/deploy separate |
| Product authority | 18 October Game plan — Q05; unresolved operational details still require explicit decisions |
| Complete product/design decision tree | IN PROGRESS |
| Plan approval | PENDING |
| Issue publication | FUTURE — user said they will convert the plan later |
| Cloud environment setup and smoke execution | PENDING — no cloud task launched |

## 26. Verification loop — required by Q03

For every pushed PR revision, produce verification evidence for the exact head commit: start the app, perform relevant browser/computer interactions, record a watchable video, check acceptance assertions and persist the supporting results. A new push invalidates the previous revision’s review-ready status. Failed runs feed a bounded fix-and-rerun loop; unavailable evidence leaves the PR draft/blocked rather than implying success. The design and proposed rollout live in `VERIFICATION.md`.

## Supporting documents

- `GRILLING.md`: interview frontier and partner continuation.
- `REMOTE-WORK.md`: proposed one-issue cloud execution guide.
- `ISSUE-TEMPLATE.md`: draft contract for issue conversion.
- `VERIFICATION.md`: per-commit browser interaction, video evidence, repair and approval loop.
- `product-findings.md`: product/repository/Notion evidence from the context agent, when complete.
- `cloud-workflow-findings.md`: tooling and official documentation evidence from the workflow agent, when complete.

## 27. Authorized tooling implementation

On 20 October the founder requested setup of subagents and cloud work tooling and asked for a push. Implement this independently in an isolated worktree/issue branch from the committed `origin/build/laundry` baseline, preserving the original dirty checkout. The baseline still uses `@wandary` package names; tooling must discover package names instead of assuming the uncommitted `@laundry` rename is available. No merge or app deployment is authorized. Product discovery and joint plan approval continue.

## 28. Founder refinements — 20 October

- Paid delivery person: pickup/return and doorstep records; founders control money changes/refunds and final processing (Q11.a).
- Premium: extra care and priority handling. Exact inclusions and supported speed promise confirmed before launch (Q12, Q15).
- Measured weight is recorded; customer approves increased price before processing (Q13). Payment is at delivery/return (Q16).
- Pilot: Indiranagar; exact boundary pending (Q14).
- Timing ideas: 8 pm pickup → next morning 8 am return, alternative 5 pm pickup → next morning 8 am; weekend idea 10 am → 5 pm. These are tentative capacity-dependent ideas, not fixed appointments or guaranteed SLAs (Q17, Q19).
- Pricing presentation: per-kg rates with an ecommerce-style approximate quantity guide, such as 1 kg ≈ 5–6 shirts. Do not use the example as an exact billing conversion. Physical box allocation remains a separate unresolved logistics rule (Q18).
- Rates and minimums/increments are deferred to the joint session (Q20). Unanswered consent means hold/contact and founder-agreed unprocessed return (Q21/Q24); return payment is UPI or cash (Q22).

The complete original-answer record for cofounder review is [founder questions and answers](../../discovery/2026-10-20-founder-questions-and-answers.md). No partner approval has been inferred.

## 29. Latest founder answers and partner agenda

Overnight and weekend same-day options are capacity-dependent (Q19). Per-kg/Premium rates, minimums and billing increments are deferred to the joint founder session; raise Q20 first when the partner reviews. Hold processing and contact the customer while increased-price consent is unanswered (Q21). Return payment supports UPI and cash (Q22). Cloud account provisioning is explicitly deferred until after the repo tooling push; do not report a cloud environment or actual cloud task as ready.

## 30. Intake and unanswered approval — Q23/Q24

The paid rider weighs and inspects at the laundry. Founders retain control of pricing adjustments, refunds and final processing exceptions. If increased-weight approval is still unanswered after contact, processing stays on hold and a founder agrees an unprocessed return with the customer. Exact timeout, contact attempts and fees remain deferred. Partner review is pending.

## 31. Current delivery scope — Q25

This branch covers PLAN.md and remote-agent execution/verification tooling. It does not implement the proposed product redesign or assign frontend ownership. Future cloud agents implement manually assigned bounded issues and verify their pushed revisions. Repository browser evidence runs on all pushes and pull requests, regardless of worker branch naming.

## 32. Partner report and stopped frontend work

The founder requested a neat report pairing every question with options and original answers. See [partner review report](../../discovery/PARTNER-REVIEW.md), covering Q01–Q25 and Q11.a. Discovery is not complete and both-founder approval remains pending. The founder subsequently instructed “stop the frontend stuff”: frontend implementation and further manual app walkthroughs are stopped. Current work is planning/report and repository tooling.

## 33. Latest billing and exception answers — Q26–Q28

Q26: charge the original selected estimate even if measured weight is lower. This supersedes any earlier assumption that lower measured weight automatically reduces billing. A 5 kg selection measuring 4 kg is billed at 5 kg; higher measured-price increases still need customer approval before processing. Q29 is clarifying whether the selected kg is a clearly disclosed minimum package quantity. Rates, rounding and other minimum rules remain undecided.

Q27: cancellation is free before pickup; founders handle requests after pickup. Exact charges, treatment after processing begins and unprocessed-return rules remain to be completed.

Q28: if return payment fails, try an agreed alternative, then contact a founder. Keep payment unresolved and do not mark payment or delivery complete until the outcome is agreed; founders decide credit, handover and return arrangements.

## 34. Partner deferrals and communication — Q29–Q31

Q29: the minimum-package/lower-weight billing rule is deferred to the joint partner session. Q26 remains a proposed founder direction; the final billing contract is unresolved and must not be implemented as approved. Raise this after Q20 rates.

Q30: the entire missing/damaged-clothes claims policy is deferred to joint review before launch. Evidence, reporting deadlines, responsibility, remedies, compensation and exclusions are all unresolved.

Q31: show order status in the app and use WhatsApp for key updates/contact. Whether the pilot uses manual messages or automatic integration is being clarified in Q32. No delivery reliability is assumed.

## 35. Messaging, access and capacity — Q32–Q34

Q32: manual versus automated WhatsApp sending is deferred to the partner. Q31’s channel decision remains: in-app status plus WhatsApp key updates/contact.

Q33: real customers sign in with phone OTP; demo sign-in is for testing only. Actual provider delivery and failure handling must be verified before the live pilot.

Q34: founders control slot capacity and opening/closing with rider/operator input. Full slots stop accepting new bookings. Atomic capacity reservation and booking confirmation are being clarified in Q35.
