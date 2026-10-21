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

## Latest scope and report request

- Founder asked whether all questions were done and requested a neat partner report containing question, answer and options. The interview remains incomplete; [partner report](PARTNER-REVIEW.md) consolidates all 26 entries and open decisions.
- Founder instruction: “stop the frontend stuff”. Frontend implementation and further manual app walkthroughs are stopped. Continue the planning report and repository tooling only.

## Round 7 — billing, cancellation and payment exceptions

### Q26 — If the customer estimates 5 kg but intake measures 4 kg, how should billing work?

**Options / response format:**

- Charge measured weight; minimum/rounding rules decided later (recommended)
- Charge the original estimate even if weight is lower
- Decide this with my partner

**Founder’s original answer:**

> Charge the original estimate even if weight is lower

**Current reading / follow-up:** The selected estimate is a billing floor even when measured weight is lower. Q29 asks whether to define and clearly disclose it as a minimum package quantity. Higher measured-price increases still require prior consent; minimum/rounding rules and prices remain undecided.

**Partner review:** ☐ Agree · ☐ Challenge · ☐ Needs discussion

### Q27 — When may a customer cancel?

**Options / response format:**

- Free before pickup; founder handles requests after pickup (recommended)
- Founder reviews every cancellation, including before pickup
- Decide the full cancellation policy with my partner

**Founder’s original answer:**

> Free before pickup; founder handles requests after pickup (Recommended)

**Current reading / follow-up:** Free cancellation before pickup. Founder handles requests after pickup, including any unprocessed return. Exact charges and post-processing rules remain open.

**Partner review:** ☐ Agree · ☐ Challenge · ☐ Needs discussion

### Q28 — What happens if UPI fails or the customer cannot pay at return?

**Options / response format:**

- Try agreed alternative, then contact founder; keep payment unresolved (recommended)
- Allow delivery and later payment within a founder-approved limit
- Decide failed-payment handling with my partner

**Founder’s original answer:**

> Try agreed alternative, then contact founder; keep payment unresolved (Recommended)

**Current reading / follow-up:** Try an agreed alternative such as cash; then contact a founder before marking payment or delivery complete. Credit, handover or return arrangements require a founder decision.

**Partner review:** ☐ Agree · ☐ Challenge · ☐ Needs discussion

## Round 8 — partner deferrals and communications

### Q29 — Should the selected kg be a clearly disclosed minimum package quantity?

**Options / response format:**

- Yes: selected kg is a clearly disclosed minimum package quantity
- Revise Q26 and charge lower measured weight
- Discuss the minimum-package rule with my partner

**Founder’s original answer:**

> Discuss the minimum-package rule with my partner

**Current reading / follow-up:** Deferred to the joint partner session. Q26 is this founder’s proposed direction, not a settled customer billing contract. Decide package/minimum disclosure and lower measured-weight treatment together before product issues implement billing.

**Partner review:** ☐ Agree · ☐ Challenge · ☐ Needs discussion

### Q30 — What should happen if clothes are missing or damaged?

**Options / response format:**

- Founder investigates/agrees remedy; limits decided before launch (recommended)
- Rider may settle claims within a defined limit
- Decide the entire claims policy with my partner

**Founder’s original answer:**

> Decide the entire claims policy with my partner

**Current reading / follow-up:** Entire claims policy deferred: evidence requirements, responsibility, reporting window, remedy, compensation and exclusions all need joint review. No compensation promise or rider authority is approved.

**Partner review:** ☐ Agree · ☐ Challenge · ☐ Needs discussion

### Q31 — How should customers receive confirmation and important order updates?

**Options / response format:**

- In-app status + WhatsApp for key updates/contact (recommended)
- In-app status and push notifications only
- WhatsApp and phone calls initially; app status later

**Founder’s original answer:**

> In-app status + WhatsApp for key updates/contact (Recommended)

**Current reading / follow-up:** Order status stays in the app; WhatsApp carries key updates/contact. Q32 asks whether pilot messages are manual or automated. Reliability and failure handling must be verified.

**Partner review:** ☐ Agree · ☐ Challenge · ☐ Needs discussion

## Round 9 — messaging, sign-in and capacity

### Q32 — How should WhatsApp updates be sent in the pilot?

**Options / response format:**

- Manual business WhatsApp updates for the pilot (recommended)
- Automatic updates required at launch
- Decide messaging automation with my partner

**Founder’s original answer:**

> Decide messaging automation with my partner

**Current reading / follow-up:** Manual versus automated sending is deferred to joint review. Q31 still selects WhatsApp alongside in-app status. Do not assume an automatic WhatsApp integration is a launch requirement.

**Partner review:** ☐ Agree · ☐ Challenge · ☐ Needs discussion

### Q33 — How should real customers sign in?

**Options / response format:**

- Phone OTP for real customers; demo access only for testing (recommended)
- Founder manually creates accounts
- Choose sign-in with my partner

**Founder’s original answer:**

> Phone OTP for real customers; demo access only for testing (Recommended)

**Current reading / follow-up:** Real customer access uses a verified phone OTP provider before live launch. Demo access remains isolated to testing; provider selection and failed OTP handling still need specification.

**Partner review:** ☐ Agree · ☐ Challenge · ☐ Needs discussion

### Q34 — Who controls whether slots can accept more orders?

**Options / response format:**

- Founder controls slot capacity with rider/operator input (recommended)
- Rider controls availability
- Laundry operator controls availability

**Founder’s original answer:**

> Founder controls slot capacity with rider/operator input (Recommended)

**Current reading / follow-up:** A founder opens/closes slots and sets capacity after checking rider/operator feasibility. Full slots must stop accepting new bookings; capacity reservation is addressed in Q35.

**Partner review:** ☐ Agree · ☐ Challenge · ☐ Needs discussion

## Interview closed — partner handoff

Original founder instruction:

> im done with the questions . give me a clean report for my partner to review also put unanswered and more questions down.  the report i want it on notion and i want it on a databse for mobile viewing it should be easy to read for him

No further questions are being asked of the founder. The review is published in Notion under Laundry Home. It preserves all 35 answered/deferred entries and carries forward 12 unanswered questions and 8 clearly marked proposed follow-ups. This closes the interview round, not the unresolved product decisions or both-founder approval.
