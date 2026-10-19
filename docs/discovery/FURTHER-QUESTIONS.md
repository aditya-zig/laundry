# Laundry — proposed further questions

Interview closed for this handoff. These eight questions were not asked or answered; they are a partner-review backlog, not approved requirements.

## F01 — OTP and account recovery

**Question:** What should happen when OTP delivery fails, a phone is lost or the customer changes number?

**Possible responses — suggestions:**

- Define limited retries and a founder-assisted recovery path
- Choose provider-supported recovery
- Discuss recovery before launch

**Answer:** Not asked or answered.

**Why this remains open:** Define failure/recovery without silently bypassing identity checks. Exact process and provider remain undecided.

## F02 — Privacy and record retention

**Question:** Which contact, address, photo and handover records should be retained, who can access them and for how long?

**Possible responses — suggestions:**

- Document purpose, access and retention per record type
- Keep only the minimum evidence needed for pilot operations
- Review the policy jointly before launch

**Answer:** Not asked or answered.

**Why this remains open:** A scoped data/retention policy remains to be written; no retention period or consent rule has been approved.

## F03 — Cash and UPI reconciliation

**Question:** Who verifies received UPI payments and reconciles rider-collected cash, and what happens on mismatch?

**Possible responses — suggestions:**

- Founder verifies receipts and reconciles a daily rider record
- Dedicated operations person reconciles and escalates discrepancies
- Discuss record and reconciliation rules jointly

**Answer:** Not asked or answered.

**Why this remains open:** Payment methods are selected; account confirmation, cash handoff and discrepancy handling remain unspecified.

## F04 — Customer absent or unreachable

**Question:** What happens when the customer is absent at pickup/return or cannot be reached?

**Possible responses — suggestions:**

- Record attempts, contact founder and agree another slot
- Set a jointly approved wait/retry/storage policy
- Decide any fees with the pricing review

**Answer:** Not asked or answered.

**Why this remains open:** Distinct from operator delay: waiting limits, retries, custody, storage and any fees require decisions.

## F05 — Unsuitable or partly rejected laundry

**Question:** What if some garments cannot be processed safely or the operator cannot provide the selected service?

**Possible responses — suggestions:**

- Hold affected items and obtain a customer-approved revised scope
- Arrange unprocessed return through a founder
- Define excluded items and service limitations before launch

**Answer:** Not asked or answered.

**Why this remains open:** Do not infer permission to change care/service/price. Item-level rejection and partial fulfillment rules remain open.

## F06 — Provider and environment ownership

**Question:** Who owns OTP/WhatsApp/payment accounts, test data, cloud environment access and recovery credentials?

**Possible responses — suggestions:**

- Assign named business owners and separate test/live access
- Inventory current accounts first, then allocate ownership
- Settle account ownership during later cloud setup

**Answer:** Not asked or answered.

**Why this remains open:** Cloud account setup is explicitly deferred. This is a future ownership checklist, not authorization to sign in, deploy or buy services now.

## F07 — Pilot success measures

**Question:** What observations and targets decide whether the pilot is ready to expand?

**Possible responses — suggestions:**

- Track promised-window performance, corrections, complaints, repeat use and per-order costs
- Define a small agreed trial checklist and review cadence
- Set exact targets together after the operational rehearsal

**Answer:** Not asked or answered.

**Why this remains open:** Measures are suggestions; no numeric target, trial size, date or expansion commitment has been approved.

## F08 — Interrupted work and duplicate requests

**Question:** How should interrupted booking/payment/approval attempts and offline rider actions recover without duplicate orders or contradictory records?

**Possible responses — suggestions:**

- Preserve pending state and safely retry with duplicate protection
- Require founder reconciliation when the outcome is uncertain
- Specify recovery per critical action before implementation

**Answer:** Not asked or answered.

**Why this remains open:** Future behavior and verification criteria need to cover uncertain outcomes and resynchronization. No frontend implementation is authorized by this backlog.
