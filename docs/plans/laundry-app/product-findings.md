> Historical research snapshot from the earlier GPT-6.1-Sol discovery track. Read PLAN.md and GRILLING.md for the founder’s current decisions. This report is evidence, not the approved plan. The two native GPT subagents were interrupted after the founder requested actual OpenCode Muse execution.

# Laundry planning: product, repository and partner-review evidence

Prepared 19 October 2026. Research owner: `laundry_context` subagent, GPT-6.1-Sol. Read-only discovery; this file is the only artifact written by this subagent. No app, repository configuration, Notion, GitHub or provider changes were made. No current runtime/test success is claimed.

## Strongest findings

1. The likely Notion workspace is **Laundry · Home**, https://app.notion.com/p/3f6074fda55681ee8b3cdc20db4090a2. Both local product specifications cite that exact page. It now contains separate Business, Meetings and Engineering databases, plus customer/shop surveys.
2. This is **not a greenfield codebase**. Two local clones already contain customer, delivery partner and operations apps, backend, contracts, design tokens, tests and execution packets. They point to different GitHub repos and both have substantial uncommitted work. A canonical repository decision is required before installing the new execution workflow into either one.
3. Existing plans are useful evidence but contain stale statements. The Notion build plan and local historical plan still say the folder is empty/no application exists; current files contradict this. They also propose Next.js ops while the implemented ops app uses Vite. README documents hosted Convex plus local NestJS/Postgres; the historical plan describes only Postgres.
4. Newer meeting notes materially narrow or change the old spec: app-first, Zepto-familiar UI, service → kg quantity → pickup slot, premium/general services and WhatsApp communication rather than voice ordering. These are recorded discussion outcomes, not authority to silently rewrite everything.
5. Operational details conflict across meetings: Indiranagar versus a suggested Beniganalli starting zone; batch truck/driver/sorter and reusable boxes versus one scooter and a 10–15-minute radius. Ask which decisions are current rather than combining both into one impossible launch.
6. The shop interview explicitly warns its original AI summary overstates confidence. Its quoted rates, hours, capacity and earnings must not become production facts.
7. `Landary/.github/workflows/ci.yml` already deploys Convex automatically on a push to `build/laundry` if its secret is configured. Future remote workers should operate on feature branches and PRs; direct pushes to this branch can trigger deployment.

## Repository inventory

| Property | Laundry clone | Wandary clone |
|---|---|---|
| Local path | `/home/batman/Projects/code/Landary` | `/home/batman/Projects/code/wandary` |
| Origin | `git@github.com:aditya-zig/laundry.git` | `git@github.com:aditya-zig/wandary.git` |
| Current branch | `build/laundry` | `build/wandary` |
| HEAD observed | `e3c509a` · 2026-10-12 · fix: correct displayed product name to Laundry | `5b7ccb1` · 2026-10-15 · test: drop self-answering journey tests and token hex pins |
| Working tree | 135 porcelain entries at inspection, including namespace/config changes | 13 porcelain entries at inspection, mostly UI refresh plus new docs |
| Package namespace | `@laundry/*` | `@wandary/*` preserved for compatibility |
| Display name | Laundry | Laundry |
| Main plan | `docs/superpowers/plans/2026-10-11-laundry.md` | `docs/superpowers/plans/2026-10-11-wandary.md` |
| Product spec | `docs/specs/product-spec.md` | `docs/specs/product-spec.md` |
| Contracts | `docs/specs/contracts.md` and `packages/contracts` | same relative paths |
| Agent packets | `docs/agent-tasks/a0-...md` through `a9-...md` | same A0–A9 structure |

Counts describe the inspected working trees, not a permanent state. Neither clone was changed by this research. Do not reset, stash, rename or migrate these edits merely to make a clean execution starting point.

Both repos implement customer and partner Expo/React Native Web apps, a React/Vite operations console, NestJS API and worker, modular domain code, a Convex hosted engine, typed client, schemas, fixtures and tokens. README lists Node 24 and pnpm 10.33.2. Historical plan checkboxes are not evidence the implementation is missing.

The existing `docs/agent-tasks` dispatch model already has valuable pieces: frozen contracts, per-worker allowlists, separate worktrees, single owner of manifests/lockfile/migrations, dependency gates and verification receipts. It should be adapted to smaller ready issues and the chosen cloud environment rather than copied as ten brand-new build tasks.

### Existing design work to preserve

`the earlier Wandary design reference (historical local source)` is uncommitted and defines white/pale-blue/navy/teal tokens, system fonts, 44px touch targets, 560px mobile content, customer/partner and ops layouts and component rules.

`/home/batman/Projects/code/wandary/docs/implementation/opendesign-ui-refresh.md` records uncommitted work on customer Home, Service, Basket and Checkout; ops shell/Orders/OrderDetail; shared tokens and partner theme. It reports prior local checks but no full customer/partner device/browser verification. The new plan must decide whether this existing visual direction is the starting point, a reference, or to be revised.

Laundry clone tokens are in `packages/design-tokens/src/index.ts` and `apps/customer/src/theme.ts`: white `#FFFFFF`, pale blue `#EEF4FF`, navy `#0F1F3D`, teal `#0E7C7B`, 44px touch targets. This is an existing product design source for any planning/review artifact.

### Existing execution constraints

Both root `AGENTS.md` files require reading product spec, contracts and the relevant agent packet. Order, payment and delivery-leg states stay distinct; INR amounts use integer minor units; schedule windows include timezone. Demo integrations must be explicit. Contracts/client changes, migrations and dependencies require coordinator ownership.

Do not invoke commercial provider calls or paid models without authorization. Existing docs saying prior sessions authorized specific actions are historical records, not new permission for this session to deploy, send messages or reuse accounts.

`Landary/docs/implementation/release-verification-2026-10-12.md` cites earlier `wandary` commit/CI/deployment evidence and explicitly lists remaining production/provider and correctness gaps. These historical receipts must be distinguished from freshly re-run verification.

## Notion source map

All fetched pages returned `verification.state=unverified`. Fetch output did not expose `truncated`, `unknown_block_count` or `unknown_block_ids`; their absence does not itself prove universal completeness. Meeting **summaries and curated recaps** were read; transcripts were not fetched. Recency is contextual evidence, not automatic source authority.

| Source | Link | What it establishes |
|---|---|---|
| Laundry · Home | https://app.notion.com/p/3f6074fda55681ee8b3cdc20db4090a2 | Workspace identity and database structure; last edit reported 18 Oct |
| Idea · Original notebook | https://app.notion.com/p/3fd074fda556812b8218debd146cc540 | Doorstep garment care, space/convenience/readiness motivations; many original statements explicitly hypotheses |
| Product · Customer, rider & WhatsApp | https://app.notion.com/p/3f6074fda55681e3973fd481a3f1e733 | 11 Oct proposal: two installed apps, ops console, garment selectors, weight/count distinction, voice/text ordering, price adjustments and custody |
| Build plan · Architecture & roadmap | https://app.notion.com/p/3f6074fda55681059525d620dc4fb321 | Historical plan, modular architecture, A0–A9 boundaries, tests; stale empty-folder claim |
| Game plan | https://app.notion.com/p/3fd074fda5568004817ad43be59922f5 | 18 Oct meeting: app priority, one location, Zepto-familiar layout, service/kg/slots, premium/general, app core and WhatsApp communications, single-scooter suggestion |
| 15 Oct · Startup planning | https://app.notion.com/p/3fa074fda5568008a077c16b3317c307 | Indiranagar-first discussion, reusable boxes trial, delivery/staff/timing economics still open; 15-day app ambition recorded, not a new promise |
| 15 Oct · Laundry shop interview | https://app.notion.com/p/3fa074fda55680278b25f3f3ab195e2e | Explicit Needs check warning; written rate card/trial agreement needed; uncertain numeric survey fields intentionally blank |

Search also found:

- Engineering database: https://app.notion.com/p/68d51a6c9c364943a57faacb7f9f5b28
- Engineering · Work packages A0–A9: https://app.notion.com/p/3f6074fda556812da8dce06bdcc812ee
- Engineering · APIs & order states: https://app.notion.com/p/3f6074fda55681ccbc2ddd4e0d7aa2b1
- Surveys · Customers & shops: https://app.notion.com/p/3fd074fda55681448346f6c169e93f77
- Laundry owner surveys: https://app.notion.com/p/7bdac75ba2f64d1a8d9cfa1528fb0dd2

These additional source contents were not read in this task. Customer survey rows and personal data were not needed for the workflow setup.

## Conflicts to record explicitly

| Decision area | Existing spec/code | Newer meeting evidence | Required treatment |
|---|---|---|---|
| Canonical repo | Laundry clone points to `laundry`; other clone points to `wandary` | Both contain real divergent work | Founder selects canonical repo; inventory/migration issue before cloud execution |
| Scope | Two apps, ops, voice ordering, large set of services and edge cases | User says build the app look and plan first | Define next deliverable and launch bar before screen/backend issue decomposition |
| Quantity | Garment counts for custody; per-piece and estimated-weight pricing | kg-first customer input | Decide visible customer input later; never confuse measured weight with custody counts |
| WhatsApp | Voice/text checkout channel | App is core; WhatsApp communication feature | Explicit scope decision rather than retaining all voice work automatically |
| Geography | Defaults unconfirmed | Indiranagar vs Beniganalli suggestion | Reconcile when launch scope requires it; UI can use labeled configurable fixtures meanwhile |
| Logistics | Bag IDs, two custody legs, manual/provider adapters | Reusable boxes/truck vs single scooter | Keep custody/container terms distinct from chosen vehicle and dispatch model |
| App feel | Calm/fresh with pale blue/navy/teal and photo categories | Familiar Zepto ordering model | Ask whether Zepto reference means navigation density/familiarity or stronger visual restyling |
| Historical plans | Empty-folder, Next.js and Postgres-only statements | Vite/Convex apps exist | Mark historical sections superseded by evidence; do not implement greenfield foundation twice |

## Recommended first interview frontier

The parent remains sole interviewer. Stable IDs below are suggestions; renumber once if parent already assigned IDs, then never reuse or shuffle them. Ask whole frontier in one round with a recommended answer, as required by `grilling`. These are decisions with independent prerequisites; detailed downstream questions wait.

1. **FND-001 · Canonical project.** Which repo is the source of truth: `aditya-zig/laundry` or `aditya-zig/wandary`? Recommendation: the deliberately named Laundry repo if that is the intended successor, after preserving/reconciling the uncommitted UI work; do not assume based solely on spelling or date.
2. **FND-002 · Immediate finish line.** Is this plan for a customer-app visual/interaction redesign, a demonstrable end-to-end pilot, or full customer+rider+ops launch? Recommendation: plan the next customer journey and minimum enabling rider/ops dependencies, separating later production integrations. The user chooses the scope.
3. **FND-003 · Evidence precedence.** Should 18 Oct Game plan be the provisional product starting point, with old spec features retained only after review? Recommendation: maintain a source/conflict table and explicitly resolve affected decisions rather than treat every meeting line as approved.
4. **FND-004 · Partner authority and handoff.** Does partner review require both founders' approval for product decisions, or can one named owner decide after recording objections? Recommendation: both approve scope and operating promises; nominate a tie-break owner or leave disputed decisions blocking dependent issues. Preserve attribution.
5. **FND-005 · Collaboration home.** Where should the partner review and answer the same stable questions: shared Notion, GitHub files/PR, or a locally generated bundle they transfer? Recommendation: use Notion for partner discussion if both already share it, and versioned Markdown as the execution source. Publishing/sync writes are a separate authorized step.

Avoid asking for facts already discovered: Notion link, existence of apps, available local tokens, current git origins, or whether work packages exist. Do not ask launch price/hour/vendor questions until the chosen deliverable depends on them.

### Later branches unlocked by answers

- Visual-only/customer scope: first primary customer, target device, one primary journey, service vs deadline entry, kg-estimate UI, premium/general semantics, reference approval, screen/state matrix, accessibility, offline/retry/payment boundaries.
- Real pilot scope: geography; laundry operator and hours/capacity; garment/container custody; measured weight and adjustment approval; promised return versus requested deadline; support/compensation and payment obligations; actual vs simulated integrations.
- Remote execution scope after canonical repo: baseline commit, ready criteria, per-issue ownership/dependencies, cloud setup, fixture/test commands, no private Notion dependency, PR branch policy, CI acceptance and deployment boundary. Parent's separate tooling subagent owns current Codex capability research.

## Partner review and continuation protocol (proposed)

Use one master Markdown file as the index and approved specification, with stable requirement/decision/question IDs. Keep append-only interview history separate if desired; a single huge mutable transcript should not be the worker's only instructions.

Each question record includes:

```yaml
id: FND-004
round: 1
depends_on: []
status: awaiting_answers # open | answered | contested | resolved | deferred
question: ...
recommendation: ...
evidence: [SRC-001]
answers:
  - author: founder_a
    date: YYYY-MM-DD
    answer: ...
  - author: founder_b
    date: YYYY-MM-DD
    answer: ...
resolution: null
decision_owner: null
approved_by: []
supersedes: null
impacts: [REQ-..., SCREEN-...]
```

Do not flatten different founders' answers into one unattributed answer. Silence means pending review, never agreement. Record disagreements as contested and identify exactly which dependent questions/issues are blocked. Defer a decision only with explicit reason, owner and trigger for reopening. An assumption may unblock a prototype only if clearly marked and not presented as launch approval.

After a round:

1. Save each answer with author/date and preserve the question text.
2. Update the design tree and distinguish resolved, contested and unanswered nodes.
3. Summarize changes since the partner's last review and list their needed responses by stable ID.
4. Partner replies to those IDs, adds evidence, or opens a named challenge; original answers remain available.
5. The interviewer follows up only on the current frontier; challenges can reopen affected decisions and invalidate downstream acceptance.
6. On resolution, update the master requirements and glossary immediately. Create ADRs sparingly for hard-to-reverse, surprising trade-offs, not each preference.
7. Record plan revision and explicit approval by each required decision maker. No ready issue may depend on an unapproved contested decision.

Recommended partner continuation prompt:

> Read PLAN.md, the source/conflict register and the latest interview round. Preserve IDs and both founders' attributed answers. Summarize what was decided, what is disputed and which decisions now form the frontier. Ask follow-ups only on that frontier, give recommendations and cite existing evidence. Record new answers and any affected requirements. Do not implement, file issues, merge or deploy during the interview. Do not invent agreement from silence.

Recommended eventual ready issue contract:

- Plan revision/commit, requirement and decision IDs.
- Observable outcome and bounded scope; exclusions when they prevent an actual ambiguity.
- Prerequisites and dependency issues with completion evidence.
- Allowed files/modules and shared contract owner.
- Required initial reading stored in the repo, accessible to cloud without private Notion login.
- Fixtures/environment setup and exact meaningful verification commands.
- Expected screenshot/device evidence for UI changes.
- Completion report: paths, commit, tests/results, limitations and PR.
- Branch/PR-only delivery; merge and deployment remain separate decisions.

## Domain modeling notes

No CONTEXT.md, CONTEXT-MAP.md or ADR files were found by filename scan in either clone. The `domain-modeling` skill says CONTEXT.md is a glossary only; implementation plan and workflow instructions do not belong in it.

Useful existing language to preserve while grilling:

- **Service**: garment-care offering, distinct from a commercial premium/general tier.
- **Customer**: person ordering care; **delivery partner/rider**: authorized transporter; **laundry operator/facility**: physical care provider. The user's collaborator is a **cofounder/reviewer**, not one of these fulfillment roles.
- **Pickup window**, **requested return deadline**, **promised return window**: three distinct concepts.
- **Estimated weight**, **measured weight**, **garment count**, **container/bag/box count**: separate price/custody facts.
- **Order state**, **payment state**, **delivery-leg state**: separate lifecycles in current contracts.
- **Discussion answer**, **resolved decision**, **approved plan revision**, **ready issue**, **cloud task**, **pull request**: distinct steps in the development process.

Potential meaningful ADRs, only after decisions: canonical repo and migration strategy; hosted backend authority if changing architecture; one vs multiple customer ordering channels if consequential. Routine visual preferences and question workflow settings usually do not warrant ADRs.

## Research limits

This inventory inspected local files and fetched connected Notion sources. It did not fetch remote GitHub branch state, run app tests, inspect live websites, fetch full meeting transcripts, query survey response data or change credentials/accounts. It is not a production readiness or UI quality certification.
