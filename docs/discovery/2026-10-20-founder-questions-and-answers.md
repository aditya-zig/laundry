# Laundry — founder questions and answers for partner review

Recorded 19–20 October 2026. Author of the answers: the requesting founder in this planning session. Partner review: pending. This document preserves the founder's original answer wording and separates it from the agent's interpretation. Recommendations below were interview suggestions, not additional founder answers.

Product authority: [18 October Game plan](https://app.notion.com/p/3fd074fda5568004817ad43be59922f5). Repository: `aditya-zig/laundry`. Working specification: [master plan](../plans/laundry-app/PLAN.md). Decision ledger: [GRILLING.md](../plans/laundry-app/GRILLING.md).

## Partner session: raise pricing first

**Q20 is deliberately deferred until both founders review together. At the start of that session, remind them to settle per-kg rates, Premium pricing, minimums and billing increments. No rates are approved yet.** This is a contextual reminder for the partner session, not a scheduled notification.

## How to review

For each question, reply `Agree Qxx`, `Challenge Qxx: ...`, or `Follow-up Qxx: ...`, with the reason and a concrete example where useful. Keep both founders' answers attributed. Both founders must approve the same final plan version; an unanswered review is not approval. A challenge reopens the affected requirement and dependent build issues.

## Q01 — Planning scope

**Question:** What should this planning session cover? The options were customer app UI plus working booking journey, visual redesign only, or the whole product covering customer, delivery partner and operations.

**Agent recommendation:** Customer app look and booking journey first, other surfaces separately.

**Founder answer:**
> Whole product: customer, delivery partner, and operations

**Recorded interpretation:** Plan all three surfaces and their connected workflows. Delivery can still happen in small slices.

## Q02 — Shared decision authority

**Question:** How should you and your partner settle product decisions? Either can answer or challenge; should both approve the same plan version before it becomes build issues, or should one person have final authority?

**Agent recommendation:** Both approve the same plan version; either may challenge.

**Founder answer:**
> Both approve the plan; either can challenge

**Recorded interpretation:** Joint approval is required for the final product plan. Earlier answers are this founder's direction until reviewed by the partner.

## Q03 — Cloud delivery and verification

**Question:** What should a cloud agent be allowed to deliver when you manually assign an issue? Options were issue branch plus reviewable PR, branch only, or direct push to the main working branch.

**Agent recommendation:** Issue branch plus PR; merge and deployment remain separate.

**Founder answer:**
> so im a bit fan of verification loops when ever it pushes i ideally want to see the it run the app and use it with computer use or browser use and then send a video proving it works so that way approving it becomes easly for me. lets do 1 and build solutions to make the loop working

**Recorded interpretation:** Select branch plus PR. Actual app interactions and watchable video are part of the delivery contract for each revision. Build a fix-and-rerun loop and associate evidence with the exact revision under review. Browser-only evidence cannot certify native-device behavior.

## Q04 — Canonical repository

**Question:** Which repository should receive the plan and future issues? Existing implementations were found in `Landary` (`aditya-zig/laundry`) and `wandary` (`aditya-zig/wandary`).

**Agent recommendation:** Pick one target and preserve useful work from the other.

**Founder answer:**
> aditya-zig/laundry

**Recorded interpretation:** `aditya-zig/laundry` is canonical. Preserve the original dirty local checkout; tooling implementation uses an isolated branch from the committed baseline.

## Q05 — Product authority

**Question:** May we use current code as the starting point, newer Notion notes as proposed changes, and resolve material conflicts explicitly? Older notes say no app exists and later notes differ on launch geography/logistics.

**Agent recommendation:** Resolve conflicts explicitly rather than treating recency or current code as automatic future product authority.

**Founder answer:**
> Use the 18 October Game plan as the product authority

**Recorded interpretation:** The selected meeting governs desired product behavior, amended by subsequent explicit founder decisions. Current code is evidence of current implementation. Ambiguous brainstorms within the meeting still need decisions.

## Q06 — Partner review home

**Question:** Where should your partner review and continue grilling? Options were shared Notion discussion plus GitHub Markdown, GitHub only, or a local Markdown bundle first.

**Agent recommendation:** Shared Notion discussion and versioned Markdown in GitHub for cloud-worker context.

**Founder answer:**
> Shared Notion discussion + GitHub Markdown

**Recorded interpretation:** Discussion can happen in shared Notion; the approved execution specification is committed Markdown. Avoid silently diverging copies. No partner message is authorized merely by choosing this home.

## Q07 — First release readiness

**Question:** What counts as the first release being ready? A: connected demo with test data; B: controlled live pilot in one area with real fulfillment; C: broad production launch.

**Agent recommendation:** B, with A as an earlier milestone.

**Founder answer:**
> 7. B

**Recorded interpretation:** Target a controlled live pilot across the whole product, with an earlier connected demo/test milestone. Real integration and operational readiness remain launch gates.

## Q08 — Platforms

**Question:** Which platforms must work at the first release: installed Android apps, mobile web/PWAs, or Android and iPhone? Operations can remain desktop web.

**Agent recommendation:** Android customer and rider apps, operations web, with browser builds for quick review. Native permissions/notifications/background behavior require native checks.

**Founder answer:**
> 8. recomented. iphone support later.

**Recorded interpretation:** Android customer/rider first, operations web, browser builds for review. Native iPhone support later.

## Q09 — Initial services

**Question:** Which services are definitely included, possibly included and excluded initially? Current code has wash-and-fold, wash-and-iron, dry-cleaning and steam-press concepts, which do not establish business availability.

**Agent recommendation:** Start with wash-and-fold and wash-and-iron if the laundry operator can reliably deliver them; define other services before enabling them.

**Founder answer:**
> 9. yes

**Recorded interpretation:** Yes to the recommended initial wash-and-fold and wash-and-iron catalog. Vendor agreement, detailed inclusions and rates still need confirmation; no additional service was accepted by this short answer.

## Q10 — Zepto reference

**Question:** What should be borrowed from Zepto? A: familiar shopping/navigation and quick selection; B: similar compact visual density; C: a broader redesign of Laundry's colors, typography and navigation.

**Agent recommendation:** A, with a distinct Laundry visual identity.

**Founder answer:**
> 10. A

**Recorded interpretation:** Familiar service selection, quantity, basket and checkout interactions; not approval to copy another brand's identity. Concrete Laundry visual design still needs review.

## Q11 — Operations operator

**Question:** Who operates the operations console: you/cofounder, a separate employee, or laundry-shop staff? Who records measured weight, marks cleaning progress and reports problems?

**Agent recommendation:** A named person on the founders' side owns operations, with shop communication initially manual.

**Founder answer:**
> 11. yes we will pay the delivery guy he will do it.

**Recorded interpretation:** This answer was initially ambiguous about the rider's authority, so Q11.a below narrows it. Read the two together.

## Q11.a — Paid delivery person's permissions

**Question:** Which responsibilities should the paid delivery person have? 1: field pickup/return and doorstep records, founders control operations decisions; 2: rider also weighs/intakes and updates processing, founders control money; 3: rider runs the full console including money decisions.

**Agent recommendation:** Option 1, with founders controlling pricing adjustments, refunds and final processing decisions.

**Founder answer:**
> 1

**Recorded interpretation:** The paid rider handles field work and doorstep records. Founders retain pricing/refund and final processing authority. This follow-up supersedes any broader interpretation of Q11.

## Q12 — Premium at launch

**Question:** General and Premium are mentioned in the Game plan, but Premium's offer is undefined. Should launch be General first, faster-turnaround Premium, or Premium with different care/handling?

**Agent recommendation:** General first until the Premium promise is specific and reliable.

**Founder answer:**
> 3 more care more speed etc

**Recorded interpretation:** Premium is intended to combine enhanced care and speed. The exact customer promise was refined in Q15. No numerical turnaround guarantee was accepted here.

## Q13 — Estimated versus measured weight

**Question:** If a customer estimates 5 kg and intake measures 7 kg, should the measured price require approval, should the business absorb the difference, or should pricing be fixed per box?

**Agent recommendation:** Show an estimate at booking; require customer approval of an increase before processing.

**Founder answer:**
> 1

**Recorded interpretation:** Final quantity is measured; an increased price needs customer approval before processing. Payment timing is separately decided in Q16. Approval timeout, declines, decreases and rounding remain unresolved.

## Q14 — First service area

**Question:** Should the first live area be around Beniganalli, Indiranagar, or another explicit neighborhood/boundary? Both earlier areas appear in the notes.

**Agent recommendation:** One small, explicit zone for the single-rider pilot.

**Founder answer:**
> Indiranagar area; I’ll specify the boundary

**Recorded interpretation:** Indiranagar is selected. Exact serviceability boundary is pending; do not mark all of Bengaluru serviceable.

## Q15 — Concrete Premium promise

**Question:** What concrete Premium promise should appear? Options were extra care plus priority handling with exact promise confirmed before launch; guaranteed faster return plus extra care with a supplied deadline; or Premium coming soon.

**Agent recommendation:** Define handling first and enable faster promises only once operator capacity is confirmed.

**Founder answer:**
> Extra care + priority handling; exact promise confirmed before launch

**Recorded interpretation:** Premium means extra care and priority handling. The precise handling inclusions, price and any deadline promise must be confirmed before enabling a sellable promise.

## Q16 — Payment timing

**Question:** When should the customer pay, given that weight increases require approval? Options were after measured-price approval before processing, at delivery/return, or estimated prepayment adjusted later.

**Agent recommendation:** After measured-price approval and before processing.

**Founder answer:**
> At delivery/return

**Recorded interpretation:** Payment at return. Price-increase consent still happens before processing. Payment methods, payment confirmation owner and failed/refused payment at return remain unresolved.

## Q17 — Pickup and return windows

**Question:** What morning and evening pickup hours should we plan in India time, and are any days closed? Give both windows; recommendation was clear windows with no exact-arrival promise inside them.

**Founder answer:**
> im thinking 8pm pick up 8am drop . if not possible 5pm pick up 8am drop. weekends . 10am pick 5pm drop . etc like that

**Recorded interpretation — tentative ideas, not final promises:** Weekday idea: 8 pm pickup and next-morning 8 am return; alternative 5 pm pickup and next-morning 8 am return. Weekend idea: 10 am pickup and 5 pm return. Which option is feasible, whether these are arrival times or windows, service/tier applicability, cutoff, operating days and capacity still need confirmation. The phrases “im thinking”, “if not possible” and “etc” must not be converted into a guaranteed SLA.

## Q18 — Quantity guidance and box allocation

**Question:** How should boxes be allocated: operations assigns boxes from estimated kg until a trial establishes capacity, automatic kg-to-box mapping with supplied capacity, or customer chooses boxes with a kg allowance?

**Agent recommendation:** Customer enters estimated kg; operations assigns boxes until physical capacity is established.

**Founder answer:**
> no we set like a 1kg price and tell them its roughly 5-6 shirts . we provide a size chart like shopping ecomers apps.

**Recorded interpretation:** Price by kg. Help the customer estimate a suitable kg quantity with an ecommerce-style sizing guide, such as approximately 5–6 shirts for 1 kg. The example is approximate guidance, not an exact garment-to-weight billing conversion. Q13 still requires measured-weight consent for increases. Physical container allocation/custody remains a separate operational detail and was not answered by this guidance decision.

## Additional explicit instructions from this session

- Start with a detailed whole-plan Markdown file, then turn it into GitHub issues for on-demand remote work through Codex cloud.
- Use two actual OpenCode Muse Spark 1.3 work tracks. Earlier native GPT subagents were stopped when the founder corrected the executor; actual OpenCode planning runs and their receipts are documented separately.
- Keep asking questions through the question tool while independent work continues.
- Set up subagent and cloud-work tooling in `aditya-zig/laundry` and push the scoped changes. This authorizes the tooling branch/PR; it does not authorize merging or deploying the application.
- Record all questions and answers so the founder can send them to the partner. This file fulfills that record and is not a message sent to the partner.

## Partner review checklist

- [ ] Check all original answers above and add your own attributed answers/challenges.
- [ ] Confirm or challenge scope, Android-first platforms and the initial catalog.
- [ ] Define the exact Indiranagar boundary.
- [ ] Confirm Premium's actual care inclusions, pricing and any supported speed promise.
- [ ] Resolve the tentative overnight/weekend timing ideas with the laundry operator's capacity.
- [ ] Define kg rates, increments, minimums and estimate-guide content; do not assume 1 kg is exactly 5–6 shirts.
- [ ] Define measurement, price-consent, declined/unanswered consent and payment-at-return failure behavior.
- [ ] Confirm the rider/founder authority boundary and shop handoff responsibility.
- [ ] Review the remote issue/PR workflow and require current app-use video plus checks.
- [ ] Approve the same final plan version explicitly; this transcript alone is not approval.

## Partner continuation prompt

> Read this founder Q&A, docs/plans/laundry-app/PLAN.md and GRILLING.md. I am the other cofounder. Preserve the requesting founder's original answers and question IDs; record my views separately. First remind us that Q20 pricing was deferred to this joint session. Then show me decisions needing my review and any unresolved interpretations, especially Q17 timing and Q18 approximate quantity guidance. Let me agree, challenge or add a follow-up by ID. Recompute the current decision frontier and use the question tool for follow-ups. Update the plan and glossary as decisions settle. Do not treat my silence or this transcript as joint approval. Tooling implementation/push is authorized separately; app merge/deployment and unresolved business rules are not.

## Round 5 — subsequent founder answers

### Q19 — Schedule readiness

Should the 8 pm pickup → next-morning 8 am return be a launch guarantee, a pilot target to prove with the operator, or a capacity-dependent overnight/weekend option? Recommendation: pilot target until a real trial confirms it.

**Founder answer:**
> Offer both overnight and weekend same-day options when capacity permits

**Interpretation:** Offer those service-window types only when capacity allows. Exact hours, cutoffs and SLA eligibility still need confirmation.

### Q20 — Rates and increments

What are per-kg prices for wash-and-fold and wash-and-iron, Premium price difference, minimum quantity/order amount and billing increment? Undecided numbers should remain explicitly undecided.

**Founder answer:**
> need to done later. bring this to me notice when im with my partner

**Interpretation:** Deferred to the joint partner session. Surface it as the first agenda item then; no rates/minimums/increments have been selected.

### Q21 — Unanswered consent

If increased-weight approval receives no answer, should processing be held/contact made, should the order be returned after a defined timeout, or should a small pre-agreed increase be allowed? Recommendation: hold and contact, without automatic processing or price increases.

**Founder answer:**
> Hold processing and contact the customer

**Interpretation:** Do not process or apply the increase without consent. Timeouts, contact attempts and return-unprocessed policy remain open.

### Q22 — Return payment methods

UPI and cash, UPI only, or online payment link plus fallback? Recommendation: UPI and cash with explicit confirmation; a screenshot alone is not confirmation.

**Founder answer:**
> UPI and cash

**Interpretation:** Support both at return; define confirmation and cash reconciliation separately.

### Infrastructure follow-up — Cloud sign-in

The shared browser's Codex Cloud page requires account sign-in and no Laundry environment was listed in the CLI. The founder was asked to sign in there, or choose to finish the repo push first and configure the account later. No password/token was requested in chat.

**Founder answer:**
> Finish and push the repo tooling first; configure the cloud account later

**Interpretation:** Complete the repo branch/PR now. Account environment setup and a real cloud execution smoke are explicitly deferred, not claimed as completed.

## Round 6 — intake ownership and unanswered approval

### Q23 — Who weighs and inspects at intake?

Recommendation: a named laundry operator records measured weight, condition and any proposed price change; founders handle exceptions. Alternatives: paid rider at laundry; founder handles all intake.

**Founder answer:**
> Paid rider weighs and inspects at the laundry

**Interpretation:** The paid rider owns physical weighing and inspection at the laundry, within the existing founder authority over pricing exceptions and final processing decisions.

### Q24 — What follows unsuccessful price-approval contact?

Recommendation: founder agrees an unprocessed return; exact timeout and fees deferred to the partner session. Alternatives: hold indefinitely; defer the entire policy.

**Founder answer:**
> Founder agrees unprocessed return; timeout/fees deferred (Recommended)

**Interpretation:** Hold processing; escalate to a founder to arrange an unprocessed return with the customer. Timeout/contact-attempt/fee details remain undecided.

Pricing Q20 remains the first agenda item when both partners are present.

## Q25 — Scope clarification

The founder said “my partner with frontend.” Asked whether the partner owns frontend direction/review, writes frontend exclusively, or is present to review.

**Founder answer:**
> here now we are only doing the plan.md and tooling so a new cloud agent can do and verify when it pushes

**Interpretation:** Current authorization is product planning and execution/verification tooling. Do not assign frontend implementation ownership or start product features from this statement. Future cloud agents implement manually assigned bounded issues and verify their pushed revisions.
