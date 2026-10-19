# Laundry — shared grilling ledger

Status: round 1 founder answers recorded; partner review pending · Plan: 0.5 · Interview owner: parent agent in the current session.

Both founders can use this file from different sessions. Answers remain attributed; one person's answer does not overwrite another's. Recommendations are proposals, not decisions. There is no deadline-based approval.

## First frontier

### Q01 — What are we planning?

Is this a visual redesign that preserves behavior, a working customer app journey, or a wider product build covering customer, delivery partner, and operations?

Recommendation: start with the customer app's look and working booking journey, then scope other surfaces separately. This is narrow enough to review and still tests whether the look supports an actual task.

- Founder answer (2026-10-19): Whole product: customer app, delivery partner app, and operations console.
- Partner answer/challenge: pending
- Rationale/evidence: pending
- Status: founder answered; partner review pending
- Resolution: founder direction above; incorporate into draft, retain for partner review before joint plan approval
- Impacts: plan scope, screen inventory, issue granularity, verification

### Q02 — How do the founders settle decisions?

Should both approve the same plan version, or should one person have final authority with the other advising?

Recommendation: either can answer and challenge; both approve the plan version before it becomes build issues. Record any explicit delegation for day-to-day reversible decisions separately.

- Founder answer (2026-10-19): Both founders approve the same plan version; either can challenge.
- Partner answer/challenge: pending
- Status: founder answered; partner review pending
- Resolution: founder direction above; incorporate into draft, retain for partner review before joint plan approval
- Impacts: approval record, reopened decisions, partner continuation

### Q03 — What may a remote worker deliver?

When you manually launch an issue, should the cloud agent push an issue branch and open a PR, push a branch only, or push directly to the working branch?

Recommendation: branch and reviewable PR. Establish merge and deployment authority as separate explicit instructions.

- Founder answer (2026-10-19): Option 1: issue branch and reviewable PR. Additionally, run the app, interact with browser/computer tools, and supply video evidence proving the relevant journey works for review. Design a repeatable verification/fix loop.
- Partner answer/challenge: pending
- Status: founder answered; partner review pending
- Resolution: founder direction above; incorporate into draft, retain for partner review before joint plan approval
- Impacts: environment permissions, launch prompt, definition of done

### Q04 — Which existing implementation is the target?

Observed candidates: `Landary` → `aditya-zig/laundry`, and `wandary` → `aditya-zig/wandary`. Both have existing applications and planning documents; both have local changes. Which should receive the new approved plan and subsequent issues?

Recommendation: select one canonical repo and branch; reuse its implementation and intentionally include any desired local changes before cloud tasks. Confirm business intent rather than choosing solely by latest modification time.

- Founder answer (2026-10-19): aditya-zig/laundry (local Landary).
- Partner answer/challenge: pending
- Status: founder answered; partner review pending
- Resolution: founder direction above; incorporate into draft, retain for partner review before joint plan approval
- Impacts: every future document path, setup instruction, issue and cloud environment

### Q05 — How should we reconcile Notion conflicts?

Older build notes conflict with current code. Later meetings differ on launch geography and delivery setup. May we treat existing code as the baseline, propose changes from newer notes, and bring every material conflict to the founders for an explicit resolution?

Recommendation: yes. Neither the newest note nor the current code automatically decides the future product. Preserve links and distinguish current facts from desired behavior.

- Founder answer (2026-10-19): Use the 18 October Game plan as the product authority.
- Partner answer/challenge: pending
- Status: founder answered; partner review pending
- Resolution: founder direction above; incorporate into draft, retain for partner review before joint plan approval
- Impacts: source policy and requirements

### Q06 — Where does the partner review happen?

Should the partner review in shared Notion with approved Markdown in GitHub, use GitHub files/comments only, or receive a local bundle first?

Recommendation: use shared Notion for discussion and GitHub Markdown for approved execution instructions. Keep one authoritative approved version rather than two editable copies that silently disagree. No files have been shared remotely yet.

- Founder answer (2026-10-19): Shared Notion discussion plus approved Markdown in GitHub.
- Partner answer/challenge: pending
- Status: founder answered; partner review pending
- Resolution: founder direction above; incorporate into draft, retain for partner review before joint plan approval
- Impacts: partner access, review process, publication location

## Round 2 — current decision frontier (current product questions)

These are independent choices about the intended first release. Later questions about exact rates, premium inclusions, measurement adjustments, return promises and slot hours depend on these answers.

### Q07 — What counts as the first release being ready?

Choose a complete connected demo, a controlled live pilot, or broad production launch. All three product surfaces remain in scope; this decides the operating and integration readiness bar.

Recommendation: a controlled live pilot in one service area, with a connected synthetic-data demo milestone before accepting real orders. Clearly list which real integrations and operating arrangements are required before the pilot.

- Founder answer (2026-10-20): B: Controlled live pilot, preceded by a connected demo milestone.
- Partner answer/challenge: pending
- Status: founder answered; partner review pending
- Depends on: Q01 (whole product selected)
- Impacts: production requirements, integration gates, launch milestone, verification

### Q08 — Which platforms must the first release support?

Do customer and rider need installed Android apps, is mobile web/PWA sufficient initially, and is iPhone native support required immediately? Operations is browser-based unless the founders choose otherwise.

Recommendation: customer and rider Android apps plus their browser builds for quick review, with operations on desktop web. Treat real Android verification as an additional gate; browser videos alone cannot prove native permissions, notifications or background behavior.

- Founder answer (2026-10-20): Recommended Android customer and delivery apps with operations web; iPhone support later.
- Partner answer/challenge: pending
- Status: founder answered; partner review pending
- Depends on: Q01
- Impacts: screen/device requirements, release builds, browser versus device evidence

### Q09 — What services belong in the initial catalog?

Name the initial services and explicit exclusions. Current implementation contains wash-and-fold, wash-and-iron, dry-cleaning and steam-press concepts; that does not establish approved launch availability.

Recommendation: start with wash-and-fold and wash-and-iron if the operating laundry can support both consistently; keep dry-cleaning and other services out until their handling, pricing and turnaround are confirmed. These are proposals, not verified vendor capabilities.

- Founder answer (2026-10-20): Yes to wash-and-fold and wash-and-iron for the initial catalog.
- Partner answer/challenge: pending
- Status: founder answered; partner review pending
- Depends on: Q01 and Q05 (product authority selected)
- Impacts: tier definitions, per-service quantity/pricing, catalog screens, care/fulfillment flow

### Q10 — What does the Zepto reference mean visually?

Does the reference mean familiar shopping/navigation and quick selection, a similarly dense visual layout, or a wider redesign? Decide what should remain from the existing pale-blue, navy and teal Laundry design.

Recommendation: borrow familiar navigation and fast selection, while retaining Laundry's own identity. Approve concrete design alternatives before coding screens.

- Founder answer (2026-10-20): A: Familiar navigation and fast selection, with Laundry identity.
- Partner answer/challenge: pending
- Status: founder answered; partner review pending
- Depends on: Q01 and Q05
- Impacts: visual design brief, navigation, reference/mockup approval

### Q11 — Who actually operates the operations console?

Are you/cofounder coordinating the service and updating all processing information, or will laundry-shop staff sign in and update orders themselves? The delivery partner app remains the rider's interface.

Recommendation: founders or a named operations person coordinate v1, while shop communication stays manual until the handoff and responsibility are clear. If shop staff need direct access, model their permissions explicitly within operations rather than assuming they share an administrator account.

- Founder answer (2026-10-20): We will pay the delivery person; he will do it. Exact operations and money permissions are being clarified in Q11.a.
- Partner answer/challenge: pending
- Status: founder answered; partner review pending
- Depends on: Q01
- Impacts: roles/permissions, intake measurement ownership, care updates, support, vendor handoffs

## How to answer or challenge

```text
Author: <name>
Plan version: 0.5
Q01: <answer and why>
Q02: <answer and why>
Challenge Qxx: <what I disagree with; concrete scenario; proposed alternative>
Evidence: <Notion link, customer observation, or code reference>
```

Record follow-ups as Q01.a, Q01.b, etc. Keep the original ID stable. A new conflict changes a question's status to challenged and identifies affected plan sections. The interview owner recomputes the next frontier from settled prerequisites. Questions about screens, pricing behavior, and operating details that depend on scope wait for that scope decision.

## Later branches — topic map, not current questions

- First user, launch problem and measurable first outcome.
- Actual operating area, capacity, pickup and return promises.
- Service catalog, quantity/weight, tiers, pricing and adjustments.
- Included surfaces, supported devices and navigation.
- Key screen interactions, visual references and approved design language.
- Login, order confirmation, payment, notifications and support.
- Cancellation, stale data, failed payment, unavailable slots, offline recovery.
- Data/permission boundaries and integration reality.
- Cloud environment, verification footprint and work ownership.
- Issue slicing, dependencies, review authority and plan approval.

## Partner continuation prompt

> Continue the Laundry grill-with-docs session. Read PLAN.md, GRILLING.md and product-findings.md in this planning folder, then the selected repository's AGENTS.md and referenced current specs. Preserve the existing question IDs, author attribution and accepted decisions. I am the other cofounder: first show me what has been answered and what remains disputed. Record my review as my answers/challenges; do not treat me as the author of earlier answers. Ask the whole currently unblocked decision frontier with a recommendation for each question. Investigate facts rather than asking me to discover them. Reopen affected decisions when my scenario exposes a conflict. Update the plan and glossary as decisions settle. Create ADRs only for consequential trade-offs. Remain in planning until we explicitly approve the plan according to the recorded decision rule.

## Session log

| Date | Author/session | Change | Approval impact |
|---|---|---|---|
| 2026-10-19 | Initial agent session | Created draft plan and first frontier from user request and evidence | No founder choices accepted yet |

| 2026-10-19 | Requesting founder | Answered Q01–Q06; required per-revision browser/computer use and video evidence | Incorporated into version 0.2; partner review and final joint approval remain pending |

## Tooling implementation authorization — 20 October 2026

The requesting founder explicitly asked to set up subagents and cloud work tooling in this repo and push it. Tooling implementation and isolated branch/PR delivery are authorized now; this does not approve all unresolved product requirements or app deployment. Continue product questions asynchronously with the question tool.

### Q11.a — Paid delivery person permissions

Does the paid delivery person handle field work only, also weigh/intake and processing updates, or full operations including money? Recommendation: field and intake records with founders controlling adjustments/refunds.

- Founder answer (2026-10-20): 1 — Rider field work and doorstep records; founders control pricing, refunds and final processing.
- Partner answer/challenge: pending
- Status: founder answered; partner review pending

### Q12 — Premium at launch

General first until Premium has a defined promise, faster-turnaround Premium, or distinct-care Premium? Recommendation: General first until the offer is concrete.

- Founder answer (2026-10-20): 3 more care more speed etc
- Partner answer/challenge: pending
- Status: founder answered; partner review pending

### Q13 — Estimated versus measured quantity

For a 5 kg booking measured at 7 kg, use measured pricing with approval, absorb differences, or fixed box price? Recommendation: show an estimate and obtain customer approval for increases.

- Founder answer (2026-10-20): 1 — Measured-weight price, with customer approval for increases.
- Partner answer/challenge: pending
- Status: founder answered; partner review pending

### Q14 — Pilot area

Choose Beniganalli-area or Indiranagar-area pilot, or provide another exact starting boundary. Recommendation: one small explicit service area for the single-rider pilot.

- Founder answer (2026-10-20): Indiranagar area; I’ll specify the boundary
- Partner answer/challenge: pending
- Status: founder answered; partner review pending

### Q15 — Concrete Premium promise

- Original founder answer (2026-10-20): Extra care + priority handling; exact promise confirmed before launch
- Full question, recommendation and interpretation: see [partner review Q&A](../../discovery/2026-10-20-founder-questions-and-answers.md).
- Partner answer/challenge: pending
- Status: founder answered; partner review pending

### Q16 — Payment timing

- Original founder answer (2026-10-20): At delivery/return
- Full question, recommendation and interpretation: see [partner review Q&A](../../discovery/2026-10-20-founder-questions-and-answers.md).
- Partner answer/challenge: pending
- Status: founder answered; partner review pending

### Q17 — Pickup and return scheduling ideas

- Original founder answer (2026-10-20): im thinking 8pm pick up 8am drop . if not possible 5pm pick up 8am drop. weekends . 10am pick 5pm drop . etc like that
- Full question, recommendation and interpretation: see [partner review Q&A](../../discovery/2026-10-20-founder-questions-and-answers.md).
- Partner answer/challenge: pending
- Status: founder answered; partner review pending
- Scheduling remains tentative and capacity-dependent, not an accepted guaranteed SLA.

### Q18 — Kg price and quantity guide

- Original founder answer (2026-10-20): no we set like a 1kg price and tell them its roughly 5-6 shirts . we provide a size chart like shopping ecomers apps.
- Full question, recommendation and interpretation: see [partner review Q&A](../../discovery/2026-10-20-founder-questions-and-answers.md).
- Partner answer/challenge: pending
- Status: founder answered; partner review pending
- Quantity guide is approximate; measured weight determines approved final quantity. Container allocation remains separate.

### Q19 — Schedule promise readiness

Is overnight timing a pilot target to confirm, a mandatory launch guarantee, or a capacity-based option?

- Original founder answer (2026-10-20): Offer both overnight and weekend same-day options when capacity permits
- Partner answer/challenge: pending
- Status: founder answered; partner review pending

### Q20 — Kg rates and billing increments

What are wash-and-fold, wash-and-iron and Premium kg rates, minimum order and quantity increments?

- Original founder answer (2026-10-20): need to done later. bring this to me notice when im with my partner
- Partner answer/challenge: pending
- Status: deferred to joint partner review; raise first in that session

### Q21 — Unanswered increased-price consent

Hold processing/contact, return after timeout, or a defined pre-agreed increase limit?

- Original founder answer (2026-10-20): Hold processing and contact the customer
- Partner answer/challenge: pending
- Status: founder answered; partner review pending

### Q22 — Payment methods at return

UPI and cash, UPI only, or payment link plus fallback?

- Original founder answer (2026-10-20): UPI and cash
- Partner answer/challenge: pending
- Status: founder answered; partner review pending

## Cloud account timing

Founder selected: “Finish and push the repo tooling first; configure the cloud account later.” Repo setup and push continue; cloud environment provisioning and real cloud task smoke are deferred.

### Q23 — Intake ownership

- Founder answer: Paid rider weighs and inspects at the laundry.
- Interpretation: Physical intake belongs to the paid rider; founder pricing/processing exception authority remains.
- Partner answer/challenge: pending
- Status: founder answered; partner review pending

### Q24 — Unanswered approval escalation

- Founder answer: Founder agrees unprocessed return; timeout/fees deferred (Recommended).
- Interpretation: Hold processing and escalate to founder for agreed unprocessed return. Timeout, attempts and fees remain undecided.
- Partner answer/challenge: pending
- Status: founder answered; partner review pending

### Q25 — Current scope

- Founder answer: here now we are only doing the plan.md and tooling so a new cloud agent can do and verify when it pushes
- Interpretation: Planning/tooling now; no frontend assignment or product implementation authorization inferred.
- Status: scope confirmed

### Q26 — If the customer estimates 5 kg but intake measures 4 kg, how should billing work?

- Founder answer: Charge the original estimate even if weight is lower
- Interpretation: The selected estimate is a billing floor even when measured weight is lower. Q29 asks whether to define and clearly disclose it as a minimum package quantity. Higher measured-price increases still require prior consent; minimum/rounding rules and prices remain undecided.
- Partner answer/challenge: pending
- Status: founder answered; partner review pending

### Q27 — When may a customer cancel?

- Founder answer: Free before pickup; founder handles requests after pickup (Recommended)
- Interpretation: Free cancellation before pickup. Founder handles requests after pickup, including any unprocessed return. Exact charges and post-processing rules remain open.
- Partner answer/challenge: pending
- Status: founder answered; partner review pending

### Q28 — What happens if UPI fails or the customer cannot pay at return?

- Founder answer: Try agreed alternative, then contact founder; keep payment unresolved (Recommended)
- Interpretation: Try an agreed alternative such as cash; then contact a founder before marking payment or delivery complete. Credit, handover or return arrangements require a founder decision.
- Partner answer/challenge: pending
- Status: founder answered; partner review pending

## Previous frontier — Q29–Q31 (answered below)

- Q29: Is selected kg a clearly disclosed minimum package quantity? Options: yes; revise Q26 to lower measured billing; discuss with partner.
- Q30: Missing/damaged clothes: founder investigates/agrees remedy with limits before launch; rider settles within limit; or defer entire claims policy.
- Q31: Confirmation/updates: in-app status + WhatsApp; in-app + push only; or WhatsApp/phone with app status later.

Answers are recorded below; recommendations are not decisions.

### Q29 — Should the selected kg be a clearly disclosed minimum package quantity?

- Founder answer: Discuss the minimum-package rule with my partner
- Interpretation: Deferred to the joint partner session. Q26 is this founder’s proposed direction, not a settled customer billing contract. Decide package/minimum disclosure and lower measured-weight treatment together before product issues implement billing.
- Partner answer/challenge: pending
- Status: deferred to joint partner session

### Q30 — What should happen if clothes are missing or damaged?

- Founder answer: Decide the entire claims policy with my partner
- Interpretation: Entire claims policy deferred: evidence requirements, responsibility, reporting window, remedy, compensation and exclusions all need joint review. No compensation promise or rider authority is approved.
- Partner answer/challenge: pending
- Status: deferred to joint partner session

### Q31 — How should customers receive confirmation and important order updates?

- Founder answer: In-app status + WhatsApp for key updates/contact (Recommended)
- Interpretation: Order status stays in the app; WhatsApp carries key updates/contact. Q32 asks whether pilot messages are manual or automated. Reliability and failure handling must be verified.
- Partner answer/challenge: pending
- Status: founder answered; partner review pending

## Previous frontier — Q32–Q34 (answered below)

- Q32: pilot WhatsApp updates manual through business account, automated at launch, or deferred to partner.
- Q33: phone OTP for real customers, founder-created accounts, or joint sign-in decision.
- Q34: slot capacity controlled by founder with rider/operator input, rider, or operator.

No answers have been assumed.

### Q32 — How should WhatsApp updates be sent in the pilot?

- Founder answer: Decide messaging automation with my partner
- Interpretation: Manual versus automated sending is deferred to joint review. Q31 still selects WhatsApp alongside in-app status. Do not assume an automatic WhatsApp integration is a launch requirement.
- Partner answer/challenge: pending
- Status: deferred to joint partner review

### Q33 — How should real customers sign in?

- Founder answer: Phone OTP for real customers; demo access only for testing (Recommended)
- Interpretation: Real customer access uses a verified phone OTP provider before live launch. Demo access remains isolated to testing; provider selection and failed OTP handling still need specification.
- Partner answer/challenge: pending
- Status: founder answered; partner review pending

### Q34 — Who controls whether slots can accept more orders?

- Founder answer: Founder controls slot capacity with rider/operator input (Recommended)
- Interpretation: A founder opens/closes slots and sets capacity after checking rider/operator feasibility. Full slots must stop accepting new bookings; capacity reservation is addressed in Q35.
- Partner answer/challenge: pending
- Status: founder answered; partner review pending

## Current unanswered frontier — Q35–Q46

All 12 questions, recommendations and options are preserved in [NEXT-QUESTIONS.md](../../discovery/NEXT-QUESTIONS.md). They are awaiting answers. This is the next operating-journey pass; deferred partner decisions and challenges may require further questions.
