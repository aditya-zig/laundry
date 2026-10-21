# LaundryMate public reference investigation

Task: R01. Status: IMPLEMENTED with open unknowns recorded below.

Scope: the public web presence of LaundryMate (`https://laundrymate.in/`) and the public Android listing. This investigation is a reference study for Laundry's own product. It observed a competitor's public marketing surface and shipped client artifacts. It did not create an account, request an OTP, place an order, buy a subscription, send a message or perform any other action on a competitor account.

Raw captures, downloaded bundles and the REA run output live outside the product source tree, under `/tmp/opencode/research/laundrymate/`. Only the findings and the original requirements are committed.

## 1. Method and evidence classes

Every claim in this document carries one of four classes:

| Class | Meaning |
|---|---|
| `observed UI` | Read from the rendered page in a real browser during this task |
| `static client evidence` | Read from a downloaded, versioned client artifact without executing it |
| `inference` | A conclusion drawn from observed or static evidence, with the reasoning stated |
| `unknown` | Not established. Recorded as unknown rather than guessed |

Retrieval time for every capture: 21 October 2026, between 22:33 and 22:52 IST. The local clock was the capture clock; no server-provided timestamp was available for the public pages.

## 2. Artifact receipts

| Artifact | SHA-256 | Bytes | Note |
|---|---|---|---|
| `index.html` | see `raw/bundles/SHA256SUMS` and the capture directory | 27158 | The application shell. Every marketing route returns this same shell. |
| `main.c482e44bee468cc7.js` | `e80b201d4034faa9fc0ef13d94b1ac54e10c860f9a785dc044922cc181afe887` | 2822009 | Angular application bundle, obfuscated |
| `polyfills.b9bf094c64e9f4a1.js` | `ee16ce7e9d485423ba9bfb165bb286d2d1f91992ee435d6926a6abdae9d3d775` | 80984 | |
| `runtime.6663b288b98832ae.js` | `8454ab4de90388cd6dc51b69e9c08310688f1c901a48be14619cee379ecf751c` | 14366 | String-array obfuscation table lives here |
| `scripts.5c83cbb4dbb11a83.js` | `dc671a755221678d7242b14429993d277e9555fac5fc68a8aec64475745550b7` | 209727 | |
| `styles.cbffdb5eaa045b18.css` | `fa3f39b5971ff6d56d7ca4a1f2d140313f46a7abc97d8ab7a63738caac4333fc` | 53881 | |

The bundle names embed content hashes, so the same filenames identify the same bytes on the next fetch. That makes them usable as a version pin for repeat analysis.

## 3. Technology observations

| Finding | Class | Basis |
|---|---|---|
| The site is an Angular single-page application | `static client evidence` | The shell references `main.*.js`, `runtime.*.js`, `polyfills.*.js` and `scripts.*.js` with `ng-version` style attributes and `ngcontent` markers in the rendered DOM |
| The bundle is built by webpack and served from the site root | `static client evidence` | `runtime.*.js` contains webpack chunk-loading code and a `data-webpack` marker |
| The bundle is string-array obfuscated | `static client evidence` | `runtime.*.js` holds a large string array and a hex-index decoder; readable identifiers are absent from the bundle |
| The application is built on a third-party white-label platform | `static client evidence` | The bundle contains platform endpoints such as `api/lmapi/get-socialmedia/social_media_group`, `api/lmapi/get_contact/contact_details` and a `generic-settings` module |
| Google Maps is embedded with an API key | `static client evidence` | The bundle contains a `maps.googleapis.com/maps/api/js?key=` loader and a literal key |
| The Ionic component set is used | `observed UI` | The rendered DOM uses `ion-img`, `ion-icon` and `ion-app` elements |

The practical consequence: LaundryMate's own product logic is not readable as source, and it is not what Laundry should copy. What is reusable is the observed service taxonomy, the price-list structure and the membership shape.

## 4. Route and screen inventory

| Route | Class | Observed behavior |
|---|---|---|
| `/` | `observed UI` | Marketing home. Hero, why-us, services, membership table, testimonials, footer |
| `/our-services/wash-and-fold` | `observed UI` | Wash and fold detail page with a 19-item price grid, a four-step process, FAQ block and customer testimonials |
| `/our-services/wash-and-iron` | `observed UI` | Wash and iron detail page with a 42-item price grid |
| `/our-services/steam-iron` | `observed UI` | Steam iron detail page with a 44-item price grid |
| `/our-services/dry-clean` | `observed UI` | Dry clean detail page with a 45-item price grid |
| `/login` | `observed UI` | Mobile-number sign-in and sign-up entry |
| `/help-and-support` | `observed UI` | FAQ list plus a support ticket form |
| `/offers` | `observed UI` | Offers page. Header copy reads "The offers are on!" |
| `/content/about-us` | `observed UI` | Link present in the footer |
| `/content/careers` | `observed UI` | Link present in the footer |
| `/content/terms-condition` | `observed UI` | Link present in the footer |
| `/content/contact-us` | `observed UI` | Link present in the footer |
| `/laundry-blog/blog` | `observed UI` | Link present in the footer |
| `/laundry-blog/in-the-news` | `observed UI` | Link present in the footer |
| `/sustainability` | `observed UI` | Link present in the footer |
| `/membership` | `observed UI` | Redirects to `/`. Membership is a section on the home page, not its own route |
| `/services` | `observed UI` | Redirects to `/`. Services are a section on the home page |
| `/pricing` | `observed UI` | Redirects to `/`. The price list lives on each service page |
| `/signup` | `observed UI` | Redirects to `/`. Sign-up shares the mobile-number entry |
| Application navigation | `observed UI` | A service-page header shows: About us, Services, Price List, Membership, Offers, Blog, Sprint Store, Get the app, Sign in / Sign up |

## 5. The four services

`observed UI` from the home page service cards and the four service pages.

| LaundryMate name | Laundry service code | Page title observed |
|---|---|---|
| WASH + FOLD | `WASH_FOLD` | WASH & FOLD LAUNDRY SERVICE IN BENGALURU |
| WASH + IRON | `WASH_PRESS` | Wash and iron detail page |
| STEAM IRON | `PRESS_ONLY` | Steam iron detail page |
| DRY CLEAN | `DRY_CLEAN` | Dry clean detail page |

This is a one-to-one mapping against Laundry's four codes. It is the only part of the reference that maps cleanly, and it confirms that Laundry's four-code model is a reasonable public taxonomy.

## 6. Price list structure

`observed UI` from the four service pages.

LaundryMate prices per garment, not per kilogram. Every line has three parts:

1. A garment name, for example "Shirt Half Standard Pack".
2. A pack or treatment modifier: `Standard Pack`, `Premium Pack`, `Hanger Pack`, `Folded`, `Crease Front`, `Flat Front`.
3. An integer rupee price.

The modifier is the interesting part. "Shirt Half Standard Pack" and "Shirt Half Hanger Pack" are different products at different prices, because the customer chooses how the garment is returned: folded and bagged, or on a hanger. Dry clean carries the widest modifier spread, with leather at ₹800 and a Sherwani Hanger Pack at ₹650 against a ₹100 Muffler.

Observed wash and fold prices, complete list of 19:

| Garment | Price |
|---|---|
| Shirt Half Standard Pack | ₹25 |
| T-Shirt Half Standard Pack | ₹25 |
| Trousers Standard Pack | ₹40 |
| Jeans Standard Pack | ₹50 |
| Shorts Standard Pack | ₹30 |
| Jacket Hanger Pack | ₹150 |
| Half Jacket Standard Pack | ₹100 |
| Sweater Premium Pack | ₹75 |
| Kurta Standard Pack | ₹40 |
| Churidar/Pyjama Standard Pack | ₹40 |
| Sweatshirt Standard Pack | ₹75 |
| Trackpant Standard Pack | ₹40 |
| Muffler | ₹30 |
| Bathrobe Standard Pack | ₹100 |
| Dhoti Standard Pack | ₹50 |
| T-Shirt Full Standard Pack | ₹35 |
| Shirt Full Standard Pack | ₹30 |
| Jacket Standard Pack | ₹140 |
| Shalya Standard Pack | ₹30 |

Observed dry clean prices include: Shirt Half Premium Pack ₹130, T-Shirt Half Premium Pack ₹130, Trousers Flat Front Premium Pack ₹175, Jeans Flat Front Premium Pack ₹200, Shorts Flat Front Standard Pack ₹110, Coat or Blazer Hanger Pack ₹325, Ethnic Jacket Hanger Pack ₹250, Long Coat Hanger Pack ₹400, Sherwani Hanger Pack ₹650, Sherwani Plain Hanger Pack ₹550, Woolen Jacket Hanger Pack ₹275, Sweater Premium Pack ₹260, Kurta Premium Pack ₹160, Churidar or Pyjama Premium Pack ₹135, Sweatshirt Standard Pack ₹275, Trackpant Standard Pack ₹175, Muffler ₹100, Bathrobe Standard Pack ₹250, Dhoti Premium Pack ₹160, Pants Leather Hanger Pack ₹800, Jacket Leather Hanger Pack ₹800, Jacket Hanger Pack ₹275, T-Shirt Full Premium Pack ₹150, Trousers Crease Front Premium Pack ₹175, Jeans Crease Front Premium Pack ₹200, Shirt Half Hanger Pack ₹135, T-Shirt Half Hanger Pack ₹135, Shirt Full Premium Pack ₹155, Shirt Full Hanger Pack ₹160, T-Shirt Full Hanger Pack ₹160, Trousers Crease Front Hanger Pack ₹165, Trousers Flat Front Hanger Pack ₹180, Shirt Half Folded Standard Pack ₹130, Shirt Full Folded Standard Pack ₹140.

`inference`: the pack modifier is a separate catalog dimension from the garment. Laundry's current catalog has a service and a garment with one price. LaundryMate charges more for a hanger presentation and for a premium treatment of the same garment. Laundry's own catalog should keep garment, treatment and presentation separate, or it will lose the ability to charge for ironing a hanger versus folding a bag.

`inference`: the same garment can cost differently under different services. A "Shirt Half Premium Pack" at ₹130 in dry clean and a "Shirt Half Standard Pack" at ₹25 in wash and fold are different products, not one product with two prices. Laundry's rate card must therefore be keyed by service and garment, with the treatment inside the garment entry, exactly as `packages/contracts/src/v2/catalog.ts` models it with `garmentEligibility`.

## 7. Membership structure

`observed UI` from the home page membership table.

The product is called Club Ultimate. The tiers observed are:

| Plan | Price observed | Entitlement observed |
|---|---|---|
| ClubUltimate Breezz | Refundable deposit ₹1000, 12 months ₹1 | Up to 7 pickups per week, 12 free pickups per month, ₹25 per additional pickup from the 13th, guaranteed slot availability on the selected pickup days and slots |
| Monthly Bronze | ₹299 | Up to 2 pickups per week, item-based service charges with 2 pickups and deliveries free per week, monthly cashback up to 5% of the previous month spend, guaranteed slot availability |
| Monthly Silver | ₹599 | Up to 3 pickups per week, 3 pickups and deliveries free per week, 5% monthly cashback, guaranteed slot availability |
| Monthly Gold | ₹899 | Up to 5 pickups per week, 5 pickups and deliveries free per week, 5% monthly cashback, guaranteed slot availability |
| Monthly Platinum | ₹1199 | Up to 7 pickups per week, 7 pickups and deliveries free per week, guaranteed slot availability |
| Quarterly Bronze / Silver / Gold / Platinum | price not captured | Quarterly Gold additionally lists 4 free cloth wraps to keep items for pickup |
| Half Yearly Bronze / Silver / Gold / Platinum | price not captured | |
| Annual Bronze / Silver / Gold / Platinum | price not captured | |

`observed UI` structural findings that matter for Laundry:

- Membership has three axes: a cadence (monthly, quarterly, half-yearly, annual), a tier (Bronze, Silver, Gold, Platinum) and two families (the normal ClubUltimate and the Breezz plan).
- Entitlements are a mix of free pickup counts, weekly caps, slot guarantees, cashback percentages and free consumables such as cloth wraps.
- The slot guarantee is the part that touches Laundry's architecture directly. A membership that guarantees a slot means capacity reservation has to be aware of membership, and the guarantee has to be a promise the scheduling module can actually keep.

`inference`: Laundry's plan already reserves memberships, wallet credit, referrals and subscriptions as later candidates. This evidence supports keeping them out of the first production milestone. Membership pricing here is a commercial decision the founders have not made, and copying a competitor's tier ladder without Laundry's own unit economics would be a mistake. The value of this evidence is structural, not numerical.

## 8. Sign-in, support and offers

`observed UI` from `/login`, `/help-and-support` and `/offers`.

- Sign-in is a mobile number entry. The copy reads "Laundry piling up? Let's start" and "Please enter your mobile number to sign in / sign up", and continuing is stated to accept the terms and privacy policy. There is no observed password, social login or email entry on the public page.
- Support is a ticket form with a free-text "Describe your concern" field, an "Attach Images" control and a "Submit ticket" action, plus the email `care@laundrymate.in` and the phone number `080-4748 6688`.
- The offers page states that there is always a promo, a discount or a surprise offer running. No specific offer card was captured in the text layer, so the offer content itself is `unknown`.
- The home page states "You can even ask for reprocessing or a refund, no questions asked."
- The wash and fold page states a 24-hour turnaround, "a wash and fold service that delivers in 24 hours", and describes pickup in bags, transport in an electric van, facility processing and return in no-plastic packaging.

`inference`: the support flow with an image attachment maps cleanly onto Laundry's incident-plus-private-media flow. Laundry's B08 should support a customer attaching evidence to an incident from the customer app, and the media must be private and access-scoped.

`inference`: LaundryMate publicly promises reprocessing and refunds. Laundry's own policy is payment at return with a held process when the measured amount is higher. These are different promises, and Laundry must not adopt a public refund promise until the founders approve one.

## 9. Company identity

`observed UI` from the footer of every page.

New Age Consumer Services Pvt Ltd, 3rd Floor, 86, Karthik Nagar, Outer Ring Rd, Marathahalli, Bengaluru 560037. Email `care@laundrymate.in`. Phone `080-4748 6688`.

`inference`: the address is in Marathahalli, Bengaluru, which matches the Indiranagar-area pilot Laundry has been discussing. LaundryMate is therefore a direct competitor inside the intended launch area, and the "sprint store" and "Sprint Store" navigation entry suggests a physical retail location.

## 10. Explicit unknowns

| Unknown | Why it is unknown | What would resolve it |
|---|---|---|
| The in-app booking flow, the bag, the slot picker and the order tracking screen | The application screens behind the sign-in wall were never rendered | A separate authorized test account |
| The rider or delivery-partner application | No public artifact was found | A public artifact or an authorized account |
| The backend contract | The bundle is obfuscated and the API hosts were not observed at runtime | A runtime capture of the authenticated app |
| The Android application internals | No APK was supplied and no device was attached | A legitimately supplied APK plus a JDK and JADX |
| The membership checkout flow and the actual price of the quarterly, half-yearly and annual plans | The plan cards render prices that were not present in the captured text layer | A targeted capture of the membership table after its pricing elements hydrate |
| The offer contents | The offers page text layer held only the header copy | A capture after the offer cards hydrate |
| The garment catalog behind the price list, including which garments are eligible for which service | The public price grid does not state eligibility | The in-app catalog |
| Whether the 24-hour promise is enforced or aspirational | Only the marketing claim was observed | The in-app promised return window |

The REA static analysis of the client bundle timed out on the 2.8 MB obfuscated `main` bundle. The first run was given 300 seconds and returned `provider_timeout` with a retained partial Evidence record. A second run with a 900 second analysis timeout was still in flight when this document was written. The static findings in section 3 come from direct inspection of the downloaded artifacts, which is sufficient for the claims made there, and the REA outcome is recorded in the handoff rather than assumed.

## 11. Reference-to-Laundry feature matrix

| LaundryMate feature | Class | Laundry equivalent | Laundry decision |
|---|---|---|---|
| Four public services | `observed UI` | `WASH_FOLD`, `WASH_PRESS`, `PRESS_ONLY`, `DRY_CLEAN` | Adopt. The codes already match. |
| Per-garment price list | `observed UI` | Catalog garment eligibility plus a versioned rate card | Adopt the structure. Do not adopt the numbers. |
| Pack or treatment modifier on a garment | `observed UI` | Garment entry inside a service-scoped rate card | Adopt as a separate catalog dimension. |
| Hanger versus folded presentation | `observed UI` | Not present in the current catalog | Add as a presentation option on a garment line. |
| Per-piece pricing only | `observed UI` | `KG` and `PIECE` billing units | Keep both. Laundry is not limited to piece pricing. |
| Service-area restriction to Bengaluru | `observed UI` | Service area polygons in B03 | Adopt the concept. The boundary needs founder approval. |
| Slot guarantee from membership | `observed UI` | Capacity holds in B03 | Defer. Membership is a later candidate. |
| Mobile-number sign-in | `observed UI` | OTP identity in B01 | Adopt. Laundry must not ship the demo token. |
| Support ticket with image attachment | `observed UI` | Incidents with private evidence in B08 and media in B07 | Adopt. |
| Public 24-hour promise | `observed UI` | Promised return window in a quote | Do not copy the number. Use the configured turnaround per service. |
| Public no-questions-asked refund promise | `observed UI` | No equivalent | Do not adopt. Laundry's refund policy is a founder decision that is still open. |
| Cashback on prior month spend | `observed UI` | None | Defer with membership. |
| Membership cadences and tiers | `observed UI` | Memberships in the v2 contracts | Defer. Record the shape only. |
| Physical "Sprint Store" | `observed UI` | None | Out of scope for the first production milestone. |
| Four-step process narrative | `observed UI` | Customer journey copy in D01 and F01 | Adapt the idea, write Laundry's own copy. |
| No-plastic packaging claim | `observed UI` | None | Out of scope. |
| 100% electric van claim | `observed UI` | None | Out of scope. |

## 12. Prioritized requirements for Laundry

### Now, for the first production milestone

1. Keep the four service codes and make them the public taxonomy.
2. Price by garment inside a versioned rate card, with the treatment and the presentation as part of the garment entry rather than as a separate charge.
3. Support both `KG` and `PIECE` billing units in one basket, priced independently per line.
4. Keep the per-piece price grid readable on a phone, with the unit shown next to the number, because that is how the category works.
5. Let a customer attach evidence to a support request, and keep that evidence private to the customer and staff.
6. Sign in with a mobile number and a real OTP, with no demo path in production.

### Later, once the founders decide the commercial terms

7. Memberships with a cadence, a tier and a pickup entitlement.
8. A capacity guarantee for members, which means the availability module needs a membership-aware reservation rule.
9. Cashback, wallet credit and referrals.
10. A published turnaround promise derived from configured service turnaround, not a marketing constant.

## 13. Provenance ledger

| Finding id | Claim | Class | Source | Retrieved |
|---|---|---|---|---|
| LM-01 | Angular SPA with Ionic components | `static client evidence` | `main.*.js`, `index.html` | 21 Oct 2026 22:33 IST |
| LM-02 | String-array obfuscated bundle | `static client evidence` | `runtime.*.js` | 21 Oct 2026 22:35 IST |
| LM-03 | Third-party white-label platform endpoints | `static client evidence` | `main.*.js` | 21 Oct 2026 22:35 IST |
| LM-04 | Google Maps loader with a key | `static client evidence` | `main.*.js` | 21 Oct 2026 22:35 IST |
| LM-05 | Four service cards and their descriptions | `observed UI` | `https://laundrymate.in/` | 21 Oct 2026 22:41 IST |
| LM-06 | Four service detail routes and their price grids | `observed UI` | `/our-services/*` | 21 Oct 2026 22:47 IST |
| LM-07 | Membership table with tiers, prices and entitlements | `observed UI` | `https://laundrymate.in/` | 21 Oct 2026 22:41 IST |
| LM-08 | Mobile-number sign-in entry | `observed UI` | `https://laundrymate.in/login` | 21 Oct 2026 22:39 IST |
| LM-09 | Support ticket form with image attachment | `observed UI` | `https://laundrymate.in/help-and-support` | 21 Oct 2026 22:52 IST |
| LM-10 | Offers page header copy | `observed UI` | `https://laundrymate.in/offers` | 21 Oct 2026 22:52 IST |
| LM-11 | Refund and reprocessing promise | `observed UI` | `https://laundrymate.in/` | 21 Oct 2026 22:41 IST |
| LM-12 | Company address, email and phone | `observed UI` | Footer of every page | 21 Oct 2026 22:41 IST |
| LM-13 | Service-page navigation set | `observed UI` | `/our-services/wash-and-fold` | 21 Oct 2026 22:47 IST |
| LM-14 | 24-hour turnaround claim | `observed UI` | `/our-services/wash-and-fold` | 21 Oct 2026 22:47 IST |
| LM-15 | Android listing describes the same four services and a subscription offer | `observed UI` | Public Play Store listing, read during plan preparation on 21 Oct 2026 | 21 Oct 2026 21:40 IST |

## 14. Legal and ethical boundary

- No competitor account was created and no OTP was requested.
- No order, payment, subscription purchase or outbound message was performed.
- No private backend code, rider application or internal operations tooling was accessed.
- Downloaded client artifacts are reference evidence. They are not copied into the Laundry product source, and no competitor image, copy or asset is used in Laundry.
- The competitor's marketing claims are recorded as their claims, not as verified fulfillment behavior and not as Laundry promises.
