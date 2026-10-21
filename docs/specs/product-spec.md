# Laundry product specification

Status: implementation proposal v1, 11 October 2026. The product name is **Laundry**, confirmed by the founder on 12 October 2026. Source: the founder’s conversation and [idea notebook](https://app.notion.com/p/3f6074fda55681ee8b3cdc20db4090a2).

## Outcome and scope

Give customers a clear home and clothes ready for their plans. Build two separately installed mobile apps: a customer storefront and a delivery partner app. Add WhatsApp text/voice-note ordering as another interface to the same order system. A restricted internal web console supports the actual laundry operation.

The customer app includes service photography, service details, garment selection, basket, pickup scheduling, return estimates, checkout, payment, confirmation, tracking, order history, reviews and support. The partner app includes assigned tasks, navigation handoff, bag/garment counts, handover verification, proof, exceptions and task history. Third-party providers supply delivery capacity where a commercial integration exists.

India, INR, Asia/Kolkata, English UI and English/Hindi/Hinglish voice evaluation are planning defaults, not confirmed launch-market decisions. Implement configurable service areas and business hours. Do not invent prices, tax rates, refund fees, operating capacity or turnaround promises: test fixtures are explicitly marked demo-only. Production ordering stays disabled until these settings and commercial arrangements are approved.

## Customer experience

Navigation: Home / Orders / Help / Account; basket accessible from Home and service pages. Browse before sign-in; verified phone required before checkout. Home starts with serviceable address and current order, followed by photographic service categories. One primary action per screen. No fake urgency or ratings.

1. **Home:** delivery address, area eligibility, active-order return window, photographed categories (wash & fold, wash & press, pressing only, dry cleaning), service explanations and real verified reviews. Empty reviews say “No reviews yet”.
2. **Service:** photo gallery, included steps, excluded fabrics/items, pricing unit, indicative turnaround, garment selectors and care notes. A price labeled “from” must state its unit. Photos are licensed originals or licensed assets with attribution records; no provider/customer images without permission.
3. **Basket:** service + garment type + quantity, separate price components, pickup and requested return deadline. Per-piece services use integer counts. Weight-based services use declared item count for custody and estimated weight for price; these are separate fields.
4. **Schedule:** saved/new address, pickup window, requested return deadline, earliest feasible return window. Show unavailable slots and a useful alternative. Never silently replace the requested deadline. Mixed-service orders use the slowest eligible return window; no split returns in v1.
5. **Checkout:** item summary, provisional/fixed price label, tax, pickup/return fees, total, cancellation terms and hosted payment checkout. Server recalculates all amounts. Payment pending is distinct from failure and confirmation.
6. **Confirmation:** order ID, pickup window, promised return window, payment receipt state, preparation instructions and support. A paid order awaiting slot reconciliation must explicitly say “Payment received; booking being resolved”.
7. **Tracking:** Confirmed → Pickup → At laundry → In care → Quality check → Ready → Returning → Delivered. Separately show pickup and return delivery legs, exceptions, freshness timestamp and revised estimate. A map appears only when authorized live coordinates exist; never animate fabricated rider positions.
8. **Order detail:** immutable original quote plus approved adjustments, bag/garment inventory, care exceptions, receipts/refunds, cancel/reschedule action when allowed, and support. “Reorder” creates a fresh basket and quote.
9. **Reviews:** delivered-order customers can submit one review per order, overall score 1–5, service and delivery scores, comment and optional moderated photos. Label verified service use, publish only consented content, and keep moderation reasons/audit history. No staff-written synthetic ratings.

Visual proposal: bright white and pale blue surfaces, deep navy text, teal actions, generous space, clear rounded controls and large service photography. Use pictures where they explain the service; confirmation, payment and tracking prioritize legible facts. Text never depends on an image loading. Minimum 44px touch areas, scalable text, descriptive labels, screen-reader order and non-color status indicators. Responsive image variants, placeholders and retries keep the storefront useful on slow networks.

## Delivery partner experience

Two modes are explicit. **Provider-managed:** the rider stays in the provider’s app; our system receives contracted dispatch/tracking events. **Authorized partner:** a rider or dispatcher invited by our operator uses this app for supported tasks. We do not assume access to other companies’ rider identities, payroll or location.

Screens: sign-in/invite → assigned jobs → job detail → pickup/handover → exception → history/profile. Each job contains only the necessary contact/address, window, bag count and instructions. Active jobs show next action, navigation link and support. Job acceptance applies only where assignment rules allow it; outsourced jobs are read-only unless the provider delegates actions.

Customer-to-laundry and laundry-to-customer are separate jobs. Record sealed bag IDs, custody count, condition photos where needed and handover confirmation. Facility confirms intake independently. Use short-lived handover codes with expiry and attempt limits; delivery proof must follow the selected provider contract. Never expose customer handover codes to riders. Offline capture may queue evidence with a client action ID; show “Pending sync”, not successful delivery. Reassignment revokes the previous rider’s write access. Do not implement a fictional earnings screen for externally employed riders.

## Internal operations

Browser console roles: operator, facility staff, support and administrator. Facility staff see only assigned facilities and jobs. Screens: order queue, intake/count reconciliation, care workflow, quality check, dispatch board, failed jobs, payment/refund reconciliation, service/photo/price/capacity configuration and review moderation. Every override requires reason, actor, previous/new value and timestamp.

Workflow: receive sealed bag → compare count/weight → propose price change if needed → obtain approval and collect any top-up → care → quality check → repack and count → return dispatch. Rejecting a changed quote pauses care and opens an agreed return/refund workflow. Lower final prices trigger a tracked refund; higher prices never debit silently. Support owns missing/damaged item incidents and rewash requests; they do not silently mark the original order successful.

## WhatsApp text and voice notes

Example input: “Pick up five shirts tomorrow between nine and ten, wash and press, and return them Friday before six.” Interpret relative times against the message receipt time and customer timezone; ask which date/time when ambiguous. Clothes count alone is insufficient for garment-specific prices: ask types or offer a clearly provisional basket.

Flow: verified webhook → deduplicate message → retrieve private audio → transcribe → extract a strict draft → validate against catalog/address/slot availability → ask only missing questions → present exact dated summary + quote → customer confirms the current draft revision → hosted payment link → authoritative order confirmation. New customers provide/confirm an address; existing app accounts require secure ownership verification before linking. Never disclose saved addresses based on an unverified claim of phone ownership.

Draft fields: customer/address reference, garment types/counts, estimated weight if applicable, service IDs, pickup window, requested return deadline, care notes, timezone and revision. Preserve field-level source/confidence, but do not treat model confidence as proof. Ambiguous dates, quantities or services require clarification. All prices, capacity decisions and order writes come from backend tools; model output is untrusted. No arbitrary URLs, SQL or tool names from messages execute.

Confirmation is bound to draft ID, revision, quote ID and expiry. Changes invalidate previous confirmations/payment requests. A repeated webhook or “confirm” message cannot create a second order. Voice-only confirmation can express intent, but payment authorization still occurs through hosted checkout. No card details or OTP collection in conversation.

First release means asynchronous voice notes and text, with a readable confirmation. Live two-way WhatsApp calls, speech interruption and spoken payment are separate future scope requiring provider capability and cost validation. Transcription is behind a vendor-neutral adapter; choose/pin a provider through a representative language/noise evaluation during integration. Retain original audio for at most 24 hours after transcription by default, unless a user-requested support case requires explicit retention; apply the same policy to our storage and verify vendor retention settings. Transcripts are minimized/redacted and kept 30 days by default; structured order records follow a separately approved business retention policy.

WhatsApp sends require consent and opt-out handling. Outside the customer service window use approved templates; automation has a visible human escalation path. Current policy basis: [WhatsApp Business Messaging Policy](https://whatsappbusiness.com/policy/). Audio transport exists in Meta’s published ecosystem, but the older SDK is archived; implement against the currently supported Cloud API/BSP and verify inbound voice-note fixtures before enabling it. [Meta audio reference](https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/messages/audio/).

## Launch proof

A real pilot must complete pickup, garment reconciliation, cleaning, return, payment, support and a refund with the actual partners. No same-day or urgent guarantee until measured capacity supports it. Operational ownership, rate card, care liability, geographic coverage and tax configuration are business inputs required for production, not blockers for development with labeled fixtures.
