# Quick-commerce operations and Uber-style driver maps: research references

Date: 2026-10-20 (updated 2026-10-21)
Author: research subagent for the laundry-on-demand backend MVP
Scope: (a) quick-commerce operations patterns (Zepto, Blinkit, Zomato, Swiggy) and (b) Uber-style live driver maps.
Purpose: tell the implementing agent which concrete, reusable patterns to borrow.

Evidence rules used in this document:

- **Observed.** I ran the tool and read the output, or I read the file/repo directly.
- **Inferred.** A conclusion drawn from observed evidence, with the reasoning stated.
- **Assumption.** A design choice I am recommending without direct evidence.
- **Unknown.** I could not establish it. Do not treat as fact.

Star counts, licences and last-push dates are as returned by `gh api repos/<owner>/<repo>` on 2026-10-20.

---

## 0. Environment and tooling notes

| Thing | Value | How established |
|---|---|---|
| REA CLI | `rea-agents` npm, version **6.7.0** | `npx -y rea-agents@latest --version` → `6.7.0` |
| REA source (read-only) | `/tmp/opencode/research/rea` (clone of https://github.com/morluto/rea) | `docs/cli.md`, `docs/browser-observation.md` |
| Browser | `/usr/bin/google-chrome-stable`, Chrome/155.0.8059.84, headless `--headless=new` | `http://127.0.0.1:9222/json/version` |
| CDP endpoint | `http://127.0.0.1:9222`, dedicated profile `/tmp/opencode/rea-browser-profile` | REA needs an HTTP discovery endpoint; see `docs/browser-observation.md` "Start a browser" |
| Host memory | 7.25 GB total | `free -m` (this caused a real failure, see §1.2) |
| Fallback browser driver | my own small CDP client over Node's built-in `WebSocket` (`/tmp/opencode/cdpnet.mjs`, `cdpfetch.mjs`, `cdpapishape.mjs`) | used only where REA could not produce the data (see §1.3) |

REA commands used, all from `/tmp/opencode/rea-out`:

```
npx -y rea-agents@latest list-browser-targets http://127.0.0.1:9222 --json
npx -y rea-agents@latest inspect-web-page http://127.0.0.1:9222 <targetId> \
  --observation-ms 8000 --include-accessibility-text --include-json-body-shapes \
  --include-websocket-shapes [--include-script-sources] --json
npx -y rea-agents@latest analyze-web-bundle http://127.0.0.1:9222 <targetId> --json
npx -y rea-agents@latest discover-webmcp-tools http://127.0.0.1:9222 <targetId> --json
npx -y rea-agents@latest analyze-javascript-application /tmp/opencode/bundles --json
npx -y rea-agents@latest inspect-analysis-view /tmp/opencode/rea-out/blinkit-view.json --json
```

REA's own limitations that shaped the method (all from `docs/browser-observation.md` and the source):

- "Network and console coverage starts only after REA attaches… `prior_activity_available` is always `false`; absence from these arrays is not evidence that an event never occurred." (`docs/browser-observation.md`, "Completeness and limits")
- "If the main frame navigates during final capture, REA discards the mixed result and returns `target_changed`." (same section; implemented at `src/browser/CdpBrowserProvider.ts`, `src/browser/CdpAuthorizedMainFrame.ts`)
- Frames/resources/scripts outside the selected origin scope are excluded, so a CDN-hosted vendor bundle is never captured on behalf of the page's own origin.

---

## 1. What REA found on Zepto and Blinkit

### 1.1 Zepto (https://www.zepto.com/)

**Observed. REA succeeded.** `rea list-browser-targets http://127.0.0.1:9222 --json` returned one eligible page target (`https://www.zepto.com`, title "Zepto: Online Grocery Delivery App - Groceries in Minutes") and reported `excluded: {disallowed_origin: 0, unsupported_url: 1, non_page: 4}`.

**Observed. REA succeeded.** `rea inspect-web-page http://127.0.0.1:9222 <zepto-target> --observation-ms 8000 --include-accessibility-text --include-json-body-shapes --include-websocket-shapes --json` produced a 653,900-byte evidence file (`evidence_id ev_1cf00954282b36a2abbca6ed51de551d3507efea49c1bb93e1213869bae97a06`). Reported completeness was `status: "policy_filtered"` with conditions `["attach_limited", "policy_filtered"]`; policy-filtered sections were `console_events, console_text, metadata, resources, script_sources, scripts, storage_keys, workers`; attach-limited sections were `console_events, metadata, network_requests, websocket_connections, websocket_frames`. `network.requests` was an empty array and `network.prior_activity_available` was `false`.

**Observed. REA succeeded.** `rea analyze-web-bundle http://127.0.0.1:9222 <zepto-target> --json` produced `evidence_id ev_323056cbfd6bfb8785422a3934dd88d5a1085ce86b2543b866a1a1d51abb6a64`:

- `scripts_observed: 5`, `scripts_analyzed: 5`, `completeness.status: "complete"`, `visited_ast_nodes: 6430`.
- `observations.chunks.edges: []`, `observations.routes: []`, `observations.endpoints: []`.
- One inference: `vendor_fingerprint = "Next.js"`, `confidence: "high"`, detector `next-runtime`, basis script `scr_7287007d…`.
- Captured script URLs were `https://www.zepto.com/` (inline) and `https://www.zepto.com/~partytown/partytown-sandbox-sw.html?…` (50,941 bytes).

**Exact REA limitations/failures on Zepto:**

1. `target_not_allowed` before the site would serve the page.
   Command: `rea inspect-web-page http://127.0.0.1:9222 <target> --observation-ms 8000 … --json`
   Output: `{"code":"target_unavailable","category":"unavailable","details":{"operation":"inspect_web_page","reason":"target_not_allowed"}}`
   Cause (Observed from the DOM): the headless browser with its default `HeadlessChrome/155.0.0.0` user agent was served **HTTP 429** by Zepto; the document URL became `chrome-error://chromewebdata/` ("This page isn't working… HTTP ERROR 429"). REA's origin boundary check throws `target_not_allowed` when the main frame is not on an allowed HTTP(S) origin (`src/browser/CdpAuthorizedMainFrame.ts:36-40`).
   Fix: relaunch Chrome with an ordinary Chrome user-agent string. Zepto then served the real page. **Inferred.** Zepto sits behind AWS WAF. A plain `curl` to `https://www.zepto.com/` returned HTTP 202 with a `challenge.js` from `277df17f54ea.f4d9c26b.ap-south-1.token.awswaf.com`. That edge rate-limits or challenges the default headless UA.

2. `unreadable_output` / `protocol_error` when script sources are requested across a reload.
   Command: `rea inspect-web-page … --include-script-sources --json` (observation 25 s, page reloaded 8 s in)
   Output: `{"code":"unreadable_output","message":"CDP Debugger.getScriptSource failed (-32000): No script for id: 6","details":{"operation":"inspect_web_page","reason":"protocol_error"}}`
   Cause: the script id was invalidated by the navigation before `Debugger.getScriptSource` resolved.

3. `target_unavailable` / `target_changed` when the page reloads inside the observation window.
   Command: same as (2) without `--include-script-sources`
   Output: `{"code":"target_unavailable","details":{"operation":"inspect_web_page","reason":"target_changed"}}`
   **Consequence.** REA cannot capture the network traffic of a page *load*. It can only observe what happens *after* it attaches, on a page that is not navigating. This is the single biggest REA limitation for this task, and it is why the fallback in §1.3 was needed.

**Observed. Fallback browser (not REA).** Full network capture of `https://www.zepto.com/` (161 requests):

- One application XHR:
  `GET https://bff-gateway.zepto.com/lms/api/v2/get_page?latitude=12.96902&longitude=77.75395&page_type=HOME&version=v2&show_new_eta_banner=true&page_size=3&enforce_platform_type=DESKTOP` → 200
- **Zero** WebSocket connections opened during the load.
- Static assets come from `cdn.zeptonow.com/web-static-assets-prod/artifacts/17.3.4/_next/static/chunks/…` (Next.js App Router, artifact version `17.3.4`). These are on a different origin from `www.zepto.com`, which is why REA's origin-scoped bundle analysis saw only 5 scripts and zero endpoints.
- A Partytown web-worker sandbox is loaded: `GET https://www.zepto.com/~partytown/partytown-sandbox-sw.html?…`.
- Document HTML size 774,247 bytes (server-rendered catalogue).
- Page copy: "Delivery in minutes*", "Select Location", category taxonomy including **"Laundry Care"** and **"Cleaning Essentials"**; product cards show a price pair (sale price, then MRP), e.g. `₹608` / `₹780`.
- Fetching the `bff-gateway.zepto.com` endpoint directly from the page context returned HTTP 202 with a non-JSON body, so **the response shape of `get_page` is Unknown**.

### 1.2 Blinkit (https://blinkit.com/)

**Observed. Bot protection.** `curl https://blinkit.com/` → **HTTP 403** with a 564,290-byte HTML body. Direct `curl` of a Blinkit webpack chunk URL also returned an HTML page instead of JavaScript. Blinkit serves JS to a real browser session and HTML to plain clients. **Inferred.** Blinkit's edge checks the client fingerprint and the TLS handshake, not the user-agent on its own.

**Observed. REA succeeded.** `rea inspect-web-page http://127.0.0.1:9222 <blinkit-target> --observation-ms 8000 --include-accessibility-text --include-json-body-shapes --include-websocket-shapes --json` produced a 169,204-byte evidence file.

**Observed. REA succeeded, and this is the most interesting REA result of the task.** `rea discover-webmcp-tools http://127.0.0.1:9222 <blinkit-target> --json` returned `status: "available"`, `completeness.status: "complete_within_window"`, and **12 page-declared tools**, all registered from `https://blinkit.com/555.scripts/agent-tools.c61456984d856f3e3c8c.js` (line 0, column 72717), each with `trust: "page-declared-untrusted"`:

`get_order` (read-only), `proceed_to_checkout`, `list_orders` (read-only), `search_products` (read-only), `clear_cart`, `get_cart`, `request_otp`, `list_saved_addresses` (read-only), `submit_otp`, `set_delivery_address`, `set_cart_items`, `get_session` (read-only).

`get_order`'s declared description is a free specification of Blinkit's order-tracking contract:

> "Read one grocery order by the token from a list_orders row. Requires a logged-in shopper. Returns its phase: **live** with the delivery status, the **ETA text the tracking page shows** and **refreshAfterMs**, its refresh cadence; **finished** as delivered, cancelled or delivery_failed; or unknown."

`list_orders` documents cursor pagination ("A non-null nextCursor means older orders exist; pass it back as cursor") and a `limit` of 1 to 10, default 3, with "A live order is always included even when it falls outside this count."

**Observed. REA succeeded.** `rea analyze-javascript-application /tmp/opencode/bundles --json` (the two Blinkit chunks below) produced a 58,247,420-byte evidence file, projected to a 10,204-byte summary with `rea inspect-analysis-view`:

- `relevant_files: 2`, `text_bytes_read: 203,604`, `parsed_javascript_files: 2`, `parse_failures: 0`, `visited_ast_nodes: 48,205`, `findings: 234`, `modules: 57`.
- Summary coverage `complete-within-view` (examined 110 of 118).
- `semantic_graph.coverage.status: "unknown"`; `9224 semantic graph unknowns remain in the parent Evidence`. REA's own limitation text: "Static paths and relationships may remain unresolved when expressions are dynamic or obfuscated" and "Webpack/Rspack factories were recovered from AST literals; REA did not invoke push handlers or bundle bootstrap code."

**Exact REA limitations/failures on Blinkit:**

4. `analyze-web-bundle` on the live Blinkit page **crashed the analyser**:
   Command: `rea analyze-web-bundle http://127.0.0.1:9222 <blinkit-target> --json`
   Output: exit code **134**, stderr
   `[29245:0x2e8e7000] 150976 ms: Scavenge … 2042.7 (2047.6) -> 2040.8 (2051.6) MB … FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory` and `timeout: the monitored command dumped core`.
   **Inferred.** Blinkit's home page loads several large route-split chunks and REA's per-process V8 old-space budget (documented default `max_heap_mb = 1024` in `docs/browser-observation.md`) is not enough for the whole page at once.

5. Retrying with a larger heap killed the browser, not the analyser:
   Command: `NODE_OPTIONS="--max-old-space-size=8192" rea analyze-web-bundle … --json`
   Output: `{"code":"provider_unavailable","category":"unavailable","details":{"operation":"analyze_web_bundle","reason":"endpoint_unreachable"}}`
   Cause (Observed): the host has 7.25 GB RAM; the 8 GB-heap child exhausted it and Chrome was OOM-killed. `curl http://127.0.0.1:9222/json/version` then returned nothing and `pgrep chrome` was empty.
   **Workaround that worked.** Fetch the two specific chunks through the browser (so Blinkit serves them), then run `rea analyze-javascript-application` on a directory containing only those files. This keeps the analyser inside its memory budget and still produces REA Evidence.

**Observed. Fallback browser (not REA), Blinkit home page.** 116 requests. Application traffic, all same-origin on `blinkit.com`:

| Method | Path | Note |
|---|---|---|
| GET | `/v1/consumerweb/eta` | ETA lookup |
| GET | `/config/main` | client config |
| POST | `/v1/layout/tag_collections` | body `{"fetch_categories":true}` |
| GET | `/v2/services/secondary-data/?filter=new_offer,…` | flags/secondary data by filter list |
| GET | `/visibility?latitude=…&longitude=…` | serviceability check for a coordinate |
| GET | `/api/feature-flags/receive` | feature flags |
| GET | `/feed/?template_version=9` | feed |
| POST | `https://mpc2-prod-28-is5qnl632q-ue.a.run.app/events` | analytics event collector; body carries `event_name: "PageView"` and an auto-captured "smart_setup" payload |

**Zero** WebSocket connections on the home page. Page copy: "Delivery in 11 minutes", "Please provide your delivery location to see products at nearby store".

**Observed. Blinkit live-tracking internals** (read from the two fetched chunks with REA static analysis plus plain string extraction; file names and byte counts are from the fetch):

- Chunks fetched (through the browser, because plain `curl` returns HTML):
  - `8721.scripts/layout-/OrderTrack-.257beda5e83dc7c0b1a9.js` → 114,274 bytes
  - `555.scripts/agent-tools.c61456984d856f3e3c8c.js` → 89,322 bytes
- Tracking endpoints (verbatim strings in the chunks):
  - `GET /v1/layout/crystal_track_order?cart_id=` (OrderTrack chunk)
  - `POST /v1/layout/crystal_track_order?cart_id=<cartId>&order_id=<orderId>` (agent-tools chunk)
  - `POST /v1/layout/order_details/<orderId>?cart_id=<cartId>`
  - `GET /v1/layout/order_history`
  - `GET /layout/crystal_track_order_page?source=track_order&cart_id=`
- **Order status vocabulary** (verbatim, `agent-tools` chunk):
  ```js
  C = { CREATED:"created", APPROVED:"approved", PICKING_STARTED:"picking",
        BILLED:"billed", ENROUTE:"enroute", REACHED_DOORSTEP:"at_doorstep" }
  w = { DELIVERED:"delivered", CANCELLED:"cancelled", DELIVERY_FAILED:"delivery_failed" }
  ```
  A classifier turns a raw state into `{kind:"live"|"finished"|"unknown", status, steps}`.
- **Terminal-state list** (OrderTrack chunk): `S = ["DELIVERED","CANCELLED","DELIVERY_FAILED"]`.
- **Transport is HTTP polling, not a socket.** The OrderTrack chunk contains `setInterval(Re, F)` where `F` is `page_actions[].repeating_action.duration` if present, else `response.refresh_interval`, else the literal default `1e4` (10 000 ms). The strings `WebSocket`, `EventSource` and `socket` **do not appear** in either chunk. The agent-facing contract mirrors this: the server returns `refreshAfterMs` telling the caller when to ask again.
- **The map is server-rendered data, not client-side GPS.** The client extracts `map_data` from a widget of type `TYPE_MAP_TRACKING_WIDGET` (numeric id 204) or a snippet of type `crystal_map_snippet_v2`. The map renderer is the **Google Maps JS API**: `https://maps.googleapis.com/maps/api/js`, configured with `libraries`, `mapIds`, `region`, `nonce`, `authReferrerPolicy`.
- **ETA is server-computed text.** The client reads `etaText` / `etaText`+`statusText` out of the server payload; there is a `STATUS_CODE_ETA_BREACHED` constant, i.e. the server can tell the client the promise was missed.
- **Order timeline is a server widget.** `TYPE_TIMELINE_DATA` → `data.timeline_data.order_status_timeline_data` (an array of typed entries), rendered as `timeline_snippet`.
- **Trust/safety widgets on the tracking page:** `track_order_map_data`, `track_order_delivery_partner`, `track_order_delivery_partner_safety`, `rider_tip_snippet` (contains `delivery_partner_tip`), `track_order_summary`, `track_order_alternate_contact_number`, `track_order_chat_support`, `track_order_delivery_details_header_widget`, `track_order_vertical_banner_list`, plus widget types `TYPE_DELIVERY_PARTNER_INFO_WIDGET: 201`, `TYPE_CHAT_SUPPORT_WIDGET: 210`, `TYPE_CANCELLATION_POLICY: 214`.
- **Page-level order state:** `page_meta.custom_data.order_state`, and the page switches to a different layout when the state is in an "in progress" set, with `order_progress_tracker` and `order_details_v2` as the two supported page variants.

### 1.3 Zomato (https://www.zomato.com/) and Swiggy

**Observed.** `https://www.zomato.com/` loads as a static marketing site (Astro.js: `https://www.zomato.com/z-homepage/_astro/index.*.css`), 79 requests, one XHR (`GET /restaurant-onboard-diy/check-auth`), zero WebSockets. It advertises "3,00,000+ restaurants", "800+ cities", "3 billion+ orders delivered", and a "Schedule your order" feature; the Eternal group page links to Blinkit, District and Hyperpure.

**Not reachable.** The Zomato/Swiggy *ordering* flows require a logged-in account and a serviceable pincode. **Unknown.** what their internal order/assignment APIs look like. I did not attempt to bypass authentication, and no Swiggy ordering page was reached in this session. Everything below about Zomato and Swiggy is therefore marketing copy or third-party reporting. There is no Observed API detail for them in this document.

### 1.4 What REA could not do here, stated plainly

- REA **cannot** capture a page load's network traffic (it only observes post-attach activity, and a navigation during the window returns `target_changed`). Any "which API does the homepage call" answer had to come from the fallback CDP client.
- REA's **origin scoping** means the heavy vendor bundles on `cdn.zeptonow.com` / `blinkit.com` are only reachable when they are same-origin (Blinkit) or when explicitly fetched into a local directory and analysed with `analyze-javascript-application` (both).
- REA's **analyser memory budget** is smaller than a full Blinkit page load (2 GB crash on 7.25 GB host).
- REA's **native binary** features (Ghidra/Hopper/IDA) are irrelevant here and were not used. `rea doctor` was not required to be run for the browser lane; the only doctor-style advice REA emitted was the generic "Run `rea doctor`, then try again" on the `target_unavailable` failures above.

---

## 2. Quick-commerce operations patterns worth borrowing

### 2.1 Order status vocabulary

**Observed** (Blinkit `agent-tools` chunk, §1.2): the live/terminal split is
`created → approved → picking → billed → enroute → at_doorstep` and terminal `delivered | cancelled | delivery_failed`.
The ordering is meaningful: *the order is only "live" (and only displayed on the tracking page) until it is en route*.

**Observed** (Blinkit OrderTrack chunk): the page's terminal-state list is exactly `["DELIVERED","CANCELLED","DELIVERY_FAILED"]`, and the page renders a different layout when the order is in progress.

**Inferred.** The useful distinction for the laundry MVP is **"pre-pickup" states vs "delivery" states vs "terminal" states**, because that is exactly the split Blinkit makes and exactly the split that maps onto the repo's existing separate `OrderStatus` and `DeliveryStatus` enums (`packages/contracts/src/types.ts:98-155`).

**Observed** (this repo, already implemented): `packages/contracts/src/types.ts` defines
`OrderStatus = AWAITING_PAYMENT | CONFIRMED | PICKUP_PENDING | AT_FACILITY | IN_CARE | QUALITY_CHECK | READY_FOR_RETURN | RETURNING | DELIVERED | AWAITING_ADJUSTMENT | ON_HOLD | RESOLUTION_REQUIRED | CANCEL_REQUESTED | CANCELLED` and
`DeliveryStatus = REQUESTED | BOOKING_UNKNOWN | BOOKED | ASSIGNED | AT_PICKUP | IN_TRANSIT | COMPLETED | FAILED | CANCEL_REQUESTED | CANCELLED` with `leg: "PICKUP" | "RETURN"`.

**Recommendation.** Keep these. The quick-commerce vocabulary confirms the repo's split rather than contradicting it. The one thing to add is a `customerVisibleStatus` projection. The repo already has `order.updated.v1` carrying `customerVisibleStatus` (`packages/contracts/src/events.ts:61-66`). Blinkit keeps internal states and customer-facing status separate the same way.

### 2.2 The saga / order-approval pattern

**Observed.** Chris Richardson's Saga pattern page (https://microservices.io/patterns/data/saga.html) describes the canonical flow: the Order Service creates an Order in a `PENDING` state, emits *Order Created*, the Customer Service reserves credit, and the Order Service either approves or rejects. The page lists three client-outcome options: (a) respond when the saga completes, (b) respond with an order id and let the client **poll** `GET /orders/{orderID}`, (c) respond with an order id and then **push an event (websocket or webhook)** when the saga completes.

**Observed.** The reference implementation, `microservice-patterns/ftgo-application` (https://github.com/microservice-patterns/ftgo-application, **3,777 stars**, Java, last push 2026-03-13, no root LICENSE file), implements orchestration-based sagas with explicit compensations. The files worth reading:

- `ftgo-order-service/src/main/java/net/chrisrichardson/ftgo/orderservice/sagas/createorder/CreateOrderSaga.java`. A declarative saga: `step().withCompensation(orderService.reject, …).step().invokeParticipant(consumerService.validateOrder, …).step().invokeParticipant(kitchenService.create, …).onReply(CreateTicketReply.class, …).withCompensation(kitchenService.cancel, …).step().invokeParticipant(accountingService.authorize, …).step().invokeParticipant(kitchenService.confirmCreate, …).step().invokeParticipant(orderService.approve, …).build()`
- `…/sagas/createorder/CreateOrderSagaState.java`. Saga state carried between steps
- `…/sagas/cancelorder/CancelOrderSaga.java` plus `CancelOrderSagaState.java`. The cancel path as its own saga
- `…/sagaparticipants/UndoBeginCancelCommand.java`, `ReverseOrderUpdateCommand.java`, `RejectOrderCommand.java`. The compensation commands themselves

**Observed.** The Go reference, `mehdihadeli/go-food-delivery-microservices` (https://github.com/mehdihadeli/go-food-delivery-microservices, **1,135 stars**, MIT, last push 2025-07-07), uses a **vertical-slice + event-sourced** layout. Files worth reading:

- `internal/services/orderservice/internal/orders/models/orders/aggregate/order.go`. Event-sourced aggregate: `*models.EventSourcedAggregateRoot`, an `Apply(event, true)` + `When(event)` pattern, and state held as **boolean flags** (`paid`, `submitted`, `completed`, `canceled`, `cancelReason`) rather than a status enum.
- `internal/services/orderservice/internal/orders/features/creating_order/v1/…` and `…/features/submitting_order/v1/…`. One directory per command, each with `commands/`, `dtos/`, `endpoints/`, `events/domain_events/`, `events/integration_events/`
- `internal/services/orderservice/internal/orders/projections/mongo_order_projection.go` and `elastic_order_projection.go`. Read models fed by events
- `internal/services/orderservice/internal/orders/features/creating_order/v1/events/integration_events/order_created.go`. The integration event envelope

**Inferred.** The Go repo's boolean flags are a weak model for the laundry MVP. You cannot answer "which states are terminal" or "what is the customer-visible status" from them. The repo's existing `OrderStatus` enum is better. But the **vertical-slice folder layout** and the **separate domain-events / integration-events split** are worth copying.

**Observed (a second, closer reference).** `mehdihadeli/food-delivery-microservices` (https://github.com/mehdihadeli/food-delivery-microservices, **1,014 stars**, MIT, last push 2026-10-14, C#/.NET 10 + Aspire + Wolverine) is the most active of the three. Worth reading:

- `docs/eventcatalog/domains/FoodDelivery/index.mdx` and `docs/eventcatalog/domains/FoodDelivery/subdomains/<Domain>/services/<Service>/events/<Event>V1/{index.mdx,schema.json}`. A machine-readable **event catalog**: every domain event has a versioned JSON Schema. This is the single most borrowable artefact in the whole survey for the repo's `packages/contracts/src/events.ts`.
- `src/Services/Orders/FoodDelivery.Services.Orders/Orders/Models/Order.cs`. **This is a stub**: `Create()` returns an order with a `// TODO: Complete order domain model` comment. Do not treat this repo as a source of order-state-machine truth.
- `src/Services/Orders/FoodDelivery.Services.Orders/Orders/Models/Reads/OrderReadModel.cs` and `…/Shared/Data/OrdersDbContext.cs`. CQRS split of write model and read model.
- `src/Services/Shippings/FoodDelivery.Services.Shippings/FoodDelivery.Services.Shippings/Class1.cs`. The shipping and delivery service is **also a stub**.

**Observed.** `aws-samples/delivery-routes-optimization-for-logistics` (https://github.com/aws-samples/delivery-routes-optimization-for-logistics, **33 stars**, MIT-0, TypeScript, last push 2026-09-10) is the AWS sample for delivery dispatch. Its Lambda layout is worth reading as a decomposition reference: `apps_infra/lambda/api-order/create-order-batch/index.ts`, `…/api-order/start-order-dispatch-task/index.ts`, `…/api-web/customer-location-manager/index.ts`, `…/api-web/vehicle-manager/index.ts`, `…/api-web/warehouse-manager/index.ts`, `…/api-web/distance-cache-query/index.ts`, `…/api-web/solver-job-query/index.ts`.

**Reference implementations to cite in design discussions (patterns, not code to copy):**

- Saga pattern: https://microservices.io/patterns/data/saga.html
- Transactional Outbox: https://microservices.io/patterns/data/transactional-outbox.html
- Database per Service: https://microservices.io/patterns/database-per-service.html
- Choreography saga example: https://github.com/eventuate-tram/eventuate-tram-examples-customers-and-orders
- Orchestration saga example: https://github.com/eventuate-tram/eventuate-tram-sagas-examples-customers-and-orders
- **The AWS "ordering microservices" reference architecture repo (`awslabs/aws-durable-micro-service-based-on-cdk`) returns HTTP 404 and is no longer available.** Do not link to it. The nearest live AWS references are `aws-samples/serverless-coffee` (245 stars, MIT-0, last push 2026-07-27) and `aws-samples/delivery-routes-optimization-for-logistics` above.

### 2.3 Event / audit tables

**Observed (this repo).** `packages/contracts/src/events.ts` already defines the envelope: `{eventId, eventType, schemaVersion, aggregateId, aggregateVersion, occurredAt, traceId, payload}` and `makeEnvelope()`. `aggregateVersion` + `expectedVersion` in `CommandMeta` (`packages/contracts/src/types.ts:260-264`) is the optimistic-concurrency primitive.

**Observed (Blinkit).** The tracking page is built from *server-computed* timeline data (`order_status_timeline_data`) and a *server-computed* status/ETA, not from a client-side event log. The client only ever learns "current status + ETA text + when to refresh".

**Inferred.** The MVP should keep a single append-only event table keyed by `(aggregate_id, aggregate_version)` and derive the customer-facing timeline from it, exactly like the repo's `DomainEvent` envelope intends. Then the "timeline" the customer sees is a projection of the event table, and the same table is the audit log.

**Observed (patterns for the table shape).** `order_status_history` tables are a widespread convention; a search of GitHub code returns many independent implementations, e.g. `nextdeveloper-nl/marketplace :: schemas/marketplace_order_status_history.sql`, `BrianPHL/seraphim-luxe-ecommerce :: sql/orders/order_status_history.sql`, `jussipalanen/jaladb :: database/migrations/0003_order_status_history.sql`. I did not open these files, so I cite them only as evidence that the convention exists, not as a shape to copy.

**Assumption.** The MVP's audit table is exactly the `DomainEvent` envelope plus two columns, `idempotency_key` (unique) and `actor_id`/`actor_role`, because the repo already requires `CommandMeta.idempotencyKey` and the AGENTS.md verification list calls out "duplicate payment/webhook replay".

### 2.4 Capacity, slots and promises

**Observed (Blinkit).** The site makes a delivery *promise*, not a delivery estimate: "Delivery in 11 minutes" on the home page and "Delivery in minutes*" on Zepto. Zepto's BFF call carries `show_new_eta_banner=true`; Blinkit has a dedicated `GET /v1/consumerweb/eta` endpoint and a `STATUS_CODE_ETA_BREACHED` code that tells the client the promise was missed.

**Observed (Blinkit).** `GET /visibility?latitude=…&longitude=…` returns whether a coordinate is serviceable; `GET /config/main` and `GET /api/feature-flags/receive` carry client configuration and flags; the `secondary-data` endpoint is filter-driven (`filter=new_offer,show_product_group_sharing,is_new_user,…`), i.e. the client asks for the flags it cares about by name.

**Observed (this repo).** The error vocabulary already anticipates capacity: `ErrorCode` includes `OUT_OF_AREA`, `NO_CAPACITY`, `DEADLINE_UNAVAILABLE` (`packages/contracts/src/types.ts:204-219`), and `Quote` carries `pickupWindow`, `promisedReturnWindow`, `expiresAt`, `version`, `provisional` (lines 74-87).

**Inferred.** The "capacity promise" in the laundry MVP has three distinct checks, and the repo already has a distinct error code for each:
1. *Is this address serviceable at all?* → `OUT_OF_AREA` (Blinkit's `/visibility`).
2. *Is there capacity in the requested window?* → `NO_CAPACITY` (this is the slot-reservation step, §4.3).
3. *Can we meet the deadline the customer was promised?* → `DEADLINE_UNAVAILABLE` (this is the ETA check, §4.7).

**Assumption.** Slot capacity should be held as a counted resource with a TTL, and the quote's `expiresAt` is the reservation's expiry. The repo's `Quote.expiresAt` and `provisional` flag map directly onto that.

### 2.5 Rider assignment

**Observed (this repo).** `DeliveryJob` already carries `dispatchMode: "PROVIDER" | "MANUAL"`, `capabilities: string[]`, `assignedTo?: Id`, `window: Window`, `bagIds: string[]`, `provider: string` (`packages/contracts/src/types.ts:157-171`). The `BOOKING_UNKNOWN` state in `DeliveryStatus` and the `PROVIDER_OUTCOME_UNKNOWN` error code are the repo's way of admitting that an external provider's answer may be unknown.

**Observed, Blinkit transport.** There is no rider-assignment API visible from the public web surface; assignment happens server-side. **Unknown.** Blinkit's actual assignment algorithm.

**Inferred from the public surface.** Blinkit's customer-facing tracking page receives a *single* `delivery_partner` widget plus a safety widget and a tip widget. That is one assigned partner per leg, not a bidding market, on the web at least.

**Observed (reference implementations).**

- `rohith-chitturi/DispatchX` (https://github.com/rohith-chitturi/DispatchX, **11 stars**, TypeScript, last push 2026-07-10, **no licence file**). The most directly borrowable dispatch design in the survey, and the cleanest code. Files worth reading:
  - `backend/src/services/LocationService.js`. Redis GEO as the live index: `GEOADD driver_locations lon lat driverId`; `ZREM driver_locations driverId` to take a driver off the map; `GEOSEARCH driver_locations FROMLONLAT lon lat BYRADIUS <radiusKm> km ASC COUNT <limit>` for nearest-driver search (the comment notes GEOSEARCH replaced the deprecated GEORADIUS in Redis 6.2+).
  - `backend/src/services/DispatchService.js`. Dispatch in four steps: (1) `SET request:<rideId> active EX 30` to give the offer a TTL; (2) `PUBLISH driver:<driverId>:requests <payload>` per candidate; (3) race resolution with a Redis distributed lock `SET lock:ride:<rideId> <driverId> NX EX 5`, then a **Postgres update guarded by a defensive `WHERE status = 'REQUESTED'` check** so a late click cannot double-assign; (4) `XADD stream:ride_events * event ACCEPTED rideId … driverId …` as an append-only event log, then release the lock only if still held.
  - `backend/src/websockets/socketHandler.js`. Socket.IO layer: a dedicated Redis subscriber client does `psubscribe('driver:*:requests')` and forwards each message to `io.to('driver_' + driverId).emit('ride_request', …)`. Drivers and customers join per-role/per-entity rooms (`driver_<id>`, `ride_<id>`). Location updates arrive on `location_update` and are echoed to the ride room as `driver_location_update`. On `disconnect`, the driver's GEO entry is removed so "ghost drivers" cannot be dispatched to.
  - `backend/database/init.sql`. Postgres source of truth: `CREATE TYPE ride_status AS ENUM ('REQUESTED','ACCEPTED','IN_PROGRESS','COMPLETED','CANCELLED')`, a `rides` table with `driver_id UUID REFERENCES users(id) ON DELETE SET NULL` (null until assigned), `status ride_status NOT NULL DEFAULT 'REQUESTED'`, `pickup_lat DECIMAL(10,8)`, `pickup_lon DECIMAL(11,8)`, and a **partial index** `CREATE INDEX idx_active_rides ON rides(status) WHERE status IN ('REQUESTED','ACCEPTED','IN_PROGRESS')` so the "is this user already on a ride" check stays cheap as history grows.
- `nammayatri/nammayatri` (https://github.com/nammayatri/nammayatri, **2,573 stars**, **AGPL-3.0**, Haskell backend, last push 2026-10-20). Uber's open "Namma Yatri" direct-to-driver platform. Read for *concepts*, not for code (AGPL, see §5):
  - `Backend/app/provider-platform/dynamic-offer-driver-app/Main/src/SharedLogic/External/LocationTrackingService/API/NearBy.hs`. The nearest-driver query service
  - `…/LocationTrackingService/API/DriverLocation.hs`, `DriversLocation.hs`, `PickupDriverLocation.hs`, `NearByTag.hs`. The location-tracking API surface
  - `…/Main/src/SharedLogic/Allocator/Jobs/…`. The "dynamic offer driver app" allocator, which is the matching engine
  - `Backend/dev/ddl-migrations/dynamic-offer-driver-app/0000-db-init.sql` and the 376 migrations in that directory, including `0052-move-geofencing-to-db.sql`, `0068-added-driver-availability-table.sql`, `0087-create-driver-flow-status-table.sql`, `0091-adding-uniq-constaint-on-driver-bucket.sql`
- `Ramitha-Silva/mageride` (https://github.com/Ramitha-Silva/mageride, **0 stars**, C#/Kotlin, last push 2026-08-31, **no licence**). It has the single best PostGIS presence table I found. See §3.1.

### 2.6 Reference implementations of the "food delivery clone" genre, and a warning

**Observed.** Searching GitHub for "zepto clone", "blinkit clone", "quick commerce" and "food delivery order state machine" turns up mostly small, unlicensed or zero-star projects. Two I checked and would **not** use:

- `dungnotnull/Crab-Transport-Food-Delivery-Platform` (https://github.com/dungnotnull/Crab-Transport-Food-Delivery-Platform, 4 stars, GPL-3.0). Its README claims "strict order state machine, PostGIS (ST_DWithin + GIST index), spatial driver matching, real-time GPS tracking via Socket.io". **The repository contains only 12 blobs**, all of them Markdown (`BUG-TRACKING.md`, `backend/DEVELOPMENT-TASK-BY-PHASES-TRACKING-LOGS.md`, `backend/ISSUES-LIST-TRACKING.md`). There is no code. The README describes a system that is not in the repo.
- `RatneshwarPandey12220865/Food-delivery-logistics-platform` (0 stars, no licence). README claims "real order state machine, Redis GEO-based courier dispatch, live GPS over WebSockets". Not opened in detail; treat claims as unverified.

**Inferred.** For this MVP, borrow *shapes* from the well-licensed references and write the laundry-specific code yourself. The clone genre is mostly README fiction.

---

## 3. Driver-map and live-location patterns worth borrowing

### 3.1 Where the live location lives

**Observed (three distinct answers in the wild, all real):**

1. **Redis GEO (hot path).** `rohith-chitturi/DispatchX`, `backend/src/services/LocationService.js`:
   `GEOADD driver_locations <lon> <lat> <driverId>` on every update, `ZREM driver_locations <driverId>` on disconnect/assignment, and `GEOSEARCH driver_locations FROMLONLAT <lon> <lat> BYRADIUS <km> km ASC COUNT <n>` for the candidate query. In-memory, sub-millisecond, no spatial index maintenance.
2. **PostGIS (durable path).** `Ramitha-Silva/mageride`, `db/migrations/0701__dispatch_driver_presence.sql` (read in full):
   ```sql
   CREATE TABLE IF NOT EXISTS dispatch.driver_presence (
     driver_id UUID PRIMARY KEY REFERENCES iam.users(id),
     vehicle_id UUID NOT NULL REFERENCES registry.vehicles(id),
     vehicle_type TEXT NOT NULL,
     state TEXT NOT NULL DEFAULT 'OFFLINE' CONSTRAINT ck_driver_presence_state
       CHECK (state IN ('OFFLINE','AVAILABLE','OFFERED','ON_RIDE')),
     geo GEOGRAPHY(POINT,4326),          -- last known position
     driver_home GEOGRAPHY(POINT,4326),  -- 30 km ST_DWithin job-board query
     last_seen_at TIMESTAMPTZ,
     updated_at TIMESTAMPTZ NOT NULL DEFAULT now());

   CREATE INDEX IF NOT EXISTS ix_presence_geo
     ON dispatch.driver_presence USING gist(geo) WHERE state = 'AVAILABLE';
   CREATE INDEX IF NOT EXISTS ix_presence_home
     ON dispatch.driver_presence USING gist(driver_home);
   ```
   Its own header comment states the design: *"Redis (`geo:drivers:available:{type}:{h3cell}`) is the hot candidate index; this table is the durable one and the source for the Job Board ST_DWithin query (D-06)."* The partial GIST index on `state = 'AVAILABLE'` keeps offered/on-ride/offline rows out of the index.
3. **Server-rendered map payload (no client-side GPS).** Blinkit, §1.2: the tracking page receives `map_data` for the delivery partner and the timeline, and renders them with the Google Maps JS API. The browser never computes the partner's position.

**Inferred.** Pattern 3 is what a laundry MVP should copy for the *customer* view (the customer must not compute anything, and the server owns the truth), and pattern 1+2 is what the *backend* should use for the *operations* view (you need the live fleet, not the customer's page).

### 3.2 Geospatial index choice

**Observed.** `uber/h3` (https://github.com/uber/h3, **6,634 stars**, Apache-2.0, C, last push 2026-10-20) is the hexagonal hierarchical geospatial index. `postgis/postgis` (https://github.com/postgis/postgis, **2,246 stars**, GPL-2.0, PL/pgSQL, last push 2026-10-20) is the spatial extension for Postgres.

**Inferred.** H3 is the right tool for *bucketing* (pre-aggregating "riders per cell" for cheap candidate selection and for capacity heatmaps); PostGIS is the right tool for *exact* distance and for the durable record. `mageride` uses exactly this pairing (Redis key includes an H3 cell; Postgres holds the point).

**Assumption for the MVP.** Skip H3 entirely at first. With a pilot fleet of tens of delivery partners, `ST_DWithin` on a GiST index is more than enough, and it removes a dependency. Introduce H3 only when the partner count makes point-in-radius queries expensive.

### 3.3 Transport for location reporting

**Observed. Blinkit, the biggest real operator in this survey.** The web tracking page **polls**: `setInterval(Re, F)` with `F = page_actions[].repeating_action.duration ?? response.refresh_interval ?? 10000` ms. There is no WebSocket and no EventSource in either Blinkit chunk. The server tells the client when to come back (`refreshAfterMs`, `refresh_interval`).

**Observed. The socket-based references.**
- `DispatchX` `backend/src/websockets/socketHandler.js`: Socket.IO. Driver → `location_update` (role-checked); server → Redis `GEOADD`; the server then fans out `driver_location_update` to the `ride_<rideId>` room. Redis Pub/Sub bridges the dispatch service to the socket server so the socket tier stays stateless.
- `Ritik5Prasad/Ride_Booking_Server` (https://github.com/Ritik5Prasad/Ride_Booking_Server, **97 stars**, MIT, JavaScript, last push 2025-02-22):
  - `controllers/sockets.js`. Socket.IO with a JWT handshake middleware (`socket.handshake.headers.access_token`), an in-memory `Map` of on-duty riders, per-rider rooms `rider_<id>` and per-ride rooms `ride_<id>`, and a **broadcast-on-change** model: every location update calls `updateNearbyriders()`, which re-computes the nearby-rider list for *every* connected customer and re-emits it. Customer-initiated search retries every 10 s up to `MAX_RETRIES = 20` (i.e. a 5-minute search window), and the ride is deleted if nobody accepts.
  - `utils/mapUtils.js`. A plain haversine implementation (`R = 6371`, radians, `2 * atan2(√a, √(1−a))`) plus a fare model with base fare, per-km rate and a minimum fare.
- `lalit999999/realtime-rider-location-tracting-application` (https://github.com/lalit999999/realtime-rider-location-tracting-application, **6 stars**, no licence, last push 2026-05-02). Express + Socket.IO + Apache Kafka + Leaflet. Files: `index.js`, `api/kafka/kafka-client.js`, `api/kafka/database-processor.js`, `api/models/LocationEvent.js`, `public/index.html`. **Warning.** It commits `api/kafka/service.key` and `api/kafka/service.cert` to the repo. Do not copy that practice, and do not copy this code (no licence).

**Inferred.** The split that works is:
- **Partner → server:** WebSocket, because it is a high-frequency, low-latency, always-on stream and the partner app wants push notifications for new jobs anyway.
- **Server → customer:** HTTP polling at 10 s (Blinkit's observed default) for the MVP, because a customer looking at a map for a few minutes does not need a socket, and polling is trivially cacheable, reconnectable and testable. Upgrade to SSE (or WebSocket) later if the product wants live "partner is 2 minutes away" nudges.

**Assumption.** The MVP uses WebSocket for the partner app and 10 s HTTP polling for the customer, exactly mirroring the observed Blinkit cadence.

### 3.4 Map library

**Observed.** Blinkit's web app uses the **Google Maps JS API** (`https://maps.googleapis.com/maps/api/js`, with `mapIds`, `libraries`, `region`, `nonce`, `authReferrerPolicy`).

**Observed.** The open-source references use **Leaflet** (`lalit999999/…` renders "Interactive Leaflet map with live location updates").

**Observed (this repo).** The laundry web app already depends on Leaflet: the Vite dev server in this worktree serves `node_modules/.pnpm/leaflet@1.9.4/…/leaflet.js` and `leaflet.css` (observed in the browser network log of the local dev server at `http://localhost:5175/`).

**Recommendation.** Use **Leaflet** for the MVP. It is already a dependency of the web app, it is MIT, it needs no API key, and it works with plain OSM tiles. Use a Google/Mapbox provider only when a commercial licence or a specific style is required. If a commercial tile provider is added, keep it behind a single tile-layer factory so it can be swapped.

### 3.5 ETA

**Observed.** Neither Blinkit nor Zepto computes ETA in the browser. Blinkit's tracking payload carries server-computed `etaText` (plus `statusText` and `refreshAfterMs`); the client renders it verbatim. Blinkit also has a dedicated `GET /v1/consumerweb/eta` endpoint and a `STATUS_CODE_ETA_BREACHED` code, so the server is the single authority on whether a promise was met.

**Observed.** `Ritik5Prasad/Ride_Booking_Server/utils/mapUtils.js` shows the minimal client-side geometric approach (haversine + a rate table), and `DispatchX` shows the server-side approach (Postgres is the source of truth, Redis is a cache).

**Inferred.** For the laundry MVP, ETA should be a **server-side function of the delivery leg**, not a client computation and not a straight-line distance:
- straight-line distance is the *lower bound*; a real ETA needs a road-network distance or at least a speed model;
- the repo already separates pickup and return legs (`DeliveryLeg = "PICKUP" | "RETURN"`), and each leg needs its own ETA and its own promise;
- the repo's `Quote.promisedReturnWindow` is the promise, and `DEADLINE_UNAVAILABLE` is the failure.

**Assumption.** MVP ETA = straight-line distance (haversine) × a per-mode speed factor, with a per-leg buffer, computed on the server and stored on the delivery leg; recompute on every accepted location update that changes the distance materially (e.g. > 100 m).

### 3.6 Geospatial query shapes that exist in the wild

**Observed.** `gh search code '"ST_DWithin" "driver" language:SQL'` returns real implementations, e.g.:

- `Nap20192/ride-hail :: queries/driver.sql`
- `Ramitha-Silva/mageride :: db/migrations/0701__dispatch_driver_presence.sql` (read in full, quoted above)
- `areascript22/taxi-backend :: src/main/resources/db/migration/V5__driver_presence.sql`
- `Divyansh-0909/RCS-Travels-Website :: backend/prisma/migrations/20260813150000_driver_location_postgis/migration.sql`
- `mansuraananmita-wq/Pothik :: apps/backend/prisma/queries/nearby-drivers.sql`
- `nammayatri/nammayatri :: Backend/dev/ddl-migrations/dynamic-offer-driver-app/0828-add-special-location-geom-geojson.sql`

**I opened only the `mageride` file.** The others are listed as pointers, not as verified content.

---

## 4. What to implement in the MVP

Everything in this section is a **recommendation**. Where a real example exists it is cited; where it does not, the item is marked as my own design.

### 4.1 Order state machine

**Keep the repo's existing states.** `packages/contracts/src/types.ts:98-112` already defines a 14-state `OrderStatus` and a 10-state `DeliveryStatus` (`packages/contracts/src/types.ts:145-155`) with the legs separated. This matches the quick-commerce split observed in §2.1, and AGENTS.md already requires order, payment and delivery-leg states to stay separate.

**Add, per the observed Blinkit distinction:**

- A **terminal-state set** as a single exported constant, mirroring Blinkit's `S = ["DELIVERED","CANCELLED","DELIVERY_FAILED"]`:
  ```ts
  // packages/contracts/src/types.ts (new, additive)
  export const TERMINAL_ORDER_STATUSES = ["DELIVERED", "CANCELLED"] as const;
  export const TERMINAL_DELIVERY_STATUSES = ["COMPLETED", "FAILED", "CANCELLED"] as const;
  ```
  Blinkit has a third terminal state, `delivery_failed`, which the repo already has as `DeliveryStatus.FAILED`. Good match.
- A **`customerVisibleStatus`** projection per order, carried on the existing `order.updated.v1` event (`packages/contracts/src/events.ts:61-66`). Blinkit keeps internal states and customer-facing status separate; the repo already has the field.
- A **leg-level mirror of the order lifecycle**: the pickup leg and the return leg each need their own "live" flag so the customer-facing timeline can say "partner on the way" without inspecting order internals. `DeliveryStatus.ASSIGNED | AT_PICKUP | IN_TRANSIT` is the live set; `COMPLETED | FAILED | CANCELLED` is terminal.

**Transition table.** The repo's `guards.ts` (`packages/contracts/src/guards.ts`) is the right home for a transition map. Shape (my design, informed by Blinkit's observed order and by `DispatchX`'s Postgres enum):

```ts
export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  AWAITING_PAYMENT: ["CONFIRMED", "CANCEL_REQUESTED"],
  CONFIRMED: ["PICKUP_PENDING", "ON_HOLD", "CANCEL_REQUESTED"],
  PICKUP_PENDING: ["AT_FACILITY", "CANCEL_REQUESTED"],
  AT_FACILITY: ["IN_CARE"],
  IN_CARE: ["QUALITY_CHECK", "ON_HOLD"],
  QUALITY_CHECK: ["READY_FOR_RETURN", "AWAITING_ADJUSTMENT"],
  READY_FOR_RETURN: ["RETURNING"],
  RETURNING: ["DELIVERED", "AWAITING_ADJUSTMENT", "CANCEL_REQUESTED"],
  AWAITING_ADJUSTMENT: ["DELIVERED", "RETURNING"],
  ON_HOLD: ["CONFIRMED", "PICKUP_PENDING", "IN_CARE", "CANCEL_REQUESTED"],
  RESOLUTION_REQUIRED: ["AWAITING_ADJUSTMENT", "CANCELLED"],
  CANCEL_REQUESTED: ["CANCELLED", "CONFIRMED"],
  CANCELLED: [],
};
```

Every transition must be a **guarded command**, never a direct status write, because:
- AGENTS.md requires "stale quote/order versions" and "duplicate payment/webhook replay" to be verified;
- the repo's `CommandMeta.expectedVersion` exists for exactly this;
- the saga pattern (https://microservices.io/patterns/data/saga.html) requires that a step either completes or is compensated, not that state is poked.

### 4.2 Event / audit table shape

**Recommendation: one append-only table, `order_events`, keyed by `(aggregate_id, aggregate_version)`, written in the same transaction as the state change.** The envelope is already fixed by `packages/contracts/src/events.ts`; do not invent a second one.

```sql
-- Recommended (my design; envelope fields mirror packages/contracts/src/events.ts)
CREATE TABLE order_events (
  event_id          uuid PRIMARY KEY,                 -- from DomainEvent.eventId
  event_type        text        NOT NULL,             -- DomainEventType, e.g. 'order.confirmed.v1'
  schema_version    int         NOT NULL,             -- SCHEMA_VERSION = 1
  aggregate_type    text        NOT NULL,             -- 'order' | 'delivery_job' | 'payment'
  aggregate_id      uuid        NOT NULL,
  aggregate_version int         NOT NULL,
  occurred_at       timestamptz NOT NULL,
  trace_id          text        NOT NULL,
  actor_id          uuid,                             -- nullable for system transitions
  actor_role        text,                             -- Role from contracts/types.ts
  idempotency_key   text,                             -- CommandMeta.idempotencyKey
  payload           jsonb       NOT NULL,             -- DomainEvent.payload
  CONSTRAINT order_events_aggregate_version_uniq UNIQUE (aggregate_type, aggregate_id, aggregate_version)
);
CREATE INDEX order_events_aggregate_idx ON order_events (aggregate_type, aggregate_id, occurred_at);
CREATE UNIQUE INDEX order_events_idempotency_idx ON order_events (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
```

Why this shape:

- `aggregate_version` + the unique constraint give optimistic concurrency for free and match `DomainEvent.aggregateVersion` and `CommandMeta.expectedVersion` (`packages/contracts/src/types.ts:260-264`). **Inferred** from the contract, not from a cited implementation.
- The partial unique index on `idempotency_key` is the "duplicate payment/webhook replay" defence AGENTS.md asks for. **Inferred.**
- `payload jsonb` lets the table double as the audit log without a second schema per event type. The versioned per-event JSON Schemas in `mehdihadeli/food-delivery-microservices` under `docs/eventcatalog/domains/FoodDelivery/subdomains/*/services/*/events/*V1/schema.json` are the model for validating those payloads, if the repo later wants typed payload validation.
- **Outbox versus direct publish.** The Saga pattern page explicitly requires atomically updating the database *and* publishing a message. The MVP is a single Postgres instance, so write the event row in the same transaction as the state change and have a worker poll the table for un-published rows (the transactional-outbox pattern, https://microservices.io/patterns/data/transactional-outbox.html). Do not publish to a broker inside the transaction.

### 4.3 Capacity and slot reservation

**Recommendation: a counted, expiring reservation table; a quote holds the reservation.**

```sql
-- Recommended (my design)
CREATE TABLE facility_slots (
  facility_id  uuid        NOT NULL,
  slot_start   timestamptz NOT NULL,
  slot_end     timestamptz NOT NULL,
  capacity     int         NOT NULL CHECK (capacity >= 0),
  reserved     int         NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  PRIMARY KEY (facility_id, slot_start)
);

CREATE TABLE slot_reservations (
  id            uuid PRIMARY KEY,
  facility_id   uuid        NOT NULL,
  slot_start    timestamptz NOT NULL,
  slot_end      timestamptz NOT NULL,
  order_id      uuid        NOT NULL,
  quote_id      uuid        NOT NULL,
  units         int         NOT NULL CHECK (units > 0),
  state         text        NOT NULL CHECK (state IN ('HELD','COMMITTED','RELEASED','EXPIRED')),
  expires_at    timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX slot_reservations_active_idx ON slot_reservations (facility_id, slot_start)
  WHERE state = 'HELD';
```

Rules:

- A quote is **provisional** until payment is captured; the repo's `Quote.provisional` and `Quote.expiresAt` (`packages/contracts/src/types.ts:74-87`) are exactly the fields for this. While provisional, hold a `HELD` reservation that expires at `Quote.expiresAt`.
- On `payment.captured.v1` (an existing event type, `packages/contracts/src/events.ts:16`), promote `HELD → COMMITTED` in the same transaction as the order's `AWAITING_PAYMENT → CONFIRMED` transition.
- On quote expiry, a worker moves `HELD → EXPIRED` and decrements `reserved`. On `CANCEL_REQUESTED`/`CANCELLED`, release the committed reservation.
- If there is no room, the command fails with the repo's existing `ErrorCode.NO_CAPACITY` (`packages/contracts/src/types.ts:210`). Do not invent a new code.
- Serviceability of the address maps to `OUT_OF_AREA` and mirrors Blinkit's `/visibility?latitude=&longitude=` check (§2.4).

**Note on the repo's constraint.** AGENTS.md says "Order, payment and delivery-leg states are separate" and requires "timezone-qualified schedule windows" with integer minor-unit INR. The `Window` type (`packages/contracts/src/types.ts:14-18`) carries `start`, `end`, `timezone`. **Assumption.** `facility_slots.slot_start/slot_end` are stored as `timestamptz` and the *facility's* timezone is a separate column on the facility, because a slot boundary in local time is not the same instant across a DST transition.

### 4.4 Rider assignment algorithm

**Recommendation (MVP): nearest-available, with a soft hold, and a manual override.** The repo already provides `dispatchMode: "PROVIDER" | "MANUAL"` and `assignedTo?` on `DeliveryJob` (`packages/contracts/src/types.ts:157-171`), so both paths are in the contract.

Steps:

1. **Candidate query.** With a pilot fleet, use PostGIS:
   ```sql
   SELECT d.id,
          ST_Distance(d.last_location::geography,
                      ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) AS metres
   FROM delivery_partners d
   WHERE d.status = 'AVAILABLE'
     AND d.last_location IS NOT NULL
     AND ST_DWithin(d.last_location::geography,
                    ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
                    $3)
   ORDER BY metres
   LIMIT 5;
   ```
   with `last_location geography(Point, 4326)` and a GiST index, following `mageride`'s `ix_presence_geo` partial-index idea (§3.1). `ST_DWithin` is the function that `mageride`'s own comment and the GitHub code search results (§3.6) all point at.
2. **Availability filter.** Also filter on the partner's declared capabilities against the job's `capabilities` array, and on the partner's working hours vs the job `window`.
3. **Assignment must be race-safe.** Follow `DispatchX`'s pattern exactly: a conditional update that only succeeds if the job is still unassigned, e.g.
   ```sql
   UPDATE delivery_jobs
   SET assigned_to = $1, status = 'ASSIGNED', version = version + 1
   WHERE id = $2 AND version = $3 AND assigned_to IS NULL;
   ```
   and treat `rowCount = 0` as "someone else won the race" → re-run the candidate query. `DispatchX` does the equivalent in Postgres with a defensive `WHERE status = 'REQUESTED'` check while using a Redis `SET NX EX` lock for the offer window (`backend/src/services/DispatchService.js`). **Inferred.** With one Postgres instance, the conditional `UPDATE` alone is sufficient; add a Redis lock only when there is more than one API replica.
4. **The offer has a TTL.** `DispatchX` uses `SET request:<id> active EX 30` (30 s). For the MVP, a `HELD` slot on the partner with `expires_at` plus a job state that reverts to `REQUESTED` on expiry is enough. The repo's `DeliveryStatus.BOOKING_UNKNOWN` and `ErrorCode.PROVIDER_OUTCOME_UNKNOWN` are the right vocabulary for "we don't know if the provider accepted".
5. **Fallback is manual.** When no partner is found inside the radius, the job goes to an operator queue and `dispatchMode` becomes `MANUAL`. AGENTS.md already requires "pickup and return custody" verification, so the manual path is a first-class path, not an afterthought.

### 4.5 Location reporting transport

**Recommendation.**

| Path | Transport | Cadence | Where |
|---|---|---|---|
| Partner → server | **WebSocket** (Socket.IO) | every 3 to 5 s while on duty | `location_update` event, same shape as `DispatchX`'s `socket.on('location_update', {lon, lat, rideId})` |
| Server → customer | **HTTP polling** | 10 s | matches Blinkit's observed `refresh_interval` default of `1e4` ms |
| Server → operations | **WebSocket**, plus Postgres history | live | a per-fleet room |

- The WebSocket handshake must authenticate. `DispatchX` uses JWT via a `register` event with a `role` in the room name (`socket.join(\`${role.toLowerCase()}_${userId}\`)`); `Ride_Booking_Server` uses Socket.IO middleware with `socket.handshake.headers.access_token` and `jwt.verify`. **Recommendation.** Use Socket.IO middleware + the repo's existing session token, and put the partner in a `partner_<id>` room; never trust a client-supplied role.
- On disconnect, remove the partner from the live index (both references do this: `DispatchX` `removeDriver` on disconnect, `Ride_Booking_Server` deletes from `onDutyRiders`). **Recommendation.** Set the partner's presence row to `OFFLINE` and delete the Redis/Postgres "last location" or mark it stale via `last_seen_at`.
- Persist location history at a lower rate than you receive it (e.g. every 15 to 30 s or every 50 m). A full history table at 3 s cadence is write-amplification you do not need for the MVP. **Assumption.**

### 4.6 Map library

**Recommendation: Leaflet**, because the web app in this worktree already loads `leaflet@1.9.4` (observed in the local dev server's network log) and Leaflet is MIT.

- Render the partner marker from the **server's** `map_data`-equivalent payload (the Blinkit pattern, §1.2 / §3.1), so the customer view and the operations view cannot disagree.
- Put the tile provider behind one factory so OSM tiles can be swapped for a commercial provider without touching map code.
- If you later want a "no tiles" fallback for a restricted network, render the partner on a plain background. Do not fall back to a straight-line polyline, because a straight line between two points in a city is almost never the route and will be read as a bug.

### 4.7 ETA approach

**Recommendation: server-side, per leg, recomputed on meaningful movement, and returned to the client as text plus a machine-readable number.**

- Shape: `{ etaAt: ISO-8601 instant, etaText: "12 min", distanceMeters: number, confidence: "LOW"|"MEDIUM"|"HIGH" }` on the delivery leg.
- Distance: haversine for the MVP (`Ride_Booking_Server/utils/mapUtils.js` has a clean 10-line implementation) or `ST_Distance` on the server if the point is already in Postgres.
- Speed model: a per-mode constant plus a per-leg buffer, because straight-line distance is a lower bound. **Assumption.**
- Recompute trigger: when the accepted location changes the distance by more than ~100 m, or every 30 s, whichever is less frequent. **Assumption.**
- Promise semantics: the *promise* lives on the order/leg (`Quote.promisedReturnWindow`), and the *estimate* lives on the leg. When the estimate passes the promise, the server reports it. Blinkit does exactly this with `STATUS_CODE_ETA_BREACHED` (§1.2). The repo's `ErrorCode.DEADLINE_UNAVAILABLE` is the pre-acceptance failure, not the post-acceptance breach.
- Do not compute ETA in the browser. Blinkit does not; the client receives `etaText` and `refreshAfterMs` and renders them.

### 4.8 Suggested MVP file layout

Consistent with the repo's existing ownership rules (AGENTS.md: backend owns `apps/api`, `apps/worker`, `modules`; the contracts package is the shared wire boundary) and with the vertical-slice layout observed in `mehdihadeli/go-food-delivery-microservices` (§2.2):

```
modules/orders/            # order aggregate + transitions + events (write side)
modules/logistics/         # delivery legs, partner presence, assignment
modules/schema/migrations/ # the SQL above
packages/contracts/src/    # only additive changes: TERMINAL_*_STATUSES, transition map
apps/api/                  # HTTP handlers + customer polling endpoint
apps/worker/               # outbox publisher, reservation expiry, ETA recompute
```

**Do not** put partner location, ETA computation, or assignment logic in the contracts package. `packages/contracts/src/ports.ts` is the right place to declare the *interface* (e.g. `DeliveryLocationReporter`, `RiderAssignmentPort`) that `apps/api` depends on.

---

## 5. Licence and attribution notes

Copying or adapting anything below carries the stated licence obligations. Verify each licence file yourself before copying a single line; the values below are what the GitHub API reported on 2026-10-20.

| Repo | Licence (per GitHub API) | Safe to copy code? | Notes |
|---|---|---|---|
| `mehdihadeli/food-delivery-microservices` | MIT | Yes, with attribution | Best source of the **event-catalog** idea (`docs/eventcatalog/…`). Its `Order.cs` and `Shippings` service are stubs, so cite them as stubs. |
| `mehdihadeli/go-food-delivery-microservices` | MIT | Yes, with attribution | Best source of the **vertical-slice folder layout** and the domain-event/integration-event split. Its order aggregate uses boolean flags, not a status enum, so do not copy that. |
| `microservice-patterns/ftgo-application` | **NOASSERTION, no root LICENSE file** | **No.** Cite it; do not copy code. | The saga definitions are the canonical example. |
| `rohith-chitturi/DispatchX` | **No licence file** (GitHub API returned `null`) | **No.** Treat as inspiration only, or re-implement the same design. | This is the design most worth re-implementing: Redis GEO + offer TTL + `SET NX EX` lock + guarded Postgres update + `XADD` event stream. |
| `Ritik5Prasad/Ride_Booking_Server` | MIT | Yes, with attribution | The haversine helper (`utils/mapUtils.js`) is a clean 10-line reference. The `setInterval` re-broadcast pattern in `controllers/sockets.js` is O(customers) per location update, so **do not** copy that part. |
| `nammayatri/nammayatri` | **AGPL-3.0** | **No, for a closed-source product.** Read for concepts only. | AGPL's network-use clause is the risk: linking or adapting it in a server the users interact with over a network can trigger source-disclosure obligations. Do not copy. |
| `Ramitha-Silva/mageride` | **No licence file** | **No.** | Its `dispatch.driver_presence` DDL is a good *shape* to re-derive. Re-derive it. |
| `dungnotnull/Crab-Transport-Food-Delivery-Platform` | GPL-3.0 | **No** (and it has no code anyway) | README-only repo. |
| `lalit999999/realtime-rider-location-tracting-application` | **No licence file** | **No.** | Also commits Kafka TLS key and cert. Do not copy that practice under any licence. |
| `aws-samples/delivery-routes-optimization-for-logistics` | MIT-0 | Yes (MIT-0 is permissive, attribution appreciated not required) | Good decomposition reference. |
| `aws-samples/serverless-coffee` | MIT-0 | Yes | Ordering reference. |
| `postgis/postgis` | GPL-2.0 | Use as a **database extension**, not vendored code | PostGIS is normally installed from the distro/`postgis` image, so the GPL does not attach to your application code. |
| `uber/h3` | Apache-2.0 | Yes, with attribution + NOTICE | Optional; not needed for the MVP (§3.2). |
| `microservices.io` (Chris Richardson) | Text on the site; the FTGO code repo has no LICENSE | Cite the pattern; do not copy code | The saga/outbox/database-per-service pattern descriptions are the design reference. |
| Blinkit / Zepto bundles observed in §1 | Proprietary | **No.** | These were observed for behavioural understanding only. Do not copy Blinkit's or Zepto's JavaScript, endpoint shapes, or widget identifiers into the product. Treat the endpoint paths in §1.2 as evidence of *how such apps are shaped*, not as an API to integrate with. |
| `BandaySajid/harud` | No licence file | **No.** | Its haversine + availability-toggle model was read for confirmation only. |
| `RatneshwarPandey12220865/Food-delivery-logistics-platform`, `saikhurana98/swiggy-track`, `Misba9/QuickGroceries-Full` | No licence / not opened | **No** | Listed only to record that they were surveyed. |

Attribution format if you do copy MIT-licensed material: keep the upstream copyright notice and the MIT licence text with the copied files, and record the upstream repo + commit in the file header (e.g. `Adapted from rohith-chitturi/DispatchX`, but that repo has no licence, so re-implement it instead and cite it in a design note).

---

## 6. Open questions (Unknowns)

1. Zepto's `bff-gateway.zepto.com/lms/api/v2/get_page` **response shape**. Fetching it from the page context returned HTTP 202 with no JSON body. Unknown.
2. Blinkit's and Zepto's **server-side assignment algorithms** are not observable from the public web surface. Unknown.
3. Whether Blinkit's `crystal_track_order` response carries a **live coordinate stream** or only periodic snapshots. The client only reads `map_data`, so the cadence behind it is unknown; the observed client-side polling default is 10 s.
4. Zomato and Swiggy internal APIs. Not reached, because auth and serviceability are required. Unknown.
5. Whether `REPORT_ETA_BREACHED` / `STATUS_CODE_ETA_BREACHED` is a customer-visible state or only an internal banner flag in Blinkit. Unknown.
6. Whether the repo's `ON_HOLD` and `AWAITING_ADJUSTMENT` order states need a delivery-leg equivalent. This is a product decision, not a research finding.
