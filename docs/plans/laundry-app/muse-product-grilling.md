# OpenCode Muse Spark 1.3 — product work track

Executor: OpenCode CLI. Requested model: `openrouter/meta/muse-spark-1.3`. Session: ses_eaa922743ffePY2UE2mwKgh07l. Exit: 0. Supplied-context planning run; tools disabled; no implementation or tests performed.

> Coordinator note: this is an unedited agent proposal. Its suggested version 0.3 and Q07–Q13 numbering were not adopted. The authoritative draft is PLAN.md version 0.2 and question IDs are owned by GRILLING.md. Earlier choices are the requesting founder’s answers; partner approval remains pending.

# Laundry full product grilling and partner review plan

Executor and model: OpenCode agent powered by openrouter/meta/muse-spark-1.3. I am one of the two requested OpenCode Muse agents. The coordinator is GPT-6.1-Sol. This is planning only. No code was changed, no issues were filed, no cloud tasks were launched, and no tests were run by me.

Plan version: 0.3 draft for partner review. Prior joint choices are preserved. Canonical repo is aditya-zig/laundry. Scope is full product covering customer plus delivery partner plus ops. The 18 October Game plan is product authority. Both founders approve the same version and either can challenge. Shared Notion holds discussion and GitHub Markdown holds approved execution context. Cloud workers may push issue branches and open PRs with browser or computer use and watchable video evidence for each revision. Humans merge and deploy.

All Oct18 and code facts below come from supplied sources. They are observations, not my own verification.

## 1. What the supplied evidence settles

Supplied Oct18 transcript observations establish the intended order as service, then quantity, then morning or evening pickup. Premium and general sections are intended but the actual premium offer is undefined. Rs 100 was discussed and questioned. It is not an approved rate. Quantity in kg determines how many boxes are needed. One scooter is agreed. Route chaining was brainstormed and depends on ready returns. No optimization promise was settled.

Supplied code observations show current gaps. RequestedLine requires garmentTypeId plus integer quantity, with estimatedWeightGrams optional. Local quote service and hosted Convex both price garment unit cost times count, with weight only as a provisional flag. Ops intake copies the requested measurement instead of capturing true measured input. Service has no tier field. Basket uses hardcoded past ISO date inputs with no slot picker.

These two sets conflict in a useful way. The product intent is kg led and box constrained. The implementation is count led and weight blind. That mismatch is the core of this round.

## 2. Gap analysis by journey

### Customer journey

Discovery works in code but tier truth is missing. Supplied intent wants premium versus general sections. Code has no tier field on service, so any premium label today would be copy without behavior. Do not ship tier copy until Q08 is settled.

Quantity input is the largest gap. Supplied intent says kg determines boxes. Code asks for garment counts and treats weight as optional. The fix is not cosmetic. It needs product truth on whether kg is the customer input, how boxes are derived, and what happens when measured weight differs. See Q09.

Pickup selection is placeholder. Basket has hardcoded ISO dates and no slot picker. Supplied intent says morning or evening pickup, but hours are unsettled. Return SLA is also unsettled. So slot UI, promise copy, and validation all remain blocked. See Q10.

Price and payment timing are blocked. Code prices by count. Supplied intent prices by measured reality with adjustment and consent still undefined. Payment timing is unsettled. Any fixed checkout total today would overpromise. See Q09 and Q11.

Tracking, help, cancel, and review exist as screens or stubs in the candidate implementation, but their promises depend on Q10 and Q11. Keep them in scope for planning and out of scope for build issues until those answers land.

### Delivery partner journey

Supplied intent preserves one scooter and a small radius idea. Route chaining is brainstorm only. Code has custody legs and delivery leg states, which is good. What is missing is the operational promise. Who assigns the pickup, what box or bag identity travels with the order, what proof of pickup and return is required, and whether chained stops are allowed in v1.

My view: lock single scooter plus manual dispatch for v1 and explicitly defer chaining optimization. Otherwise the rider app will imply capacity the business has not approved.

### Ops journey

Ops intake is the weakest supplied point. Copying requested measurement as measured truth breaks pricing trust and custody. Ops needs a separate measured weight and box count input, an adjustment approval step, and a clear payment state transition. Vendor identity, zone boundary, support hours, cancel and refund rules, and lost or damaged handling are all unsettled per supplied notes. Do not let UI copy invent them.

## 3. Requirements authority

Settled by authority unless jointly amended:

- Whole product scope.
- Canonical repo and branch baseline intent.
- Branch plus PR delivery with per revision browser evidence and video. Human merge and deploy remain separate.
- Both approve rule with challenge right.
- Notion discussion plus GitHub Markdown record.
- Game plan as product source over older build notes.
- Flow order of service to quantity to pickup.
- Kg determines boxes.
- Single scooter.

Remains unclear and must not be guessed:

- Morning and evening hours with timezone.
- Return SLA or promised window versus requested deadline.
- Exact zone boundary.
- Actual laundry vendor and capacity.
- Payment timing and adjustment consent.
- Premium versus general semantics and availability.
- Box derivation table from kg.
- Support, cancel, refund, and loss policy.
- Visual approval set beyond existing tokens.
- First release bar and first user definition.

Pricing calculations and architecture changes wait until Q07 through Q11 are jointly approved. That deferral is deliberate. A premature rate or schema choice would force rework across customer, rider, and ops.

## 4. Preserved concepts

Kg stays as the customer quantity language. Boxes stay as the custody and capacity language. Single scooter stays as the v1 logistics constraint. These three are not interchangeable. Kg answers how much. Boxes answer how it moves and where custody sits. Scooter answers the capacity ceiling. Future issues must keep estimated weight, measured weight, garment count, and container count as separate fields.

## 5. Next frontier Q07 to Q13

One parent agent owns the interview. Subagents do not reask or fork IDs. Q01 to Q06 are closed for partner challenge only, not for fresh answers.

### Q07. First release bar and platforms

Question: what single pilot outcome proves usefulness, who is the first user, and which devices must work. This includes Expo customer and partner on phone web plus Vite ops on desktop, or a narrower bar if founders choose it.

Dependency: none. It gates issue slicing.

Recommended answer: one real customer books a kg quantity with a morning or evening pickup in a named pilot zone, rider completes pickup and return with box custody, ops records measured weight, customer sees status. Phone width 390px for customer and partner plus desktop ops. Tablet only if founders name a tablet user now.

### Q08. Launch service and tier structure

Question: which services launch, what premium means in concrete inclusions and turnaround, and whether general is the default.

Dependency: Q07. Tier scope follows release bar.

Recommended answer: launch two or three wash and iron services max, define premium as explicit inclusion plus turnaround difference, keep general as standard. If premium cannot be defined in one sentence per inclusion, cut it from v1 and keep the section hidden rather than empty.

### Q09. Kg, boxes, and pricing approval

Question: is kg the customer input, what box table maps kg to boxes, where measured weight is entered, who approves adjustments, and when payment is captured. Rs 100 stays discussion only until a vendor rate card is attached.

Dependency: Q07 and Q08. Pricing truth needs catalog and release bar first.

Recommended answer: customer enters kg, app shows derived boxes and an estimate labeled as estimate, ops enters measured weight and actual boxes at intake, customer approves any increase before processing, payment timing is cash or UPI on return for pilot unless founders pick prepaid. Keep integer INR minor units and keep order, payment, and leg states separate per repo rules.

### Q10. Pickup windows, return promise, zone, and scooter capacity

Question: morning and evening hours with timezone, return SLA, exact pilot boundary, daily order cap for one scooter, and whether route chaining is allowed in v1.

Dependency: Q07. It also constrains Q11 dispatch.

Recommended answer: two named windows with clock times, return promise as a day range not a guaranteed hour, one named zone with a labeled fixture, explicit daily cap, no chained optimization promise in v1. Chaining only as manual back to back jobs if time allows.

### Q11. Operational actors, vendor, and promises

Question: actual vendor, intake and support hours, payment timing, cancel and refund windows, lost or damaged policy, and whether shop staff need a login or stay manual. WhatsApp is support and notification in v1, not an ordering channel, unless founders explicitly approve ordering.

Dependency: Q09 and Q10. Promises need pricing and window truth.

Recommended answer: name one vendor, keep shop interaction manual in v1, define cancel before pickup free and after pickup manual, define refund as ops approved, define loss handling as named compensation owner. Record what is manual so the UI does not promise automation.

### Q12. Design reference interpretation

Question: does Zepto familiar mean navigation density and speed, or a stronger visual restyle, and what is retained from white plus pale blue plus navy plus teal with 44px targets.

Dependency: Q07 and Q08. Screens need catalog truth.

Recommended answer: keep existing tokens and touch targets as baseline, borrow flow familiarity only, no brand copy. Approve one customer booking path at phone width plus shared components, typography, spacing, icon treatment, copy tone, and loading plus empty plus error states before any build issue. Store approved screenshots in the repo.

### Q13. Publication, traceability, and video bar

Question: where approved Markdown lands in aditya-zig/laundry, how Notion discussion links to it, and what per PR video must show.

Dependency: Q07. It can be prepared in parallel but only binds issues after Q07 lands.

Recommended answer: publish docs plans plus discovery plus ADRs under versioned paths, link each decision from Notion, require every cloud PR revision to include real app use video covering the claimed journey at the agreed widths, with commit hash, commands, and limits stated. Failed or missing evidence leaves the PR in draft.

## 6. Partner attributed protocol

Each Q07 to Q13 record keeps author, date, rationale, evidence link, and status. Statuses are unanswered, answered, challenged or resolved, then accepted. Partner challenge cites a question ID, gives a concrete scenario, and proposes an alternative. Challenge reopens that question and marks dependent requirements and draft issues for re review. Silence is pending, never approval. Both founders must approve the same plan version. Later edits create a new version and list affected issues. This preserves the Q02 rule without letting async review drift.

Suggested record shape follows the existing GRILLING ledger. Do not flatten two founders into one answer. Keep original text stable and add follow ups as Q07.a rather than renumbering.

## 7. Ready issue traceability

No issue is ready while it depends on an unanswered or challenged Q07 to Q12 decision. Each draft issue must cite plan version, requirement IDs in UX, VIS, OPS, and NFR series, decision IDs, bounded scope with exclusions, allowed files, fixtures, exact verification commands, device evidence, and branch plus PR limits. Shared contract, migration, or manifest changes need a named owner. Dependent work becomes eligible only after blockers merge to baseline, not on a success message.

Per revision delivery keeps the Q03 promise. New push invalidates prior review ready status. The worker reruns the journey, refreshes video, and reports paths, commit, test results, limits, and PR link. Human merge and deploy stay separate, especially because push to build slash laundry can trigger Convex deploy when the secret is set.

## 8. Cross surface edge cases

These are concrete and must shape acceptance criteria once Q09 to Q11 settle. Estimated versus measured weight mismatch with customer approval pending. Box count change at doorstep when kg was underestimated. Pickup window expires while rider is en route. Return ready late and chaining tempts overcommit on one scooter. Failed payment on return with clothes in custody. Offline rider proof capture with later sync. Duplicate webhook replay creating double charge. Stale quote applied after price truth changed. Cancel after pickup with box already moved. Unavailable slot shown as selectable due to stale fixture. Customer support message without order context. Each needs a defined owner state and recovery path across customer, rider, and ops, not three separate copies.

## 9. ADR candidates only where consequential

Do not write ADRs for visual taste or workflow wording. Candidates after decisions: canonical repo reconciliation and what happens to wandary UI work, hosted Convex versus local NestJS authority if the pilot changes backends, single ordering channel versus WhatsApp ordering if that becomes consequential, and manual ops intake versus vendor login. Keep routine reversible choices in the plan.

## Recommendation

Approve Q07 first, then Q08 through Q12 as a batch, with Q13 running in parallel for publication mechanics. I would lock a narrow pilot of one zone, one vendor, kg led estimates with ops measured truth, two pickup windows, no chaining promise, existing tokens retained, and every PR gated by real use video. That gives the partner something concrete to challenge without reopening Q01 to Q06, and it stops pricing and schema work from starting before the business truth exists.
